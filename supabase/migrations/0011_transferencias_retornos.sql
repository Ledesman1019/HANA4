-- =====================================================================
-- ERP HANA4 — Migración 0011: transferencias en tránsito y retornos a proveedor
--   1. Transferencias con guía: sale de una tienda, viaja «en tránsito» y la
--      tienda de destino la recibe (contando lo que llegó). Las diferencias
--      quedan como merma o sobrante en destino.
--   2. Retorno a proveedor: salida de mercadería que el proveedor debe reponer
--      o abonar (cuenta 1673 Reclamaciones a terceros, no es una merma).
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0010.
-- Es compatible con la versión anterior del ERP y de RLS Tools.
-- =====================================================================
begin;

-- =====================================================================
-- 1. TRANSFERENCIAS EN TRÁNSITO
-- =====================================================================
create table transfer_orders (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique,                                 -- TR001-00000001
  from_branch  uuid not null references branches (id),
  to_branch    uuid not null references branches (id),
  status       text not null default 'en_transito' check (status in ('en_transito', 'recibida', 'recibida_con_diferencias')),
  note         text not null default '',
  created_by   uuid references profiles (id),
  created_at   timestamptz not null default now(),
  received_by  uuid references profiles (id),
  received_at  timestamptz,
  receive_note text not null default '',
  check (from_branch <> to_branch)
);
create index transfer_orders_to_idx on transfer_orders (to_branch, status, created_at desc);
create index transfer_orders_from_idx on transfer_orders (from_branch, created_at desc);

create table transfer_order_items (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid not null references transfer_orders (id) on delete cascade,
  product_id        uuid not null references products (id),
  quantity_sent     numeric(14,3) not null check (quantity_sent > 0),
  quantity_received numeric(14,3) check (quantity_received >= 0),
  unit_cost         numeric(12,2) not null default 0,
  unique (transfer_id, product_id)
);

-- Envía mercadería a otra tienda: sale del stock de origen y queda en tránsito
create function rls_send_transfer(p_op uuid, p_from uuid, p_to uuid, p_items jsonb, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done jsonb := _op_done(p_op);
  v_id   uuid := gen_random_uuid();
  v_num  text;
  v_n    int := 0;
  p      products;
  r      record;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'edit') then
    raise exception 'Tu rol no puede transferir mercadería';
  end if;
  if p_from = p_to then
    raise exception 'El origen y el destino deben ser distintos';
  end if;
  if (select count(*) from branches where id in (p_from, p_to) and active) <> 2 then
    raise exception 'Sucursal inválida';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia no tiene productos';
  end if;

  v_num := _next_number(p_from, 'transferencia', 'TR');
  insert into transfer_orders (id, number, from_branch, to_branch, note, created_by)
  values (v_id, v_num, p_from, p_to, coalesce(trim(p_note), ''), auth.uid());

  for r in
    select trim(e ->> 'code') as code, sum((e ->> 'quantity')::numeric) as quantity
    from jsonb_array_elements(p_items) e group by trim(e ->> 'code')
  loop
    p := _product_by_code(r.code);
    if p.id is null then
      raise exception 'El código % no corresponde a ningún producto del ERP', r.code;
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception 'Cantidad inválida para «%»', p.name;
    end if;
    insert into transfer_order_items (transfer_id, product_id, quantity_sent, unit_cost)
    values (v_id, p.id, r.quantity, p.cost)
    on conflict (transfer_id, product_id) do update set quantity_sent = transfer_order_items.quantity_sent + excluded.quantity_sent;
    perform _move_stock(p.id, p_from, -r.quantity, 'transferencia_salida', p.cost, 'transfer_order', v_id, 'Guía ' || v_num);
    v_n := v_n + 1;
  end loop;

  perform _audit('inventario.transferencia', 'transferencia', v_id::text,
    format('Envió la transferencia %s a %s con %s productos', v_num, (select name from branches where id = p_to), v_n), '{}');
  return _op_record(p_op, p_from, 'transferencia.enviar', format('Envió %s (%s productos)', v_num, v_n),
    jsonb_build_object('transfer_id', v_id, 'number', v_num, 'products', v_n));
end;
$$;

-- Recibe una transferencia en la tienda de destino. Ingresa lo enviado (los
-- lotes viajan con la mercadería) y registra la diferencia contada como
-- ajuste en destino: así lotes, stock y contabilidad cuadran solos.
create function rls_receive_transfer(p_op uuid, p_transfer uuid, p_items jsonb, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done  jsonb := _op_done(p_op);
  t       transfer_orders;
  r       record;
  v_recv  numeric;
  v_diffs int := 0;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'edit') then
    raise exception 'Tu rol no puede recibir transferencias';
  end if;
  select * into t from transfer_orders where id = p_transfer for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if t.status <> 'en_transito' then
    raise exception 'La transferencia % ya fue recibida', t.number;
  end if;

  for r in select i.*, p.name from transfer_order_items i join products p on p.id = i.product_id where i.transfer_id = t.id loop
    select coalesce(sum((e ->> 'quantity')::numeric), 0) into v_recv
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where (e ->> 'product_id')::uuid = r.product_id;
    if v_recv < 0 then raise exception 'Cantidad inválida para «%»', r.name; end if;

    perform _move_stock(r.product_id, t.to_branch, r.quantity_sent, 'transferencia_entrada', r.unit_cost, 'transfer_order', t.id, 'Guía ' || t.number);
    if v_recv <> r.quantity_sent then
      v_diffs := v_diffs + 1;
      perform _move_stock(r.product_id, t.to_branch, v_recv - r.quantity_sent, 'ajuste', r.unit_cost, 'transfer_order', t.id,
        format('%s en la guía %s: enviado %s, recibido %s', case when v_recv < r.quantity_sent then 'Faltante' else 'Sobrante' end,
               t.number, r.quantity_sent, v_recv));
    end if;
    update transfer_order_items set quantity_received = v_recv where id = r.id;
  end loop;

  update transfer_orders
  set status = case when v_diffs > 0 then 'recibida_con_diferencias' else 'recibida' end,
      received_by = auth.uid(), received_at = now(), receive_note = coalesce(trim(p_note), '')
  where id = t.id;
  perform _audit('inventario.transferencia_recibida', 'transferencia', t.id::text,
    format('Recibió la transferencia %s%s', t.number, case when v_diffs > 0 then format(' con %s diferencias', v_diffs) else '' end), '{}');
  return _op_record(p_op, t.to_branch, 'transferencia.recibir', format('Recibió %s', t.number),
    jsonb_build_object('transfer_id', t.id, 'differences', v_diffs));
end;
$$;

-- =====================================================================
-- 2. RETORNO A PROVEEDOR
-- =====================================================================
insert into accounts (code, name, type) values ('1673', 'Reclamaciones a terceros (retornos a proveedores)', 'activo')
on conflict (code) do nothing;

create table supplier_returns (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,                                  -- DV001-00000001
  branch_id   uuid not null references branches (id),
  supplier_id uuid not null references suppliers (id),
  purchase_id uuid references purchases (id),
  reason      text not null,
  total_cost  numeric(12,2) not null default 0,
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);
create index supplier_returns_branch_idx on supplier_returns (branch_id, created_at desc);

create table supplier_return_items (
  id         uuid primary key default gen_random_uuid(),
  return_id  uuid not null references supplier_returns (id) on delete cascade,
  product_id uuid not null references products (id),
  quantity   numeric(14,3) not null check (quantity > 0),
  unit_cost  numeric(12,2) not null default 0
);

create function rls_supplier_return(p_op uuid, p_branch uuid, p_supplier uuid, p_purchase uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_done  jsonb := _op_done(p_op);
  v_id    uuid := gen_random_uuid();
  v_num   text;
  v_total numeric := 0;
  p       products;
  r       record;
begin
  if v_done is not null then return v_done; end if;
  if not can('inventario', 'edit') then
    raise exception 'Tu rol no puede registrar retornos a proveedor';
  end if;
  if length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'Indica el motivo del retorno (ej. «Producto dañado»)';
  end if;
  if not exists (select 1 from suppliers where id = p_supplier) then
    raise exception 'Proveedor inválido';
  end if;
  if p_purchase is not null and not exists (select 1 from purchases where id = p_purchase and supplier_id = p_supplier) then
    raise exception 'La orden de compra no es de ese proveedor';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El retorno no tiene productos';
  end if;

  v_num := _next_number(p_branch, 'retorno', 'DV');
  insert into supplier_returns (id, number, branch_id, supplier_id, purchase_id, reason, created_by)
  values (v_id, v_num, p_branch, p_supplier, p_purchase, trim(p_reason), auth.uid());

  for r in
    select trim(e ->> 'code') as code, sum((e ->> 'quantity')::numeric) as quantity
    from jsonb_array_elements(p_items) e group by trim(e ->> 'code')
  loop
    p := _product_by_code(r.code);
    if p.id is null then
      raise exception 'El código % no corresponde a ningún producto del ERP', r.code;
    end if;
    if r.quantity is null or r.quantity <= 0 then
      raise exception 'Cantidad inválida para «%»', p.name;
    end if;
    insert into supplier_return_items (return_id, product_id, quantity, unit_cost) values (v_id, p.id, r.quantity, p.cost);
    perform _move_stock(p.id, p_branch, -r.quantity, 'ajuste', p.cost, 'retorno_proveedor', v_id, format('Retorno a proveedor %s: %s', v_num, trim(p_reason)));
    v_total := v_total + round(r.quantity * p.cost, 2);
  end loop;

  update supplier_returns set total_cost = v_total where id = v_id;
  perform _audit('compras.retorno', 'proveedor', p_supplier::text,
    format('Retornó mercadería al proveedor (%s) por %s. Motivo: %s', v_num, to_char(v_total, 'FM999G999G990D00'), trim(p_reason)), '{}');
  return _op_record(p_op, p_branch, 'retorno.proveedor', format('Retorno %s a proveedor', v_num),
    jsonb_build_object('return_id', v_id, 'number', v_num, 'total', v_total));
end;
$$;

-- Contabilización de movimientos: el retorno a proveedor no es merma, es un
-- reclamo al proveedor (1673) hasta que reponga o emita su nota de crédito.
create or replace function _post_stock_movement(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m       stock_movements;
  v_value numeric;
  v_name  text;
begin
  select * into m from stock_movements where id = p_id;
  v_value := round(abs(m.quantity) * m.unit_cost, 2);
  if v_value = 0 then
    return;
  end if;
  select name into v_name from products where id = m.product_id;
  if m.type = 'inicial' then
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Inventario inicial de ' || v_name, m.branch_id,
      jsonb_build_array(_ln('2011', v_value, 0), _ln('5911', 0, v_value)));
  elsif m.reference_type = 'retorno_proveedor' then
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Retorno a proveedor: ' || v_name, m.branch_id,
      jsonb_build_array(_ln('1673', v_value, 0, 'Por reponer o abonar'), _ln('2011', 0, v_value)));
  elsif m.quantity < 0 then
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Merma de inventario: ' || v_name, m.branch_id,
      jsonb_build_array(_ln('6591', v_value, 0, '', _cost_center('LOG')), _ln('2011', 0, v_value)));
  else
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Sobrante de inventario: ' || v_name, m.branch_id,
      jsonb_build_array(_ln('2011', v_value, 0), _ln('7599', 0, v_value)));
  end if;
end;
$$;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table transfer_orders enable row level security;
alter table transfer_order_items enable row level security;
alter table supplier_returns enable row level security;
alter table supplier_return_items enable row level security;

create policy transfer_orders_read on transfer_orders for select to authenticated using (can('inventario', 'view') or can('inventario', 'create'));
create policy transfer_items_read on transfer_order_items for select to authenticated
  using (exists (select 1 from transfer_orders t where t.id = transfer_id));
create policy supplier_returns_read on supplier_returns for select to authenticated
  using (can('inventario', 'view') or can('compras', 'view') or can('cuentas_pagar', 'view'));
create policy supplier_return_items_read on supplier_return_items for select to authenticated
  using (exists (select 1 from supplier_returns s where s.id = return_id));

revoke all on transfer_orders, transfer_order_items, supplier_returns, supplier_return_items from anon, authenticated;
grant select on transfer_orders, transfer_order_items, supplier_returns, supplier_return_items to authenticated;

create or replace function schema_version()
returns int language sql immutable as $$ select 11 $$;

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
