-- =====================================================================
-- ERP HANA4 — Migración 0006: ciclo comercial (SAP SD)
--
--   Cotización → Venta → Comprobante → Cobro
--
--   1. Cotizaciones con precio congelado y vigencia
--   2. Ventas al crédito con línea de crédito por cliente
--   3. Cuentas por cobrar: cobros totales o parciales
--
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0005.
-- Es compatible con la versión anterior de la aplicación: puede ejecutarse
-- antes de desplegar el código nuevo sin interrumpir el servicio.
-- =====================================================================
begin;

-- ---------- Módulo nuevo ----------------------------------------------
insert into app_modules (key, label, sort) values ('cuentas_cobrar', 'Cuentas por cobrar', 45);
insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) values
  ('gerente',  'cuentas_cobrar', true, true, true, false),
  ('contador', 'cuentas_cobrar', true, true, false, false)
on conflict (role_id, module) do nothing;

-- ---------- Línea de crédito del cliente ------------------------------
alter table customers
  add column credit_limit numeric(12,2) not null default 0 check (credit_limit >= 0),   -- 0 = solo contado
  add column credit_days  int not null default 0 check (credit_days between 0 and 365);

-- Solo quien administra el crédito puede concederlo o cambiarlo; queda en la auditoría
create function protect_customer_credit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (new.credit_limit <> 0 or new.credit_days <> 0) and auth.uid() is not null and not can('cuentas_cobrar', 'edit') then
      raise exception 'Tu rol no puede conceder crédito a clientes';
    end if;
    return new;
  end if;
  if new.credit_limit is distinct from old.credit_limit or new.credit_days is distinct from old.credit_days then
    if auth.uid() is not null and not can('cuentas_cobrar', 'edit') then
      raise exception 'Tu rol no puede modificar la línea de crédito de un cliente';
    end if;
    perform _audit('cobro.credito', 'cliente', new.id::text,
      format('Cambió la línea de crédito de %s: de %s a %s (plazo de %s a %s días)', new.name,
             to_char(old.credit_limit, 'FM999G999G990D00'), to_char(new.credit_limit, 'FM999G999G990D00'), old.credit_days, new.credit_days), '{}');
  end if;
  return new;
end;
$$;
create trigger customers_credit before insert or update on customers
  for each row execute function protect_customer_credit();

-- ---------- Cotizaciones ----------------------------------------------
create table quotations (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  branch_id   uuid not null references branches (id),
  customer_id uuid references customers (id),
  valid_until date not null,
  status      text not null default 'vigente' check (status in ('vigente', 'aceptada', 'anulada')),
  subtotal    numeric(12,2) not null default 0,
  discount    numeric(12,2) not null default 0,
  tax         numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0,
  note        text not null default '',
  sale_id     uuid references sales (id),
  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now()
);
create index quotations_idx on quotations (branch_id, created_at desc);

create table quotation_items (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations (id) on delete cascade,
  product_id   uuid not null references products (id),
  product_name text not null,
  sku          text not null,
  quantity     numeric(14,3) not null check (quantity > 0),
  unit_price   numeric(12,2) not null,           -- precio congelado al cotizar
  total        numeric(12,2) not null
);
create index quotation_items_idx on quotation_items (quotation_id);

-- ---------- Ventas al crédito -----------------------------------------
alter table sales drop constraint sales_payment_method_check;
alter table sales add constraint sales_payment_method_check
  check (payment_method in ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia', 'credito'));
alter table sales
  add column due_date      date,                                    -- solo ventas al crédito
  add column amount_paid   numeric(12,2) not null default 0,
  add column credit_status text check (credit_status in ('pendiente', 'parcial', 'pagada')),
  add column quotation_id  uuid references quotations (id);
create index sales_credit_idx on sales (due_date) where credit_status in ('pendiente', 'parcial');

create table customer_payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references sales (id),
  amount     numeric(12,2) not null check (amount > 0),
  method     text not null check (method in ('efectivo', 'transferencia', 'tarjeta', 'yape', 'plin', 'cheque')),
  paid_at    date not null,
  reference  text not null default '',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index customer_payments_sale_idx on customer_payments (sale_id);

-- Deuda vigente de un cliente (ventas al crédito sin cancelar)
create function customer_debt(p_customer uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(total - amount_paid), 0) from sales
  where customer_id = p_customer and status = 'completada' and credit_status in ('pendiente', 'parcial')
$$;

-- Crédito disponible de los clientes con línea (para el punto de venta: el
-- vendedor no ve las ventas de otros, pero sí necesita saber cuánto le queda al cliente)
create function customer_credit_status()
returns table (customer_id uuid, debt numeric, overdue boolean)
language sql stable security definer set search_path = public
as $$
  select c.id,
         coalesce(sum(s.total - s.amount_paid), 0),
         coalesce(bool_or(s.due_date < (now() at time zone (select timezone from company_settings where id = 1))::date), false)
  from customers c
  left join sales s on s.customer_id = c.id and s.status = 'completada' and s.credit_status in ('pendiente', 'parcial')
  where c.active and c.credit_limit > 0 and (can('ventas', 'create') or can('cuentas_cobrar', 'view'))
  group by c.id
$$;

-- Una venta al crédito con cobros no se anula: primero hay que revertir el cobro
create function protect_credit_sale()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status = 'anulada' and old.status <> 'anulada' and old.payment_method = 'credito' then
    if old.amount_paid > 0 then
      raise exception 'La venta al crédito ya tiene cobros registrados y no se puede anular';
    end if;
    new.credit_status := null;
  end if;
  return new;
end;
$$;
create trigger sales_protect_credit before update on sales
  for each row execute function protect_credit_sale();

-- =====================================================================
-- Operaciones
-- =====================================================================

-- p_items: [{"product_id": "...", "quantity": 2}, ...]. Precios de la base, congelados en la cotización.
create function create_quotation(
  p_branch uuid, p_customer uuid, p_valid_days int, p_discount numeric, p_note text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id       uuid := gen_random_uuid();
  v_rate     numeric;
  v_tz       text;
  v_gross    numeric := 0;
  v_discount numeric := round(coalesce(p_discount, 0), 2);
  v_total    numeric;
  v_subtotal numeric;
  r          record;
begin
  if not can('ventas', 'create') then
    raise exception 'Tu rol no puede crear cotizaciones';
  end if;
  if not exists (select 1 from branches where id = p_branch and active) then
    raise exception 'Sucursal inválida';
  end if;
  if p_customer is not null and not exists (select 1 from customers where id = p_customer and active) then
    raise exception 'Cliente inválido';
  end if;
  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 90 then
    raise exception 'La vigencia debe estar entre 1 y 90 días';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización no tiene productos';
  end if;

  select tax_rate, timezone into v_rate, v_tz from company_settings where id = 1;

  insert into quotations (id, number, branch_id, customer_id, valid_until, note, created_by)
  values (v_id, _next_number(p_branch, 'cotizacion', 'CT'), p_branch, p_customer,
          (now() at time zone v_tz)::date + p_valid_days, coalesce(trim(p_note), ''), auth.uid());

  for r in
    select p.id, p.name, p.sku, p.price, p.active, i.quantity
    from (
      select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::numeric) as quantity
      from jsonb_array_elements(p_items) e group by 1
    ) i
    left join products p on p.id = i.product_id
    order by p.name
  loop
    if r.id is null or not r.active then
      raise exception 'Uno de los productos no existe o está inactivo';
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception 'Cantidad inválida para "%"', r.name;
    end if;
    insert into quotation_items (quotation_id, product_id, product_name, sku, quantity, unit_price, total)
    values (v_id, r.id, r.name, r.sku, r.quantity, r.price, round(r.price * r.quantity, 2));
    v_gross := v_gross + round(r.price * r.quantity, 2);
  end loop;

  if v_discount < 0 or v_discount > v_gross then
    raise exception 'Descuento inválido';
  end if;
  if v_discount > round(v_gross * 0.10, 2) and not can('ventas', 'edit') then
    raise exception 'Tu rol solo puede ofrecer hasta 10%% de descuento';
  end if;

  v_total := v_gross - v_discount;
  v_subtotal := round(v_total / (1 + v_rate / 100), 2);
  update quotations set subtotal = v_subtotal, discount = v_discount, tax = v_total - v_subtotal, total = v_total where id = v_id;
  return v_id;
end;
$$;

create function cancel_quotation(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_q quotations;
begin
  select * into v_q from quotations where id = p_id for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  if not (v_q.created_by = auth.uid() or can('ventas', 'edit')) then
    raise exception 'Solo quien la creó o un supervisor de ventas puede anular la cotización';
  end if;
  if v_q.status <> 'vigente' then
    raise exception 'La cotización ya fue %', v_q.status;
  end if;
  update quotations set status = 'anulada', note = trim(both ' ' from note || ' · Anulada: ' || coalesce(trim(p_reason), '')) where id = p_id;
end;
$$;

-- Venta: al contado o al crédito, directa o a partir de una cotización vigente
-- (en ese caso se respetan los precios, cantidades y descuento cotizados).
drop function create_sale(uuid, uuid, text, text, numeric, numeric, jsonb);
create function create_sale(
  p_branch uuid,
  p_customer uuid,
  p_doc_type text,
  p_payment_method text,
  p_amount_received numeric,
  p_discount numeric,
  p_items jsonb,
  p_quotation uuid default null,
  p_due_date date default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  uuid;
  v_sale     uuid := gen_random_uuid();
  v_rate     numeric;
  v_tz       text;
  v_today    date;
  v_gross    numeric := 0;
  v_cost     numeric := 0;
  v_discount numeric := round(coalesce(p_discount, 0), 2);
  v_total    numeric;
  v_subtotal numeric;
  v_received numeric;
  v_number   text;
  v_customer customers;
  v_cust_id  uuid := p_customer;
  v_quote    quotations;
  v_items    jsonb := p_items;
  v_due      date;
  v_debt     numeric;
  r          record;
begin
  if not can('ventas', 'create') then
    raise exception 'No tienes permiso para registrar ventas';
  end if;
  if p_doc_type not in ('ticket', 'boleta', 'factura') then
    raise exception 'Tipo de comprobante inválido';
  end if;
  if p_payment_method not in ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia', 'credito') then
    raise exception 'Método de pago inválido';
  end if;

  select tax_rate, timezone into v_rate, v_tz from company_settings where id = 1;
  v_today := (now() at time zone v_tz)::date;

  -- Cotización: fija productos, precios y descuento
  if p_quotation is not null then
    select * into v_quote from quotations where id = p_quotation for update;
    if not found or v_quote.status <> 'vigente' then
      raise exception 'La cotización no está vigente';
    end if;
    if v_quote.valid_until < v_today then
      raise exception 'La cotización venció el %. Emite una nueva', to_char(v_quote.valid_until, 'DD/MM/YYYY');
    end if;
    if v_quote.branch_id <> p_branch then
      raise exception 'La cotización pertenece a otra sucursal';
    end if;
    v_cust_id := coalesce(p_customer, v_quote.customer_id);
    v_discount := v_quote.discount;
    select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity, 'unit_price', unit_price))
      into v_items from quotation_items where quotation_id = p_quotation;
  end if;

  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  select id into v_session from cash_sessions
  where opened_by = v_uid and status = 'abierta' and branch_id = p_branch;
  if v_session is null then
    raise exception 'Debes abrir caja en esta sucursal antes de vender';
  end if;

  if v_cust_id is not null then
    select * into v_customer from customers where id = v_cust_id and active;
    if not found then
      raise exception 'Cliente inválido';
    end if;
  end if;
  if p_doc_type = 'factura' and (v_cust_id is null or v_customer.doc_type <> 'RUC') then
    raise exception 'La factura requiere un cliente con RUC';
  end if;
  if p_payment_method = 'credito' and v_cust_id is null then
    raise exception 'La venta al crédito requiere un cliente registrado';
  end if;

  v_number := _next_number(p_branch,
    p_doc_type,
    case p_doc_type when 'boleta' then 'B' when 'factura' then 'F' else 'T' end);

  insert into sales (id, number, doc_type, branch_id, customer_id, cashier_id, cash_session_id,
                     subtotal, discount, tax, total, payment_method, quotation_id)
  values (v_sale, v_number, p_doc_type, p_branch, v_cust_id, v_uid, v_session,
          0, 0, 0, 0, p_payment_method, p_quotation);

  -- El precio solo viene de la cotización; en una venta directa siempre es el de la base
  for r in
    select p.id, p.name, p.sku, coalesce(i.unit_price, p.price) as price, p.cost, p.active, i.quantity
    from (
      select (e ->> 'product_id')::uuid as product_id,
             sum((e ->> 'quantity')::numeric) as quantity,
             case when p_quotation is not null then max((e ->> 'unit_price')::numeric) end as unit_price
      from jsonb_array_elements(v_items) e
      group by 1
    ) i
    left join products p on p.id = i.product_id
    order by i.product_id
  loop
    if r.id is null or not r.active then
      raise exception 'Uno de los productos no existe o está inactivo';
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception 'Cantidad inválida para "%"', r.name;
    end if;

    insert into sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, total)
    values (v_sale, r.id, r.name, r.sku, r.quantity, r.price, r.cost, round(r.price * r.quantity, 2));

    perform _move_stock(r.id, p_branch, -r.quantity, 'venta', r.cost, 'sale', v_sale, v_number);

    v_gross := v_gross + round(r.price * r.quantity, 2);
    v_cost  := v_cost + round(r.cost * r.quantity, 2);
  end loop;

  if v_discount < 0 or v_discount > v_gross then
    raise exception 'Descuento inválido';
  end if;
  -- El descuento de una cotización ya fue validado al emitirla
  if p_quotation is null and v_discount > round(v_gross * 0.10, 2) and not can('ventas', 'edit') then
    raise exception 'Tu rol solo puede aplicar hasta 10%% de descuento';
  end if;

  v_total    := v_gross - v_discount;
  v_subtotal := round(v_total / (1 + v_rate / 100), 2);

  if p_payment_method = 'efectivo' then
    v_received := round(coalesce(p_amount_received, 0), 2);
    if v_received < v_total then
      raise exception 'El monto recibido es menor al total';
    end if;
  elsif p_payment_method = 'credito' then
    -- Verificación de crédito: línea disponible y sin deuda vencida
    if v_customer.credit_limit <= 0 then
      raise exception '% no tiene línea de crédito. Véndele al contado o solicita que se la asignen', v_customer.name;
    end if;
    if exists (select 1 from sales where customer_id = v_cust_id and status = 'completada'
               and credit_status in ('pendiente', 'parcial') and due_date < v_today) then
      raise exception '% tiene deuda vencida: debe ponerse al día antes de una nueva venta al crédito', v_customer.name;
    end if;
    v_debt := customer_debt(v_cust_id);
    if v_debt + v_total > v_customer.credit_limit then
      raise exception 'La venta supera la línea de crédito de %: disponible %', v_customer.name,
        to_char(greatest(v_customer.credit_limit - v_debt, 0), 'FM999G999G990D00');
    end if;
    v_due := coalesce(p_due_date, v_today + v_customer.credit_days);
    if v_due < v_today or v_due > v_today + 365 then
      raise exception 'Fecha de vencimiento inválida';
    end if;
    v_received := 0;
  else
    v_received := v_total;
  end if;

  update sales set
    subtotal = v_subtotal,
    discount = v_discount,
    tax = v_total - v_subtotal,
    total = v_total,
    cost_total = v_cost,
    amount_received = v_received,
    change_amount = case when p_payment_method = 'credito' then 0 else v_received - v_total end,
    due_date = v_due,
    credit_status = case when p_payment_method = 'credito' then 'pendiente' end
  where id = v_sale;

  if p_quotation is not null then
    update quotations set status = 'aceptada', sale_id = v_sale where id = p_quotation;
  end if;
  return v_sale;
end;
$$;

-- Cobro de una venta al crédito. Si es en efectivo, entra a la caja abierta de quien cobra.
create function collect_payment(p_sale uuid, p_amount numeric, p_method text, p_paid_at date, p_reference text default '')
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_sale    sales;
  v_amount  numeric := round(p_amount, 2);
  v_paid    numeric;
  v_session uuid;
begin
  if not can('cuentas_cobrar', 'create') then
    raise exception 'Tu rol no puede registrar cobros a clientes';
  end if;
  select * into v_sale from sales where id = p_sale for update;
  if not found or v_sale.payment_method <> 'credito' or v_sale.status <> 'completada' then
    raise exception 'La venta no es una venta al crédito vigente';
  end if;
  if v_sale.credit_status not in ('pendiente', 'parcial') then
    raise exception 'La venta ya está cancelada';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Importe inválido';
  end if;
  if v_amount > v_sale.total - v_sale.amount_paid then
    raise exception 'El cobro supera el saldo pendiente (%)', to_char(v_sale.total - v_sale.amount_paid, 'FM999G999G990D00');
  end if;
  if p_method not in ('efectivo', 'transferencia', 'tarjeta', 'yape', 'plin', 'cheque') then
    raise exception 'Medio de pago inválido';
  end if;
  if p_paid_at is null or p_paid_at > current_date + 1 then
    raise exception 'Fecha de cobro inválida';
  end if;

  if p_method = 'efectivo' then
    select id into v_session from cash_sessions where opened_by = auth.uid() and status = 'abierta';
    if v_session is null then
      raise exception 'Para cobrar en efectivo debes tener tu caja abierta: el dinero entra a tu arqueo';
    end if;
    insert into cash_movements (cash_session_id, type, amount, concept, created_by)
    values (v_session, 'ingreso', v_amount, 'Cobranza ' || v_sale.number, auth.uid());
  end if;

  insert into customer_payments (sale_id, amount, method, paid_at, reference, created_by)
  values (p_sale, v_amount, p_method, p_paid_at, coalesce(trim(p_reference), ''), auth.uid());

  v_paid := v_sale.amount_paid + v_amount;
  update sales set amount_paid = v_paid, credit_status = case when v_paid >= total then 'pagada' else 'parcial' end where id = p_sale;

  perform _audit('cobro.cliente', 'venta', p_sale::text,
    format('Cobró %s de %s a %s (%s)%s', to_char(v_amount, 'FM999G999G990D00'), v_sale.number,
           coalesce((select name from customers where id = v_sale.customer_id), 'cliente'), p_method,
           case when v_paid >= v_sale.total then '. Deuda cancelada' else '' end),
    jsonb_build_object('importe', v_amount, 'saldo', v_sale.total - v_paid));
  return v_sale.total - v_paid;
end;
$$;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table quotations        enable row level security;
alter table quotation_items   enable row level security;
alter table customer_payments enable row level security;

create policy quotations_read on quotations for select to authenticated
  using (created_by = auth.uid() or can('ventas', 'view'));
create policy quotation_items_read on quotation_items for select to authenticated
  using (exists (select 1 from quotations q where q.id = quotation_id));

-- Quien cobra necesita ver las ventas al crédito
drop policy sales_read on sales;
create policy sales_read on sales for select to authenticated
  using (cashier_id = auth.uid() or can('ventas', 'view') or can('reportes', 'view') or can('finanzas', 'view')
         or (payment_method = 'credito' and can('cuentas_cobrar', 'view')));
create policy customer_payments_read on customer_payments for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_id));

revoke all on quotations, quotation_items, customer_payments from anon, authenticated;
grant select on quotations, quotation_items, customer_payments to authenticated;

create or replace function schema_version()
returns int language sql immutable as $$ select 6 $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function _move_stock(uuid, uuid, numeric, text, numeric, text, uuid, text) from authenticated;
revoke execute on function _next_number(uuid, text, text) from authenticated;
revoke execute on function _audit(text, text, text, text, jsonb) from authenticated;
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
