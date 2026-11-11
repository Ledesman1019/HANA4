-- =====================================================================
-- ERP HANA4 — Migración 0005: ciclo de aprovisionamiento completo (SAP MM)
--
--   Solicitud de pedido → Aprobación → Orden de compra → Recepción
--   → Factura del proveedor (verificación) → Pago (cuentas por pagar)
--
-- Separa funciones: quien solicita no aprueba su propia solicitud, el
-- almacén recibe, contabilidad registra la factura y tesorería paga.
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0004.
-- =====================================================================
begin;

-- ---------- Catálogo de módulos (reemplaza la lista fija) -------------
-- A partir de ahora, agregar un módulo es insertar una fila aquí.
create table app_modules (
  key   text primary key,
  label text not null,
  sort  int not null default 0
);
insert into app_modules (key, label, sort) values
  ('ventas', 'Ventas', 10), ('facturacion', 'Facturación', 20), ('caja', 'Caja', 30), ('clientes', 'Clientes', 40),
  ('inventario', 'Inventario', 50), ('compras', 'Compras', 60), ('proveedores', 'Proveedores', 70),
  ('cuentas_pagar', 'Cuentas por pagar', 80), ('finanzas', 'Finanzas', 90), ('reportes', 'Reportes', 100),
  ('rrhh', 'Personal', 110), ('configuracion', 'Configuración', 120);

alter table role_permissions drop constraint role_permissions_module_check;
alter table role_permissions add constraint role_permissions_module_fkey foreign key (module) references app_modules (key);

-- Permisos iniciales del módulo nuevo
insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) values
  ('gerente',  'cuentas_pagar', true, true, true, true),
  ('contador', 'cuentas_pagar', true, true, true, false)
on conflict (role_id, module) do nothing;

-- En Compras, "Editar" ahora significa aprobar solicitudes y emitir órdenes.
-- El almacenero solicita y recibe, pero ya no aprueba ni emite órdenes.
update role_permissions set can_edit = false where role_id = 'almacenero' and module = 'compras';

-- ---------- Solicitudes de pedido ------------------------------------
create table purchase_requisitions (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  branch_id     uuid not null references branches (id),
  requested_by  uuid not null references profiles (id),
  justification text not null default '',
  status        text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada', 'convertida')),
  decided_by    uuid references profiles (id),
  decided_at    timestamptz,
  decision_note text not null default '',
  purchase_id   uuid references purchases (id),
  created_at    timestamptz not null default now()
);
create index purchase_requisitions_idx on purchase_requisitions (branch_id, created_at desc);

create table purchase_requisition_items (
  id             uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references purchase_requisitions (id) on delete cascade,
  product_id     uuid not null references products (id),
  quantity       numeric(14,3) not null check (quantity > 0),
  unique (requisition_id, product_id)
);

alter table purchases add column requisition_id uuid references purchase_requisitions (id);

-- ---------- Facturas de proveedor y pagos ----------------------------
create table supplier_invoices (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases (id),
  supplier_id uuid not null references suppliers (id),
  branch_id   uuid not null references branches (id),
  number      text not null,                    -- número de la factura del proveedor
  issue_date  date not null,
  due_date    date not null,
  subtotal    numeric(12,2) not null,
  tax         numeric(12,2) not null,
  total       numeric(12,2) not null check (total > 0),
  paid        numeric(12,2) not null default 0 check (paid >= 0),
  -- bloqueada: su importe no coincide con la orden y espera el visto bueno de Compras
  status      text not null default 'pendiente' check (status in ('bloqueada', 'pendiente', 'parcial', 'pagada', 'anulada')),
  difference  numeric(12,2) not null default 0, -- factura − orden de compra
  note        text not null default '',
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now(),
  check (paid <= total),
  check (due_date >= issue_date)
);
create unique index supplier_invoices_number_idx on supplier_invoices (supplier_id, number) where status <> 'anulada';
create unique index supplier_invoices_purchase_idx on supplier_invoices (purchase_id) where status <> 'anulada';
create index supplier_invoices_due_idx on supplier_invoices (due_date) where status in ('bloqueada', 'pendiente', 'parcial');

create table supplier_payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references supplier_invoices (id),
  amount     numeric(12,2) not null check (amount > 0),
  method     text not null check (method in ('transferencia', 'efectivo', 'cheque', 'tarjeta', 'yape', 'plin')),
  paid_at    date not null,
  reference  text not null default '',          -- número de operación o cheque
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index supplier_payments_invoice_idx on supplier_payments (invoice_id);

-- =====================================================================
-- Operaciones
-- =====================================================================

-- p_items: [{"product_id": "...", "quantity": 10}, ...]
create function create_requisition(p_branch uuid, p_justification text, p_items jsonb)
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
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La solicitud no tiene productos';
  end if;

  insert into purchase_requisitions (id, number, branch_id, requested_by, justification)
  values (v_id, _next_number(p_branch, 'solped', 'SP'), p_branch, auth.uid(), coalesce(trim(p_justification), ''));

  for r in
    select p.id, sum(i.quantity) as quantity
    from (select (e ->> 'product_id')::uuid as product_id, (e ->> 'quantity')::numeric as quantity from jsonb_array_elements(p_items) e) i
    left join products p on p.id = i.product_id
    group by p.id
  loop
    if r.id is null then
      raise exception 'Uno de los productos no existe';
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception 'Cantidad inválida';
    end if;
    insert into purchase_requisition_items (requisition_id, product_id, quantity) values (v_id, r.id, r.quantity);
  end loop;
  return v_id;
end;
$$;

-- Liberación: aprobar o rechazar. Nadie decide sobre su propia solicitud
-- (salvo el administrador, para empresas donde una persona hace todo).
create function decide_requisition(p_id uuid, p_approve boolean, p_note text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req purchase_requisitions;
begin
  if not can('compras', 'edit') then
    raise exception 'Tu rol no puede aprobar solicitudes de pedido';
  end if;
  select * into v_req from purchase_requisitions where id = p_id for update;
  if not found then
    raise exception 'Solicitud no encontrada';
  end if;
  if v_req.status <> 'pendiente' then
    raise exception 'La solicitud ya fue %', v_req.status;
  end if;
  if v_req.requested_by = auth.uid() and app_role() <> 'admin' then
    raise exception 'No puedes aprobar tu propia solicitud: debe revisarla otra persona';
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Indica el motivo del rechazo';
  end if;

  update purchase_requisitions set
    status = case when p_approve then 'aprobada' else 'rechazada' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(trim(p_note), '')
  where id = p_id;

  perform _audit('compra.solicitud', 'solicitud', p_id::text,
    format('%s la solicitud de pedido %s%s', case when p_approve then 'Aprobó' else 'Rechazó' end, v_req.number,
           case when coalesce(trim(p_note), '') <> '' then '. Nota: ' || trim(p_note) else '' end), '{}');
end;
$$;

-- Orden de compra: directa o a partir de una solicitud aprobada.
drop function create_purchase(uuid, uuid, date, text, jsonb);
create function create_purchase(
  p_supplier uuid, p_branch uuid, p_expected_date date, p_note text, p_items jsonb, p_requisition uuid default null
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
  end if;

  select tax_rate into v_rate from company_settings where id = 1;
  v_number := _next_number(p_branch, 'compra', 'OC');

  insert into purchases (id, number, supplier_id, branch_id, expected_date, note, created_by, requisition_id)
  values (v_id, v_number, p_supplier, p_branch, p_expected_date, coalesce(p_note, ''), auth.uid(), p_requisition);

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

  if p_requisition is not null then
    update purchase_requisitions set status = 'convertida', purchase_id = v_id where id = p_requisition;
  end if;
  return v_id;
end;
$$;

-- Entrada de mercadería: la hace el almacén (permiso "Editar" de Inventario)
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
  if not can('inventario', 'edit') then
    raise exception 'La recepción de mercadería la registra el almacén (permiso Editar de Inventario)';
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
declare
  v_number text;
begin
  if not can('compras', 'delete') then
    raise exception 'Tu rol no puede anular órdenes de compra';
  end if;
  update purchases set status = 'anulada' where id = p_purchase and status = 'ordenada' returning number into v_number;
  if v_number is null then
    raise exception 'Solo se pueden anular órdenes pendientes de recepción';
  end if;
  -- La solicitud que la originó vuelve a estar disponible
  update purchase_requisitions set status = 'aprobada', purchase_id = null where purchase_id = p_purchase;
  perform _audit('compra.anulacion', 'orden', p_purchase::text, format('Anuló la orden de compra %s', v_number), '{}');
end;
$$;

-- Verificación de factura: se compara contra la orden recibida. Si el
-- importe difiere más de la tolerancia (1 % o 1.00), queda bloqueada para pago.
create function register_supplier_invoice(
  p_purchase uuid, p_number text, p_issue_date date, p_due_date date, p_total numeric, p_note text default ''
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_po       purchases;
  v_rate     numeric;
  v_total    numeric := round(p_total, 2);
  v_subtotal numeric;
  v_diff     numeric;
  v_blocked  boolean;
  v_id       uuid;
begin
  if not can('cuentas_pagar', 'create') then
    raise exception 'Tu rol no puede registrar facturas de proveedor';
  end if;
  select * into v_po from purchases where id = p_purchase for update;
  if not found then
    raise exception 'Orden de compra no encontrada';
  end if;
  if v_po.status <> 'recibida' then
    raise exception 'Solo se factura una orden ya recibida: primero registra la entrada de mercadería';
  end if;
  if exists (select 1 from supplier_invoices where purchase_id = p_purchase and status <> 'anulada') then
    raise exception 'Esta orden ya tiene una factura registrada';
  end if;
  if coalesce(trim(p_number), '') = '' then
    raise exception 'Indica el número de la factura del proveedor';
  end if;
  if p_issue_date is null or p_due_date is null or p_due_date < p_issue_date then
    raise exception 'La fecha de vencimiento no puede ser anterior a la de emisión';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'Importe inválido';
  end if;

  v_diff := v_total - v_po.total;
  v_blocked := abs(v_diff) > greatest(1, round(v_po.total * 0.01, 2));
  if v_blocked and coalesce(trim(p_note), '') = '' then
    raise exception 'El importe difiere de la orden de compra en %. Explica la diferencia en la nota', to_char(v_diff, 'FM999G999G990D00');
  end if;

  select tax_rate into v_rate from company_settings where id = 1;
  v_subtotal := round(v_total / (1 + v_rate / 100), 2);

  insert into supplier_invoices (purchase_id, supplier_id, branch_id, number, issue_date, due_date, subtotal, tax, total, status, difference, note, created_by)
  values (p_purchase, v_po.supplier_id, v_po.branch_id, upper(trim(p_number)), p_issue_date, p_due_date, v_subtotal, v_total - v_subtotal, v_total,
          case when v_blocked then 'bloqueada' else 'pendiente' end, v_diff, coalesce(trim(p_note), ''), auth.uid())
  returning id into v_id;

  if v_blocked then
    perform _audit('pago.factura', 'factura', v_id::text,
      format('Registró la factura %s de la orden %s con una diferencia de %s: quedó bloqueada para pago', upper(trim(p_number)), v_po.number, to_char(v_diff, 'FM999G999G990D00')), '{}');
  end if;
  return v_id;
end;
$$;

-- Compras da el visto bueno a una factura con diferencia de importe
create function release_supplier_invoice(p_invoice uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv supplier_invoices;
begin
  if not can('compras', 'edit') then
    raise exception 'Solo quien aprueba compras puede liberar una factura con diferencia';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Indica por qué se acepta la diferencia';
  end if;
  select * into v_inv from supplier_invoices where id = p_invoice for update;
  if not found or v_inv.status <> 'bloqueada' then
    raise exception 'La factura no está bloqueada';
  end if;
  if v_inv.created_by = auth.uid() and app_role() <> 'admin' then
    raise exception 'No puedes liberar una factura que registraste tú: debe revisarla otra persona';
  end if;
  update supplier_invoices set status = 'pendiente', note = trim(both ' ' from note || ' · Liberada: ' || trim(p_note)) where id = p_invoice;
  perform _audit('pago.factura', 'factura', p_invoice::text,
    format('Liberó para pago la factura %s (diferencia de %s). Motivo: %s', v_inv.number, to_char(v_inv.difference, 'FM999G999G990D00'), trim(p_note)), '{}');
end;
$$;

create function pay_supplier_invoice(p_invoice uuid, p_amount numeric, p_method text, p_paid_at date, p_reference text default '')
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_inv    supplier_invoices;
  v_amount numeric := round(p_amount, 2);
  v_paid   numeric;
begin
  if not can('cuentas_pagar', 'edit') then
    raise exception 'Tu rol no puede registrar pagos a proveedores';
  end if;
  select * into v_inv from supplier_invoices where id = p_invoice for update;
  if not found then
    raise exception 'Factura no encontrada';
  end if;
  if v_inv.status = 'bloqueada' then
    raise exception 'La factura está bloqueada: Compras debe revisar la diferencia con la orden antes de pagarla';
  end if;
  if v_inv.status not in ('pendiente', 'parcial') then
    raise exception 'La factura ya está %', v_inv.status;
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Importe inválido';
  end if;
  if v_amount > v_inv.total - v_inv.paid then
    raise exception 'El pago supera el saldo pendiente (%)', to_char(v_inv.total - v_inv.paid, 'FM999G999G990D00');
  end if;
  if p_method not in ('transferencia', 'efectivo', 'cheque', 'tarjeta', 'yape', 'plin') then
    raise exception 'Medio de pago inválido';
  end if;
  if p_paid_at is null or p_paid_at > current_date + 1 then
    raise exception 'Fecha de pago inválida';
  end if;

  insert into supplier_payments (invoice_id, amount, method, paid_at, reference, created_by)
  values (p_invoice, v_amount, p_method, p_paid_at, coalesce(trim(p_reference), ''), auth.uid());

  v_paid := v_inv.paid + v_amount;
  update supplier_invoices set paid = v_paid, status = case when v_paid >= total then 'pagada' else 'parcial' end where id = p_invoice;

  perform _audit('pago.proveedor', 'factura', p_invoice::text,
    format('Pagó %s de la factura %s a %s (%s)%s', to_char(v_amount, 'FM999G999G990D00'), v_inv.number,
           (select name from suppliers where id = v_inv.supplier_id), p_method,
           case when v_paid >= v_inv.total then '. Factura cancelada' else '' end),
    jsonb_build_object('importe', v_amount, 'saldo', v_inv.total - v_paid));
  return v_inv.total - v_paid;
end;
$$;

create function void_supplier_invoice(p_invoice uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv supplier_invoices;
begin
  if not can('cuentas_pagar', 'delete') then
    raise exception 'Tu rol no puede anular facturas de proveedor';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la anulación';
  end if;
  select * into v_inv from supplier_invoices where id = p_invoice for update;
  if not found or v_inv.status = 'anulada' then
    raise exception 'Factura no encontrada o ya anulada';
  end if;
  if v_inv.paid > 0 then
    raise exception 'La factura ya tiene pagos registrados y no se puede anular';
  end if;
  update supplier_invoices set status = 'anulada', note = trim(both ' ' from note || ' · Anulada: ' || trim(p_reason)) where id = p_invoice;
  perform _audit('pago.factura', 'factura', p_invoice::text, format('Anuló la factura de proveedor %s. Motivo: %s', v_inv.number, trim(p_reason)), '{}');
end;
$$;

-- ---------- Guardar rol: ahora lee los módulos del catálogo ----------
create or replace function save_role(p_id text, p_name text, p_description text, p_permissions jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_id      text := p_id;
  v_is_new  boolean := p_id is null;
  v_name    text := trim(coalesce(p_name, ''));
  v_old     record;
  v_mod     record;
  v_p       jsonb;
  a         text;
  v_before  boolean;
  v_after   boolean;
  v_granted int := 0;
  v_actions jsonb := '{"view":"Ver","create":"Crear","edit":"Editar","delete":"Eliminar"}';
begin
  if not can('configuracion', 'edit') then
    raise exception 'No tienes permiso para gestionar roles';
  end if;
  if v_name = '' then
    raise exception 'El rol necesita un nombre';
  end if;
  if v_id = 'admin' then
    raise exception 'El rol Administrador siempre tiene acceso total y no se modifica';
  end if;
  if v_id is not null and v_id = app_role() then
    raise exception 'No puedes modificar los permisos de tu propio rol';
  end if;

  if v_is_new then
    v_id := 'rol_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into roles (id, name, description) values (v_id, v_name, coalesce(trim(p_description), ''));
  else
    select name into v_old from roles where id = v_id;
    if not found then
      raise exception 'Rol no encontrado';
    end if;
    update roles set name = v_name, description = coalesce(trim(p_description), '') where id = v_id;
    if v_old.name <> v_name then
      perform _audit('rol.nombre', 'rol', v_id, format('Renombró el rol «%s» a «%s»', v_old.name, v_name), '{}');
    end if;
  end if;

  for v_mod in select key, label from app_modules order by sort loop
    v_p := coalesce(p_permissions -> v_mod.key, '{}'::jsonb);
    for a in select jsonb_object_keys(v_actions) loop
      select case a when 'view' then can_view when 'create' then can_create when 'edit' then can_edit else can_delete end
        into v_before from role_permissions where role_id = v_id and module = v_mod.key;
      v_before := coalesce(v_before, false);
      v_after := coalesce((v_p ->> a)::boolean, false);
      if v_after then
        v_granted := v_granted + 1;
      end if;
      if not v_is_new and v_before <> v_after then
        perform _audit('rol.permiso', 'rol', v_id,
          format('%s rol «%s» el permiso %s en %s', case when v_after then 'Concedió al' else 'Quitó al' end, v_name, v_actions ->> a, v_mod.label),
          jsonb_build_object('modulo', v_mod.key, 'accion', a, 'antes', v_before, 'despues', v_after));
      end if;
    end loop;

    insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
    values (v_id, v_mod.key,
      coalesce((v_p ->> 'view')::boolean, false), coalesce((v_p ->> 'create')::boolean, false),
      coalesce((v_p ->> 'edit')::boolean, false), coalesce((v_p ->> 'delete')::boolean, false))
    on conflict (role_id, module) do update set
      can_view = excluded.can_view, can_create = excluded.can_create, can_edit = excluded.can_edit, can_delete = excluded.can_delete;
  end loop;

  if v_is_new then
    perform _audit('rol.creacion', 'rol', v_id, format('Creó el rol «%s» con %s permisos', v_name, v_granted), jsonb_build_object('permisos', p_permissions));
  end if;
  return v_id;
end;
$$;

-- ---------- Contexto de sesión: ahora informa la versión del esquema --
create or replace function schema_version()
returns int language sql immutable as $$ select 5 $$;

create or replace function app_context()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'schema', schema_version(),
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

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table app_modules                enable row level security;
alter table purchase_requisitions      enable row level security;
alter table purchase_requisition_items enable row level security;
alter table supplier_invoices          enable row level security;
alter table supplier_payments          enable row level security;

create policy app_modules_read on app_modules for select to authenticated using (true);
create policy requisitions_read on purchase_requisitions for select to authenticated
  using (requested_by = auth.uid() or can('compras', 'view'));
create policy requisition_items_read on purchase_requisition_items for select to authenticated
  using (exists (select 1 from purchase_requisitions r where r.id = requisition_id));
create policy supplier_invoices_read on supplier_invoices for select to authenticated
  using (can('cuentas_pagar', 'view') or can('compras', 'view'));
create policy supplier_payments_read on supplier_payments for select to authenticated
  using (exists (select 1 from supplier_invoices i where i.id = invoice_id));

-- Solo lectura: todo se escribe con las funciones de arriba
revoke all on app_modules, purchase_requisitions, purchase_requisition_items, supplier_invoices, supplier_payments from anon, authenticated;
grant select on app_modules, purchase_requisitions, purchase_requisition_items, supplier_invoices, supplier_payments to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function _move_stock(uuid, uuid, numeric, text, numeric, text, uuid, text) from authenticated;
revoke execute on function _next_number(uuid, text, text) from authenticated;
revoke execute on function _audit(text, text, text, text, jsonb) from authenticated;
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
