-- =====================================================================
-- ERP Retail — Datos de demostración (OPCIONAL)
-- Ejecutar DESPUÉS de crear el usuario administrador en /setup.
-- Genera catálogo, clientes, proveedores, empleados, stock inicial y
-- ~30 días de ventas para que el tablero y los reportes tengan datos.
-- No lo ejecutes en una base con datos reales.
-- =====================================================================
do $$
declare
  v_admin   uuid;
  v_branch  uuid;
  v_session uuid;
  v_sale    uuid;
  v_day     date;
  v_ts      timestamptz;
  v_rate    numeric;
  v_total   numeric;
  v_cost    numeric;
  v_sub     numeric;
  v_n       int := 0;
  v_balance numeric;
  v_qty     numeric;
  v_number  text;
  v_method  text;
  v_customer uuid;
  p         record;
begin
  select id into v_admin from profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'Primero crea el usuario administrador en /setup';
  end if;
  if exists (select 1 from products) then
    raise exception 'La base ya tiene productos; el seed solo se ejecuta sobre una base vacía';
  end if;

  select id into v_branch from branches order by code limit 1;
  select tax_rate into v_rate from company_settings where id = 1;

  insert into branches (code, name, address) values ('002', 'Tienda Mall Plaza', 'Av. América Oeste 750');

  insert into categories (name, description) values
    ('Abarrotes', 'Productos de despensa'),
    ('Bebidas', 'Gaseosas, aguas y jugos'),
    ('Lácteos', 'Leche, yogurt y quesos'),
    ('Limpieza', 'Limpieza del hogar'),
    ('Cuidado personal', 'Higiene y belleza'),
    ('Snacks', 'Galletas, golosinas y piqueos');

  insert into products (sku, barcode, name, category_id, unit, cost, price, min_stock)
  select v.sku, v.barcode, v.name, c.id, v.unit, v.cost, v.price, v.min_stock
  from (values
    ('ABA-001', '7750001000011', 'Arroz Extra 5 kg',               'Abarrotes', 'UND', 17.50, 23.90, 20),
    ('ABA-002', '7750001000028', 'Azúcar Rubia 1 kg',              'Abarrotes', 'UND',  3.20,  4.50, 30),
    ('ABA-003', '7750001000035', 'Aceite Vegetal 1 L',             'Abarrotes', 'UND',  7.80, 10.90, 25),
    ('ABA-004', '7750001000042', 'Fideos Spaghetti 500 g',         'Abarrotes', 'UND',  2.10,  3.20, 40),
    ('ABA-005', '7750001000059', 'Atún en Aceite 170 g',           'Abarrotes', 'UND',  4.30,  6.50, 30),
    ('ABA-006', '7750001000066', 'Lentejas 500 g',                 'Abarrotes', 'UND',  3.40,  5.20, 20),
    ('BEB-001', '7750002000010', 'Gaseosa Cola 1.5 L',             'Bebidas',   'UND',  4.90,  7.50, 36),
    ('BEB-002', '7750002000027', 'Agua Mineral 625 ml',            'Bebidas',   'UND',  1.00,  2.00, 60),
    ('BEB-003', '7750002000034', 'Jugo de Naranja 1 L',            'Bebidas',   'UND',  4.20,  6.90, 24),
    ('BEB-004', '7750002000041', 'Bebida Energizante 300 ml',      'Bebidas',   'UND',  2.60,  4.50, 24),
    ('LAC-001', '7750003000019', 'Leche Evaporada 400 g',          'Lácteos',   'UND',  3.10,  4.20, 48),
    ('LAC-002', '7750003000026', 'Yogurt Fresa 1 L',               'Lácteos',   'UND',  5.40,  7.90, 18),
    ('LAC-003', '7750003000033', 'Queso Fresco 250 g',             'Lácteos',   'UND',  6.80,  9.90, 12),
    ('LAC-004', '7750003000040', 'Mantequilla 200 g',              'Lácteos',   'UND',  6.20,  8.90, 12),
    ('LIM-001', '7750004000018', 'Detergente 900 g',               'Limpieza',  'UND',  8.90, 12.90, 20),
    ('LIM-002', '7750004000025', 'Lejía 1 L',                      'Limpieza',  'UND',  2.30,  3.90, 24),
    ('LIM-003', '7750004000032', 'Lavavajilla 500 g',              'Limpieza',  'UND',  3.60,  5.50, 20),
    ('LIM-004', '7750004000049', 'Papel Higiénico x4',             'Limpieza',  'PAQ',  4.10,  6.50, 30),
    ('CUI-001', '7750005000017', 'Shampoo 400 ml',                 'Cuidado personal', 'UND', 11.50, 16.90, 15),
    ('CUI-002', '7750005000024', 'Jabón de Tocador x3',            'Cuidado personal', 'PAQ',  4.80,  7.50, 20),
    ('CUI-003', '7750005000031', 'Pasta Dental 90 g',              'Cuidado personal', 'UND',  3.90,  6.20, 24),
    ('SNA-001', '7750006000016', 'Galletas de Soda x6',            'Snacks',    'PAQ',  2.40,  3.90, 30),
    ('SNA-002', '7750006000023', 'Papas Fritas 150 g',             'Snacks',    'UND',  3.80,  6.00, 24),
    ('SNA-003', '7750006000030', 'Chocolate con Leche 90 g',       'Snacks',    'UND',  3.20,  5.50, 24)
  ) as v(sku, barcode, name, category, unit, cost, price, min_stock)
  join categories c on c.name = v.category;

  insert into customers (doc_type, doc_number, name, email, phone, address) values
    ('DNI', '45678912', 'María Fernanda Torres Ruiz', 'maria.torres@example.com', '987654321', 'Av. Larco 1250, Trujillo'),
    ('DNI', '71234568', 'José Luis Paredes Vega',     'jose.paredes@example.com', '912345678', 'Jr. Pizarro 480, Trujillo'),
    ('DNI', '40987123', 'Carmen Rosa Díaz Salazar',   '',                         '945612378', ''),
    ('RUC', '20481234567', 'Restaurante El Buen Sabor S.A.C.', 'compras@elbuensabor.example.com', '044201515', 'Av. España 2210, Trujillo'),
    ('RUC', '20559876541', 'Bodega Doña Julia E.I.R.L.',       'julia@bodegajulia.example.com',   '948771203', 'Calle Las Gemas 115, Trujillo');

  insert into suppliers (tax_id, name, contact_name, email, phone, address) values
    ('20100055237', 'Distribuidora Norte S.A.',      'Ricardo Alva',   'ventas@disnorte.example.com',  '044285500', 'Parque Industrial Mz. C Lt. 4'),
    ('20131312955', 'Lácteos del Valle S.A.C.',      'Patricia Luna',  'pedidos@lacvalle.example.com', '044312288', 'Carretera Panamericana Km 558'),
    ('20502233441', 'Corporación Limpia Hogar S.A.', 'Hugo Meléndez',  'hugo@limpiahogar.example.com', '016254400', 'Av. Argentina 3093, Lima');

  insert into employees (branch_id, doc_number, full_name, position, email, phone, salary, hire_date, status) values
    (v_branch, '44556677', 'Ana Lucía Rojas Mendoza',  'Jefa de tienda',    'ana.rojas@example.com',  '955111222', 2800, current_date - 720, 'activo'),
    (v_branch, '47889900', 'Carlos Enrique Vargas',    'Cajero',            'carlos.v@example.com',   '955333444', 1300, current_date - 400, 'activo'),
    (v_branch, '70112233', 'Diana Castillo Flores',    'Cajera',            'diana.c@example.com',    '955555666', 1300, current_date - 210, 'vacaciones'),
    (v_branch, '43221100', 'Miguel Ángel Sánchez',     'Almacenero',        'miguel.s@example.com',   '955777888', 1450, current_date - 530, 'activo'),
    (v_branch, '41009988', 'Rosa Elena Gutiérrez',     'Contadora',         'rosa.g@example.com',     '955999000', 3200, current_date - 900, 'activo');

  insert into expenses (branch_id, category, description, amount, payment_method, expense_date, created_by) values
    (v_branch, 'alquiler',      'Alquiler del local',              3500.00, 'transferencia', current_date - 25, v_admin),
    (v_branch, 'servicios',     'Recibo de luz',                    684.30, 'transferencia', current_date - 18, v_admin),
    (v_branch, 'servicios',     'Internet y telefonía',             189.90, 'tarjeta',       current_date - 15, v_admin),
    (v_branch, 'marketing',     'Volantes y publicidad en redes',   350.00, 'yape',          current_date - 9,  v_admin),
    (v_branch, 'mantenimiento', 'Reparación de congeladora',        280.00, 'efectivo',      current_date - 4,  v_admin);

  -- Stock inicial (hace 31 días)
  v_ts := now() - interval '31 days';
  for p in select id, cost, min_stock from products loop
    v_qty := 150 + floor(random() * 150);
    insert into stock (product_id, branch_id, quantity) values (p.id, v_branch, v_qty);
    insert into stock_movements (product_id, branch_id, type, quantity, balance_after, unit_cost, note, created_by, created_at)
    values (p.id, v_branch, 'inicial', v_qty, v_qty, p.cost, 'Inventario inicial', v_admin, v_ts);
  end loop;

  -- Una sesión de caja cerrada por día y ventas dentro de ella
  for v_day in select generate_series(current_date - 30, current_date - 1, interval '1 day')::date loop
    v_session := gen_random_uuid();
    insert into cash_sessions (id, branch_id, opened_by, opened_at, opening_amount, status)
    values (v_session, v_branch, v_admin, (v_day + time '08:00') at time zone 'America/Lima', 200, 'cerrada');

    for i in 1 .. (8 + floor(random() * 10))::int loop
      v_n := v_n + 1;
      v_sale := gen_random_uuid();
      v_ts := (v_day + time '09:00' + (random() * interval '11 hours')) at time zone 'America/Lima';
      v_number := 'B001-' || lpad(v_n::text, 8, '0');
      v_method := (array['efectivo','efectivo','efectivo','tarjeta','yape','yape','plin'])[1 + floor(random() * 7)::int];
      v_customer := null;
      if random() < 0.3 then
        select id into v_customer from customers where doc_type <> 'RUC' order by random() limit 1;
      end if;
      v_total := 0;
      v_cost := 0;

      insert into sales (id, number, doc_type, branch_id, customer_id, cashier_id, cash_session_id,
                         subtotal, tax, total, payment_method, created_at)
      values (v_sale, v_number, 'boleta', v_branch, v_customer, v_admin, v_session, 0, 0, 0, v_method, v_ts);

      for p in select id, name, sku, price, cost from products order by random() limit (1 + floor(random() * 4))::int loop
        v_qty := 1 + floor(random() * 3);
        update stock set quantity = quantity - v_qty, updated_at = v_ts
        where product_id = p.id and branch_id = v_branch and quantity >= v_qty
        returning quantity into v_balance;
        continue when not found;

        insert into sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, total)
        values (v_sale, p.id, p.name, p.sku, v_qty, p.price, p.cost, p.price * v_qty);
        insert into stock_movements (product_id, branch_id, type, quantity, balance_after, unit_cost,
                                     reference_type, reference_id, note, created_by, created_at)
        values (p.id, v_branch, 'venta', -v_qty, v_balance, p.cost, 'sale', v_sale, v_number, v_admin, v_ts);
        v_total := v_total + p.price * v_qty;
        v_cost := v_cost + p.cost * v_qty;
      end loop;

      if v_total = 0 then
        delete from sales where id = v_sale;
        v_n := v_n - 1;
      else
        v_sub := round(v_total / (1 + v_rate / 100), 2);
        update sales set subtotal = v_sub, tax = v_total - v_sub, total = v_total, cost_total = v_cost,
                         amount_received = v_total, change_amount = 0
        where id = v_sale;
      end if;
    end loop;

    select 200 + coalesce(sum(total), 0) into v_total
    from sales where cash_session_id = v_session and payment_method = 'efectivo';
    update cash_sessions set closed_at = (v_day + time '20:30') at time zone 'America/Lima', closed_by = v_admin,
                             expected_amount = v_total, counted_amount = v_total, difference = 0
    where id = v_session;
  end loop;

  insert into document_sequences (branch_id, doc_type, last_number) values (v_branch, 'boleta', v_n)
  on conflict (branch_id, doc_type) do update set last_number = excluded.last_number;
end;
$$;
