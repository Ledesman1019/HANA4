-- =====================================================================
-- ERP Retail — Esquema principal
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run
-- =====================================================================

-- ---------- Tipos ----------------------------------------------------
create type user_role as enum ('admin', 'gerente', 'cajero', 'almacenero', 'contador');

-- ---------- Configuración de empresa (fila única) --------------------
create table company_settings (
  id            int primary key default 1 check (id = 1),
  name          text not null default 'Mi Empresa Retail',
  tax_id        text not null default '',
  address       text not null default '',
  phone         text not null default '',
  email         text not null default '',
  currency_code text not null default 'PEN',
  currency_symbol text not null default 'S/',
  tax_name      text not null default 'IGV',
  tax_rate      numeric(5,2) not null default 18 check (tax_rate >= 0 and tax_rate < 100),
  timezone      text not null default 'America/Lima',
  receipt_footer text not null default '¡Gracias por su compra!',
  updated_at    timestamptz not null default now()
);
insert into company_settings (id) values (1);

-- ---------- Sucursales ------------------------------------------------
create table branches (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[0-9]{3}$'),
  name       text not null,
  address    text not null default '',
  phone      text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into branches (code, name) values ('001', 'Tienda Principal');

-- ---------- Perfiles de usuario --------------------------------------
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  email      text not null default '',
  role       user_role not null default 'cajero',
  branch_id  uuid references branches (id),
  active     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Catálogo --------------------------------------------------
create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table products (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null unique,
  barcode     text unique,
  name        text not null,
  description text not null default '',
  category_id uuid references categories (id) on delete set null,
  unit        text not null default 'UND',
  cost        numeric(12,2) not null default 0 check (cost >= 0),
  price       numeric(12,2) not null default 0 check (price >= 0),
  min_stock   numeric(14,3) not null default 0 check (min_stock >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_category_idx on products (category_id);
create index products_name_idx on products (lower(name));

-- ---------- Inventario ------------------------------------------------
create table stock (
  product_id uuid not null references products (id) on delete cascade,
  branch_id  uuid not null references branches (id) on delete cascade,
  quantity   numeric(14,3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, branch_id)
);

create table stock_movements (
  id             bigint generated always as identity primary key,
  product_id     uuid not null references products (id) on delete cascade,
  branch_id      uuid not null references branches (id),
  type           text not null check (type in
                   ('inicial','compra','venta','ajuste','devolucion','transferencia_entrada','transferencia_salida')),
  quantity       numeric(14,3) not null,           -- con signo: + entrada, - salida
  balance_after  numeric(14,3) not null,
  unit_cost      numeric(12,2) not null default 0,
  reference_type text,
  reference_id   uuid,
  note           text not null default '',
  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);
create index stock_movements_product_idx on stock_movements (product_id, created_at desc);
create index stock_movements_branch_idx on stock_movements (branch_id, created_at desc);

-- ---------- Terceros --------------------------------------------------
create table customers (
  id         uuid primary key default gen_random_uuid(),
  doc_type   text not null default 'DNI' check (doc_type in ('DNI','RUC','CE','PASAPORTE')),
  doc_number text not null,
  name       text not null,
  email      text not null default '',
  phone      text not null default '',
  address    text not null default '',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (doc_type, doc_number)
);
create index customers_name_idx on customers (lower(name));

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  tax_id       text not null unique,
  name         text not null,
  contact_name text not null default '',
  email        text not null default '',
  phone        text not null default '',
  address      text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- Caja ------------------------------------------------------
create table cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches (id),
  opened_by       uuid not null references profiles (id),
  opened_at       timestamptz not null default now(),
  opening_amount  numeric(12,2) not null default 0 check (opening_amount >= 0),
  status          text not null default 'abierta' check (status in ('abierta','cerrada')),
  closed_at       timestamptz,
  closed_by       uuid references profiles (id),
  expected_amount numeric(12,2),
  counted_amount  numeric(12,2),
  difference      numeric(12,2),
  note            text not null default ''
);
-- Un usuario solo puede tener una caja abierta a la vez
create unique index cash_sessions_one_open_idx on cash_sessions (opened_by) where status = 'abierta';
create index cash_sessions_branch_idx on cash_sessions (branch_id, opened_at desc);

create table cash_movements (
  id              uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references cash_sessions (id) on delete cascade,
  type            text not null check (type in ('ingreso','egreso')),
  amount          numeric(12,2) not null check (amount > 0),
  concept         text not null,
  created_by      uuid references profiles (id),
  created_at      timestamptz not null default now()
);
create index cash_movements_session_idx on cash_movements (cash_session_id);

-- ---------- Ventas ----------------------------------------------------
create table document_sequences (
  branch_id   uuid not null references branches (id) on delete cascade,
  doc_type    text not null,
  last_number bigint not null default 0,
  primary key (branch_id, doc_type)
);

create table sales (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  doc_type        text not null check (doc_type in ('ticket','boleta','factura')),
  branch_id       uuid not null references branches (id),
  customer_id     uuid references customers (id),
  cashier_id      uuid not null references profiles (id),
  cash_session_id uuid references cash_sessions (id),
  subtotal        numeric(12,2) not null,   -- base imponible
  discount        numeric(12,2) not null default 0,
  tax             numeric(12,2) not null,
  total           numeric(12,2) not null,
  cost_total      numeric(12,2) not null default 0,
  payment_method  text not null check (payment_method in ('efectivo','tarjeta','yape','plin','transferencia')),
  amount_received numeric(12,2) not null default 0,
  change_amount   numeric(12,2) not null default 0,
  status          text not null default 'completada' check (status in ('completada','anulada')),
  void_reason     text,
  voided_by       uuid references profiles (id),
  voided_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index sales_created_idx on sales (created_at desc);
create index sales_branch_idx on sales (branch_id, created_at desc);
create index sales_cashier_idx on sales (cashier_id, created_at desc);
create index sales_session_idx on sales (cash_session_id);
create index sales_customer_idx on sales (customer_id);

create table sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales (id) on delete cascade,
  product_id   uuid not null references products (id),
  product_name text not null,
  sku          text not null,
  quantity     numeric(14,3) not null check (quantity > 0),
  unit_price   numeric(12,2) not null,
  unit_cost    numeric(12,2) not null default 0,
  total        numeric(12,2) not null
);
create index sale_items_sale_idx on sale_items (sale_id);
create index sale_items_product_idx on sale_items (product_id);

-- ---------- Compras ---------------------------------------------------
create table purchases (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  supplier_id   uuid not null references suppliers (id),
  branch_id     uuid not null references branches (id),
  status        text not null default 'ordenada' check (status in ('ordenada','recibida','anulada')),
  subtotal      numeric(12,2) not null default 0,
  tax           numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  expected_date date,
  received_at   timestamptz,
  note          text not null default '',
  created_by    uuid references profiles (id),
  created_at    timestamptz not null default now()
);
create index purchases_created_idx on purchases (created_at desc);

create table purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases (id) on delete cascade,
  product_id  uuid not null references products (id),
  quantity    numeric(14,3) not null check (quantity > 0),
  unit_cost   numeric(12,2) not null check (unit_cost >= 0),
  total       numeric(12,2) not null
);
create index purchase_items_purchase_idx on purchase_items (purchase_id);

-- ---------- Finanzas --------------------------------------------------
create table expenses (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references branches (id),
  category       text not null check (category in
                   ('alquiler','servicios','planilla','marketing','transporte','mantenimiento','impuestos','otros')),
  description    text not null,
  amount         numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'efectivo' check (payment_method in ('efectivo','tarjeta','transferencia','yape','plin')),
  expense_date   date not null default current_date,
  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);
create index expenses_date_idx on expenses (expense_date desc);

-- ---------- RRHH ------------------------------------------------------
create table employees (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid references branches (id),
  doc_number text not null unique,
  full_name  text not null,
  position   text not null,
  email      text not null default '',
  phone      text not null default '',
  salary     numeric(12,2) not null default 0 check (salary >= 0),
  hire_date  date not null default current_date,
  status     text not null default 'activo' check (status in ('activo','vacaciones','licencia','cesado')),
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Funciones de apoyo
-- =====================================================================

-- Rol del usuario autenticado (null si no existe o está inactivo)
create or replace function app_role()
returns user_role
language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function has_role(variadic roles user_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(app_role() = any (roles), false)
$$;

-- ¿El sistema aún no tiene usuarios? (para el asistente de instalación)
create or replace function needs_setup()
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (select 1 from profiles)
$$;

-- Crea el perfil al registrarse un usuario en Supabase Auth.
-- El primer usuario es administrador. Los demás solo quedan activos si
-- fueron creados por un administrador (app_metadata.role lo fija el servidor).
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_first  boolean;
  v_role   user_role;
  v_branch uuid;
begin
  perform pg_advisory_xact_lock(hashtext('erp_new_user'));
  select not exists (select 1 from profiles) into v_first;

  if v_first then
    v_role := 'admin';
  elsif new.raw_app_meta_data ? 'role' then
    v_role := (new.raw_app_meta_data ->> 'role')::user_role;
  else
    v_role := 'cajero';
  end if;

  if new.raw_app_meta_data ? 'branch_id' then
    v_branch := (new.raw_app_meta_data ->> 'branch_id')::uuid;
  else
    select id into v_branch from branches where active order by code limit 1;
  end if;

  insert into profiles (id, full_name, email, role, branch_id, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    v_role,
    v_branch,
    v_first or (new.raw_app_meta_data ? 'role')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger products_touch before update on products
  for each row execute function touch_updated_at();
create trigger settings_touch before update on company_settings
  for each row execute function touch_updated_at();

-- Movimiento de stock interno: actualiza saldo y registra kardex.
-- No se expone a los clientes (ver revokes al final).
create or replace function _move_stock(
  p_product uuid, p_branch uuid, p_delta numeric, p_type text,
  p_unit_cost numeric, p_ref_type text, p_ref_id uuid, p_note text
) returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric;
begin
  insert into stock (product_id, branch_id, quantity)
  values (p_product, p_branch, 0)
  on conflict (product_id, branch_id) do nothing;

  select quantity into v_balance from stock
  where product_id = p_product and branch_id = p_branch
  for update;

  v_balance := v_balance + p_delta;
  if v_balance < 0 then
    raise exception 'Stock insuficiente para "%" (disponible: %)',
      (select name from products where id = p_product), v_balance - p_delta
      using errcode = 'P0001';
  end if;

  update stock set quantity = v_balance, updated_at = now()
  where product_id = p_product and branch_id = p_branch;

  insert into stock_movements
    (product_id, branch_id, type, quantity, balance_after, unit_cost, reference_type, reference_id, note, created_by)
  values
    (p_product, p_branch, p_type, p_delta, v_balance, coalesce(p_unit_cost, 0), p_ref_type, p_ref_id, coalesce(p_note, ''), auth.uid());

  return v_balance;
end;
$$;

create or replace function _next_number(p_branch uuid, p_doc_type text, p_prefix text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_n bigint;
  v_code text;
begin
  insert into document_sequences (branch_id, doc_type, last_number)
  values (p_branch, p_doc_type, 1)
  on conflict (branch_id, doc_type)
  do update set last_number = document_sequences.last_number + 1
  returning last_number into v_n;

  select code into v_code from branches where id = p_branch;
  return p_prefix || v_code || '-' || lpad(v_n::text, 8, '0');
end;
$$;

-- =====================================================================
-- Operaciones de negocio (transaccionales)
-- =====================================================================

-- ---------- Caja ------------------------------------------------------
create or replace function open_cash_session(p_branch uuid, p_opening_amount numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not has_role('admin', 'gerente', 'cajero') then
    raise exception 'No tienes permiso para abrir caja';
  end if;
  if p_opening_amount is null or p_opening_amount < 0 then
    raise exception 'Monto de apertura inválido';
  end if;
  if not exists (select 1 from branches where id = p_branch and active) then
    raise exception 'Sucursal inválida';
  end if;
  if exists (select 1 from cash_sessions where opened_by = auth.uid() and status = 'abierta') then
    raise exception 'Ya tienes una caja abierta';
  end if;

  insert into cash_sessions (branch_id, opened_by, opening_amount)
  values (p_branch, auth.uid(), round(p_opening_amount, 2))
  returning id into v_id;
  return v_id;
end;
$$;

-- Efectivo esperado en una sesión de caja
create or replace function cash_session_expected(p_session uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select
    s.opening_amount
    + coalesce((select sum(total) from sales
                where cash_session_id = s.id and payment_method = 'efectivo' and status = 'completada'), 0)
    + coalesce((select sum(case when type = 'ingreso' then amount else -amount end)
                from cash_movements where cash_session_id = s.id), 0)
  from cash_sessions s
  where s.id = p_session
    and (s.opened_by = auth.uid() or has_role('admin', 'gerente', 'contador'))
$$;

create or replace function add_cash_movement(p_session uuid, p_type text, p_amount numeric, p_concept text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_session cash_sessions;
  v_id uuid;
begin
  select * into v_session from cash_sessions where id = p_session for update;
  if not found or v_session.status <> 'abierta' then
    raise exception 'La caja no está abierta';
  end if;
  if v_session.opened_by <> auth.uid() and not has_role('admin', 'gerente') then
    raise exception 'No puedes registrar movimientos en esta caja';
  end if;
  if p_type not in ('ingreso', 'egreso') or p_amount is null or p_amount <= 0 then
    raise exception 'Movimiento inválido';
  end if;
  if coalesce(trim(p_concept), '') = '' then
    raise exception 'Indica el concepto del movimiento';
  end if;
  if p_type = 'egreso' and p_amount > cash_session_expected(p_session) then
    raise exception 'No hay efectivo suficiente en caja';
  end if;

  insert into cash_movements (cash_session_id, type, amount, concept, created_by)
  values (p_session, p_type, round(p_amount, 2), trim(p_concept), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function close_cash_session(p_session uuid, p_counted_amount numeric, p_note text default '')
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_session  cash_sessions;
  v_expected numeric;
begin
  select * into v_session from cash_sessions where id = p_session for update;
  if not found or v_session.status <> 'abierta' then
    raise exception 'La caja no está abierta';
  end if;
  if v_session.opened_by <> auth.uid() and not has_role('admin', 'gerente') then
    raise exception 'No puedes cerrar esta caja';
  end if;
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'Monto contado inválido';
  end if;

  v_expected := cash_session_expected(p_session);

  update cash_sessions set
    status = 'cerrada',
    closed_at = now(),
    closed_by = auth.uid(),
    expected_amount = v_expected,
    counted_amount = round(p_counted_amount, 2),
    difference = round(p_counted_amount, 2) - v_expected,
    note = coalesce(p_note, '')
  where id = p_session;

  return round(p_counted_amount, 2) - v_expected;
end;
$$;

-- ---------- Venta (POS) -----------------------------------------------
-- p_items: [{"product_id": "...", "quantity": 2}, ...]
-- Los precios se toman SIEMPRE de la base de datos, nunca del cliente.
-- Los precios de venta incluyen impuesto.
create or replace function create_sale(
  p_branch uuid,
  p_customer uuid,
  p_doc_type text,
  p_payment_method text,
  p_amount_received numeric,
  p_discount numeric,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  uuid;
  v_sale     uuid := gen_random_uuid();
  v_rate     numeric;
  v_gross    numeric := 0;
  v_cost     numeric := 0;
  v_discount numeric := round(coalesce(p_discount, 0), 2);
  v_total    numeric;
  v_subtotal numeric;
  v_received numeric;
  v_number   text;
  v_customer customers;
  r          record;
begin
  if not has_role('admin', 'gerente', 'cajero') then
    raise exception 'No tienes permiso para registrar ventas';
  end if;
  if p_doc_type not in ('ticket', 'boleta', 'factura') then
    raise exception 'Tipo de comprobante inválido';
  end if;
  if p_payment_method not in ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia') then
    raise exception 'Método de pago inválido';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  select id into v_session from cash_sessions
  where opened_by = v_uid and status = 'abierta' and branch_id = p_branch;
  if v_session is null then
    raise exception 'Debes abrir caja en esta sucursal antes de vender';
  end if;

  if p_customer is not null then
    select * into v_customer from customers where id = p_customer and active;
    if not found then
      raise exception 'Cliente inválido';
    end if;
  end if;
  if p_doc_type = 'factura' and (p_customer is null or v_customer.doc_type <> 'RUC') then
    raise exception 'La factura requiere un cliente con RUC';
  end if;

  select tax_rate into v_rate from company_settings where id = 1;

  -- Cabecera provisional (los totales se actualizan al final)
  v_number := _next_number(p_branch,
    p_doc_type,
    case p_doc_type when 'boleta' then 'B' when 'factura' then 'F' else 'T' end);

  insert into sales (id, number, doc_type, branch_id, customer_id, cashier_id, cash_session_id,
                     subtotal, discount, tax, total, payment_method)
  values (v_sale, v_number, p_doc_type, p_branch, p_customer, v_uid, v_session,
          0, 0, 0, 0, p_payment_method);

  -- Ítems agrupados por producto y ordenados para evitar interbloqueos
  for r in
    select p.id, p.name, p.sku, p.price, p.cost, p.active, i.quantity
    from (
      select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::numeric) as quantity
      from jsonb_array_elements(p_items) e
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
  if v_discount > 0 and not has_role('admin', 'gerente') and v_discount > round(v_gross * 0.10, 2) then
    raise exception 'Un cajero solo puede aplicar hasta 10%% de descuento';
  end if;

  v_total    := v_gross - v_discount;
  v_subtotal := round(v_total / (1 + v_rate / 100), 2);

  if p_payment_method = 'efectivo' then
    v_received := round(coalesce(p_amount_received, 0), 2);
    if v_received < v_total then
      raise exception 'El monto recibido es menor al total';
    end if;
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
    change_amount = v_received - v_total
  where id = v_sale;

  return v_sale;
end;
$$;

create or replace function void_sale(p_sale uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sale sales;
  r      record;
begin
  if not has_role('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular ventas';
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

  for r in select product_id, quantity, unit_cost from sale_items where sale_id = p_sale order by product_id loop
    perform _move_stock(r.product_id, v_sale.branch_id, r.quantity, 'devolucion', r.unit_cost,
                        'sale', p_sale, 'Anulación ' || v_sale.number);
  end loop;

  update sales set status = 'anulada', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_sale;
end;
$$;

-- ---------- Inventario ------------------------------------------------
-- Ajuste por conteo físico: fija la cantidad real
create or replace function adjust_stock(p_product uuid, p_branch uuid, p_new_quantity numeric, p_note text)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_current numeric;
  v_cost    numeric;
  v_first   boolean;
begin
  if not has_role('admin', 'gerente', 'almacenero') then
    raise exception 'No tienes permiso para ajustar stock';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Cantidad inválida';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Indica el motivo del ajuste';
  end if;

  select cost into v_cost from products where id = p_product;
  if not found then
    raise exception 'Producto no encontrado';
  end if;

  insert into stock (product_id, branch_id, quantity) values (p_product, p_branch, 0)
  on conflict (product_id, branch_id) do nothing;
  select quantity into v_current from stock
  where product_id = p_product and branch_id = p_branch for update;

  if v_current = p_new_quantity then
    return v_current;
  end if;

  select not exists (select 1 from stock_movements where product_id = p_product and branch_id = p_branch)
  into v_first;

  return _move_stock(p_product, p_branch, p_new_quantity - v_current,
                     case when v_first then 'inicial' else 'ajuste' end,
                     v_cost, 'adjustment', null, trim(p_note));
end;
$$;

create or replace function transfer_stock(p_product uuid, p_from uuid, p_to uuid, p_quantity numeric, p_note text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_cost numeric;
  v_ref  uuid := gen_random_uuid();
begin
  if not has_role('admin', 'gerente', 'almacenero') then
    raise exception 'No tienes permiso para transferir stock';
  end if;
  if p_from = p_to then
    raise exception 'El origen y el destino deben ser distintos';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad inválida';
  end if;
  if (select count(*) from branches where id in (p_from, p_to) and active) <> 2 then
    raise exception 'Sucursal inválida';
  end if;

  select cost into v_cost from products where id = p_product;
  if not found then
    raise exception 'Producto no encontrado';
  end if;

  perform _move_stock(p_product, p_from, -p_quantity, 'transferencia_salida', v_cost, 'transfer', v_ref, coalesce(p_note, ''));
  perform _move_stock(p_product, p_to, p_quantity, 'transferencia_entrada', v_cost, 'transfer', v_ref, coalesce(p_note, ''));
end;
$$;

-- ---------- Compras ---------------------------------------------------
-- p_items: [{"product_id": "...", "quantity": 10, "unit_cost": 5.50}, ...]
-- Los costos de compra se registran sin impuesto.
create or replace function create_purchase(
  p_supplier uuid, p_branch uuid, p_expected_date date, p_note text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id       uuid := gen_random_uuid();
  v_rate     numeric;
  v_subtotal numeric := 0;
  v_tax      numeric;
  r          record;
begin
  if not has_role('admin', 'gerente', 'almacenero') then
    raise exception 'No tienes permiso para registrar compras';
  end if;
  if not exists (select 1 from suppliers where id = p_supplier and active) then
    raise exception 'Proveedor inválido';
  end if;
  if not exists (select 1 from branches where id = p_branch and active) then
    raise exception 'Sucursal inválida';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden no tiene productos';
  end if;

  select tax_rate into v_rate from company_settings where id = 1;

  insert into purchases (id, number, supplier_id, branch_id, expected_date, note, created_by)
  values (v_id, _next_number(p_branch, 'compra', 'OC'), p_supplier, p_branch, p_expected_date, coalesce(p_note, ''), auth.uid());

  for r in
    select p.id, i.quantity, i.unit_cost
    from (
      select (e ->> 'product_id')::uuid as product_id,
             (e ->> 'quantity')::numeric as quantity,
             (e ->> 'unit_cost')::numeric as unit_cost
      from jsonb_array_elements(p_items) e
    ) i
    left join products p on p.id = i.product_id
  loop
    if r.id is null then
      raise exception 'Uno de los productos no existe';
    end if;
    if r.quantity is null or r.quantity <= 0 or r.unit_cost is null or r.unit_cost < 0 then
      raise exception 'Cantidad o costo inválido';
    end if;
    insert into purchase_items (purchase_id, product_id, quantity, unit_cost, total)
    values (v_id, r.id, r.quantity, round(r.unit_cost, 2), round(r.quantity * r.unit_cost, 2));
    v_subtotal := v_subtotal + round(r.quantity * r.unit_cost, 2);
  end loop;

  v_tax := round(v_subtotal * v_rate / 100, 2);
  update purchases set subtotal = v_subtotal, tax = v_tax, total = v_subtotal + v_tax where id = v_id;
  return v_id;
end;
$$;

-- Recepción: ingresa stock y recalcula el costo promedio ponderado
create or replace function receive_purchase(p_purchase uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_purchase purchases;
  v_total_qty numeric;
  v_old_cost  numeric;
  r           record;
begin
  if not has_role('admin', 'gerente', 'almacenero') then
    raise exception 'No tienes permiso para recibir compras';
  end if;

  select * into v_purchase from purchases where id = p_purchase for update;
  if not found then
    raise exception 'Orden no encontrada';
  end if;
  if v_purchase.status <> 'ordenada' then
    raise exception 'La orden ya fue % ', v_purchase.status;
  end if;

  for r in
    select product_id, sum(quantity) as quantity, sum(total) / sum(quantity) as unit_cost
    from purchase_items where purchase_id = p_purchase
    group by product_id order by product_id
  loop
    select cost into v_old_cost from products where id = r.product_id for update;
    select coalesce(sum(quantity), 0) into v_total_qty from stock where product_id = r.product_id;

    update products
    set cost = round((v_total_qty * v_old_cost + r.quantity * r.unit_cost) / (v_total_qty + r.quantity), 2)
    where id = r.product_id;

    perform _move_stock(r.product_id, v_purchase.branch_id, r.quantity, 'compra', round(r.unit_cost, 2),
                        'purchase', p_purchase, v_purchase.number);
  end loop;

  update purchases set status = 'recibida', received_at = now() where id = p_purchase;
end;
$$;

create or replace function cancel_purchase(p_purchase uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not has_role('admin', 'gerente') then
    raise exception 'Solo un administrador o gerente puede anular órdenes';
  end if;
  update purchases set status = 'anulada' where id = p_purchase and status = 'ordenada';
  if not found then
    raise exception 'Solo se pueden anular órdenes pendientes de recepción';
  end if;
end;
$$;

-- =====================================================================
-- Reportes (se ejecutan con los permisos del usuario: respetan RLS)
-- =====================================================================
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
  )
  select d.day, coalesce(a.total, 0), coalesce(a.cost, 0), coalesce(a.tickets, 0)
  from days d left join agg a using (day)
  order by d.day
$$;

create or replace function report_top_products(p_from date, p_to date, p_branch uuid default null, p_limit int default 10)
returns table (product_id uuid, name text, sku text, quantity numeric, total numeric, profit numeric)
language sql stable set search_path = public
as $$
  select i.product_id, max(i.product_name), max(i.sku),
         sum(i.quantity), sum(i.total), sum(i.total - i.unit_cost * i.quantity)
  from sale_items i
  join sales s on s.id = i.sale_id
  where s.status = 'completada'
    and (p_branch is null or s.branch_id = p_branch)
    and (s.created_at at time zone (select timezone from company_settings where id = 1))::date between p_from and p_to
  group by i.product_id
  order by sum(i.total) desc
  limit greatest(p_limit, 1)
$$;

create or replace function report_sales_breakdown(p_from date, p_to date, p_branch uuid default null, p_dimension text default 'payment_method')
returns table (label text, total numeric, tickets bigint)
language sql stable set search_path = public
as $$
  select
    case p_dimension
      when 'category' then coalesce(c.name, 'Sin categoría')
      when 'cashier' then coalesce(pr.full_name, '—')
      when 'branch' then b.name
      else s.payment_method
    end as label,
    sum(case when p_dimension = 'category' then i.total else s.total end) as total,
    count(distinct s.id) as tickets
  from sales s
  join branches b on b.id = s.branch_id
  left join profiles pr on pr.id = s.cashier_id
  left join sale_items i on p_dimension = 'category' and i.sale_id = s.id
  left join products p on p.id = i.product_id
  left join categories c on c.id = p.category_id
  where s.status = 'completada'
    and (p_branch is null or s.branch_id = p_branch)
    and (s.created_at at time zone (select timezone from company_settings where id = 1))::date between p_from and p_to
  group by 1
  order by 2 desc
$$;

-- Vista de inventario valorizado (respeta RLS de las tablas base)
create view inventory_view with (security_invoker = true) as
  select
    p.id as product_id, p.sku, p.barcode, p.name, p.description, p.unit, p.cost, p.price, p.min_stock, p.active,
    p.category_id, c.name as category_name,
    b.id as branch_id, b.name as branch_name,
    coalesce(s.quantity, 0) as quantity,
    coalesce(s.quantity, 0) * p.cost as stock_value,
    coalesce(s.quantity, 0) <= p.min_stock as low_stock
  from products p
  cross join branches b
  left join categories c on c.id = p.category_id
  left join stock s on s.product_id = p.id and s.branch_id = b.id
  where b.active;

-- =====================================================================
-- Seguridad: Row Level Security
-- Toda escritura sensible (stock, ventas, caja, compras) pasa por las
-- funciones de arriba; las tablas no aceptan escrituras directas.
-- =====================================================================
alter table company_settings   enable row level security;
alter table branches           enable row level security;
alter table profiles           enable row level security;
alter table categories         enable row level security;
alter table products           enable row level security;
alter table stock              enable row level security;
alter table stock_movements    enable row level security;
alter table customers          enable row level security;
alter table suppliers          enable row level security;
alter table cash_sessions      enable row level security;
alter table cash_movements     enable row level security;
alter table document_sequences enable row level security;
alter table sales              enable row level security;
alter table sale_items         enable row level security;
alter table purchases          enable row level security;
alter table purchase_items     enable row level security;
alter table expenses           enable row level security;
alter table employees          enable row level security;

-- Lectura general para cualquier usuario activo
create policy settings_read   on company_settings for select to authenticated using (app_role() is not null);
create policy branches_read   on branches         for select to authenticated using (app_role() is not null);
create policy profiles_read   on profiles         for select to authenticated using (id = auth.uid() or app_role() is not null);
create policy categories_read on categories       for select to authenticated using (app_role() is not null);
create policy products_read   on products         for select to authenticated using (app_role() is not null);
create policy stock_read      on stock            for select to authenticated using (app_role() is not null);
create policy customers_read  on customers        for select to authenticated using (app_role() is not null);
create policy movements_read  on stock_movements  for select to authenticated using (has_role('admin','gerente','almacenero','contador'));
create policy suppliers_read  on suppliers        for select to authenticated using (has_role('admin','gerente','almacenero','contador'));
create policy purchases_read  on purchases        for select to authenticated using (has_role('admin','gerente','almacenero','contador'));
create policy pitems_read     on purchase_items   for select to authenticated using (has_role('admin','gerente','almacenero','contador'));
create policy expenses_read   on expenses         for select to authenticated using (has_role('admin','gerente','contador'));
create policy employees_read  on employees        for select to authenticated using (has_role('admin','gerente'));

-- Ventas y caja: el cajero solo ve lo suyo
create policy sales_read on sales for select to authenticated
  using (has_role('admin','gerente','contador') or cashier_id = auth.uid());
create policy sale_items_read on sale_items for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_id));
create policy cash_sessions_read on cash_sessions for select to authenticated
  using (has_role('admin','gerente','contador') or opened_by = auth.uid());
create policy cash_movements_read on cash_movements for select to authenticated
  using (exists (select 1 from cash_sessions cs where cs.id = cash_session_id));

-- Escritura de maestros
create policy settings_write on company_settings for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

create policy branches_insert on branches for insert to authenticated with check (has_role('admin'));
create policy branches_update on branches for update to authenticated using (has_role('admin')) with check (has_role('admin'));

create policy profiles_update on profiles for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

create policy categories_insert on categories for insert to authenticated with check (has_role('admin','gerente','almacenero'));
create policy categories_update on categories for update to authenticated using (has_role('admin','gerente','almacenero')) with check (has_role('admin','gerente','almacenero'));
create policy categories_delete on categories for delete to authenticated using (has_role('admin','gerente'));

create policy products_insert on products for insert to authenticated with check (has_role('admin','gerente','almacenero'));
create policy products_update on products for update to authenticated using (has_role('admin','gerente','almacenero')) with check (has_role('admin','gerente','almacenero'));

create policy customers_insert on customers for insert to authenticated with check (has_role('admin','gerente','cajero'));
create policy customers_update on customers for update to authenticated using (has_role('admin','gerente','cajero')) with check (has_role('admin','gerente','cajero'));

create policy suppliers_insert on suppliers for insert to authenticated with check (has_role('admin','gerente','almacenero'));
create policy suppliers_update on suppliers for update to authenticated using (has_role('admin','gerente','almacenero')) with check (has_role('admin','gerente','almacenero'));

create policy expenses_insert on expenses for insert to authenticated with check (has_role('admin','gerente','contador'));
create policy expenses_update on expenses for update to authenticated using (has_role('admin','gerente','contador')) with check (has_role('admin','gerente','contador'));
create policy expenses_delete on expenses for delete to authenticated using (has_role('admin','gerente'));

create policy employees_insert on employees for insert to authenticated with check (has_role('admin','gerente'));
create policy employees_update on employees for update to authenticated using (has_role('admin','gerente')) with check (has_role('admin','gerente'));

-- ---------- Permisos ---------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- Tablas transaccionales: solo lectura; se escriben únicamente vía funciones
revoke insert, update, delete on
  stock, stock_movements, sales, sale_items, cash_sessions, cash_movements,
  document_sequences, purchases, purchase_items, inventory_view
from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Funciones internas: nadie las llama directamente
revoke execute on function _move_stock(uuid, uuid, numeric, text, numeric, text, uuid, text) from authenticated;
revoke execute on function _next_number(uuid, text, text) from authenticated;
revoke execute on function handle_new_user() from authenticated;
-- El asistente de instalación consulta esto sin sesión
grant execute on function needs_setup() to anon;

-- Los usuarios anónimos no acceden a ninguna tabla
revoke all on all tables in schema public from anon;
