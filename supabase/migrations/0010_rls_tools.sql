-- =====================================================================
-- ERP HANA4 — Migración 0010: RLS Tools (app móvil de almacén)
--   1. Ubicaciones de almacén y ubicación de cada producto
--   2. Sesiones de inventario físico por zona, con conteo ciego
--   3. Movimientos desde el celular: entradas, salidas, transferencias, ubicación
--   4. Bitácora de operaciones móviles: cada operación trae su id generado en el
--      celular, así reenviarla tras un corte de señal no la duplica (idempotencia)
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0009.
-- Es compatible con la versión anterior del ERP.
-- =====================================================================
begin;

-- =====================================================================
-- 1. UBICACIONES
-- =====================================================================
create table warehouse_locations (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches (id),
  code        text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),   -- ej. A-01-03 (pasillo-estante-nivel)
  zone        text not null default '' check (length(zone) <= 40),        -- ej. ABARROTES, BEBIDAS, TRASTIENDA
  description text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (branch_id, code)
);
create index warehouse_locations_zone_idx on warehouse_locations (branch_id, zone);

-- Ubicación principal de cada producto en cada sucursal
create table product_locations (
  product_id  uuid not null references products (id) on delete cascade,
  branch_id   uuid not null references branches (id),
  location_id uuid not null references warehouse_locations (id),
  updated_by  uuid references profiles (id),
  updated_at  timestamptz not null default now(),
  primary key (product_id, branch_id)
);

-- =====================================================================
-- 2. INVENTARIO FÍSICO
-- =====================================================================
create table count_sessions (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,                                      -- IF001-00000001
  branch_id   uuid not null references branches (id),
  name        text not null check (length(name) between 3 and 80),
  zone        text not null default '',                                  -- '' = toda la sucursal
  blind       boolean not null default true,                             -- conteo ciego: no muestra el stock al contar
  status      text not null default 'abierta' check (status in ('abierta', 'cerrada', 'aplicada', 'anulada')),
  full_count  boolean not null default false,                            -- lo no contado se toma como 0 al cerrar
  note        text not null default '',
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now(),
  closed_by   uuid references profiles (id),
  closed_at   timestamptz,
  applied_by  uuid references profiles (id),
  applied_at  timestamptz,
  void_reason text
);
create index count_sessions_branch_idx on count_sessions (branch_id, created_at desc);

create table count_lines (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references count_sessions (id) on delete cascade,
  product_id  uuid not null references products (id),
  location_id uuid references warehouse_locations (id),
  counted     numeric(14,3) not null default 0 check (counted >= 0),
  system_qty  numeric(14,3),            -- foto del stock del ERP al cerrar el conteo
  unit_cost   numeric(12,2),            -- foto del costo al cerrar (diferencia valorizada)
  updated_by  uuid references profiles (id),
  updated_at  timestamptz not null default now()
);
create unique index count_lines_key on count_lines (session_id, product_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Códigos escaneados que no existen en el ERP: se reportan para darlos de alta
create table count_unknown_codes (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references count_sessions (id) on delete cascade,
  code       text not null,
  quantity   numeric(14,3) not null default 0,
  scanned_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (session_id, code)
);

-- =====================================================================
-- 3. BITÁCORA DE OPERACIONES MÓVILES (idempotencia y trazabilidad)
-- =====================================================================
create table mobile_operations (
  id         uuid primary key,                         -- generado en el celular
  user_id    uuid not null references profiles (id),
  branch_id  uuid references branches (id),
  kind       text not null,
  summary    text not null default '',
  result     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index mobile_operations_user_idx on mobile_operations (user_id, created_at desc);
create index mobile_operations_branch_idx on mobile_operations (branch_id, created_at desc);

-- Devuelve el resultado guardado si la operación ya se aplicó (reintento tras corte de señal)
create function _op_done(p_op uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select result || jsonb_build_object('repetida', true) from mobile_operations where id = p_op and user_id = auth.uid()
$$;

create function _op_record(p_op uuid, p_branch uuid, p_kind text, p_summary text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_op is null then
    raise exception 'Falta el identificador de la operación';
  end if;
  insert into mobile_operations (id, user_id, branch_id, kind, summary, result)
  values (p_op, auth.uid(), p_branch, p_kind, left(coalesce(p_summary, ''), 300), coalesce(p_result, '{}'));
  return p_result;
end;
$$;

-- Producto por código de barras o SKU (el escáner lee cualquiera de los dos)
create function _product_by_code(p_code text)
returns products language sql stable security definer set search_path = public as $$
  select * from products
  where barcode = trim(p_code) or upper(sku) = upper(trim(p_code))
  order by (barcode = trim(p_code)) desc nulls last
  limit 1
$$;

-- =====================================================================
-- Funciones de conteo
-- =====================================================================
create function rls_open_count(p_op uuid, p_branch uuid, p_name text, p_zone text default '', p_blind boolean default true, p_full boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done jsonb := _op_done(p_op);
  v_id   uuid := gen_random_uuid();
  v_num  text;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'create') then
    raise exception 'Tu rol no puede abrir inventarios';
  end if;
  if not exists (select 1 from branches where id = p_branch and active) then
    raise exception 'Sucursal inválida';
  end if;
  if length(coalesce(trim(p_name), '')) < 3 then
    raise exception 'Ponle un nombre al inventario (ej. «Conteo de bebidas»)';
  end if;
  v_num := _next_number(p_branch, 'conteo', 'IF');
  insert into count_sessions (id, number, branch_id, name, zone, blind, full_count, created_by)
  values (v_id, v_num, p_branch, trim(p_name), upper(coalesce(trim(p_zone), '')), coalesce(p_blind, true), coalesce(p_full, false), auth.uid());
  perform _audit('inventario.conteo_abierto', 'inventario', v_id::text, format('Abrió el inventario %s «%s»', v_num, trim(p_name)), '{}');
  return _op_record(p_op, p_branch, 'conteo.abrir', format('Abrió %s', v_num), jsonb_build_object('session_id', v_id, 'number', v_num));
end;
$$;

-- Registra un conteo: «sumar» (cada escaneo suma) o «fijar» (cantidad contada total)
create function rls_count(p_op uuid, p_session uuid, p_code text, p_qty numeric default 1, p_location uuid default null, p_mode text default 'sumar')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done jsonb := _op_done(p_op);
  s      count_sessions;
  p      products;
  v_qty  numeric;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'create') then
    raise exception 'Tu rol no puede registrar conteos';
  end if;
  if p_mode not in ('sumar', 'fijar') then
    raise exception 'Modo de conteo inválido';
  end if;
  if p_qty is null or p_qty < 0 or p_qty > 999999 or (p_mode = 'sumar' and p_qty = 0) then
    raise exception 'Cantidad inválida';
  end if;
  select * into s from count_sessions where id = p_session for update;
  if not found then
    raise exception 'Inventario no encontrado';
  end if;
  if s.status <> 'abierta' then
    raise exception 'El inventario % ya está %', s.number, s.status;
  end if;
  if p_location is not null and not exists (select 1 from warehouse_locations where id = p_location and branch_id = s.branch_id and active) then
    raise exception 'La ubicación no pertenece a esta sucursal';
  end if;

  p := _product_by_code(p_code);
  if p.id is null then
    -- Código que no existe en el ERP: se reporta, no se descarta
    insert into count_unknown_codes (session_id, code, quantity, scanned_by)
    values (p_session, trim(p_code), p_qty, auth.uid())
    on conflict (session_id, code) do update
      set quantity = case when p_mode = 'fijar' then excluded.quantity else count_unknown_codes.quantity + excluded.quantity end;
    return _op_record(p_op, s.branch_id, 'conteo.desconocido', format('Código no registrado %s en %s', trim(p_code), s.number),
      jsonb_build_object('status', 'desconocido', 'code', trim(p_code)));
  end if;

  insert into count_lines (session_id, product_id, location_id, counted, updated_by)
  values (p_session, p.id, p_location, p_qty, auth.uid())
  on conflict (session_id, product_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
    set counted = case when p_mode = 'fijar' then excluded.counted else count_lines.counted + excluded.counted end,
        updated_by = auth.uid(), updated_at = now()
  returning counted into v_qty;

  return _op_record(p_op, s.branch_id, 'conteo.registro', format('%s %s × %s en %s', case p_mode when 'fijar' then 'Fijó' else 'Contó' end, p.name, p_qty, s.number),
    jsonb_build_object('status', 'ok', 'product_id', p.id, 'name', p.name, 'sku', p.sku, 'active', p.active, 'counted', v_qty));
end;
$$;

-- Cierra el conteo: toma la foto del stock y del costo del ERP en ese momento
create function rls_close_count(p_op uuid, p_session uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done jsonb := _op_done(p_op);
  s      count_sessions;
  v_lines int;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'create') then
    raise exception 'Tu rol no puede cerrar inventarios';
  end if;
  select * into s from count_sessions where id = p_session for update;
  if not found then raise exception 'Inventario no encontrado'; end if;
  if s.status <> 'abierta' then
    raise exception 'El inventario % ya está %', s.number, s.status;
  end if;

  -- Conteo completo: lo que tiene stock y no se contó, se registra como 0 (faltante)
  if s.full_count then
    insert into count_lines (session_id, product_id, counted, updated_by)
    select s.id, st.product_id, 0, auth.uid()
    from stock st
    join products pr on pr.id = st.product_id and pr.active
    where st.branch_id = s.branch_id and st.quantity > 0
      and not exists (select 1 from count_lines l where l.session_id = s.id and l.product_id = st.product_id)
      and (s.zone = '' or exists (
        select 1 from product_locations pl join warehouse_locations wl on wl.id = pl.location_id
        where pl.product_id = st.product_id and pl.branch_id = s.branch_id and wl.zone = s.zone));
  end if;

  update count_lines l
  set system_qty = coalesce((select quantity from stock where product_id = l.product_id and branch_id = s.branch_id), 0),
      unit_cost = (select cost from products where id = l.product_id)
  where l.session_id = s.id;
  select count(distinct product_id) into v_lines from count_lines where session_id = s.id;
  if v_lines = 0 then
    raise exception 'El inventario no tiene productos contados';
  end if;

  update count_sessions set status = 'cerrada', closed_by = auth.uid(), closed_at = now() where id = s.id;
  perform _audit('inventario.conteo_cerrado', 'inventario', s.id::text, format('Cerró el inventario %s con %s productos', s.number, v_lines), '{}');
  return _op_record(p_op, s.branch_id, 'conteo.cerrar', format('Cerró y envió %s', s.number), jsonb_build_object('session_id', s.id, 'products', v_lines));
end;
$$;

-- Aplica el inventario al ERP: ajusta solo la diferencia contada (contado − stock al cerrar),
-- así las ventas hechas entre el cierre y la aplicación no se pierden.
create function rls_apply_count(p_op uuid, p_session uuid, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done  jsonb := _op_done(p_op);
  s       count_sessions;
  r       record;
  v_count int := 0;
  v_value numeric := 0;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'edit') then
    raise exception 'Solo quien puede ajustar stock aplica inventarios';
  end if;
  select * into s from count_sessions where id = p_session for update;
  if not found then raise exception 'Inventario no encontrado'; end if;
  if s.status <> 'cerrada' then
    raise exception 'Solo se aplica un inventario cerrado (estado actual: %)', s.status;
  end if;

  for r in
    select l.product_id, sum(l.counted) as counted, max(l.system_qty) as system_qty, max(l.unit_cost) as unit_cost
    from count_lines l where l.session_id = s.id
    group by l.product_id
    having sum(l.counted) <> max(l.system_qty)
  loop
    perform _move_stock(r.product_id, s.branch_id, r.counted - r.system_qty, 'ajuste', r.unit_cost, 'conteo', s.id,
      format('Inventario físico %s%s', s.number, case when coalesce(trim(p_note), '') <> '' then ': ' || trim(p_note) else '' end));
    v_count := v_count + 1;
    v_value := v_value + (r.counted - r.system_qty) * coalesce(r.unit_cost, 0);
  end loop;

  update count_sessions set status = 'aplicada', applied_by = auth.uid(), applied_at = now(), note = coalesce(trim(p_note), '') where id = s.id;
  perform _audit('inventario.conteo_aplicado', 'inventario', s.id::text,
    format('Aplicó el inventario %s: %s ajustes, diferencia valorizada %s', s.number, v_count, to_char(v_value, 'FM999G999G990D00')), '{}');
  return _op_record(p_op, s.branch_id, 'conteo.aplicar', format('Aplicó %s (%s ajustes)', s.number, v_count),
    jsonb_build_object('session_id', s.id, 'adjustments', v_count, 'value', round(v_value, 2)));
end;
$$;

create function rls_cancel_count(p_op uuid, p_session uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done jsonb := _op_done(p_op);
  s      count_sessions;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'create') then
    raise exception 'Tu rol no puede anular inventarios';
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then
    raise exception 'Indica el motivo de la anulación';
  end if;
  select * into s from count_sessions where id = p_session for update;
  if not found then raise exception 'Inventario no encontrado'; end if;
  if s.status not in ('abierta', 'cerrada') then
    raise exception 'El inventario % ya está %', s.number, s.status;
  end if;
  update count_sessions set status = 'anulada', void_reason = trim(p_reason) where id = s.id;
  perform _audit('inventario.conteo_anulado', 'inventario', s.id::text, format('Anuló el inventario %s. Motivo: %s', s.number, trim(p_reason)), '{}');
  return _op_record(p_op, s.branch_id, 'conteo.anular', format('Anuló %s', s.number), jsonb_build_object('session_id', s.id));
end;
$$;

-- =====================================================================
-- Movimientos de almacén desde el celular
--   entrada / salida: suma o resta stock (ajuste con motivo; se contabiliza solo)
--   transferencia: a otra sucursal (igual que en el ERP)
--   ubicacion: cambia la ubicación del producto en la sucursal
-- =====================================================================
create function rls_move(p_op uuid, p_kind text, p_code text, p_branch uuid, p_qty numeric default null,
                         p_to_branch uuid default null, p_location uuid default null, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done    jsonb := _op_done(p_op);
  p         products;
  v_balance numeric;
  v_note    text := coalesce(trim(p_note), '');
  v_loc     warehouse_locations;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'edit') then
    raise exception 'Tu rol no puede registrar movimientos de almacén';
  end if;
  if p_kind not in ('entrada', 'salida', 'transferencia', 'ubicacion') then
    raise exception 'Tipo de movimiento inválido';
  end if;
  if not exists (select 1 from branches where id = p_branch and active) then
    raise exception 'Sucursal inválida';
  end if;
  p := _product_by_code(p_code);
  if p.id is null then
    raise exception 'El código % no corresponde a ningún producto del ERP', trim(p_code);
  end if;

  if p_kind in ('entrada', 'salida', 'transferencia') then
    if p_qty is null or p_qty <= 0 or p_qty > 999999 then
      raise exception 'Cantidad inválida';
    end if;
    if p_kind <> 'transferencia' and length(v_note) < 3 then
      raise exception 'Indica el motivo (ej. «Devolución de cliente», «Merma por rotura»)';
    end if;
  end if;

  if p_kind = 'entrada' then
    v_balance := _move_stock(p.id, p_branch, p_qty, 'ajuste', p.cost, 'movil', p_op, 'Entrada: ' || v_note);
  elsif p_kind = 'salida' then
    v_balance := _move_stock(p.id, p_branch, -p_qty, 'ajuste', p.cost, 'movil', p_op, 'Salida: ' || v_note);
  elsif p_kind = 'transferencia' then
    if p_to_branch is null then raise exception 'Elige la sucursal de destino'; end if;
    perform transfer_stock(p.id, p_branch, p_to_branch, p_qty, coalesce(nullif(v_note, ''), 'Transferencia desde RLS Tools'));
    select quantity into v_balance from stock where product_id = p.id and branch_id = p_branch;
  else
    select * into v_loc from warehouse_locations where id = p_location and branch_id = p_branch and active;
    if not found then raise exception 'La ubicación no existe en esta sucursal'; end if;
    insert into product_locations (product_id, branch_id, location_id, updated_by)
    values (p.id, p_branch, v_loc.id, auth.uid())
    on conflict (product_id, branch_id) do update set location_id = excluded.location_id, updated_by = auth.uid(), updated_at = now();
    perform _audit('inventario.ubicacion', 'producto', p.id::text, format('Ubicó «%s» en %s', p.name, v_loc.code), '{}');
  end if;

  return _op_record(p_op, p_branch, 'movimiento.' || p_kind,
    case p_kind
      when 'entrada' then format('Entrada de %s × %s', p.name, p_qty)
      when 'salida' then format('Salida de %s × %s', p.name, p_qty)
      when 'transferencia' then format('Transfirió %s × %s', p.name, p_qty)
      else format('Ubicó %s en %s', p.name, v_loc.code) end,
    jsonb_build_object('product_id', p.id, 'name', p.name, 'balance', v_balance, 'location', v_loc.code));
end;
$$;

-- =====================================================================
-- Seguridad: se lee con permiso de inventario; se escribe solo por funciones
-- =====================================================================
alter table warehouse_locations enable row level security;
alter table product_locations enable row level security;
alter table count_sessions enable row level security;
alter table count_lines enable row level security;
alter table count_unknown_codes enable row level security;
alter table mobile_operations enable row level security;

create policy locations_read on warehouse_locations for select to authenticated using (app_role() is not null);
create policy locations_insert on warehouse_locations for insert to authenticated with check (can('inventario', 'create'));
create policy locations_update on warehouse_locations for update to authenticated
  using (can('inventario', 'edit') or can('inventario', 'delete')) with check (can('inventario', 'edit') or can('inventario', 'delete'));
create policy product_locations_read on product_locations for select to authenticated using (app_role() is not null);
create policy count_sessions_read on count_sessions for select to authenticated using (can('inventario', 'view') or can('inventario', 'create'));
create policy count_lines_read on count_lines for select to authenticated
  using (exists (select 1 from count_sessions s where s.id = session_id));
create policy count_unknown_read on count_unknown_codes for select to authenticated
  using (exists (select 1 from count_sessions s where s.id = session_id));
create policy mobile_operations_read on mobile_operations for select to authenticated
  using (user_id = auth.uid() or can('inventario', 'view'));

revoke all on warehouse_locations, product_locations, count_sessions, count_lines, count_unknown_codes, mobile_operations from anon, authenticated;
grant select on warehouse_locations, product_locations, count_sessions, count_lines, count_unknown_codes, mobile_operations to authenticated;
grant insert, update on warehouse_locations to authenticated;

create or replace function schema_version()
returns int language sql immutable as $$ select 10 $$;

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
