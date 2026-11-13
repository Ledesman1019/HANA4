-- =====================================================================
-- ERP HANA4 — Migración 0012: planilla pagada por Tesorería y notas de crédito parciales
--   1. Separación de funciones: Recursos Humanos prepara la planilla, pero el
--      pago (salida de dinero) lo registra Tesorería (permiso Crear de Finanzas).
--   2. Nota de crédito parcial: devolución de solo algunos productos (o parte de
--      sus cantidades). Reingresa el stock, revierte ingreso, IGV y costo de lo
--      devuelto, devuelve el dinero (o descuenta la deuda si fue al crédito) y
--      ajusta la comisión del vendedor si aún no se pagó.
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0011.
-- Es compatible con la versión anterior del ERP y de RLS Tools.
-- =====================================================================
begin;

-- ---------- 1. Planilla: la paga Tesorería ----------------------------
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

    select coalesce(sum(amount), 0) into v_comm from commissions
    where employee_id = e.id and status = 'generada' and payroll_id is null
      and (created_at at time zone v_tz)::date >= v_from and (created_at at time zone v_tz)::date < v_to;
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
      and (created_at at time zone v_tz)::date >= v_from and (created_at at time zone v_tz)::date < v_to;

    perform _post_entry(p_date, 'planilla', v_id::text, format('Pago de planilla %s · %s (%s)', p_period, e.full_name, v_number), v_branch,
      (select jsonb_agg(l) from (
        select _ln('6211', e.salary, 0, 'Sueldo ' || p_period, coalesce(e.cost_center_id, _cost_center('ADM'))) l where e.salary > 0
        union all
        select _ln('4111', v_comm, 0, 'Comisiones ' || p_period) where v_comm > 0
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

create or replace function void_payroll_payment(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v payroll_payments;
  v_today date;
begin
  if not can('finanzas', 'edit') then
    raise exception 'La anulación de pagos de planilla la registra Tesorería (permiso Editar de Finanzas)';
  end if;
  if coalesce(trim(p_reason), '') = '' or length(trim(p_reason)) < 5 then
    raise exception 'Indica el motivo de la anulación';
  end if;
  select * into v from payroll_payments where id = p_id for update;
  if not found then
    raise exception 'Pago no encontrado';
  end if;
  if v.status = 'anulado' then
    raise exception 'El pago ya está anulado';
  end if;
  v_today := (now() at time zone coalesce((select timezone from company_settings where id = 1), 'America/Lima'))::date;

  update payroll_payments set status = 'anulado', void_reason = trim(p_reason) where id = p_id;
  update commissions set payroll_id = null where payroll_id = p_id;
  perform _reverse_source('planilla', p_id::text, v_today, 'Anulación del pago de planilla ' || v.number);
  perform _audit('planilla.anulacion', 'colaborador', v.employee_id::text,
    format('Anuló el pago de planilla %s (%s). Motivo: %s', v.number, v.period, trim(p_reason)), '{}');
end;
$$;

-- Tesorería necesita ver a quién y cuánto paga
drop policy if exists employees_read on employees;
create policy employees_read on employees for select to authenticated
  using (can('rrhh', 'view') or can('finanzas', 'create') or profile_id = auth.uid());
drop policy if exists payroll_read on payroll_payments;
create policy payroll_read on payroll_payments for select to authenticated
  using (can('rrhh', 'view') or can('finanzas', 'view') or employee_id = my_employee_id());
drop policy if exists commissions_read on commissions;
create policy commissions_read on commissions for select to authenticated
  using (can('rrhh', 'view') or can('finanzas', 'create') or employee_id = my_employee_id());

-- ---------- 2. Notas de crédito parciales -----------------------------
-- Una venta puede tener varias notas de crédito parciales (o una total por anulación)
alter table e_documents drop constraint if exists e_documents_sale_id_kind_key;
create unique index if not exists e_documents_sale_kind_uq on e_documents (sale_id, kind) where kind <> 'nota_credito';
alter table e_documents add column if not exists scope text not null default 'total' check (scope in ('total', 'parcial'));
alter table e_documents add column if not exists refund_method text;

-- Emisión de boleta/factura: igual que antes, con el índice único parcial
create or replace function issue_e_document(p_sale uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_sale     sales;
  v_customer customers;
  v_id       uuid;
begin
  select * into v_sale from sales where id = p_sale;
  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if not (v_sale.cashier_id = auth.uid() or can('facturacion', 'create')) then
    raise exception 'Tu rol no puede emitir comprobantes electrónicos';
  end if;
  if v_sale.doc_type = 'ticket' then
    raise exception 'El ticket interno no se envía a SUNAT. Emite boleta o factura';
  end if;

  select id into v_id from e_documents where sale_id = p_sale and kind = v_sale.doc_type;
  if v_id is not null then
    return v_id;
  end if;

  if v_sale.customer_id is not null then
    select * into v_customer from customers where id = v_sale.customer_id;
  end if;

  insert into e_documents (sale_id, kind, number, branch_id, customer_doc_type, customer_doc_number, customer_name,
                           subtotal, tax, total, created_by)
  values (p_sale, v_sale.doc_type, v_sale.number, v_sale.branch_id,
          coalesce(v_customer.doc_type, ''), coalesce(v_customer.doc_number, ''), coalesce(v_customer.name, 'CLIENTE VARIOS'),
          v_sale.subtotal, v_sale.tax, v_sale.total, auth.uid())
  on conflict (sale_id, kind) where kind <> 'nota_credito' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from e_documents where sale_id = p_sale and kind = v_sale.doc_type;
  end if;
  return v_id;
end;
$$;

create table credit_note_items (
  id             uuid primary key default gen_random_uuid(),
  e_document_id  uuid not null references e_documents (id) on delete cascade,
  product_id     uuid not null references products (id),
  product_name   text not null,
  sku            text not null,
  quantity       numeric(14,3) not null check (quantity > 0),
  unit_price     numeric(12,2) not null,
  unit_cost      numeric(12,2) not null default 0,
  total          numeric(12,2) not null
);
create index credit_note_items_doc_idx on credit_note_items (e_document_id);
create index credit_note_items_product_idx on credit_note_items (product_id);

alter table credit_note_items enable row level security;
create policy credit_note_items_read on credit_note_items for select to authenticated
  using (exists (select 1 from e_documents d where d.id = e_document_id));
revoke all on credit_note_items from anon, authenticated;
grant select on credit_note_items to authenticated;

-- La anulación total ya no puede repetir lo devuelto con notas parciales
create or replace function issue_credit_note(p_sale uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_sale sales;
  v_doc  e_documents;
  v_id   uuid;
begin
  select * into v_sale from sales where id = p_sale;
  if not found or v_sale.status <> 'anulada' then
    raise exception 'Solo se emite nota de crédito total de una venta anulada';
  end if;
  if not (can('ventas', 'delete') or can('facturacion', 'create')) then
    raise exception 'Tu rol no puede emitir notas de crédito';
  end if;

  select * into v_doc from e_documents where sale_id = p_sale and kind in ('boleta', 'factura');
  if not found then
    return null;   -- la venta nunca tuvo comprobante electrónico: no hay nada que revertir
  end if;

  select id into v_id from e_documents where sale_id = p_sale and kind = 'nota_credito' and scope = 'total';
  if v_id is not null then
    return v_id;
  end if;

  insert into e_documents (sale_id, kind, scope, number, branch_id, customer_doc_type, customer_doc_number, customer_name,
                           subtotal, tax, total, reference_id, reason, created_by)
  values (p_sale, 'nota_credito', 'total',
          _next_number(v_sale.branch_id, 'nc_' || v_doc.kind, case v_doc.kind when 'factura' then 'FC' else 'BC' end),
          v_sale.branch_id, v_doc.customer_doc_type, v_doc.customer_doc_number, v_doc.customer_name,
          v_doc.subtotal, v_doc.tax, v_doc.total, v_doc.id, coalesce(v_sale.void_reason, 'Anulación de la operación'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Si ya hubo devoluciones parciales, la venta no se anula: se emite nota por lo que queda
create or replace function void_sale(p_sale uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sale sales;
  r      record;
begin
  if not can('ventas', 'delete') then
    raise exception 'Tu rol no puede anular ventas';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la anulación';
  end if;

  select * into v_sale from sales where id = p_sale for update;
  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_sale.status = 'anulada' then
    raise exception 'La venta ya está anulada';
  end if;
  if exists (select 1 from e_documents where sale_id = p_sale and kind = 'nota_credito' and scope = 'parcial') then
    raise exception 'La venta % ya tiene devoluciones parciales: emite una nota de crédito por los productos que quedan', v_sale.number;
  end if;

  for r in select product_id, quantity, unit_cost from sale_items where sale_id = p_sale order by product_id loop
    perform _move_stock(r.product_id, v_sale.branch_id, r.quantity, 'devolucion', r.unit_cost,
                        'sale', p_sale, 'Anulación ' || v_sale.number);
  end loop;

  update sales set status = 'anulada', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_sale;
end;
$$;

-- Lotes: una devolución reingresa a los lotes que salieron, pero solo hasta la
-- cantidad devuelta (antes asumía la venta completa)
create or replace function _lots_on_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_qty    numeric := abs(new.quantity);
  v_left   numeric;
  v_take   numeric;
  r        record;
  v_lot    text;
  v_expiry date;
begin
  if not exists (select 1 from products where id = new.product_id and track_lots) then
    return new;
  end if;

  if new.quantity < 0 then
    perform _consume_lots(new.id, new.product_id, new.branch_id, v_qty, new.type = 'venta');
    return new;
  end if;

  if new.type = 'compra' then
    select lot_number, expiry_date into v_lot, v_expiry from purchase_items
    where purchase_id = new.reference_id and product_id = new.product_id and lot_number is not null limit 1;
    perform _add_to_lot(new.id, new.product_id, new.branch_id, coalesce(v_lot, 'SIN LOTE'), v_expiry, v_qty);
  elsif new.type in ('devolucion', 'transferencia_entrada') then
    v_left := v_qty;
    for r in
      select lo.lot_number, lo.expiry_date, -lm.quantity as qty
      from stock_movements m
      join lot_movements lm on lm.stock_movement_id = m.id
      join lots lo on lo.id = lm.lot_id
      where m.reference_id = new.reference_id and m.product_id = new.product_id
        and m.type = case new.type when 'devolucion' then 'venta' else 'transferencia_salida' end
        and lm.quantity < 0
      order by lo.expiry_date desc nulls last
    loop
      exit when v_left <= 0;
      v_take := least(r.qty, v_left);
      perform _add_to_lot(new.id, new.product_id, new.branch_id, r.lot_number, r.expiry_date, v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      perform _add_to_lot(new.id, new.product_id, new.branch_id, 'SIN LOTE', null, v_left);
    end if;
  else
    perform _add_to_lot(new.id, new.product_id, new.branch_id, 'SIN LOTE', null, v_qty);
  end if;
  return new;
end;
$$;

-- Nota de crédito parcial: p_items [{product_id, quantity}], p_refund_method:
-- efectivo (sale de la caja abierta de quien la emite), tarjeta/yape/plin/transferencia
-- (cuenta bancaria). En ventas al crédito se descuenta de la deuda del cliente.
create function issue_partial_credit_note(p_sale uuid, p_items jsonb, p_reason text, p_refund_method text default null)
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

  -- Comisión del vendedor: se reduce en proporción, si todavía no se pagó
  select * into v_comm from commissions where sale_id = p_sale and status = 'generada' and payroll_id is null for update;
  if found and v_sale.subtotal > 0 then
    v_cut := least(v_comm.amount, round(v_comm.amount * v_sub / v_sale.subtotal, 2));
    if v_cut > 0 then
      update commissions set amount = amount - v_cut, base = greatest(base - v_sub, 0) where id = v_comm.id;
      perform _post_entry(v_date, 'comision', v_comm.id::text, 'Ajuste de comisión por ' || v_number, v_sale.branch_id,
        jsonb_build_array(_ln('4111', v_cut, 0), _ln('6212', 0, v_cut)));
    end if;
  end if;

  perform _audit('venta.nota_credito', 'venta', p_sale::text,
    format('Emitió la nota de crédito %s por %s de la venta %s. Motivo: %s', v_number,
           to_char(v_total, 'FM999G999G990D00'), v_sale.number, trim(p_reason)), '{}');
  return v_id;
end;
$$;

create or replace function schema_version()
returns int language sql immutable as $$ select 12 $$;

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
