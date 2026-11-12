-- =====================================================================
-- ERP HANA4 — Migración 0009
--   1. Doce roles con mínimo privilegio. El menú de cada rol sale de su matriz
--      de permisos, así que cada rol ve solo sus módulos.
--   2. Vendedor ≠ Cajero: la comisión es de quien vende (cotiza), no de quien cobra.
--   3. Pago de planilla (sueldo + comisiones) con su asiento contable,
--      y «Mis datos» para que cada colaborador vea su ficha y sus pagos.
--   4. Compras: proveedores con plazo de crédito (30 días), centro de costo
--      en solicitudes y órdenes, y pedido por empaque (caja, paquete…) o unidad.
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0008.
-- Es compatible con la versión anterior de la aplicación.
-- =====================================================================
begin;

-- =====================================================================
-- 1. ROLES Y MATRIZ DE PERMISOS
-- =====================================================================
-- El rol «cajero» deja de llamarse Vendedor: ahora cobra y maneja la caja.
update roles set name = 'Cajero', description = 'Cobra en el punto de venta, recibe pagos de clientes, abre y cierra su caja.'
where id = 'cajero';

insert into roles (id, name, description, is_system) values
  ('gerente_area', 'Gerente de área',  'Supervisa las operaciones y resultados de su área; aprueba solicitudes de pedido.', true),
  ('rrhh',         'Recursos humanos', 'Gestiona colaboradores, comisiones y el pago de la planilla.', true),
  ('vendedor',     'Vendedor',         'Atiende clientes y emite cotizaciones (órdenes de venta) que cobra caja.', true),
  ('comprador',    'Comprador',        'Gestiona proveedores, solicitudes de pedido y órdenes de compra.', true),
  ('auditor',      'Auditor',          'Consulta todas las operaciones y registros sin poder modificarlos.', true),
  ('empleado',     'Empleado',         'Accede solo a sus datos personales, pagos y comisiones.', true)
on conflict (id) do nothing;

update roles set name = 'Gerente general', description = 'Visualiza indicadores, ventas, compras, finanzas y rendimiento; aprueba compras.' where id = 'gerente';
update roles set description = 'Gestiona usuarios, roles, permisos y la configuración de la empresa. Acceso total.' where id = 'admin';
update roles set description = 'Gestiona productos, inventario, recepción de mercadería, ajustes y transferencias.' where id = 'almacenero';
update roles set description = 'Gestiona la contabilidad, comprobantes, facturas de proveedores, balances y estados financieros.' where id = 'contador';

-- Matriz nueva de los roles del sistema (los roles creados por el usuario no se tocan).
-- Letras: v = ver, c = crear, e = editar, d = eliminar/desactivar.
delete from role_permissions
where role_id in ('gerente', 'gerente_area', 'contador', 'rrhh', 'vendedor', 'almacenero', 'comprador', 'cajero', 'auditor', 'empleado');

insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
select role_id, module, flags like '%v%', flags like '%c%', flags like '%e%', flags like '%d%'
from (values
  -- Gerente general: ve todo el negocio y aprueba compras; no registra operaciones
  ('gerente', 'ventas', 'v'), ('gerente', 'facturacion', 'v'), ('gerente', 'caja', 'v'), ('gerente', 'clientes', 'v'),
  ('gerente', 'cuentas_cobrar', 've'), ('gerente', 'inventario', 'v'), ('gerente', 'compras', 've'), ('gerente', 'proveedores', 'v'),
  ('gerente', 'cuentas_pagar', 've'), ('gerente', 'finanzas', 'v'), ('gerente', 'contabilidad', 'v'), ('gerente', 'rrhh', 'v'),
  ('gerente', 'reportes', 'v'),
  -- Gerente de área: supervisa la operación (ventas, almacén, compras) y aprueba solicitudes
  ('gerente_area', 'ventas', 'v'), ('gerente_area', 'caja', 'v'), ('gerente_area', 'clientes', 'v'),
  ('gerente_area', 'inventario', 'v'), ('gerente_area', 'compras', 've'), ('gerente_area', 'proveedores', 'v'),
  ('gerente_area', 'reportes', 'v'),
  -- Contador: contabilidad, gastos, facturas de proveedor y comprobantes
  ('contador', 'contabilidad', 'vce'), ('contador', 'finanzas', 'vce'), ('contador', 'cuentas_pagar', 'vce'),
  ('contador', 'cuentas_cobrar', 've'), ('contador', 'facturacion', 'v'), ('contador', 'reportes', 'v'),
  -- Recursos humanos
  ('rrhh', 'rrhh', 'vced'),
  -- Vendedor: clientes (registrar, no editar) y cotizaciones; vende con caja solo si se le asigna
  ('vendedor', 'ventas', 'c'), ('vendedor', 'clientes', 'vc'),
  -- Almacenero: inventario completo y ver las órdenes que debe recibir
  ('almacenero', 'inventario', 'vced'), ('almacenero', 'compras', 'v'),
  -- Comprador: proveedores, solicitudes y órdenes de compra; consulta stock para reponer
  ('comprador', 'proveedores', 'vced'), ('comprador', 'compras', 'vce'), ('comprador', 'inventario', 'v'),
  -- Cajero: cobra en el punto de venta, cobra créditos y maneja su caja
  ('cajero', 'ventas', 'c'), ('cajero', 'caja', 'c'), ('cajero', 'clientes', 'vc'), ('cajero', 'cuentas_cobrar', 'vc'),
  -- Auditor: solo lectura de todo
  ('auditor', 'ventas', 'v'), ('auditor', 'facturacion', 'v'), ('auditor', 'caja', 'v'), ('auditor', 'clientes', 'v'),
  ('auditor', 'cuentas_cobrar', 'v'), ('auditor', 'inventario', 'v'), ('auditor', 'compras', 'v'), ('auditor', 'proveedores', 'v'),
  ('auditor', 'cuentas_pagar', 'v'), ('auditor', 'finanzas', 'v'), ('auditor', 'contabilidad', 'v'), ('auditor', 'rrhh', 'v'),
  ('auditor', 'reportes', 'v'), ('auditor', 'configuracion', 'v')
  -- Empleado: sin módulos; solo «Mis datos»
) as m(role_id, module, flags);

-- Las altas sin rol nacen como Empleado (mínimo privilegio) e inactivas.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_first  boolean;
  v_branch uuid;
begin
  perform pg_advisory_xact_lock(hashtext('erp_new_user'));
  select not exists (select 1 from profiles) into v_first;
  select id into v_branch from branches where active order by code limit 1;

  -- El primer usuario es el Super Administrador. Los demás nacen sin acceso:
  -- el servidor les asigna rol y sucursal cuando un administrador los crea.
  insert into profiles (id, full_name, email, role, branch_id, active, is_super)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    case when v_first then 'admin' else 'empleado' end,
    v_branch,
    v_first,
    v_first
  );
  return new;
end;
$$;

-- El Super Administrador se muestra con su propio nombre de rol.
create or replace function app_context()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'schema', schema_version(),
    'profile',  (select to_jsonb(p) from profiles p where p.id = auth.uid()),
    'role_name', (select case when p.is_super then 'Superadministrador' else r.name end
                  from profiles p join roles r on r.id = p.role where p.id = auth.uid() and app_role() is not null),
    'settings', (select to_jsonb(s) from company_settings s where s.id = 1 and app_role() is not null),
    'branches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.code), '[]'::jsonb)
                 from branches b where b.active and app_role() is not null),
    'permissions', (select coalesce(jsonb_object_agg(rp.module, jsonb_build_object(
                      'view', rp.can_view, 'create', rp.can_create, 'edit', rp.can_edit, 'delete', rp.can_delete)), '{}'::jsonb)
                    from role_permissions rp where rp.role_id = app_role())
  )
$$;

-- =====================================================================
-- 2. VENDEDOR Y CAJERO: la comisión es de quien vende
-- =====================================================================
alter table sales add column seller_id uuid references profiles (id);
update sales s set seller_id = coalesce((select q.created_by from quotations q where q.id = s.quotation_id), s.cashier_id);
create index sales_seller_idx on sales (seller_id, created_at desc);

create function sales_set_seller()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Venta desde una cotización: vende quien la emitió; si no, quien cobra.
  new.seller_id := coalesce((select created_by from quotations where id = new.quotation_id), new.cashier_id);
  return new;
end;
$$;
create trigger sales_set_seller before insert on sales for each row execute function sales_set_seller();

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
    on conflict (sale_id) do nothing;
  end if;
  if new.status = 'anulada' and old.status <> 'anulada' then
    update commissions set status = 'anulada' where sale_id = new.id;
  end if;
  return new;
end;
$$;

drop policy sales_read on sales;
create policy sales_read on sales for select to authenticated
  using (cashier_id = auth.uid() or seller_id = auth.uid() or can('ventas', 'view') or can('reportes', 'view') or can('finanzas', 'view')
         or (payment_method = 'credito' and can('cuentas_cobrar', 'view')));

-- Caja cobra las cotizaciones que emiten los vendedores.
drop policy quotations_read on quotations;
create policy quotations_read on quotations for select to authenticated
  using (created_by = auth.uid() or can('ventas', 'view') or (can('ventas', 'create') and can('caja', 'create')));

-- Cuentas por pagar registra la factura contra la orden de compra (verificación de facturas).
drop policy purchases_read on purchases;
create policy purchases_read on purchases for select to authenticated using (can('compras', 'view') or can('cuentas_pagar', 'view'));
drop policy pitems_read on purchase_items;
create policy pitems_read on purchase_items for select to authenticated using (can('compras', 'view') or can('cuentas_pagar', 'view'));
drop policy suppliers_read on suppliers;
create policy suppliers_read on suppliers for select to authenticated
  using (can('proveedores', 'view') or can('compras', 'view') or can('cuentas_pagar', 'view'));

-- Línea de crédito: la asigna control de crédito (Cuentas por cobrar → editar)
-- sin necesitar permiso para editar los demás datos del cliente.
-- El disparador protect_customer_credit deja la constancia en la auditoría.
create function set_customer_credit(p_customer uuid, p_limit numeric, p_days int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not can('cuentas_cobrar', 'edit') then
    raise exception 'Tu rol no puede modificar la línea de crédito de un cliente';
  end if;
  if p_limit is null or p_limit < 0 or p_limit > 99999999 then
    raise exception 'Línea de crédito inválida';
  end if;
  if p_days is null or p_days < 0 or p_days > 365 then
    raise exception 'Plazo inválido (0 a 365 días)';
  end if;
  update customers set credit_limit = round(p_limit, 2), credit_days = p_days where id = p_customer and active;
  if not found then
    raise exception 'Cliente no encontrado o inactivo';
  end if;
end;
$$;

-- =====================================================================
-- 3. COMPRAS: plazo de crédito, centro de costo y pedido por empaque
-- =====================================================================
alter table suppliers add column payment_terms int not null default 30 check (payment_terms between 0 and 365);

-- Presentación de compra del producto: «CAJA» de 12 unidades, «PAQUETE» de 6…
alter table products
  add column pack_unit text not null default '' check (pack_unit = '' or pack_unit ~ '^[A-Z]{2,12}$'),
  add column pack_size numeric(12,3) not null default 1 check (pack_size >= 1);

-- La vista de inventario expone la presentación de compra (columnas al final: compatible)
create or replace view inventory_view with (security_invoker = true) as
  select
    p.id as product_id, p.sku, p.barcode, p.name, p.description, p.unit, p.cost, p.price, p.min_stock, p.active,
    p.category_id, c.name as category_name,
    b.id as branch_id, b.name as branch_name,
    coalesce(s.quantity, 0) as quantity,
    coalesce(s.quantity, 0) * p.cost as stock_value,
    coalesce(s.quantity, 0) <= p.min_stock as low_stock,
    p.image_url,
    p.track_lots,
    p.pack_unit,
    p.pack_size
  from products p
  cross join branches b
  left join categories c on c.id = p.category_id
  left join stock s on s.product_id = p.id and s.branch_id = b.id
  where b.active;

alter table purchase_requisitions add column cost_center_id uuid references cost_centers (id);
alter table purchases add column cost_center_id uuid references cost_centers (id);

-- En cada línea: la cantidad sigue en unidades base; el empaque es cómo se pidió.
alter table purchase_requisition_items
  add column pack_unit text not null default '',
  add column pack_size numeric(12,3) not null default 1 check (pack_size >= 1);
alter table purchase_items
  add column pack_unit text not null default '',
  add column pack_size numeric(12,3) not null default 1 check (pack_size >= 1);

drop function create_requisition(uuid, text, jsonb);
create function create_requisition(p_branch uuid, p_justification text, p_items jsonb, p_cost_center uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  r    record;
begin
  if not can('compras', 'create') then
    raise exception 'Tu rol no puede crear solicitudes de pedido';
  end if;
  if not exists (select 1 from branches where id = p_branch and active) then
    raise exception 'Sucursal inválida';
  end if;
  if p_cost_center is not null and not exists (select 1 from cost_centers where id = p_cost_center and active) then
    raise exception 'Centro de costo inválido';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La solicitud no tiene productos';
  end if;

  insert into purchase_requisitions (id, number, branch_id, requested_by, justification, cost_center_id)
  values (v_id, _next_number(p_branch, 'solped', 'SP'), p_branch, auth.uid(), coalesce(trim(p_justification), ''), p_cost_center);

  for r in
    select p.id, i.pack_unit, i.pack_size, sum(i.quantity) as quantity
    from (
      select (e ->> 'product_id')::uuid as product_id,
             (e ->> 'quantity')::numeric as quantity,
             upper(coalesce(nullif(trim(e ->> 'pack_unit'), ''), '')) as pack_unit,
             coalesce((e ->> 'pack_size')::numeric, 1) as pack_size
      from jsonb_array_elements(p_items) e
    ) i
    left join products p on p.id = i.product_id
    group by p.id, i.pack_unit, i.pack_size
  loop
    if r.id is null then
      raise exception 'Uno de los productos no existe';
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception 'Cantidad inválida';
    end if;
    if r.pack_size < 1 or (r.pack_unit <> '' and r.pack_unit !~ '^[A-Z]{2,12}$') then
      raise exception 'Empaque inválido';
    end if;
    insert into purchase_requisition_items (requisition_id, product_id, quantity, pack_unit, pack_size)
    values (v_id, r.id, r.quantity, r.pack_unit, case when r.pack_unit = '' then 1 else r.pack_size end);
  end loop;
  return v_id;
end;
$$;

drop function create_purchase(uuid, uuid, date, text, jsonb, uuid);
create function create_purchase(
  p_supplier uuid, p_branch uuid, p_expected_date date, p_note text, p_items jsonb, p_requisition uuid default null, p_cost_center uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id       uuid := gen_random_uuid();
  v_rate     numeric;
  v_subtotal numeric := 0;
  v_tax      numeric;
  v_number   text;
  v_req      purchase_requisitions;
  v_cc       uuid := p_cost_center;
  r          record;
begin
  if not can('compras', 'edit') then
    raise exception 'Tu rol no puede emitir órdenes de compra. Crea una solicitud de pedido';
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

  if p_requisition is not null then
    select * into v_req from purchase_requisitions where id = p_requisition for update;
    if not found or v_req.status <> 'aprobada' then
      raise exception 'La solicitud de pedido no está aprobada';
    end if;
    if v_req.branch_id <> p_branch then
      raise exception 'La solicitud pertenece a otra sucursal';
    end if;
    -- La orden hereda el centro de costo de la solicitud si no se indica otro
    v_cc := coalesce(v_cc, v_req.cost_center_id);
  end if;
  if v_cc is not null and not exists (select 1 from cost_centers where id = v_cc and active) then
    raise exception 'Centro de costo inválido';
  end if;

  select tax_rate into v_rate from company_settings where id = 1;
  v_number := _next_number(p_branch, 'compra', 'OC');

  insert into purchases (id, number, supplier_id, branch_id, expected_date, note, created_by, requisition_id, cost_center_id)
  values (v_id, v_number, p_supplier, p_branch, p_expected_date, coalesce(p_note, ''), auth.uid(), p_requisition, v_cc);

  for r in
    select p.id, i.quantity, i.unit_cost, i.pack_unit, i.pack_size
    from (
      select (e ->> 'product_id')::uuid as product_id,
             (e ->> 'quantity')::numeric as quantity,
             (e ->> 'unit_cost')::numeric as unit_cost,
             upper(coalesce(nullif(trim(e ->> 'pack_unit'), ''), '')) as pack_unit,
             coalesce((e ->> 'pack_size')::numeric, 1) as pack_size
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
    if r.pack_size < 1 or (r.pack_unit <> '' and r.pack_unit !~ '^[A-Z]{2,12}$') then
      raise exception 'Empaque inválido';
    end if;
    -- Cantidad en unidades base y costo por unidad base (el costo promedio no cambia de lógica)
    insert into purchase_items (purchase_id, product_id, quantity, unit_cost, total, pack_unit, pack_size)
    values (v_id, r.id, r.quantity, round(r.unit_cost, 2), round(r.quantity * r.unit_cost, 2),
            r.pack_unit, case when r.pack_unit = '' then 1 else r.pack_size end);
    v_subtotal := v_subtotal + round(r.quantity * r.unit_cost, 2);
  end loop;

  v_tax := round(v_subtotal * v_rate / 100, 2);
  update purchases set subtotal = v_subtotal, tax = v_tax, total = v_subtotal + v_tax where id = v_id;

  if p_requisition is not null then
    update purchase_requisitions set status = 'convertida', purchase_id = v_id where id = p_requisition;
  end if;
  return v_id;
end;
$$;

-- =====================================================================
-- 4. PLANILLA: pago de sueldos y comisiones
-- =====================================================================
alter table employees add column cost_center_id uuid references cost_centers (id);

create table payroll_payments (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  employee_id uuid not null references employees (id),
  branch_id   uuid not null references branches (id),
  period      text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  salary      numeric(12,2) not null default 0 check (salary >= 0),
  commissions numeric(12,2) not null default 0 check (commissions >= 0),
  total       numeric(12,2) not null check (total > 0),
  method      text not null check (method in ('efectivo', 'transferencia')),
  paid_at     date not null,
  note        text not null default '',
  status      text not null default 'pagado' check (status in ('pagado', 'anulado')),
  void_reason text,
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);
-- Un pago vigente por colaborador y mes
create unique index payroll_one_per_period on payroll_payments (employee_id, period) where status = 'pagado';
create index payroll_period_idx on payroll_payments (period desc, created_at desc);

-- Cada comisión se paga una sola vez
alter table commissions add column payroll_id uuid references payroll_payments (id);

create function pay_payroll(p_period text, p_employees uuid[], p_method text, p_date date, p_note text default '')
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
  if not can('rrhh', 'create') then
    raise exception 'Tu rol no puede pagar la planilla';
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

    -- Sueldo al gasto del centro de costo del colaborador; las comisiones ya estaban
    -- provisionadas (6212 contra 4111): aquí se cancela esa deuda.
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

create function void_payroll_payment(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v payroll_payments;
  v_today date;
begin
  if not can('rrhh', 'delete') then
    raise exception 'Tu rol no puede anular pagos de planilla';
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

-- =====================================================================
-- 5. AUTOSERVICIO: cada colaborador ve su propia ficha y sus pagos
-- =====================================================================
drop policy employees_read on employees;
create policy employees_read on employees for select to authenticated using (can('rrhh', 'view') or profile_id = auth.uid());

alter table payroll_payments enable row level security;
create policy payroll_read on payroll_payments for select to authenticated
  using (can('rrhh', 'view') or employee_id = my_employee_id());
revoke all on payroll_payments from anon, authenticated;
grant select on payroll_payments to authenticated;

-- =====================================================================
-- Versión y permisos de ejecución
-- =====================================================================
create or replace function schema_version()
returns int language sql immutable as $$ select 9 $$;

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
-- Las funciones de trigger no se llaman directamente
revoke execute on function sales_set_seller() from authenticated;
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
