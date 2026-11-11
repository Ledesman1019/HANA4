-- =====================================================================
-- ERP HANA4 — Migración 0003: Facturación electrónica (modo DEMO)
--
-- Registra los comprobantes electrónicos (boleta, factura, nota de
-- crédito) y su ciclo de envío. En modo demo la respuesta de SUNAT es
-- simulada: los documentos NO tienen validez tributaria.
-- Para pasar a real solo cambia el proveedor en el servidor; estas
-- tablas y estados ya son los definitivos.
--
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0002.
-- =====================================================================
begin;

-- ---------- Nuevo módulo en la matriz de permisos --------------------
alter table role_permissions drop constraint role_permissions_module_check;
alter table role_permissions add constraint role_permissions_module_check check (module in
  ('ventas','caja','clientes','inventario','compras','proveedores','finanzas','rrhh','reportes','configuracion','facturacion'));

insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) values
  ('gerente',  'facturacion', true, true,  false, false),
  ('contador', 'facturacion', true, true,  false, false)
on conflict (role_id, module) do nothing;

-- ---------- Comprobantes electrónicos --------------------------------
create table e_documents (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references sales (id),
  kind                text not null check (kind in ('boleta', 'factura', 'nota_credito')),
  number              text not null unique,            -- B001-00000012, F001-…, BC001-…
  branch_id           uuid not null references branches (id),
  customer_doc_type   text not null default '',
  customer_doc_number text not null default '',
  customer_name       text not null,
  subtotal            numeric(12,2) not null,
  tax                 numeric(12,2) not null,
  total               numeric(12,2) not null,
  status              text not null default 'pendiente' check (status in ('pendiente', 'aceptado', 'rechazado')),
  environment         text not null default 'demo' check (environment in ('demo', 'produccion')),
  provider            text not null default 'demo',
  hash                text,                             -- resumen (digest) del documento firmado
  response_code       text,                             -- código de la constancia (CDR): "0" = aceptado
  response_message    text,
  reference_id        uuid references e_documents (id), -- nota de crédito → comprobante que modifica
  reason              text,                             -- motivo de la nota de crédito
  attempts            int not null default 0,
  sent_at             timestamptz,
  created_by          uuid references profiles (id),
  created_at          timestamptz not null default now(),
  unique (sale_id, kind)
);
create index e_documents_created_idx on e_documents (branch_id, created_at desc);
create index e_documents_status_idx on e_documents (status) where status <> 'aceptado';

-- Genera (una sola vez) el comprobante electrónico de una venta. Queda
-- "pendiente" hasta que el servidor registre la respuesta del proveedor.
create function issue_e_document(p_sale uuid)
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
  on conflict (sale_id, kind) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from e_documents where sale_id = p_sale and kind = v_sale.doc_type;
  end if;
  return v_id;
end;
$$;

-- Nota de crédito por anulación: revierte el comprobante de una venta anulada.
create function issue_credit_note(p_sale uuid)
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
    raise exception 'Solo se emite nota de crédito de una venta anulada';
  end if;
  if not (can('ventas', 'delete') or can('facturacion', 'create')) then
    raise exception 'Tu rol no puede emitir notas de crédito';
  end if;

  select * into v_doc from e_documents where sale_id = p_sale and kind in ('boleta', 'factura');
  if not found then
    return null;   -- la venta nunca tuvo comprobante electrónico: no hay nada que revertir
  end if;

  select id into v_id from e_documents where sale_id = p_sale and kind = 'nota_credito';
  if v_id is not null then
    return v_id;
  end if;

  insert into e_documents (sale_id, kind, number, branch_id, customer_doc_type, customer_doc_number, customer_name,
                           subtotal, tax, total, reference_id, reason, created_by)
  values (p_sale, 'nota_credito',
          _next_number(v_sale.branch_id, 'nc_' || v_doc.kind, case v_doc.kind when 'factura' then 'FC' else 'BC' end),
          v_sale.branch_id, v_doc.customer_doc_type, v_doc.customer_doc_number, v_doc.customer_name,
          v_doc.subtotal, v_doc.tax, v_doc.total, v_doc.id, coalesce(v_sale.void_reason, 'Anulación de la operación'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- Seguridad -------------------------------------------------
alter table e_documents enable row level security;

-- Cada vendedor ve los comprobantes de sus ventas; "Ver" de Facturación abre todos
create policy e_documents_read on e_documents for select to authenticated
  using (can('facturacion', 'view')
         or exists (select 1 from sales s where s.id = sale_id and s.cashier_id = auth.uid()));

-- Nadie escribe directo: se crean con las funciones de arriba y la respuesta
-- del proveedor la registra únicamente el servidor (clave de servicio).
grant select on e_documents to authenticated;
revoke all on e_documents from anon;

-- ---------- Guardar rol: ahora incluye el módulo Facturación ----------
create or replace function save_role(p_id text, p_name text, p_description text, p_permissions jsonb)
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
  foreach m in array array['ventas','caja','clientes','inventario','compras','proveedores','finanzas','rrhh','reportes','configuracion','facturacion'] loop
    v_p := coalesce(p_permissions -> m, '{}'::jsonb);
    insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
    values (v_id, m,
      coalesce((v_p ->> 'view')::boolean, false), coalesce((v_p ->> 'create')::boolean, false),
      coalesce((v_p ->> 'edit')::boolean, false), coalesce((v_p ->> 'delete')::boolean, false));
  end loop;
  return v_id;
end;
$$;

create or replace function schema_version()
returns int language sql immutable as $$ select 3 $$;

revoke execute on function issue_e_document(uuid) from public, anon;
revoke execute on function issue_credit_note(uuid) from public, anon;
grant execute on function issue_e_document(uuid) to authenticated;
grant execute on function issue_credit_note(uuid) to authenticated;

commit;
