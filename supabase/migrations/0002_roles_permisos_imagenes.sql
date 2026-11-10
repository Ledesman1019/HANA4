-- =====================================================================
-- ERP HANA4 — Migración 0002
--   1. Roles dinámicos con matriz de permisos por módulo (ver/crear/editar/eliminar)
--   2. Imágenes de producto
--   3. Contexto de sesión en una sola consulta (menor latencia)
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run
-- Requiere la 0001. Es transaccional: si algo falla, no cambia nada.
-- =====================================================================
begin;

-- ---------- 1. Roles y permisos --------------------------------------
create table roles (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name        text not null unique,
  description text not null default '',
  is_system   boolean not null default false,   -- los roles base no se eliminan
  created_at  timestamptz not null default now()
);

create table role_permissions (
  role_id    text not null references roles (id) on delete cascade,
  module     text not null check (module in
               ('ventas','caja','clientes','inventario','compras','proveedores','finanzas','rrhh','reportes','configuracion')),
  can_view   boolean not null default false,
  can_create boolean not null default false,
  can_edit   boolean not null default false,
  can_delete boolean not null default false,
  primary key (role_id, module)
);

insert into roles (id, name, description, is_system) values
  ('admin',      'Administrador', 'Acceso total. Sus permisos no se pueden recortar.', true),
  ('gerente',    'Gerente',       'Opera y supervisa todo el negocio, sin configuración.', true),
  ('cajero',     'Vendedor',      'Vende en el punto de venta y maneja su caja.', true),
  ('almacenero', 'Almacenero',    'Inventario, compras y proveedores.', true),
  ('contador',   'Contador',      'Consulta la operación y gestiona finanzas.', true);

insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
select r, m, v, c, e, d from (values
  ('gerente','ventas',true,true,true,true), ('gerente','caja',true,true,true,true),
  ('gerente','clientes',true,true,true,true), ('gerente','inventario',true,true,true,true),
  ('gerente','compras',true,true,true,true), ('gerente','proveedores',true,true,true,true),
  ('gerente','finanzas',true,true,true,true), ('gerente','rrhh',true,true,true,true),
  ('gerente','reportes',true,false,false,false),
  ('cajero','ventas',false,true,false,false), ('cajero','caja',false,true,false,false),
  ('cajero','clientes',true,true,true,false), ('cajero','inventario',true,false,false,false),
  ('almacenero','inventario',true,true,true,true), ('almacenero','compras',true,true,true,false),
  ('almacenero','proveedores',true,true,true,false),
  ('contador','ventas',true,false,false,false), ('contador','caja',true,false,false,false),
  ('contador','inventario',true,false,false,false), ('contador','compras',true,false,false,false),
  ('contador','proveedores',true,false,false,false), ('contador','finanzas',true,true,true,false),
  ('contador','reportes',true,false,false,false)
) as t(r, m, v, c, e, d);

-- Las políticas dependen de has_role()/app_role(): se retiran para poder
-- cambiar el tipo del rol y se vuelven a crear abajo con la matriz.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

drop function has_role(variadic user_role[]);
drop function app_role();

alter table profiles alter column role drop default;
alter table profiles alter column role type text using role::text;
alter table profiles alter column role set default 'cajero';
alter table profiles add constraint profiles_role_fkey foreign key (role) references roles (id) on update cascade;
drop type user_role;

-- Rol del usuario autenticado (null si no existe o está inactivo)
create function app_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid() and active
$$;

-- ¿El usuario puede hacer `p_action` (view|create|edit|delete) en `p_module`?
create function can(p_module text, p_action text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when app_role() is null then false
    when app_role() = 'admin' then true
    else coalesce((
      select case p_action
        when 'view' then can_view when 'create' then can_create
        when 'edit' then can_edit when 'delete' then can_delete else false end
      from role_permissions where role_id = app_role() and module = p_module), false)
  end
$$;

-- Guarda un rol y su matriz completa en una sola transacción.
-- p_permissions: {"ventas": {"view": true, "create": true, "edit": false, "delete": false}, ...}
create function save_role(p_id text, p_name text, p_description text, p_permissions jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_id text := p_id;
  m    text;
  v_p  jsonb;
begin
  if not can('configuracion', 'edit') then
    raise exception 'No tienes permiso para gestionar roles';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'El rol necesita un nombre';
  end if;
  if v_id = 'admin' then
    raise exception 'El rol Administrador siempre tiene acceso total y no se modifica';
  end if;
  -- Nadie puede ampliar los permisos de su propio rol
  if v_id is not null and v_id = app_role() then
    raise exception 'No puedes modificar los permisos de tu propio rol';
  end if;

  if v_id is null then
    v_id := 'rol_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into roles (id, name, description) values (v_id, trim(p_name), coalesce(trim(p_description), ''));
  else
    update roles set name = trim(p_name), description = coalesce(trim(p_description), '') where id = v_id;
    if not found then
      raise exception 'Rol no encontrado';
    end if;
  end if;

  delete from role_permissions where role_id = v_id;
  foreach m in array array['ventas','caja','clientes','inventario','compras','proveedores','finanzas','rrhh','reportes','configuracion'] loop
    v_p := coalesce(p_permissions -> m, '{}'::jsonb);
    insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
    values (v_id, m,
      coalesce((v_p ->> 'view')::boolean, false), coalesce((v_p ->> 'create')::boolean, false),
      coalesce((v_p ->> 'edit')::boolean, false), coalesce((v_p ->> 'delete')::boolean, false));
  end loop;
  return v_id;
end;
$$;

create function delete_role(p_id text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not can('configuracion', 'edit') then
    raise exception 'No tienes permiso para gestionar roles';
  end if;
  if exists (select 1 from roles where id = p_id and is_system) then
    raise exception 'Los roles base del sistema no se pueden eliminar';
  end if;
  if exists (select 1 from profiles where role = p_id) then
    raise exception 'Hay usuarios con este rol. Asígnales otro antes de eliminarlo';
  end if;
  delete from roles where id = p_id;
  if not found then
    raise exception 'Rol no encontrado';
  end if;
end;
$$;

-- Nunca puede quedar el sistema sin un administrador activo
create function protect_last_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'Debe quedar al menos un administrador activo';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_last_admin before update on profiles
  for each row execute function protect_last_admin();

-- Alta de usuario: el primer usuario es administrador; el resto toma el rol
-- que fijó el servidor (app_metadata). Un auto-registro queda sin acceso.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_first  boolean;
  v_role   text;
  v_branch uuid;
begin
  perform pg_advisory_xact_lock(hashtext('erp_new_user'));
  select not exists (select 1 from profiles) into v_first;

  if v_first then
    v_role := 'admin';
  elsif new.raw_app_meta_data ? 'role' and exists (select 1 from roles where id = new.raw_app_meta_data ->> 'role') then
    v_role := new.raw_app_meta_data ->> 'role';
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

-- ---------- Operaciones: mismos cuerpos, ahora con la matriz ---------
create or replace function open_cash_session(p_branch uuid, p_opening_amount numeric)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not can('caja', 'create') then
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
    and (s.opened_by = auth.uid() or can('caja', 'view') or can('caja', 'edit'))
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
  if not ((v_session.opened_by = auth.uid() and can('caja', 'create')) or can('caja', 'edit')) then
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
  if not ((v_session.opened_by = auth.uid() and can('caja', 'create')) or can('caja', 'edit')) then
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
  if not can('ventas', 'create') then
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

  v_number := _next_number(p_branch,
    p_doc_type,
    case p_doc_type when 'boleta' then 'B' when 'factura' then 'F' else 'T' end);

  insert into sales (id, number, doc_type, branch_id, customer_id, cashier_id, cash_session_id,
                     subtotal, discount, tax, total, payment_method)
  values (v_sale, v_number, p_doc_type, p_branch, p_customer, v_uid, v_session,
          0, 0, 0, 0, p_payment_method);

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
  -- Descuentos mayores al 10 % requieren el permiso "Editar" de Ventas
  if v_discount > round(v_gross * 0.10, 2) and not can('ventas', 'edit') then
    raise exception 'Tu rol solo puede aplicar hasta 10%% de descuento';
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

  for r in select product_id, quantity, unit_cost from sale_items where sale_id = p_sale order by product_id loop
    perform _move_stock(r.product_id, v_sale.branch_id, r.quantity, 'devolucion', r.unit_cost,
                        'sale', p_sale, 'Anulación ' || v_sale.number);
  end loop;

  update sales set status = 'anulada', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = p_sale;
end;
$$;

create or replace function adjust_stock(p_product uuid, p_branch uuid, p_new_quantity numeric, p_note text)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_current numeric;
  v_cost    numeric;
  v_first   boolean;
begin
  if not can('inventario', 'edit') then
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
  if not can('inventario', 'edit') then
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
  if not can('compras', 'create') then
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
  if not can('compras', 'edit') then
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
  if not can('compras', 'delete') then
    raise exception 'Tu rol no puede anular órdenes de compra';
  end if;
  update purchases set status = 'anulada' where id = p_purchase and status = 'ordenada';
  if not found then
    raise exception 'Solo se pueden anular órdenes pendientes de recepción';
  end if;
end;
$$;

-- ---------- Políticas de acceso (RLS) con la matriz -------------------
alter table roles            enable row level security;
alter table role_permissions enable row level security;

-- Lectura general para cualquier usuario activo (el punto de venta la necesita)
create policy settings_read   on company_settings for select to authenticated using (app_role() is not null);
create policy branches_read   on branches         for select to authenticated using (app_role() is not null);
create policy profiles_read   on profiles         for select to authenticated using (id = auth.uid() or app_role() is not null);
create policy roles_read      on roles            for select to authenticated using (app_role() is not null);
create policy role_perms_read on role_permissions for select to authenticated using (app_role() is not null);
create policy categories_read on categories       for select to authenticated using (app_role() is not null);
create policy products_read   on products         for select to authenticated using (app_role() is not null);
create policy stock_read      on stock            for select to authenticated using (app_role() is not null);
create policy customers_read  on customers        for select to authenticated using (app_role() is not null);

create policy movements_read on stock_movements for select to authenticated using (can('inventario', 'view'));
create policy suppliers_read on suppliers       for select to authenticated using (can('proveedores', 'view') or can('compras', 'view'));
create policy purchases_read on purchases       for select to authenticated using (can('compras', 'view'));
create policy pitems_read    on purchase_items  for select to authenticated using (can('compras', 'view'));
create policy expenses_read  on expenses        for select to authenticated using (can('finanzas', 'view'));
create policy employees_read on employees       for select to authenticated using (can('rrhh', 'view'));

-- Ventas y caja: cada quien ve lo suyo; "Ver" abre lo de todos
create policy sales_read on sales for select to authenticated
  using (cashier_id = auth.uid() or can('ventas', 'view') or can('reportes', 'view') or can('finanzas', 'view'));
create policy sale_items_read on sale_items for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_id));
create policy cash_sessions_read on cash_sessions for select to authenticated
  using (opened_by = auth.uid() or can('caja', 'view') or can('caja', 'edit'));
create policy cash_movements_read on cash_movements for select to authenticated
  using (exists (select 1 from cash_sessions cs where cs.id = cash_session_id));

-- Escritura de maestros
create policy settings_write on company_settings for update to authenticated
  using (can('configuracion', 'edit')) with check (can('configuracion', 'edit'));
create policy branches_insert on branches for insert to authenticated with check (can('configuracion', 'edit'));
create policy branches_update on branches for update to authenticated using (can('configuracion', 'edit')) with check (can('configuracion', 'edit'));

-- Solo un administrador puede tocar a otro administrador o conceder ese rol
create policy profiles_update on profiles for update to authenticated
  using (can('configuracion', 'edit') and (role <> 'admin' or app_role() = 'admin'))
  with check (can('configuracion', 'edit') and (role <> 'admin' or app_role() = 'admin'));

create policy categories_insert on categories for insert to authenticated with check (can('inventario', 'create'));
create policy categories_update on categories for update to authenticated using (can('inventario', 'edit') or can('inventario', 'delete')) with check (can('inventario', 'edit') or can('inventario', 'delete'));
create policy products_insert on products for insert to authenticated with check (can('inventario', 'create'));
create policy products_update on products for update to authenticated using (can('inventario', 'edit') or can('inventario', 'delete')) with check (can('inventario', 'edit') or can('inventario', 'delete'));

create policy customers_insert on customers for insert to authenticated with check (can('clientes', 'create'));
create policy customers_update on customers for update to authenticated using (can('clientes', 'edit') or can('clientes', 'delete')) with check (can('clientes', 'edit') or can('clientes', 'delete'));

create policy suppliers_insert on suppliers for insert to authenticated with check (can('proveedores', 'create'));
create policy suppliers_update on suppliers for update to authenticated using (can('proveedores', 'edit') or can('proveedores', 'delete')) with check (can('proveedores', 'edit') or can('proveedores', 'delete'));

create policy expenses_insert on expenses for insert to authenticated with check (can('finanzas', 'create'));
create policy expenses_update on expenses for update to authenticated using (can('finanzas', 'edit')) with check (can('finanzas', 'edit'));
create policy expenses_delete on expenses for delete to authenticated using (can('finanzas', 'delete'));

create policy employees_insert on employees for insert to authenticated with check (can('rrhh', 'create'));
create policy employees_update on employees for update to authenticated using (can('rrhh', 'edit')) with check (can('rrhh', 'edit'));

-- ---------- 2. Imagen de producto ------------------------------------
alter table products add column image_url text;

create or replace view inventory_view with (security_invoker = true) as
  select
    p.id as product_id, p.sku, p.barcode, p.name, p.description, p.unit, p.cost, p.price, p.min_stock, p.active,
    p.category_id, c.name as category_name,
    b.id as branch_id, b.name as branch_name,
    coalesce(s.quantity, 0) as quantity,
    coalesce(s.quantity, 0) * p.cost as stock_value,
    coalesce(s.quantity, 0) <= p.min_stock as low_stock,
    p.image_url
  from products p
  cross join branches b
  left join categories c on c.id = p.category_id
  left join stock s on s.product_id = p.id and s.branch_id = b.id
  where b.active;

-- ---------- 3. Contexto de sesión en un solo viaje -------------------
-- Antes: 3 consultas por página. Ahora: 1, e incluye los permisos del rol.
create function app_context()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'profile',  (select to_jsonb(p) from profiles p where p.id = auth.uid()),
    'role_name', (select r.name from roles r where r.id = app_role()),
    'settings', (select to_jsonb(s) from company_settings s where s.id = 1 and app_role() is not null),
    'branches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.code), '[]'::jsonb)
                 from branches b where b.active and app_role() is not null),
    'permissions', (select coalesce(jsonb_object_agg(rp.module, jsonb_build_object(
                      'view', rp.can_view, 'create', rp.can_create, 'edit', rp.can_edit, 'delete', rp.can_delete)), '{}'::jsonb)
                    from role_permissions rp where rp.role_id = app_role())
  )
$$;

-- Versión del esquema: el asistente de instalación la consulta sin sesión
create function schema_version()
returns int language sql immutable as $$ select 2 $$;

-- ---------- Permisos de ejecución y de tabla -------------------------
grant select on roles, role_permissions to authenticated;
revoke all on roles, role_permissions, inventory_view from anon;
revoke insert, update, delete on inventory_view from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function _move_stock(uuid, uuid, numeric, text, numeric, text, uuid, text) from authenticated;
revoke execute on function _next_number(uuid, text, text) from authenticated;
revoke execute on function handle_new_user() from authenticated;
revoke execute on function protect_last_admin() from authenticated;
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
