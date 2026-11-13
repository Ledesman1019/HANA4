-- =====================================================================
-- ERP HANA4 — Migración 0013: reportes netos de devoluciones y comisiones ya pagadas
--   1. Los reportes de ventas (Panel, Reportes, Estado de resultados) restan las
--      notas de crédito parciales en la fecha de la devolución.
--   2. Si la comisión de una venta ya se pagó en planilla y luego hay una
--      devolución parcial, queda un ajuste negativo que se descuenta en la
--      próxima planilla del vendedor.
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0012.
-- Es compatible con la versión anterior del ERP.
-- =====================================================================
begin;

-- ---------- 1. Reportes netos de notas de crédito parciales ----------
-- Quien ve reportes o finanzas también ve las notas de crédito (para restarlas)
drop policy if exists e_documents_read on e_documents;
create policy e_documents_read on e_documents for select to authenticated
  using (can('facturacion', 'view') or can('reportes', 'view') or can('finanzas', 'view')
         or exists (select 1 from sales s where s.id = sale_id and s.cashier_id = auth.uid()));

-- Devoluciones parciales: una fila por producto devuelto, con la fecha local de la nota
create or replace view credit_note_lines with (security_invoker = true) as
  select d.id as e_document_id, d.sale_id, d.branch_id, d.refund_method,
         (d.created_at at time zone (select timezone from company_settings where id = 1))::date as day,
         ci.product_id, ci.product_name, ci.sku, ci.quantity, ci.total, ci.unit_cost * ci.quantity as cost
  from e_documents d
  join credit_note_items ci on ci.e_document_id = d.id
  where d.kind = 'nota_credito' and d.scope = 'parcial';
revoke all on credit_note_lines from anon;
revoke insert, update, delete on credit_note_lines from authenticated;
grant select on credit_note_lines to authenticated;

create or replace function report_sales_by_day(p_from date, p_to date, p_branch uuid default null)
returns table (day date, total numeric, cost numeric, tickets bigint)
language sql stable set search_path = public
as $$
  with tz as (select timezone from company_settings where id = 1),
  days as (select generate_series(p_from, p_to, interval '1 day')::date as day),
  agg as (
    select (s.created_at at time zone (select timezone from tz))::date as day,
           sum(s.total) as total, sum(s.cost_total) as cost, count(*) as tickets
    from sales s
    where s.status = 'completada'
      and (p_branch is null or s.branch_id = p_branch)
      and (s.created_at at time zone (select timezone from tz))::date between p_from and p_to
    group by 1
  ),
  nc as (
    select l.day, sum(l.total) as total, sum(l.cost) as cost
    from credit_note_lines l join sales s on s.id = l.sale_id
    where (p_branch is null or l.branch_id = p_branch) and l.day between p_from and p_to
    group by 1
  )
  select d.day, coalesce(a.total, 0) - coalesce(n.total, 0), coalesce(a.cost, 0) - coalesce(n.cost, 0), coalesce(a.tickets, 0)
  from days d left join agg a using (day) left join nc n using (day)
  order by d.day
$$;

create or replace function report_sales_breakdown(p_from date, p_to date, p_branch uuid default null, p_dimension text default 'payment_method')
returns table (label text, total numeric, tickets bigint)
language sql stable set search_path = public
as $$
  with base as (
    select
      case p_dimension
        when 'category' then coalesce(c.name, 'Sin categoría')
        when 'cashier' then coalesce(pr.full_name, '—')
        when 'branch' then b.name
        else s.payment_method
      end as label,
      case when p_dimension = 'category' then i.total else s.total end as total,
      s.id as sale_id
    from sales s
    join branches b on b.id = s.branch_id
    left join profiles pr on pr.id = s.cashier_id
    left join sale_items i on p_dimension = 'category' and i.sale_id = s.id
    left join products p on p.id = i.product_id
    left join categories c on c.id = p.category_id
    where s.status = 'completada'
      and (p_branch is null or s.branch_id = p_branch)
      and (s.created_at at time zone (select timezone from company_settings where id = 1))::date between p_from and p_to
  ),
  returns as (
    select
      case p_dimension
        when 'category' then coalesce(c.name, 'Sin categoría')
        when 'cashier' then coalesce(pr.full_name, '—')
        when 'branch' then b.name
        else s.payment_method
      end as label,
      -l.total as total
    from credit_note_lines l
    join sales s on s.id = l.sale_id
    join branches b on b.id = s.branch_id
    left join profiles pr on pr.id = s.cashier_id
    left join products p on p.id = l.product_id
    left join categories c on c.id = p.category_id
    where (p_branch is null or l.branch_id = p_branch) and l.day between p_from and p_to
  )
  select label, sum(total), count(distinct sale_id)
  from (select label, total, sale_id from base union all select label, total, null::uuid from returns) x
  group by 1
  order by 2 desc
$$;

create or replace function report_top_products(p_from date, p_to date, p_branch uuid default null, p_limit int default 10)
returns table (product_id uuid, name text, sku text, quantity numeric, total numeric, profit numeric)
language sql stable set search_path = public
as $$
  select x.product_id, max(x.name), max(x.sku), sum(x.quantity), sum(x.total), sum(x.profit)
  from (
    select i.product_id, i.product_name as name, i.sku, i.quantity, i.total, i.total - i.unit_cost * i.quantity as profit
    from sale_items i
    join sales s on s.id = i.sale_id
    where s.status = 'completada'
      and (p_branch is null or s.branch_id = p_branch)
      and (s.created_at at time zone (select timezone from company_settings where id = 1))::date between p_from and p_to
    union all
    select l.product_id, l.product_name, l.sku, -l.quantity, -l.total, -(l.total - l.cost)
    from credit_note_lines l join sales s on s.id = l.sale_id
    where (p_branch is null or l.branch_id = p_branch) and l.day between p_from and p_to
  ) x
  group by x.product_id
  having sum(x.quantity) > 0
  order by sum(x.total) desc
  limit greatest(p_limit, 1)
$$;

-- ---------- 2. Ajustes de comisión ya pagada ------------------------
alter table commissions add column if not exists kind text not null default 'venta' check (kind in ('venta', 'ajuste'));
alter table commissions add column if not exists note text not null default '';
alter table commissions drop constraint if exists commissions_sale_id_key;
create unique index if not exists commissions_sale_uq on commissions (sale_id) where kind = 'venta';

create or replace function sales_commission()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completada' and old.total = 0 and new.total > 0 then
    insert into commissions (sale_id, employee_id, base, rate, amount, created_at)
    select new.id, e.id, new.subtotal, e.commission_rate, round(new.subtotal * e.commission_rate / 100, 2), new.created_at
    from employees e
    where e.profile_id = coalesce(new.seller_id, new.cashier_id) and e.status <> 'cesado' and e.commission_rate > 0
    on conflict (sale_id) where kind = 'venta' do nothing;
  end if;
  if new.status = 'anulada' and old.status <> 'anulada' then
    update commissions set status = 'anulada' where sale_id = new.id;
  end if;
  return new;
end;
$$;

-- Un ajuste negativo se contabiliza al revés: baja el gasto y deja la deuda a favor de la empresa
create or replace function _post_commission(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c commissions;
  s sales;
begin
  select * into c from commissions where id = p_id;
  select * into s from sales where id = c.sale_id;
  if c.amount = 0 then
    return;
  end if;
  perform _post_entry(_local_date(c.created_at), 'comision', c.id::text,
    case when c.kind = 'ajuste' then 'Ajuste de comisión de la venta ' else 'Comisión de la venta ' end || s.number, s.branch_id,
    jsonb_build_array(
      _ln('6212', greatest(c.amount, 0), greatest(-c.amount, 0)),
      _ln('4111', greatest(-c.amount, 0), greatest(c.amount, 0))));
end;
$$;

create or replace function pay_payroll(p_period text, p_employees uuid[], p_method text, p_date date, p_note text default '')
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_tz     text;
  v_from   date;
  v_to     date;
  v_today  date;
  v_count  int := 0;
  v_id     uuid;
  v_branch uuid;
  v_comm   numeric;
  v_total  numeric;
  v_number text;
  e        employees;
begin
  if not can('finanzas', 'create') then
    raise exception 'El pago de la planilla lo registra Tesorería (permiso Crear de Finanzas)';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periodo inválido';
  end if;
  if p_method not in ('efectivo', 'transferencia') then
    raise exception 'Medio de pago inválido';
  end if;
  if p_employees is null or cardinality(p_employees) = 0 then
    raise exception 'Selecciona al menos un colaborador';
  end if;

  select coalesce(timezone, 'America/Lima') into v_tz from company_settings where id = 1;
  v_today := (now() at time zone v_tz)::date;
  v_from := (p_period || '-01')::date;
  v_to := (v_from + interval '1 month')::date;
  if p_date is null or p_date > v_today then
    raise exception 'La fecha de pago no puede ser futura';
  end if;
  if v_from > v_today then
    raise exception 'No se puede pagar un mes que aún no empieza';
  end if;

  for e in select * from employees where id = any(p_employees) order by full_name for update loop
    if e.status = 'cesado' then
      raise exception '% está cesado: no entra en la planilla', e.full_name;
    end if;
    if exists (select 1 from payroll_payments where employee_id = e.id and period = p_period and status = 'pagado') then
      raise exception 'La planilla de % para % ya está pagada', e.full_name, p_period;
    end if;

    -- Comisiones del mes + ajustes pendientes (devoluciones de ventas cuya comisión ya se pagó)
    select coalesce(sum(amount), 0) into v_comm from commissions
    where employee_id = e.id and status = 'generada' and payroll_id is null
      and (created_at at time zone v_tz)::date < v_to
      and ((created_at at time zone v_tz)::date >= v_from or kind = 'ajuste');
    v_total := e.salary + v_comm;
    if v_total <= 0 then
      raise exception '% no tiene sueldo ni comisiones por pagar en %', e.full_name, p_period;
    end if;

    v_branch := coalesce(e.branch_id, (select id from branches where active order by code limit 1));
    v_id := gen_random_uuid();
    v_number := _next_number(v_branch, 'planilla', 'PL');
    insert into payroll_payments (id, number, employee_id, branch_id, period, salary, commissions, total, method, paid_at, note, created_by)
    values (v_id, v_number, e.id, v_branch, p_period, e.salary, v_comm, v_total, p_method, p_date, coalesce(trim(p_note), ''), auth.uid());

    update commissions set payroll_id = v_id
    where employee_id = e.id and status = 'generada' and payroll_id is null
      and (created_at at time zone v_tz)::date < v_to
      and ((created_at at time zone v_tz)::date >= v_from or kind = 'ajuste');

    perform _post_entry(p_date, 'planilla', v_id::text, format('Pago de planilla %s · %s (%s)', p_period, e.full_name, v_number), v_branch,
      (select jsonb_agg(l) from (
        select _ln('6211', e.salary, 0, 'Sueldo ' || p_period, coalesce(e.cost_center_id, _cost_center('ADM'))) l where e.salary > 0
        union all
        select _ln('4111', v_comm, 0, 'Comisiones ' || p_period) where v_comm > 0
        union all
        select _ln('4111', 0, -v_comm, 'Descuento de comisiones ' || p_period) where v_comm < 0
        union all
        select _ln(case p_method when 'efectivo' then '1011' else '1041' end, 0, v_total)
      ) x));

    perform _audit('planilla.pago', 'colaborador', e.id::text,
      format('Pagó la planilla %s de %s: %s (sueldo %s + comisiones %s)', p_period, e.full_name,
             to_char(v_total, 'FM999G999G990D00'), to_char(e.salary, 'FM999G999G990D00'), to_char(v_comm, 'FM999G999G990D00')), '{}');
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No se encontró a los colaboradores seleccionados';
  end if;
  return v_count;
end;
$$;

create or replace function issue_partial_credit_note(p_sale uuid, p_items jsonb, p_reason text, p_refund_method text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_sale     sales;
  v_doc      e_documents;
  v_id       uuid := gen_random_uuid();
  v_number   text;
  v_factor   numeric;
  v_rate     numeric;
  v_total    numeric := 0;
  v_cost     numeric := 0;
  v_sub      numeric;
  v_tax      numeric;
  v_method   text;
  v_session  cash_sessions;
  v_comm     commissions;
  v_cut      numeric;
  v_date     date;
  v_lines    jsonb := '[]'::jsonb;
  r          record;
  l          record;
  v_sold     numeric;
  v_returned numeric;
  v_price    numeric;
  v_line     numeric;
begin
  if not (can('ventas', 'delete') or can('facturacion', 'create')) then
    raise exception 'Tu rol no puede emitir notas de crédito';
  end if;
  if coalesce(trim(p_reason), '') = '' or length(trim(p_reason)) < 5 then
    raise exception 'Indica el motivo de la nota de crédito';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige los productos que se devuelven';
  end if;

  select * into v_sale from sales where id = p_sale for update;
  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_sale.status <> 'completada' then
    raise exception 'La venta % está anulada', v_sale.number;
  end if;
  select * into v_doc from e_documents where sale_id = p_sale and kind in ('boleta', 'factura');
  if not found then
    raise exception 'La venta % no tiene comprobante electrónico: emítelo antes de la nota de crédito', v_sale.number;
  end if;

  -- Precio efectivo de cada línea (si la venta tuvo descuento global, se prorratea)
  select v_sale.total / nullif(sum(total), 0) into v_factor from sale_items where sale_id = p_sale;
  v_factor := coalesce(v_factor, 1);
  v_date := _local_date(now());

  for r in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::numeric) as quantity
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    continue when r.quantity is null or r.quantity <= 0;
    -- Lo vendido de ese producto en la venta (precio y costo promedio de la venta)
    select max(si.product_name) as name, max(si.sku) as sku, sum(si.quantity) as sold,
           sum(si.total) / sum(si.quantity) as price, sum(si.unit_cost * si.quantity) / sum(si.quantity) as cost
    into l from sale_items si where si.sale_id = p_sale and si.product_id = r.product_id;
    v_sold := coalesce(l.sold, 0);
    if v_sold = 0 then
      raise exception 'Uno de los productos no está en la venta %', v_sale.number;
    end if;
    select coalesce(sum(ci.quantity), 0) into v_returned
    from credit_note_items ci join e_documents d on d.id = ci.e_document_id
    where d.sale_id = p_sale and d.kind = 'nota_credito' and ci.product_id = r.product_id;
    if r.quantity > v_sold - v_returned then
      raise exception 'Solo quedan % unidades por devolver de «%»', trim_scale(v_sold - v_returned), l.name;
    end if;
    v_price := round(l.price * v_factor, 2);
    v_line := round(r.quantity * l.price * v_factor, 2);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', r.product_id, 'name', l.name, 'sku', l.sku,
                 'quantity', r.quantity, 'price', v_price, 'cost', round(l.cost, 2), 'total', v_line));
    v_total := v_total + v_line;
    v_cost := v_cost + round(r.quantity * l.cost, 2);
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Indica cuántas unidades se devuelven';
  end if;

  select tax_rate into v_rate from company_settings where id = 1;
  v_sub := round(v_total / (1 + coalesce(v_rate, 18) / 100), 2);
  v_tax := v_total - v_sub;

  -- Cómo vuelve el dinero
  if v_sale.payment_method = 'credito' then
    v_method := 'credito';
    if v_total > v_sale.total - v_sale.amount_paid + 0.005 then
      raise exception 'La devolución (%) supera la deuda pendiente de la venta (%): registra la devolución del dinero aparte',
        v_total, v_sale.total - v_sale.amount_paid;
    end if;
  else
    v_method := coalesce(nullif(trim(p_refund_method), ''), v_sale.payment_method);
    if v_method not in ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia') then
      raise exception 'Medio de devolución inválido';
    end if;
    if v_method = 'efectivo' then
      select * into v_session from cash_sessions
      where opened_by = auth.uid() and status = 'abierta' and branch_id = v_sale.branch_id for update;
      if not found then
        raise exception 'Para devolver en efectivo abre tu caja en %', (select name from branches where id = v_sale.branch_id);
      end if;
      if v_total > cash_session_expected(v_session.id) then
        raise exception 'No hay efectivo suficiente en caja para devolver %', v_total;
      end if;
    end if;
  end if;

  v_number := _next_number(v_sale.branch_id, 'nc_' || v_doc.kind, case v_doc.kind when 'factura' then 'FC' else 'BC' end);
  insert into e_documents (id, sale_id, kind, scope, number, branch_id, customer_doc_type, customer_doc_number, customer_name,
                           subtotal, tax, total, reference_id, reason, refund_method, created_by)
  values (v_id, p_sale, 'nota_credito', 'parcial', v_number, v_sale.branch_id, v_doc.customer_doc_type, v_doc.customer_doc_number,
          v_doc.customer_name, v_sub, v_tax, v_total, v_doc.id, trim(p_reason), v_method, auth.uid());
  insert into credit_note_items (e_document_id, product_id, product_name, sku, quantity, unit_price, unit_cost, total)
  select v_id, (x ->> 'product_id')::uuid, x ->> 'name', x ->> 'sku', (x ->> 'quantity')::numeric,
         (x ->> 'price')::numeric, (x ->> 'cost')::numeric, (x ->> 'total')::numeric
  from jsonb_array_elements(v_lines) x;

  -- Stock de vuelta (a los mismos lotes de la venta)
  for r in select product_id, quantity, unit_cost from credit_note_items where e_document_id = v_id order by product_id loop
    perform _move_stock(r.product_id, v_sale.branch_id, r.quantity, 'devolucion', r.unit_cost, 'sale', p_sale, 'Nota de crédito ' || v_number);
  end loop;

  -- Dinero
  if v_method = 'credito' then
    update sales set amount_paid = amount_paid + v_total,
                     credit_status = case when amount_paid + v_total >= total - 0.005 then 'pagada' else 'parcial' end
    where id = p_sale;
  elsif v_method = 'efectivo' then
    insert into cash_movements (cash_session_id, type, amount, concept, created_by)
    values (v_session.id, 'egreso', v_total, 'Devolución ' || v_number || ' (venta ' || v_sale.number || ')', auth.uid());
  end if;

  -- Contabilidad: revierte ingreso e IGV de lo devuelto, y su costo
  perform _post_entry(v_date, 'nota_credito', v_id::text, format('Nota de crédito %s · venta %s', v_number, v_sale.number), v_sale.branch_id,
    jsonb_build_array(
      _ln('7011', v_sub, 0),
      _ln('40111', v_tax, 0),
      _ln(case when v_method = 'credito' then '1212' else _cash_account(v_method) end, 0, v_total)));
  if v_cost > 0 then
    perform _post_entry(v_date, 'nota_credito', v_id::text, format('Costo devuelto %s · venta %s', v_number, v_sale.number), v_sale.branch_id,
      jsonb_build_array(_ln('2011', v_cost, 0), _ln('6911', 0, v_cost)));
  end if;

  -- Comisión del vendedor, en proporción a lo devuelto: si aún no se pagó se reduce;
  -- si ya se pagó en planilla, queda un ajuste negativo que se descuenta en la próxima
  select * into v_comm from commissions where sale_id = p_sale and kind = 'venta' and status = 'generada' for update;
  if found and v_sale.subtotal > 0 then
    v_cut := round(v_comm.rate * v_sub / 100, 2);
    if v_comm.payroll_id is null then
      v_cut := least(v_comm.amount, v_cut);
      if v_cut > 0 then
        update commissions set amount = amount - v_cut, base = greatest(base - v_sub, 0) where id = v_comm.id;
        perform _post_entry(v_date, 'comision', v_comm.id::text, 'Ajuste de comisión por ' || v_number, v_sale.branch_id,
          jsonb_build_array(_ln('4111', v_cut, 0), _ln('6212', 0, v_cut)));
      end if;
    elsif v_cut > 0 then
      insert into commissions (sale_id, employee_id, base, rate, amount, kind, note)
      values (p_sale, v_comm.employee_id, -v_sub, v_comm.rate, -v_cut, 'ajuste',
              format('Devolución %s de la venta %s (comisión ya pagada en planilla)', v_number, v_sale.number));
    end if;
  end if;

  perform _audit('venta.nota_credito', 'venta', p_sale::text,
    format('Emitió la nota de crédito %s por %s de la venta %s. Motivo: %s', v_number,
           to_char(v_total, 'FM999G999G990D00'), v_sale.number, trim(p_reason)), '{}');
  return v_id;
end;
$$;

create or replace function schema_version()
returns int language sql immutable as $$ select 13 $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke execute on function sales_set_seller() from authenticated;
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
