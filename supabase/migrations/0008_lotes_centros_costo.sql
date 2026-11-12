-- =====================================================================
-- ERP HANA4 — Migración 0008
--   1. Lotes y fechas de vencimiento (SAP EWM / MM): salida FEFO automática
--   2. Centros de costo (SAP CO): gasto por área y resultado por sucursal
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0007.
-- Es compatible con la versión anterior de la aplicación.
-- =====================================================================
begin;

-- =====================================================================
-- 1. CENTROS DE COSTO
-- =====================================================================
create table cost_centers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into cost_centers (code, name) values
  ('ADM', 'Administración'),
  ('VEN', 'Ventas'),
  ('LOG', 'Logística y almacén');

create function _cost_center(p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from cost_centers where code = p_code
$$;

-- Centro de costo sugerido para cada categoría de gasto
create function _expense_cost_center(p_category text)
returns uuid language sql stable security definer set search_path = public as $$
  select _cost_center(case p_category
    when 'marketing' then 'VEN' when 'transporte' then 'LOG' when 'mantenimiento' then 'LOG' else 'ADM' end)
$$;

alter table expenses add column cost_center_id uuid references cost_centers (id);
update expenses set cost_center_id = _expense_cost_center(category);

-- Si no se indica, el gasto toma el centro sugerido por su categoría
create function _expense_default_cc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cost_center_id is null then
    new.cost_center_id := _expense_cost_center(new.category);
  end if;
  return new;
end;
$$;
create trigger expenses_default_cc before insert or update on expenses for each row execute function _expense_default_cc();

alter table journal_lines add column cost_center_id uuid references cost_centers (id);
create index journal_lines_cc_idx on journal_lines (cost_center_id) where cost_center_id is not null;

-- ---------- Motor de asientos: ahora lleva el centro de costo ----------
drop function _ln(text, numeric, numeric, text);
create function _ln(p_account text, p_debit numeric, p_credit numeric, p_note text default '', p_cc uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('a', p_account, 'd', round(coalesce(p_debit, 0), 2), 'c', round(coalesce(p_credit, 0), 2), 'n', coalesce(p_note, ''), 'cc', p_cc)
$$;

create or replace function _post_entry(
  p_date date, p_source_type text, p_source_id text, p_description text, p_branch uuid, p_lines jsonb, p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id     uuid := gen_random_uuid();
  v_debit  numeric;
  v_credit numeric;
  v_count  int;
  v_year   int := extract(year from p_date)::int;
  v_n      bigint;
begin
  select coalesce(sum((x ->> 'd')::numeric), 0), coalesce(sum((x ->> 'c')::numeric), 0),
         count(*) filter (where (x ->> 'd')::numeric + (x ->> 'c')::numeric > 0)
    into v_debit, v_credit, v_count
  from jsonb_array_elements(p_lines) x;

  if v_count = 0 then
    return null;
  end if;
  if v_debit <> v_credit then
    raise exception 'Asiento descuadrado: debe %, haber %', v_debit, v_credit;
  end if;
  if v_count < 2 then
    raise exception 'Un asiento necesita al menos dos líneas';
  end if;
  if exists (select 1 from accounting_periods where period = to_char(p_date, 'YYYY-MM') and closed_at is not null) then
    raise exception 'El periodo contable % está cerrado: no se pueden registrar operaciones con esa fecha', to_char(p_date, 'MM/YYYY');
  end if;

  insert into journal_sequences (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = journal_sequences.last_number + 1
  returning last_number into v_n;

  insert into journal_entries (id, number, entry_date, period, source_type, source_id, description, branch_id, reverses, created_by)
  values (v_id, v_year || '-' || lpad(v_n::text, 6, '0'), p_date, to_char(p_date, 'YYYY-MM'),
          p_source_type, p_source_id, p_description, p_branch, p_reverses, auth.uid());

  insert into journal_lines (entry_id, account_code, debit, credit, branch_id, note, cost_center_id)
  select v_id, x ->> 'a', (x ->> 'd')::numeric, (x ->> 'c')::numeric, p_branch, coalesce(x ->> 'n', ''), nullif(x ->> 'cc', '')::uuid
  from jsonb_array_elements(p_lines) x
  where (x ->> 'd')::numeric + (x ->> 'c')::numeric > 0;

  return v_id;
end;
$$;

create or replace function _reverse_source(p_source_type text, p_source_id text, p_date date, p_description text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e     journal_entries;
  v_new uuid;
begin
  for e in
    select * from journal_entries
    where source_type = p_source_type and source_id = p_source_id and reversed_by is null and reverses is null
    order by created_at, number
  loop
    v_new := _post_entry(p_date, p_source_type, p_source_id, p_description || ' (extorno de ' || e.number || ')', e.branch_id,
      (select jsonb_agg(_ln(account_code, credit, debit, note, cost_center_id) order by id) from journal_lines where entry_id = e.id), e.id);
    update journal_entries set reversed_by = v_new where id = e.id;
  end loop;
end;
$$;

-- ---------- Reglas de contabilización con centro de costo -------------
create or replace function _post_sale(p_sale uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s sales;
  v_date date;
begin
  select * into s from sales where id = p_sale;
  if not found or s.total <= 0 then
    return;
  end if;
  v_date := _local_date(s.created_at);
  perform _post_entry(v_date, 'venta', s.id::text, 'Venta ' || s.number, s.branch_id, jsonb_build_array(
    _ln(case when s.payment_method = 'credito' then '1212' else _cash_account(s.payment_method) end, s.total, 0),
    _ln('7011', 0, s.subtotal),
    _ln('40111', 0, s.tax)));
  perform _post_entry(v_date, 'venta', s.id::text, 'Costo de venta ' || s.number, s.branch_id, jsonb_build_array(
    _ln('6911', s.cost_total, 0, '', _cost_center('VEN')),
    _ln('2011', 0, s.cost_total)));
end;
$$;

create or replace function _post_commission(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c commissions;
  s sales;
begin
  select * into c from commissions where id = p_id;
  select * into s from sales where id = c.sale_id;
  perform _post_entry(_local_date(c.created_at), 'comision', c.id::text, 'Comisión de la venta ' || s.number, s.branch_id, jsonb_build_array(
    _ln('6212', c.amount, 0, '', _cost_center('VEN')),
    _ln('4111', 0, c.amount)));
end;
$$;

create or replace function _post_supplier_invoice(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  i    supplier_invoices;
  po   purchases;
  v_diff numeric;
begin
  select * into i from supplier_invoices where id = p_id;
  select * into po from purchases where id = i.purchase_id;
  v_diff := i.subtotal - po.subtotal;
  perform _post_entry(i.issue_date, 'factura_proveedor', i.id::text,
    'Factura ' || i.number || ' de ' || (select name from suppliers where id = i.supplier_id), i.branch_id, jsonb_build_array(
    _ln('4699', po.subtotal, 0),
    _ln('40111', i.tax, 0, 'Crédito fiscal'),
    _ln('6591', greatest(v_diff, 0), 0, 'Diferencia con la orden', _cost_center('LOG')),
    _ln('7599', 0, greatest(-v_diff, 0), 'Diferencia con la orden'),
    _ln('4212', 0, i.total)));
end;
$$;

create or replace function _post_expense(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  x expenses;
begin
  select * into x from expenses where id = p_id;
  perform _post_entry(x.expense_date, 'gasto', x.id::text, 'Gasto: ' || x.description, x.branch_id, jsonb_build_array(
    _ln(_expense_account(x.category), x.amount, 0, '', coalesce(x.cost_center_id, _expense_cost_center(x.category))),
    _ln(_cash_account(x.payment_method), 0, x.amount)));
end;
$$;

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
  elsif m.quantity < 0 then
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Merma de inventario: ' || v_name, m.branch_id,
      jsonb_build_array(_ln('6591', v_value, 0, '', _cost_center('LOG')), _ln('2011', 0, v_value)));
  else
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Sobrante de inventario: ' || v_name, m.branch_id,
      jsonb_build_array(_ln('2011', v_value, 0), _ln('7599', 0, v_value)));
  end if;
end;
$$;

create or replace function _post_cash_difference(p_session uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c cash_sessions;
begin
  select * into c from cash_sessions where id = p_session;
  if coalesce(c.difference, 0) = 0 then
    return;
  end if;
  if c.difference < 0 then
    perform _post_entry(_local_date(c.closed_at), 'caja', c.id::text, 'Faltante en arqueo de caja', c.branch_id,
      jsonb_build_array(_ln('6591', -c.difference, 0, '', _cost_center('VEN')), _ln('1011', 0, -c.difference)));
  else
    perform _post_entry(_local_date(c.closed_at), 'caja', c.id::text, 'Sobrante en arqueo de caja', c.branch_id,
      jsonb_build_array(_ln('1011', c.difference, 0), _ln('7599', 0, c.difference)));
  end if;
end;
$$;

-- Corregir un gasto (incluido su centro de costo) vuelve a contabilizarlo
create or replace function _acc_expenses() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _post_expense(new.id);
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.amount, new.category, new.payment_method, new.expense_date, new.branch_id, new.description, new.cost_center_id)
                       is not distinct from (old.amount, old.category, old.payment_method, old.expense_date, old.branch_id, old.description, old.cost_center_id) then
    return new;
  end if;
  perform _reverse_source('gasto', old.id::text, _local_date(now()), case when tg_op = 'DELETE' then 'Eliminación de gasto' else 'Corrección de gasto' end);
  if tg_op = 'UPDATE' then
    perform _post_expense(new.id);
    return new;
  end if;
  return old;
end;
$$;

-- Asiento manual: cada línea puede llevar centro de costo
create or replace function post_manual_entry(p_date date, p_description text, p_branch uuid, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_id    uuid;
  x       jsonb;
  v_d     numeric;
  v_c     numeric;
  v_cc    uuid;
begin
  if not can('contabilidad', 'create') then
    raise exception 'Tu rol no puede registrar asientos contables';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Describe el motivo del asiento';
  end if;
  if p_date is null or p_date > (now() at time zone (select timezone from company_settings where id = 1))::date then
    raise exception 'Fecha inválida: un asiento no puede tener fecha futura';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'Un asiento necesita al menos dos líneas';
  end if;

  for x in select * from jsonb_array_elements(p_lines) loop
    v_d := round(coalesce((x ->> 'debit')::numeric, 0), 2);
    v_c := round(coalesce((x ->> 'credit')::numeric, 0), 2);
    v_cc := nullif(x ->> 'cost_center', '')::uuid;
    if not exists (select 1 from accounts where code = x ->> 'account' and active) then
      raise exception 'La cuenta % no existe o está inactiva', x ->> 'account';
    end if;
    if v_cc is not null and not exists (select 1 from cost_centers where id = v_cc and active) then
      raise exception 'Centro de costo inválido';
    end if;
    if v_d < 0 or v_c < 0 or (v_d > 0 and v_c > 0) or v_d + v_c = 0 then
      raise exception 'Cada línea debe tener un importe en el debe o en el haber, no en ambos';
    end if;
    v_lines := v_lines || jsonb_build_array(_ln(x ->> 'account', v_d, v_c, left(coalesce(x ->> 'note', ''), 120), v_cc));
  end loop;

  v_id := _post_entry(p_date, 'manual', null, trim(p_description), p_branch, v_lines);
  update journal_entries set source_id = v_id::text where id = v_id;
  perform _audit('contabilidad.asiento', 'asiento', v_id::text,
    format('Registró el asiento manual %s: %s', (select number from journal_entries where id = v_id), trim(p_description)), '{}');
  return v_id;
end;
$$;

-- Centro de costo en las líneas de gasto ya contabilizadas
update journal_lines l set cost_center_id = coalesce(
    (select x.cost_center_id from expenses x where x.id::text = e.source_id),
    _expense_cost_center('otros'))
from journal_entries e
where e.id = l.entry_id and e.source_type = 'gasto' and l.account_code like '6%';
update journal_lines l set cost_center_id = _cost_center(case
    when e.source_type in ('venta', 'comision', 'caja') then 'VEN' else 'LOG' end)
from journal_entries e
where e.id = l.entry_id and l.cost_center_id is null and l.account_code like '6%'
  and e.source_type in ('venta', 'comision', 'caja', 'inventario', 'factura_proveedor');

-- Resultado por sucursal y centro de costo (respeta los permisos del usuario)
create function cost_center_report(p_from date, p_to date)
returns table (branch_id uuid, cost_center_id uuid, account_code text, type text, amount numeric)
language sql stable set search_path = public
as $$
  select l.branch_id, l.cost_center_id, l.account_code, a.type, sum(l.debit - l.credit)
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.code = l.account_code
  where e.entry_date between p_from and p_to and a.type in ('ingreso', 'gasto')
  group by 1, 2, 3, 4
$$;

-- =====================================================================
-- 2. LOTES Y VENCIMIENTOS
-- =====================================================================
alter table products add column track_lots boolean not null default false;
alter table purchase_items add column lot_number text, add column expiry_date date;

create or replace view inventory_view with (security_invoker = true) as
  select
    p.id as product_id, p.sku, p.barcode, p.name, p.description, p.unit, p.cost, p.price, p.min_stock, p.active,
    p.category_id, c.name as category_name,
    b.id as branch_id, b.name as branch_name,
    coalesce(s.quantity, 0) as quantity,
    coalesce(s.quantity, 0) * p.cost as stock_value,
    coalesce(s.quantity, 0) <= p.min_stock as low_stock,
    p.image_url,
    p.track_lots
  from products p
  cross join branches b
  left join categories c on c.id = p.category_id
  left join stock s on s.product_id = p.id and s.branch_id = b.id
  where b.active;

create table lots (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products (id) on delete cascade,
  branch_id   uuid not null references branches (id),
  lot_number  text not null,
  expiry_date date,
  quantity    numeric(14,3) not null default 0 check (quantity >= 0),
  created_at  timestamptz not null default now(),
  unique (product_id, branch_id, lot_number)
);
create index lots_expiry_idx on lots (expiry_date) where quantity > 0;

create table lot_movements (
  id                bigint generated always as identity primary key,
  stock_movement_id bigint not null references stock_movements (id) on delete cascade,
  lot_id            uuid not null references lots (id) on delete cascade,
  quantity          numeric(14,3) not null
);
create index lot_movements_movement_idx on lot_movements (stock_movement_id);

create function _add_to_lot(p_movement bigint, p_product uuid, p_branch uuid, p_lot text, p_expiry date, p_qty numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_lot uuid;
begin
  insert into lots (product_id, branch_id, lot_number, expiry_date, quantity)
  values (p_product, p_branch, p_lot, p_expiry, p_qty)
  on conflict (product_id, branch_id, lot_number) do update set quantity = lots.quantity + excluded.quantity
  returning id into v_lot;
  insert into lot_movements (stock_movement_id, lot_id, quantity) values (p_movement, v_lot, p_qty);
end;
$$;

-- Salida FEFO: primero lo que vence antes. Las ventas no toman lotes vencidos.
create function _consume_lots(p_movement bigint, p_product uuid, p_branch uuid, p_qty numeric, p_sale boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_left  numeric := p_qty;
  v_take  numeric;
  v_today date := _local_date(now());
  l       lots;
begin
  for l in
    select * from lots
    where product_id = p_product and branch_id = p_branch and quantity > 0
      and (not p_sale or expiry_date is null or expiry_date >= v_today)
    order by expiry_date nulls last, created_at
    for update
  loop
    exit when v_left <= 0;
    v_take := least(l.quantity, v_left);
    update lots set quantity = quantity - v_take where id = l.id;
    insert into lot_movements (stock_movement_id, lot_id, quantity) values (p_movement, l.id, -v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    if p_sale then
      raise exception 'Faltan % unidades vigentes de «%»: el resto del stock está vencido. Retíralo del inventario con un ajuste',
        trim(to_char(v_left, 'FM999G999G990D999'), '.,'), (select name from products where id = p_product);
    end if;
    raise exception 'Los lotes de «%» no cubren la salida', (select name from products where id = p_product);
  end if;
end;
$$;

-- Cada movimiento de stock de un producto con lotes mueve también sus lotes
create function _lots_on_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_qty    numeric := abs(new.quantity);
  r        record;
  v_found  boolean := false;
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
    -- Vuelve a los mismos lotes que salieron (anulación) o los recrea en destino (transferencia)
    for r in
      select lo.lot_number, lo.expiry_date, -lm.quantity as qty
      from stock_movements m
      join lot_movements lm on lm.stock_movement_id = m.id
      join lots lo on lo.id = lm.lot_id
      where m.reference_id = new.reference_id and m.product_id = new.product_id
        and m.type = case new.type when 'devolucion' then 'venta' else 'transferencia_salida' end
        and lm.quantity < 0
    loop
      v_found := true;
      perform _add_to_lot(new.id, new.product_id, new.branch_id, r.lot_number, r.expiry_date, r.qty);
    end loop;
    if not v_found then
      perform _add_to_lot(new.id, new.product_id, new.branch_id, 'SIN LOTE', null, v_qty);
    end if;
  else
    perform _add_to_lot(new.id, new.product_id, new.branch_id, 'SIN LOTE', null, v_qty);
  end if;
  return new;
end;
$$;
create trigger stock_movements_lots after insert on stock_movements for each row execute function _lots_on_movement();

-- Activar el control de lotes en un producto con stock crea su lote inicial;
-- desactivarlo descarta sus lotes.
create function _lots_on_tracking() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.track_lots and not old.track_lots then
    insert into lots (product_id, branch_id, lot_number, quantity)
    select new.id, branch_id, 'INICIAL', quantity from stock where product_id = new.id and quantity > 0;
  elsif old.track_lots and not new.track_lots then
    delete from lots where product_id = new.id;
  end if;
  return new;
end;
$$;
create trigger products_lots after update of track_lots on products for each row execute function _lots_on_tracking();

-- Recepción: los productos con lote exigen número de lote y vencimiento
drop function receive_purchase(uuid);
create function receive_purchase(p_purchase uuid, p_lots jsonb default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_purchase purchases;
  v_total_qty numeric;
  v_old_cost  numeric;
  v_lot       jsonb;
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

  -- Lote y vencimiento de cada producto con control de lotes
  for r in
    select distinct pi.product_id, p.name from purchase_items pi join products p on p.id = pi.product_id
    where pi.purchase_id = p_purchase and p.track_lots
  loop
    select x into v_lot from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) x where (x ->> 'product_id')::uuid = r.product_id limit 1;
    if v_lot is null or coalesce(trim(v_lot ->> 'lot_number'), '') = '' or coalesce(v_lot ->> 'expiry_date', '') = '' then
      raise exception 'Indica el lote y la fecha de vencimiento de «%»', r.name;
    end if;
    if (v_lot ->> 'expiry_date')::date <= _local_date(now()) then
      raise exception 'El lote de «%» ya está vencido: no se puede recibir', r.name;
    end if;
    update purchase_items set lot_number = upper(trim(v_lot ->> 'lot_number')), expiry_date = (v_lot ->> 'expiry_date')::date
    where purchase_id = p_purchase and product_id = r.product_id;
  end loop;

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

-- Corregir el número o el vencimiento de un lote (por ejemplo, el lote INICIAL)
create function update_lot(p_lot uuid, p_lot_number text, p_expiry date)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l lots;
begin
  if not can('inventario', 'edit') then
    raise exception 'Tu rol no puede modificar lotes';
  end if;
  if coalesce(trim(p_lot_number), '') = '' then
    raise exception 'Indica el número de lote';
  end if;
  select * into l from lots where id = p_lot for update;
  if not found then
    raise exception 'Lote no encontrado';
  end if;
  if exists (select 1 from lots where product_id = l.product_id and branch_id = l.branch_id and lot_number = upper(trim(p_lot_number)) and id <> p_lot) then
    raise exception 'Ya existe un lote con ese número para este producto';
  end if;
  update lots set lot_number = upper(trim(p_lot_number)), expiry_date = p_expiry where id = p_lot;
  perform _audit('stock.lote', 'lote', p_lot::text,
    format('Modificó el lote %s de «%s»: ahora %s, vence %s', l.lot_number, (select name from products where id = l.product_id),
           upper(trim(p_lot_number)), coalesce(to_char(p_expiry, 'DD/MM/YYYY'), 'sin fecha')), '{}');
end;
$$;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table cost_centers  enable row level security;
alter table lots          enable row level security;
alter table lot_movements enable row level security;

create policy cost_centers_read on cost_centers for select to authenticated using (app_role() is not null);
create policy cost_centers_insert on cost_centers for insert to authenticated with check (can('contabilidad', 'create'));
create policy cost_centers_update on cost_centers for update to authenticated
  using (can('contabilidad', 'create')) with check (can('contabilidad', 'create'));
create policy lots_read on lots for select to authenticated using (app_role() is not null);
create policy lot_movements_read on lot_movements for select to authenticated using (can('inventario', 'view'));

revoke all on cost_centers, lots, lot_movements from anon, authenticated;
grant select, insert, update on cost_centers to authenticated;
grant select on lots, lot_movements to authenticated;

create or replace function schema_version()
returns int language sql immutable as $$ select 8 $$;

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
grant execute on function needs_setup() to anon;
grant execute on function schema_version() to anon;

commit;
