-- =====================================================================
-- ERP HANA4 — Migración 0007: Contabilidad (modelo SAP FI)
--
--   Plan de cuentas (PCGE simplificado) · Libro diario · Libro mayor
--   Asientos automáticos: cada operación genera su asiento al registrarse
--   Periodos contables con cierre · Asientos manuales · Balance de comprobación
--
-- La migración contabiliza también todo el historial existente.
-- Ejecutar en Supabase: SQL Editor → pegar todo → Run. Requiere la 0006.
-- Es compatible con la versión anterior de la aplicación.
-- =====================================================================
begin;

-- ---------- Módulo ----------------------------------------------------
insert into app_modules (key, label, sort) values ('contabilidad', 'Contabilidad', 95);
insert into role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) values
  ('contador', 'contabilidad', true, true, true, false),
  ('gerente',  'contabilidad', true, false, false, false)
on conflict (role_id, module) do nothing;

-- ---------- Plan de cuentas (PCGE) ------------------------------------
create table accounts (
  code   text primary key check (code ~ '^[0-9]{2,8}$'),
  name   text not null,
  type   text not null check (type in ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  active boolean not null default true
);

insert into accounts (code, name, type) values
  ('1011',  'Caja',                                              'activo'),
  ('1041',  'Cuentas corrientes operativas (bancos)',            'activo'),
  ('1212',  'Facturas y boletas por cobrar',                     'activo'),
  ('2011',  'Mercaderías',                                       'activo'),
  ('40111', 'IGV - Cuenta propia',                               'pasivo'),
  ('4111',  'Remuneraciones por pagar',                          'pasivo'),
  ('4212',  'Facturas y boletas por pagar',                      'pasivo'),
  ('4699',  'Mercadería recibida por facturar',                  'pasivo'),
  ('5011',  'Capital social',                                    'patrimonio'),
  ('5911',  'Utilidades acumuladas',                             'patrimonio'),
  ('6211',  'Sueldos y salarios',                                'gasto'),
  ('6212',  'Comisiones a vendedores',                           'gasto'),
  ('6311',  'Transporte y fletes',                               'gasto'),
  ('6343',  'Mantenimiento y reparaciones',                      'gasto'),
  ('6352',  'Alquileres',                                        'gasto'),
  ('6361',  'Servicios básicos',                                 'gasto'),
  ('6371',  'Publicidad y marketing',                            'gasto'),
  ('6411',  'Impuestos y tributos',                              'gasto'),
  ('6591',  'Otros gastos de gestión (mermas y diferencias)',    'gasto'),
  ('6911',  'Costo de ventas - mercaderías',                     'gasto'),
  ('7011',  'Ventas - mercaderías',                              'ingreso'),
  ('7599',  'Otros ingresos de gestión',                         'ingreso');

-- ---------- Libro diario ----------------------------------------------
create table accounting_periods (
  period    text primary key check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  closed_at timestamptz,
  closed_by uuid references profiles (id)
);

create table journal_sequences (
  year        int primary key,
  last_number bigint not null default 0
);

create table journal_entries (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,          -- 2026-000123
  entry_date  date not null,
  period      text not null,
  source_type text not null,                 -- venta, cobro, recepcion, factura_proveedor, pago_proveedor, gasto, comision, inventario, caja, manual
  source_id   text,
  description text not null,
  branch_id   uuid references branches (id),
  reverses    uuid references journal_entries (id),   -- este asiento es el extorno de otro
  reversed_by uuid references journal_entries (id),   -- este asiento fue extornado
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);
create index journal_entries_date_idx on journal_entries (entry_date desc, number desc);
create index journal_entries_source_idx on journal_entries (source_type, source_id);

create table journal_lines (
  id           bigint generated always as identity primary key,
  entry_id     uuid not null references journal_entries (id) on delete cascade,
  account_code text not null references accounts (code),
  debit        numeric(14,2) not null default 0,
  credit       numeric(14,2) not null default 0,
  branch_id    uuid references branches (id),
  note         text not null default '',
  check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0) and debit + credit > 0)
);
create index journal_lines_entry_idx on journal_lines (entry_id);
create index journal_lines_account_idx on journal_lines (account_code);

-- =====================================================================
-- Motor de asientos (interno: nadie lo llama directamente)
-- =====================================================================
create function _ln(p_account text, p_debit numeric, p_credit numeric, p_note text default '')
returns jsonb language sql immutable as $$
  select jsonb_build_object('a', p_account, 'd', round(coalesce(p_debit, 0), 2), 'c', round(coalesce(p_credit, 0), 2), 'n', coalesce(p_note, ''))
$$;

create function _local_date(p_ts timestamptz)
returns date language sql stable security definer set search_path = public as $$
  select (p_ts at time zone (select timezone from company_settings where id = 1))::date
$$;

create function _cash_account(p_method text)
returns text language sql immutable as $$
  select case when p_method = 'efectivo' then '1011' else '1041' end
$$;

-- Registra un asiento cuadrado. Ignora líneas en cero; si no queda nada, no registra.
create function _post_entry(
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

  insert into journal_lines (entry_id, account_code, debit, credit, branch_id, note)
  select v_id, x ->> 'a', (x ->> 'd')::numeric, (x ->> 'c')::numeric, p_branch, coalesce(x ->> 'n', '')
  from jsonb_array_elements(p_lines) x
  where (x ->> 'd')::numeric + (x ->> 'c')::numeric > 0;

  return v_id;
end;
$$;

-- Extorno: revierte (debe ↔ haber) los asientos vigentes de un documento.
create function _reverse_source(p_source_type text, p_source_id text, p_date date, p_description text)
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
      (select jsonb_agg(_ln(account_code, credit, debit, note) order by id) from journal_lines where entry_id = e.id), e.id);
    update journal_entries set reversed_by = v_new where id = e.id;
  end loop;
end;
$$;

-- ---------- Reglas de contabilización por documento -------------------

-- Venta: ingreso + IGV contra caja, bancos o cuentas por cobrar; y su costo.
create function _post_sale(p_sale uuid)
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
    _ln('6911', s.cost_total, 0),
    _ln('2011', 0, s.cost_total)));
end;
$$;

create function _post_commission(p_id uuid)
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
    _ln('6212', c.amount, 0),
    _ln('4111', 0, c.amount)));
end;
$$;

create function _post_customer_payment(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  p customer_payments;
  s sales;
begin
  select * into p from customer_payments where id = p_id;
  select * into s from sales where id = p.sale_id;
  perform _post_entry(p.paid_at, 'cobro', p.id::text, 'Cobro de ' || s.number, s.branch_id, jsonb_build_array(
    _ln(_cash_account(p.method), p.amount, 0),
    _ln('1212', 0, p.amount)));
end;
$$;

-- Recepción: la mercadería entra al almacén a costo de la orden, pendiente de factura
create function _post_reception(p_purchase uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  po purchases;
begin
  select * into po from purchases where id = p_purchase;
  perform _post_entry(_local_date(coalesce(po.received_at, now())), 'recepcion', po.id::text, 'Recepción de la orden ' || po.number, po.branch_id, jsonb_build_array(
    _ln('2011', po.subtotal, 0),
    _ln('4699', 0, po.subtotal)));
end;
$$;

-- Factura del proveedor: cancela lo recibido por facturar, registra el IGV
-- (crédito fiscal) y la deuda. La diferencia con la orden va a resultados.
create function _post_supplier_invoice(p_id uuid)
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
    _ln('6591', greatest(v_diff, 0), 0, 'Diferencia con la orden'),
    _ln('7599', 0, greatest(-v_diff, 0), 'Diferencia con la orden'),
    _ln('4212', 0, i.total)));
end;
$$;

create function _post_supplier_payment(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  p supplier_payments;
  i supplier_invoices;
begin
  select * into p from supplier_payments where id = p_id;
  select * into i from supplier_invoices where id = p.invoice_id;
  perform _post_entry(p.paid_at, 'pago_proveedor', p.id::text, 'Pago de la factura ' || i.number, i.branch_id, jsonb_build_array(
    _ln('4212', p.amount, 0),
    _ln(_cash_account(p.method), 0, p.amount)));
end;
$$;

create function _expense_account(p_category text)
returns text language sql immutable as $$
  select case p_category
    when 'alquiler' then '6352' when 'servicios' then '6361' when 'planilla' then '6211'
    when 'marketing' then '6371' when 'transporte' then '6311' when 'mantenimiento' then '6343'
    when 'impuestos' then '6411' else '6591' end
$$;

create function _post_expense(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  x expenses;
begin
  select * into x from expenses where id = p_id;
  perform _post_entry(x.expense_date, 'gasto', x.id::text, 'Gasto: ' || x.description, x.branch_id, jsonb_build_array(
    _ln(_expense_account(x.category), x.amount, 0),
    _ln(_cash_account(x.payment_method), 0, x.amount)));
end;
$$;

-- Ajustes de inventario: mermas a gasto, sobrantes a ingreso, saldo inicial a patrimonio
create function _post_stock_movement(p_id bigint)
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
      jsonb_build_array(_ln('6591', v_value, 0), _ln('2011', 0, v_value)));
  else
    perform _post_entry(_local_date(m.created_at), 'inventario', m.id::text, 'Sobrante de inventario: ' || v_name, m.branch_id,
      jsonb_build_array(_ln('2011', v_value, 0), _ln('7599', 0, v_value)));
  end if;
end;
$$;

create function _post_cash_difference(p_session uuid)
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
      jsonb_build_array(_ln('6591', -c.difference, 0), _ln('1011', 0, -c.difference)));
  else
    perform _post_entry(_local_date(c.closed_at), 'caja', c.id::text, 'Sobrante en arqueo de caja', c.branch_id,
      jsonb_build_array(_ln('1011', c.difference, 0), _ln('7599', 0, c.difference)));
  end if;
end;
$$;

-- ---------- Disparadores: cada operación se contabiliza al registrarse --
create function _acc_sales() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.total = 0 and new.total > 0 and new.status = 'completada' then
    perform _post_sale(new.id);
  end if;
  if new.status = 'anulada' and old.status <> 'anulada' then
    perform _reverse_source('venta', new.id::text, _local_date(coalesce(new.voided_at, now())), 'Anulación de ' || new.number);
  end if;
  return new;
end;
$$;
create trigger sales_accounting after update on sales for each row execute function _acc_sales();

create function _acc_commissions() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _post_commission(new.id);
  elsif new.status = 'anulada' and old.status <> 'anulada' then
    perform _reverse_source('comision', new.id::text, _local_date(now()), 'Anulación de comisión');
  end if;
  return new;
end;
$$;
create trigger commissions_accounting after insert or update on commissions for each row execute function _acc_commissions();

create function _acc_customer_payments() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _post_customer_payment(new.id);
  return new;
end;
$$;
create trigger customer_payments_accounting after insert on customer_payments for each row execute function _acc_customer_payments();

create function _acc_purchases() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'ordenada' and new.status = 'recibida' then
    perform _post_reception(new.id);
  end if;
  return new;
end;
$$;
create trigger purchases_accounting after update on purchases for each row execute function _acc_purchases();

create function _acc_supplier_invoices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _post_supplier_invoice(new.id);
  elsif new.status = 'anulada' and old.status <> 'anulada' then
    perform _reverse_source('factura_proveedor', new.id::text, _local_date(now()), 'Anulación de la factura ' || new.number);
  end if;
  return new;
end;
$$;
create trigger supplier_invoices_accounting after insert or update on supplier_invoices for each row execute function _acc_supplier_invoices();

create function _acc_supplier_payments() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _post_supplier_payment(new.id);
  return new;
end;
$$;
create trigger supplier_payments_accounting after insert on supplier_payments for each row execute function _acc_supplier_payments();

create function _acc_expenses() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _post_expense(new.id);
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.amount, new.category, new.payment_method, new.expense_date, new.branch_id, new.description)
                       is not distinct from (old.amount, old.category, old.payment_method, old.expense_date, old.branch_id, old.description) then
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
create trigger expenses_accounting after insert or update or delete on expenses for each row execute function _acc_expenses();

create function _acc_stock_movements() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _post_stock_movement(new.id);
  return new;
end;
$$;
create trigger stock_movements_accounting after insert on stock_movements
  for each row when (new.type in ('ajuste', 'inicial')) execute function _acc_stock_movements();

create function _acc_cash_sessions() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'abierta' and new.status = 'cerrada' then
    perform _post_cash_difference(new.id);
  end if;
  return new;
end;
$$;
create trigger cash_sessions_accounting after update on cash_sessions for each row execute function _acc_cash_sessions();

-- =====================================================================
-- Operaciones del contador
-- =====================================================================

-- Asiento manual (ajustes, aportes de capital, retiros de caja, etc.)
-- p_lines: [{"account": "1011", "debit": 100, "credit": 0, "note": "..."}, ...]
create function post_manual_entry(p_date date, p_description text, p_branch uuid, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_id    uuid;
  x       jsonb;
  v_d     numeric;
  v_c     numeric;
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
    if not exists (select 1 from accounts where code = x ->> 'account' and active) then
      raise exception 'La cuenta % no existe o está inactiva', x ->> 'account';
    end if;
    if v_d < 0 or v_c < 0 or (v_d > 0 and v_c > 0) or v_d + v_c = 0 then
      raise exception 'Cada línea debe tener un importe en el debe o en el haber, no en ambos';
    end if;
    v_lines := v_lines || jsonb_build_array(_ln(x ->> 'account', v_d, v_c, left(coalesce(x ->> 'note', ''), 120)));
  end loop;

  v_id := _post_entry(p_date, 'manual', null, trim(p_description), p_branch, v_lines);
  update journal_entries set source_id = v_id::text where id = v_id;
  perform _audit('contabilidad.asiento', 'asiento', v_id::text,
    format('Registró el asiento manual %s: %s', (select number from journal_entries where id = v_id), trim(p_description)), '{}');
  return v_id;
end;
$$;

create function reverse_manual_entry(p_entry uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  e journal_entries;
begin
  if not can('contabilidad', 'create') then
    raise exception 'Tu rol no puede extornar asientos';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo del extorno';
  end if;
  select * into e from journal_entries where id = p_entry for update;
  if not found or e.source_type <> 'manual' then
    raise exception 'Solo se extornan asientos manuales: los automáticos se revierten anulando su documento de origen';
  end if;
  if e.reversed_by is not null or e.reverses is not null then
    raise exception 'El asiento ya fue extornado';
  end if;
  perform _reverse_source('manual', e.source_id, _local_date(now()), trim(p_reason));
  perform _audit('contabilidad.asiento', 'asiento', e.id::text, format('Extornó el asiento %s. Motivo: %s', e.number, trim(p_reason)), '{}');
end;
$$;

create function set_period_status(p_period text, p_closed boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_current text := to_char((now() at time zone (select timezone from company_settings where id = 1))::date, 'YYYY-MM');
begin
  if not can('contabilidad', 'edit') then
    raise exception 'Tu rol no puede abrir ni cerrar periodos contables';
  end if;
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periodo inválido';
  end if;
  if p_closed and p_period >= v_current then
    raise exception 'Solo se cierran meses ya terminados: el periodo actual debe seguir abierto para operar';
  end if;
  insert into accounting_periods (period, closed_at, closed_by)
  values (p_period, case when p_closed then now() end, case when p_closed then auth.uid() end)
  on conflict (period) do update set closed_at = excluded.closed_at, closed_by = excluded.closed_by;
  perform _audit('contabilidad.periodo', 'periodo', p_period,
    format('%s el periodo contable %s', case when p_closed then 'Cerró' else 'Reabrió' end, p_period), '{}');
end;
$$;

-- ---------- Reportes (respetan los permisos del usuario) --------------
-- Balance de comprobación: saldo inicial, movimientos del rango y saldo final por cuenta
create function trial_balance(p_from date, p_to date, p_branch uuid default null)
returns table (code text, name text, type text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable set search_path = public
as $$
  select a.code, a.name, a.type,
         coalesce(sum(case when e.entry_date < p_from then l.debit - l.credit end), 0) as opening,
         coalesce(sum(case when e.entry_date >= p_from then l.debit end), 0) as debit,
         coalesce(sum(case when e.entry_date >= p_from then l.credit end), 0) as credit,
         coalesce(sum(l.debit - l.credit), 0) as closing
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join accounts a on a.code = l.account_code
  where e.entry_date <= p_to and (p_branch is null or l.branch_id = p_branch)
  group by a.code, a.name, a.type
  order by a.code
$$;

-- Libro mayor: movimientos de una cuenta en orden cronológico
create function account_ledger(p_account text, p_from date, p_to date, p_branch uuid default null)
returns table (entry_id uuid, number text, entry_date date, description text, source_type text, note text, debit numeric, credit numeric)
language sql stable set search_path = public
as $$
  select e.id, e.number, e.entry_date, e.description, e.source_type, l.note, l.debit, l.credit
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  where l.account_code = p_account and e.entry_date between p_from and p_to
    and (p_branch is null or l.branch_id = p_branch)
  order by e.entry_date, e.number, l.id
$$;

-- =====================================================================
-- Contabilización del historial existente (en orden cronológico)
-- =====================================================================
do $$
declare
  r record;
begin
  for r in
    select * from (
      select created_at as ts, 'venta' as kind, id::text as id from sales where total > 0
      union all select voided_at, 'venta_anulada', id::text from sales where status = 'anulada' and total > 0 and voided_at is not null
      union all select created_at, 'comision', id::text from commissions
      union all select coalesce(s.voided_at, c.created_at) + interval '1 second', 'comision_anulada', c.id::text
                from commissions c join sales s on s.id = c.sale_id where c.status = 'anulada'
      union all select created_at, 'cobro', id::text from customer_payments
      union all select received_at, 'recepcion', id::text from purchases where status = 'recibida' and received_at is not null
      union all select created_at, 'factura', id::text from supplier_invoices
      union all select created_at + interval '1 second', 'factura_anulada', id::text from supplier_invoices where status = 'anulada'
      union all select created_at, 'pago', id::text from supplier_payments
      union all select created_at, 'gasto', id::text from expenses
      union all select created_at, 'inventario', id::text from stock_movements where type in ('ajuste', 'inicial')
      union all select closed_at, 'caja', id::text from cash_sessions where status = 'cerrada' and coalesce(difference, 0) <> 0
    ) h
    order by ts, kind
  loop
    if r.kind = 'venta' then
      perform _post_sale(r.id::uuid);
    elsif r.kind = 'venta_anulada' then
      perform _reverse_source('venta', r.id, _local_date(r.ts), 'Anulación de ' || (select number from sales where id = r.id::uuid));
    elsif r.kind = 'comision' then
      perform _post_commission(r.id::uuid);
    elsif r.kind = 'comision_anulada' then
      perform _reverse_source('comision', r.id, _local_date(r.ts), 'Anulación de comisión');
    elsif r.kind = 'cobro' then
      perform _post_customer_payment(r.id::uuid);
    elsif r.kind = 'recepcion' then
      perform _post_reception(r.id::uuid);
    elsif r.kind = 'factura' then
      perform _post_supplier_invoice(r.id::uuid);
    elsif r.kind = 'factura_anulada' then
      perform _reverse_source('factura_proveedor', r.id, (select issue_date from supplier_invoices where id = r.id::uuid), 'Anulación de factura');
    elsif r.kind = 'pago' then
      perform _post_supplier_payment(r.id::uuid);
    elsif r.kind = 'gasto' then
      perform _post_expense(r.id::uuid);
    elsif r.kind = 'inventario' then
      perform _post_stock_movement(r.id::bigint);
    elsif r.kind = 'caja' then
      perform _post_cash_difference(r.id::uuid);
    end if;
  end loop;
end $$;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table accounts           enable row level security;
alter table accounting_periods enable row level security;
alter table journal_sequences  enable row level security;
alter table journal_entries    enable row level security;
alter table journal_lines      enable row level security;

create policy accounts_read on accounts for select to authenticated using (app_role() is not null);
create policy periods_read on accounting_periods for select to authenticated using (can('contabilidad', 'view'));
create policy journal_entries_read on journal_entries for select to authenticated using (can('contabilidad', 'view'));
create policy journal_lines_read on journal_lines for select to authenticated using (can('contabilidad', 'view'));

-- Los libros son de solo lectura: se escriben únicamente con las funciones de arriba
revoke all on accounts, accounting_periods, journal_sequences, journal_entries, journal_lines from anon, authenticated;
grant select on accounts, accounting_periods, journal_entries, journal_lines to authenticated;

create or replace function schema_version()
returns int language sql immutable as $$ select 7 $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Ninguna función interna (las que empiezan con «_») es invocable por usuarios
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
