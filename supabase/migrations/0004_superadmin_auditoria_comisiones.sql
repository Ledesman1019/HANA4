-- =====================================================================
-- ERP HANA4 — Migración 0004
--   1. Super Administrador: el único que crea, modifica o retira administradores
--   2. Registro de auditoría: quién cambió qué y cuándo (no se puede editar ni borrar)
--   3. Comisiones: cada venta genera la comisión de su vendedor en Personal
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0003.
-- =====================================================================
begin;

-- =====================================================================
-- 1. SUPER ADMINISTRADOR
-- =====================================================================
alter table profiles add column is_super boolean not null default false;

-- El administrador más antiguo (quien instaló el sistema) pasa a ser Super Administrador
update profiles set is_super = true
where id = (select id from profiles where role = 'admin' and active order by created_at limit 1);

create function is_super()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_super from profiles where id = auth.uid() and active and role = 'admin'), false)
$$;

-- Un administrador solo puede ser tocado por un Super Administrador
drop policy profiles_update on profiles;
create policy profiles_update on profiles for update to authenticated
  using (can('configuracion', 'edit') and (role <> 'admin' or is_super()))
  with check (can('configuracion', 'edit') and (role <> 'admin' or is_super()));

create or replace function protect_last_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Reglas para personas (el servidor, sin sesión de usuario, ya validó por su cuenta)
  if auth.uid() is not null and not is_super() then
    if new.is_super is distinct from old.is_super then
      raise exception 'Solo un Super Administrador puede conceder o retirar ese nivel';
    end if;
    if (old.role = 'admin' or new.role = 'admin')
       and (new.role is distinct from old.role or new.active is distinct from old.active) then
      raise exception 'Solo un Super Administrador puede nombrar, modificar o desactivar administradores';
    end if;
  end if;

  -- El nivel Super solo existe dentro del rol Administrador
  if new.role <> 'admin' then
    new.is_super := false;
  end if;

  if old.is_super and old.active and (not new.is_super or not new.active)
     and not exists (select 1 from profiles where is_super and active and id <> old.id) then
    raise exception 'Debe quedar al menos un Super Administrador activo';
  end if;

  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'Debe quedar al menos un administrador activo';
  end if;
  return new;
end;
$$;

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
    case when v_first then 'admin' else 'cajero' end,
    v_branch,
    v_first,
    v_first
  );
  return new;
end;
$$;

-- =====================================================================
-- 2. REGISTRO DE AUDITORÍA
-- =====================================================================
create table audit_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id   uuid,
  actor_name text not null default 'Sistema',
  action     text not null,        -- p. ej. rol.permiso, usuario.rol, venta.anulacion
  entity     text not null,
  entity_id  text,
  summary    text not null,        -- frase legible: «Quitó al rol Vendedor el permiso…»
  details    jsonb not null default '{}'
);
create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_action_idx on audit_log (action, created_at desc);

-- Escribe una entrada a nombre del usuario en sesión. Interna: nadie la llama directo.
create function _audit(p_action text, p_entity text, p_entity_id text, p_summary text, p_details jsonb default '{}')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into audit_log (actor_id, actor_name, action, entity, entity_id, summary, details)
  values (auth.uid(), coalesce((select full_name from profiles where id = auth.uid()), 'Sistema'),
          p_action, p_entity, p_entity_id, p_summary, coalesce(p_details, '{}'));
end;
$$;

-- ---------- Usuarios: rol, acceso, nivel y sucursal -------------------
create function audit_profiles()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old text;
  v_new text;
begin
  if auth.uid() is null then
    return new;   -- cambios hechos por el servidor: los registra la aplicación con su autor
  end if;
  if new.role is distinct from old.role then
    select name into v_old from roles where id = old.role;
    select name into v_new from roles where id = new.role;
    perform _audit('usuario.rol', 'usuario', new.id::text,
      format('Cambió el rol de %s: de %s a %s', new.full_name, coalesce(v_old, old.role), coalesce(v_new, new.role)),
      jsonb_build_object('antes', old.role, 'despues', new.role));
  end if;
  if new.active is distinct from old.active then
    perform _audit('usuario.acceso', 'usuario', new.id::text,
      format('%s la cuenta de %s', case when new.active then 'Reactivó' else 'Desactivó' end, new.full_name), '{}');
  end if;
  if new.is_super is distinct from old.is_super then
    perform _audit('usuario.super', 'usuario', new.id::text,
      format('%s el nivel Super Administrador a %s', case when new.is_super then 'Concedió' else 'Retiró' end, new.full_name), '{}');
  end if;
  if new.branch_id is distinct from old.branch_id then
    perform _audit('usuario.sucursal', 'usuario', new.id::text,
      format('Movió a %s a la sucursal %s', new.full_name, coalesce((select name from branches where id = new.branch_id), '—')), '{}');
  end if;
  return new;
end;
$$;
create trigger profiles_audit after update on profiles
  for each row execute function audit_profiles();

-- ---------- Roles: cada permiso concedido o quitado -------------------
create or replace function save_role(p_id text, p_name text, p_description text, p_permissions jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_id      text := p_id;
  v_is_new  boolean := p_id is null;
  v_name    text := trim(coalesce(p_name, ''));
  v_old     record;
  v_p       jsonb;
  m         text;
  a         text;
  v_before  boolean;
  v_after   boolean;
  v_granted int := 0;
  v_modules jsonb := '{"ventas":"Ventas","facturacion":"Facturación","caja":"Caja","clientes":"Clientes","inventario":"Inventario","compras":"Compras","proveedores":"Proveedores","finanzas":"Finanzas","rrhh":"Personal","reportes":"Reportes","configuracion":"Configuración"}';
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

  for m in select jsonb_object_keys(v_modules) loop
    v_p := coalesce(p_permissions -> m, '{}'::jsonb);
    for a in select jsonb_object_keys(v_actions) loop
      select case a when 'view' then can_view when 'create' then can_create when 'edit' then can_edit else can_delete end
        into v_before from role_permissions where role_id = v_id and module = m;
      v_before := coalesce(v_before, false);
      v_after := coalesce((v_p ->> a)::boolean, false);
      if v_after then
        v_granted := v_granted + 1;
      end if;
      if not v_is_new and v_before <> v_after then
        perform _audit('rol.permiso', 'rol', v_id,
          format('%s rol «%s» el permiso %s en %s', case when v_after then 'Concedió al' else 'Quitó al' end, v_name, v_actions ->> a, v_modules ->> m),
          jsonb_build_object('modulo', m, 'accion', a, 'antes', v_before, 'despues', v_after));
      end if;
    end loop;

    insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete)
    values (v_id, m,
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

create function audit_role_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform _audit('rol.eliminacion', 'rol', old.id, format('Eliminó el rol «%s»', old.name), '{}');
  return old;
end;
$$;
create trigger roles_audit_delete after delete on roles
  for each row execute function audit_role_delete();

-- ---------- Operaciones sensibles -------------------------------------
create function audit_sales()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'anulada' and old.status <> 'anulada' then
    perform _audit('venta.anulacion', 'venta', new.id::text,
      format('Anuló la venta %s por %s. Motivo: %s', new.number, to_char(new.total, 'FM999G999G990D00'), coalesce(new.void_reason, '—')),
      jsonb_build_object('total', new.total));
  end if;
  return new;
end;
$$;
create trigger sales_audit after update on sales
  for each row execute function audit_sales();

create function audit_stock_adjust()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform _audit('stock.ajuste', 'producto', new.product_id::text,
    format('Ajustó el stock de «%s» en %s: %s%s (saldo %s). Motivo: %s',
      (select name from products where id = new.product_id),
      (select name from branches where id = new.branch_id),
      case when new.quantity > 0 then '+' else '' end, trim(to_char(new.quantity, 'FM999G999G990D999'), '.,'),
      trim(to_char(new.balance_after, 'FM999G999G990D999'), '.,'), coalesce(nullif(new.note, ''), '—')),
    jsonb_build_object('cantidad', new.quantity, 'saldo', new.balance_after));
  return new;
end;
$$;
create trigger stock_movements_audit after insert on stock_movements
  for each row when (new.type = 'ajuste') execute function audit_stock_adjust();

create function audit_cash_close()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'cerrada' and old.status = 'abierta' and coalesce(new.difference, 0) <> 0 then
    perform _audit('caja.diferencia', 'caja', new.id::text,
      format('Cerró caja con %s de %s', case when new.difference > 0 then 'sobrante' else 'faltante' end, to_char(abs(new.difference), 'FM999G999G990D00')),
      jsonb_build_object('esperado', new.expected_amount, 'contado', new.counted_amount));
  end if;
  return new;
end;
$$;
create trigger cash_sessions_audit after update on cash_sessions
  for each row execute function audit_cash_close();

create function audit_settings()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_changed text;
begin
  select string_agg(key, ', ') into v_changed
  from jsonb_each(to_jsonb(new)) n
  where key <> 'updated_at' and n.value is distinct from (to_jsonb(old) -> n.key);
  if v_changed is not null then
    perform _audit('empresa.configuracion', 'empresa', '1', 'Modificó la configuración de la empresa: ' || v_changed, '{}');
  end if;
  return new;
end;
$$;
create trigger settings_audit after update on company_settings
  for each row execute function audit_settings();

-- =====================================================================
-- 3. COMISIONES DE VENTA (Ventas → Personal)
-- =====================================================================
alter table employees
  add column profile_id uuid unique references profiles (id) on delete set null,   -- usuario del sistema del colaborador
  add column commission_rate numeric(5,2) not null default 0 check (commission_rate >= 0 and commission_rate <= 100);

create table commissions (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null unique references sales (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  base        numeric(12,2) not null,     -- venta neta (sin impuesto)
  rate        numeric(5,2) not null,      -- % vigente al momento de la venta
  amount      numeric(12,2) not null,
  status      text not null default 'generada' check (status in ('generada', 'anulada')),
  created_at  timestamptz not null default now()
);
create index commissions_employee_idx on commissions (employee_id, created_at desc);

-- Cada venta completada genera la comisión de quien la vendió;
-- si la venta se anula, la comisión también.
create function sales_commission()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completada' and old.total = 0 and new.total > 0 then
    insert into commissions (sale_id, employee_id, base, rate, amount, created_at)
    select new.id, e.id, new.subtotal, e.commission_rate, round(new.subtotal * e.commission_rate / 100, 2), new.created_at
    from employees e
    where e.profile_id = new.cashier_id and e.status <> 'cesado' and e.commission_rate > 0
    on conflict (sale_id) do nothing;
  end if;
  if new.status = 'anulada' and old.status <> 'anulada' then
    update commissions set status = 'anulada' where sale_id = new.id;
  end if;
  return new;
end;
$$;
create trigger sales_commission after update on sales
  for each row execute function sales_commission();

create function audit_employees()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.salary is distinct from old.salary then
    perform _audit('personal.sueldo', 'colaborador', new.id::text,
      format('Cambió el sueldo de %s: de %s a %s', new.full_name, to_char(old.salary, 'FM999G999G990D00'), to_char(new.salary, 'FM999G999G990D00')), '{}');
  end if;
  if new.commission_rate is distinct from old.commission_rate then
    perform _audit('personal.comision', 'colaborador', new.id::text,
      format('Cambió la comisión de %s: de %s%% a %s%%', new.full_name, old.commission_rate, new.commission_rate), '{}');
  end if;
  return new;
end;
$$;
create trigger employees_audit after update on employees
  for each row execute function audit_employees();

-- Colaborador vinculado al usuario en sesión (para que cada vendedor vea sus comisiones)
create function my_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from employees where profile_id = auth.uid()
$$;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table audit_log   enable row level security;
alter table commissions enable row level security;

create policy audit_read on audit_log for select to authenticated using (can('configuracion', 'view'));
create policy commissions_read on commissions for select to authenticated
  using (can('rrhh', 'view') or employee_id = my_employee_id());

-- Solo lectura para las personas: la auditoría no se edita ni se borra
revoke all on audit_log, commissions from anon, authenticated;
grant select on audit_log, commissions to authenticated;

create or replace function schema_version()
returns int language sql immutable as $$ select 4 $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function _move_stock(uuid, uuid, numeric, text, numeric, text, uuid, text) from authenticated;
revoke execute on function _next_number(uuid, text, text) from authenticated;
revoke execute on function _audit(text, text, text, text, jsonb) from authenticated;
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
