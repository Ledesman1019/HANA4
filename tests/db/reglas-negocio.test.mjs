// Reglas de negocio de ERP HANA4 ejecutadas sobre un Postgres en memoria (PGlite):
// aplica todas las migraciones y la semilla, y verifica permisos (RLS), transacciones
// e integraciones entre m?dulos. No necesita red ni credenciales.
// Uso: npm test
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const root = process.argv[2] ?? process.cwd();
const db = new PGlite();
let failed = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`);
};
const as = async (uid) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
};
const sudo = () => db.exec("reset role");
const q = async (sql, params) => (await db.query(sql, params)).rows;
const fails = async (name, sql, params, match) => {
  try {
    await db.query(sql, params);
    ok(name, false, "(no lanzó error)");
  } catch (e) {
    ok(name, !match || e.message.includes(match), `→ ${e.message}`);
  }
};

// --- Stub del entorno Supabase ---
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text,
    raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
`);

await db.exec(readFileSync(`${root}/supabase/migrations/0001_schema.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0002_roles_permisos_imagenes.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0003_facturacion_demo.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0004_superadmin_auditoria_comisiones.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0005_ciclo_compras_cuentas_por_pagar.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0006_cotizaciones_credito_cuentas_por_cobrar.sql`, "utf8"));
ok("migraciones 0001 a 0006 aplicadas", true);

await as(null);
ok("needs_setup = true (anon)", (await q("select needs_setup() v"))[0].v === true);
ok("schema_version = 6 (anon)", (await q("select schema_version() v"))[0].v === 6);
await fails("anon no llama app_context", "select app_context()", [], "permission denied");
await fails("anon no lee productos", "select * from products", [], "permission denied");
await sudo();

const mk = async (email, app = {}) =>
  (await q("insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) returning id",
    [email, JSON.stringify(app), JSON.stringify({ full_name: email.split("@")[0] })]))[0].id;
// Igual que la aplicación: el servidor asigna rol y acceso tras crear la cuenta
const grant = (id, role) => db.query("update profiles set role=$2, active=true where id=$1", [id, role]);
const admin = await mk("admin@erp.test");
const branch = (await q("select id from branches where code='001'"))[0].id;
const cajero = await mk("cajero@erp.test");
await grant(cajero, "cajero");
const alm = await mk("alm@erp.test");
await grant(alm, "almacenero");
const admin2 = await mk("admin2@erp.test");
await grant(admin2, "admin");
ok("primer usuario es Super Administrador; el segundo admin no", (await q("select is_super from profiles where id=$1", [admin]))[0].is_super === true && (await q("select is_super from profiles where id=$1", [admin2]))[0].is_super === false);
const intruso = await mk("intruso@erp.test");
const profs = await q("select email, role, active from profiles order by created_at, email");
ok("primer usuario es admin activo", profs.find(p => p.email === "admin@erp.test").role === "admin");
ok("auto-registro queda inactivo", profs.find(p => p.email === "intruso@erp.test").active === false);

await db.exec(readFileSync(`${root}/supabase/seed.sql`, "utf8"));
// La 0007 se aplica sobre datos existentes: así se prueba la contabilización del historial
await db.exec(readFileSync(`${root}/supabase/migrations/0007_contabilidad.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0008_lotes_centros_costo.sql`, "utf8"));
await db.exec(readFileSync(`${root}/supabase/migrations/0009_roles_planilla_compras.sql`, "utf8"));
ok("centros de costo en gastos ya contabilizados", (await q("select count(*) c from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_type='gasto' and l.account_code like '6%' and l.cost_center_id is null"))[0].c == 0);
const backfill = (await q("select count(*) filter (where source_type='venta') v, count(*) filter (where source_type='inventario') i, count(*) filter (where source_type='gasto') g from journal_entries"))[0];
ok("contabilidad: historial contabilizado al migrar", Number(backfill.v) === 2 * Number((await q("select count(*) c from sales where total > 0"))[0].c) && Number(backfill.i) === 24 && Number(backfill.g) === 5, JSON.stringify(backfill));
ok("schema_version = 9", (await q("select schema_version() v"))[0].v === 9);
const counts = (await q("select (select count(*) from products) p, (select count(*) from sales) s, (select count(*) from stock_movements) m"))[0];
ok("seed aplicado", Number(counts.p) === 24 && Number(counts.s) > 200, JSON.stringify(counts));
const drift = await q(`select count(*) c from stock s where quantity <> (select sum(quantity) from stock_movements m where m.product_id=s.product_id and m.branch_id=s.branch_id)`);
ok("seed: stock = suma de kardex", Number(drift[0].c) === 0);
// El vendedor es colaborador con 2 % de comisión
await db.query("update employees set profile_id=$1, commission_rate=2 where doc_number='47889900'", [cajero]);

// --- Intruso inactivo ---
await as(intruso);
ok("usuario inactivo no ve productos", (await q("select * from products")).length === 0);
await fails("usuario inactivo no abre caja", "select open_cash_session($1, 100)", [branch], "permiso");

// --- Cajero ---
await as(cajero);
const prods = await q("select id, price, cost from products order by sku limit 2");
ok("cajero ve productos", prods.length === 2);
ok("cajero no ve ventas ajenas", (await q("select * from sales")).length === 0);
ok("cajero solo ve su propia ficha de colaborador", (await q("select * from employees")).length === 1);
await fails("cajero no inserta productos", "insert into products (sku, name) values ('X','X')", [], "row-level security");
await fails("cajero no escribe stock directo", "update stock set quantity = 9999 returning *", [], null).catch(() => {});
const items = JSON.stringify([{ product_id: prods[0].id, quantity: 2 }, { product_id: prods[1].id, quantity: 1 }]);
await fails("no vende sin caja abierta", "select create_sale($1,null,'boleta','efectivo',100,0,$2::jsonb)", [branch, items], "abrir caja");
const session = (await q("select open_cash_session($1, 150) id", [branch]))[0].id;
await fails("no abre dos cajas", "select open_cash_session($1, 150)", [branch], "Ya tienes");
await fails("llamada directa a _move_stock bloqueada", "select _move_stock($1,$2,100,'ajuste',0,null,null,'x')", [prods[0].id, branch], "permission denied");

const before = Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity);
const expectedTotal = 2 * Number(prods[0].price) + Number(prods[1].price);
const saleId = (await q("select create_sale($1,null,'boleta','efectivo',$3,0,$2::jsonb) id", [branch, items, 100]))[0].id;
const sale = (await q("select * from sales where id=$1", [saleId]))[0];
ok("venta: total correcto", Number(sale.total) === expectedTotal, `${sale.number} total=${sale.total}`);
ok("venta: subtotal + impuesto = total", Math.abs(Number(sale.subtotal) + Number(sale.tax) - Number(sale.total)) < 0.001, `sub=${sale.subtotal} igv=${sale.tax}`);
ok("venta: vuelto correcto", Number(sale.change_amount) === Math.round((100 - expectedTotal) * 100) / 100);
const after = Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity);
ok("venta: descuenta stock", after === before - 2);
await fails("venta: stock insuficiente", "select create_sale($1,null,'ticket','tarjeta',0,0,$2::jsonb)", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: 99999 }])], "Stock insuficiente");
ok("venta fallida no deja rastro", Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity) === after);
await fails("venta: cantidad negativa", "select create_sale($1,null,'ticket','tarjeta',0,0,$2::jsonb)", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: -5 }])], "inválida");
await fails("venta: efectivo insuficiente", "select create_sale($1,null,'ticket','efectivo',1,0,$2::jsonb)", [branch, items], "menor al total");
await fails("venta: factura sin RUC", "select create_sale($1,null,'factura','tarjeta',0,0,$2::jsonb)", [branch, items], "RUC");
await fails("venta: cajero descuento > 10%", "select create_sale($1,null,'ticket','tarjeta',0,$3,$2::jsonb)", [branch, items, expectedTotal * 0.5], "10%");
await fails("cajero no anula", "select void_sale($1,'x')", [saleId], "anular");
await fails("cajero no ajusta stock", "select adjust_stock($1,$2,5,'x')", [prods[0].id, branch], "permiso");
ok("cajero ve su venta", (await q("select * from sales")).length === 1);
ok("cajero ve ítems de su venta", (await q("select * from sale_items")).length === 2);

// --- Comisiones (Ventas → Personal) ---
const com = await q("select * from commissions");
ok("venta genera la comisión del vendedor", com.length === 1 && com[0].sale_id === saleId && Number(com[0].amount) === Math.round(Number(sale.subtotal) * 2) / 100 && com[0].status === "generada", `base=${com[0]?.base} 2% = ${com[0]?.amount}`);
ok("no ve sueldos ajenos: solo su ficha", (await q("select doc_number from employees")).map((e) => e.doc_number).join() === "47889900");
await fails("comisión no se edita a mano", "update commissions set amount=9999", [], "permission denied");

// --- Facturación electrónica (demo) ---
const edoc = (await q("select issue_e_document($1) id", [saleId]))[0].id;
const edocRow = (await q("select * from e_documents where id=$1", [edoc]))[0];
ok("comprobante electrónico: se genera pendiente con los datos de la venta", edocRow.status === "pendiente" && edocRow.number === sale.number && Number(edocRow.total) === Number(sale.total) && edocRow.customer_name === "CLIENTE VARIOS", edocRow.number);
ok("comprobante electrónico: emitir dos veces devuelve el mismo", (await q("select issue_e_document($1) id", [saleId]))[0].id === edoc);
await fails("comprobante electrónico: nadie lo marca aceptado a mano", "update e_documents set status='aceptado' where id=$1", [edoc], "permission denied");
await fails("comprobante electrónico: no se inserta directo", "insert into e_documents (sale_id, kind, number, branch_id, customer_name, subtotal, tax, total) values ($1,'boleta','X',$2,'x',1,1,1)", [saleId, branch], "permission denied");

await db.query("select add_cash_movement($1,'egreso',20,'Compra de bolsas')", [session]);
const exp = Number((await q("select cash_session_expected($1) v", [session]))[0].v);
ok("caja: esperado = apertura + efectivo - egresos", Math.abs(exp - (150 + expectedTotal - 20)) < 0.001, `esperado=${exp}`);
const diff = Number((await q("select close_cash_session($1,$2,'ok') v", [session, exp - 5]))[0].v);
ok("caja: diferencia al cierre", diff === -5);
await fails("caja cerrada no acepta movimientos", "select add_cash_movement($1,'ingreso',5,'x')", [session], "no está abierta");

// --- Almacenero ---
await as(alm);
const sup = (await q("select id from suppliers limit 1"))[0].id;
const costBefore = Number(prods[0].cost);
const totalQty = Number((await q("select sum(quantity) v from stock where product_id=$1", [prods[0].id]))[0].v);
// --- Ciclo de aprovisionamiento: solicitud → aprobación → orden → recepción ---
const poItems = JSON.stringify([{ product_id: prods[0].id, quantity: 100, unit_cost: costBefore + 2 }]);
await fails("almacenero ya no emite órdenes directas", "select create_purchase($1,$2,current_date+3,'x',$3::jsonb)", [sup, branch, poItems], "solicitud de pedido");
await fails("almacenero no crea solicitudes de pedido (las crea Compras)", "select create_requisition($1,'x',$2::jsonb)", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: 1 }])], "no puede crear");
ok("almacenero no ve proveedores para crear (sin permiso de proveedores)", !(await q("select can('proveedores','create') v"))[0].v);
await sudo();
const comp = await mk("comprador@erp.test");
await grant(comp, "comprador");
await as(comp);
const req = (await q("select create_requisition($1,'Stock bajo de arroz',$2::jsonb) id", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: 100 }])]))[0].id;
const reqRow = (await q("select * from purchase_requisitions where id=$1", [req]))[0];
ok("solicitud de pedido creada pendiente", reqRow.status === "pendiente" && reqRow.number.startsWith("SP001-"), reqRow.number);
await fails("nadie aprueba su propia solicitud", "select decide_requisition($1,true,'')", [req], "tu propia solicitud");
await as(alm);
await fails("almacenero no aprueba (sin permiso)", "select decide_requisition($1,true,'')", [req], "no puede aprobar");
await as(admin2);
await fails("orden desde solicitud no aprobada", "select create_purchase($1,$2,current_date+3,'x',$3::jsonb,$4)", [sup, branch, poItems, req], "no está aprobada");
await fails("rechazo exige motivo", "select decide_requisition($1,false,'')", [req], "motivo");
await db.query("select decide_requisition($1,true,'Conforme')", [req]);
await fails("solicitud no se decide dos veces", "select decide_requisition($1,true,'')", [req], "ya fue");
await as(comp);
const po = (await q("select create_purchase($1,$2,current_date+3,'reposición',$3::jsonb,$4) id", [sup, branch, poItems, req]))[0].id;
await fails("comprador no recibe mercadería (la recibe el almacén)", "select receive_purchase($1)", [po], "almacén");
await as(admin2);
ok("solicitud queda convertida y enlazada a la orden", (await q("select status, purchase_id from purchase_requisitions where id=$1", [req]))[0].purchase_id === po);
await fails("quien no es almacén no recibe... (admin sí puede todo)", "select receive_purchase($1)", ["00000000-0000-0000-0000-000000000000"], "no encontrada");
await as(cajero);
await fails("vendedor no recibe mercadería", "select receive_purchase($1)", [po], "almacén");
await as(alm);
await fails("no se factura antes de recibir", "select register_supplier_invoice($1,'F001-1',current_date,current_date+30,100,'')", [po], "no puede registrar");
const poRow = (await q("select * from purchases where id=$1", [po]))[0];
ok("compra: totales", Number(poRow.total) === Math.round((100 * (costBefore + 2)) * 1.18 * 100) / 100, `${poRow.number} total=${poRow.total}`);
await db.query("select receive_purchase($1)", [po]);
const newCost = Number((await q("select cost from products where id=$1", [prods[0].id]))[0].cost);
const wavg = Math.round(((totalQty * costBefore + 100 * (costBefore + 2)) / (totalQty + 100)) * 100) / 100;
ok("compra: costo promedio ponderado", newCost === wavg, `${costBefore} → ${newCost}`);
ok("compra: ingresa stock", Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity) === after + 100);
await fails("compra: no se recibe dos veces", "select receive_purchase($1)", [po], "ya fue");
const b2 = (await q("select id from branches where code='002'"))[0].id;
await db.query("select transfer_stock($1,$2,$3,10,'reposición tienda 2')", [prods[0].id, branch, b2]);
ok("transferencia: llega a destino", Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, b2]))[0].quantity) === 10);
await db.query("select adjust_stock($1,$2,7,'conteo físico')", [prods[0].id, b2]);
ok("ajuste: fija cantidad", Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, b2]))[0].quantity) === 7);
ok("almacenero no ve ventas", (await q("select * from sales")).length === 0);
await fails("almacenero no vende", "select create_sale($1,null,'ticket','tarjeta',0,0,$2::jsonb)", [branch, items], "permiso");

// --- Admin ---
await as(admin);
await sudo();
await db.query("update e_documents set status='aceptado', hash='demo', response_code='0' where sale_id=$1", [saleId]);
await as(alm);
ok("almacenero no ve comprobantes electrónicos", (await q("select * from e_documents")).length === 0);
await fails("almacenero no emite comprobantes ajenos", "select issue_e_document($1)", [saleId], "no puede emitir");
await as(admin);
await fails("nota de crédito: solo de ventas anuladas", "select issue_credit_note($1)", [saleId], "anulada");
await db.query("select void_sale($1,'error de digitación')", [saleId]);
ok("anular la venta anula su comisión", (await q("select status from commissions where sale_id=$1", [saleId]))[0].status === "anulada");
const nc = (await q("select issue_credit_note($1) id", [saleId]))[0].id;
const ncRow = (await q("select n.*, d.number as ref from e_documents n join e_documents d on d.id = n.reference_id where n.id=$1", [nc]))[0];
ok("nota de crédito: referencia al comprobante y mismo importe", ncRow.kind === "nota_credito" && ncRow.number.startsWith("BC001-") && ncRow.ref === sale.number && Number(ncRow.total) === Number(sale.total) && ncRow.reason === "error de digitación", `${ncRow.number} → ${ncRow.ref}`);
ok("nota de crédito: no se duplica", (await q("select issue_credit_note($1) id", [saleId]))[0].id === nc);
ok("anulación: devuelve stock", Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity) === after + 100 - 10 + 2);
await fails("no se anula dos veces", "select void_sale($1,'x')", [saleId], "ya está anulada");
const days = await q("select * from report_sales_by_day(current_date-30, current_date, null)");
ok("reporte por día: 31 filas", days.length === 31, `total30d=${days.reduce((a, d) => a + Number(d.total), 0).toFixed(2)}`);
const top = await q("select * from report_top_products(current_date-30, current_date, null, 5)");
ok("reporte top productos", top.length === 5, top[0].name);
for (const dim of ["payment_method", "category", "cashier", "branch"]) {
  const r = await q("select * from report_sales_breakdown(current_date-30, current_date, null, $1)", [dim]);
  ok(`reporte por ${dim}`, r.length > 0, r.map(x => `${x.label}=${x.total}`).slice(0, 3).join(", "));
}
const invView = await q("select count(*) c, sum(stock_value) v from inventory_view where branch_id=$1", [branch]);
ok("vista de inventario", Number(invView[0].c) === 24, `valor=${invView[0].v}`);
await db.query("update company_settings set name='Retail Demo' where id=1");
ok("admin edita empresa", (await q("select name from company_settings"))[0].name === "Retail Demo");

// --- Factura del proveedor y pagos (cuentas por pagar) ---
const poTotal = Number((await q("select total from purchases where id=$1", [po]))[0].total);
await fails("factura con diferencia exige nota", "select register_supplier_invoice($1,'F001-77',current_date,current_date+30,$2,'')", [po, poTotal + 80], "Explica la diferencia");
await fails("vencimiento anterior a emisión", "select register_supplier_invoice($1,'F001-77',current_date,current_date-1,$2,'')", [po, poTotal], "vencimiento");
const inv = (await q("select register_supplier_invoice($1,'f001-77',current_date,current_date+30,$2,'') id", [po, poTotal]))[0].id;
const invRow = (await q("select * from supplier_invoices where id=$1", [inv]))[0];
ok("factura que coincide con la orden queda pendiente de pago", invRow.status === "pendiente" && invRow.number === "F001-77" && Math.abs(Number(invRow.subtotal) + Number(invRow.tax) - poTotal) < 0.001, `${invRow.number} total=${invRow.total}`);
await fails("una orden, una factura", "select register_supplier_invoice($1,'F001-78',current_date,current_date+30,$2,'')", [po, poTotal], "ya tiene una factura");
await fails("pago mayor al saldo", "select pay_supplier_invoice($1,$2,'transferencia',current_date,'')", [inv, poTotal + 1], "supera el saldo");
const bal1 = Number((await q("select pay_supplier_invoice($1,1000,'transferencia',current_date,'OP-555') v", [inv]))[0].v);
ok("pago parcial deja saldo", Math.abs(bal1 - (poTotal - 1000)) < 0.001 && (await q("select status from supplier_invoices where id=$1", [inv]))[0].status === "parcial", `saldo=${bal1}`);
await fails("factura con pagos no se anula", "select void_supplier_invoice($1,'error')", [inv], "ya tiene pagos");
await db.query("select pay_supplier_invoice($1,$2,'cheque',current_date,'CH-12')", [inv, bal1]);
ok("pago total cancela la factura", (await q("select status, paid from supplier_invoices where id=$1", [inv]))[0].status === "pagada");
await fails("factura pagada no admite más pagos", "select pay_supplier_invoice($1,1,'efectivo',current_date,'')", [inv], "ya está pagada");

// Factura con diferencia: bloqueada hasta que Compras la libere
const po2 = (await q("select create_purchase($1,$2,null,'',$3::jsonb) id", [sup, branch, JSON.stringify([{ product_id: prods[1].id, quantity: 10, unit_cost: 5 }])]))[0].id;
await db.query("select receive_purchase($1)", [po2]);
const inv2 = (await q("select register_supplier_invoice($1,'F009-1',current_date,current_date+15,$2,'Flete adicional') id", [po2, 59 + 40]))[0].id;
ok("factura con diferencia queda bloqueada", (await q("select status, difference from supplier_invoices where id=$1", [inv2]))[0].status === "bloqueada");
await fails("factura bloqueada no se paga", "select pay_supplier_invoice($1,10,'efectivo',current_date,'')", [inv2], "bloqueada");
await db.query("select release_supplier_invoice($1,'Flete acordado con el proveedor')", [inv2]);
ok("compras libera la factura", (await q("select status from supplier_invoices where id=$1", [inv2]))[0].status === "pendiente");
await db.query("select void_supplier_invoice($1,'Proveedor reemitirá')", [inv2]);
ok("factura sin pagos se anula y la orden admite otra", (await q("select register_supplier_invoice($1,'F009-2',current_date,current_date+15,59,'') id", [po2])).length === 1);
await as(alm);
await fails("almacenero no paga", "select pay_supplier_invoice($1,1,'efectivo',current_date,'')", [inv2], "no puede registrar pagos");
await fails("pagos no se insertan directo", "insert into supplier_payments (invoice_id, amount, method, paid_at) values ($1,1,'efectivo',current_date)", [inv], "permission denied");
await as(admin);
const plog = await q("select summary from audit_log where action like 'pago.%' or action like 'compra.%' order by id");
ok("auditoría del ciclo de compras y pagos", plog.some((l) => l.summary.includes("Aprobó la solicitud de pedido SP001-")) && plog.some((l) => l.summary.includes("Pagó 1,000.00 de la factura F001-77") || l.summary.includes("Pagó 1.000,00 de la factura F001-77")) && plog.some((l) => l.summary.includes("Liberó para pago la factura F009-1")), plog.map((l) => l.summary).slice(0, 2).join(" | "));
// --- Roles dinámicos y matriz de permisos ---
const ctx = (await q("select app_context() c"))[0].c;
ok("app_context: perfil, empresa, sucursales", ctx.profile.role === "admin" && ctx.role_name === "Superadministrador" && ctx.branches.length === 2 && ctx.settings.name === "Retail Demo");
const supervisor = (await q("select save_role(null, 'Supervisor de Ventas', 'Supervisa cajeros', $1::jsonb) id", [JSON.stringify({ ventas: { view: true, create: true, edit: true, delete: true }, caja: { view: true, create: true, edit: true }, configuracion: { view: true, edit: true } })]))[0].id;
ok("admin crea rol personalizado", supervisor.startsWith("rol_"));
await fails("rol admin no se modifica", "select save_role('admin','x','',$1::jsonb)", ["{}"], "acceso total");
await fails("rol base no se elimina", "select delete_role('cajero')", [], "roles base");
await fails("último admin no se desactiva", "update profiles set active=false where id=$1", [admin], "Super Administrador activo");
await fails("último super admin no cambia de rol", "update profiles set role='gerente' where id=$1", [admin], "Super Administrador activo");
await db.query("update profiles set role=$1 where id=$2", [supervisor, cajero]);
await fails("rol en uso no se elimina", "select delete_role($1)", [supervisor], "usuarios con este rol");

await as(cajero); // ahora es Supervisor de Ventas
const sctx = (await q("select app_context() c"))[0].c;
ok("app_context: permisos del rol", sctx.permissions.ventas.delete === true && sctx.permissions.inventario.view === false, sctx.role_name);
ok("supervisor ve todas las ventas", (await q("select * from sales")).length > 300);
ok("supervisor no ve gastos", (await q("select * from expenses")).length === 0);
await fails("supervisor no ajusta stock", "select adjust_stock($1,$2,5,'x')", [prods[0].id, branch], "permiso");
await fails("supervisor no amplía su propio rol", "select save_role($1,'x','',$2::jsonb)", [supervisor, JSON.stringify({ finanzas: { view: true } })], "propio rol");
const up = await q("update profiles set role='admin' where id=$1 returning id", [alm]).catch((e) => e.message);
ok("no-admin no puede conceder rol admin", typeof up === "string" && up.includes("Super Administrador"), String(up).slice(0, 70));
ok("no-admin no puede editar a un admin", (await q("update profiles set full_name='hack' where id=$1 returning id", [admin])).length === 0);
ok("supervisor sí edita usuarios no-admin", (await q("update profiles set full_name='Almacén 1' where id=$1 returning id", [alm])).length === 1);
const s2 = (await q("select open_cash_session($1, 50) id", [branch]))[0].id;
const sale2 = (await q("select create_sale($1,null,'ticket','tarjeta',0,$3,$2::jsonb) id", [branch, items, 20]))[0].id;
ok("supervisor aplica descuento > 10% (ventas.edit)", Number((await q("select discount from sales where id=$1", [sale2]))[0].discount) === 20);
await db.query("select void_sale($1,'prueba de permisos')", [sale2]);
await db.query("select close_cash_session($1, 50, '')", [s2]);
ok("supervisor anula (ventas.delete)", (await q("select status from sales where id=$1", [sale2]))[0].status === "anulada");

await as(admin);
await db.query("select save_role($1,'Supervisor de Ventas','',$2::jsonb)", [supervisor, JSON.stringify({ ventas: { view: true } })]);
await as(cajero);
await fails("al quitar el permiso deja de vender", "select open_cash_session($1, 50)", [branch], "permiso");
// --- Ciclo comercial: cotización → venta al crédito → cobro ---
await as(admin);
const cust = (await q("select id from customers where doc_number='20481234567'"))[0].id;
const adminSession = (await q("select open_cash_session($1, 100) id", [branch]))[0].id;
await fails("crédito: cliente sin línea no compra al crédito", "select create_sale($1,$2,'factura','credito',0,0,$3::jsonb)", [branch, cust, items], "no tiene línea de crédito");
await fails("crédito: exige cliente", "select create_sale($1,null,'boleta','credito',0,0,$2::jsonb)", [branch, items], "requiere un cliente");
await db.query("update customers set credit_limit=500, credit_days=15 where id=$1", [cust]);
const quote = (await q("select create_quotation($1,$2,7,0,'Pedido mensual',$3::jsonb) id", [branch, cust, items]))[0].id;
const quoteRow = (await q("select * from quotations where id=$1", [quote]))[0];
ok("cotización: totales y vigencia", Number(quoteRow.total) === expectedTotal && quoteRow.status === "vigente" && quoteRow.number.startsWith("CT001-"), `${quoteRow.number} total=${quoteRow.total}`);
const stockBeforeQuote = Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity);
await sudo();
await db.query("update products set price = price + 5 where id=$1", [prods[0].id]);
await as(admin);
const creditSale = (await q("select create_sale($1,null,'factura','credito',0,0,null,$2,null) id", [branch, quote]))[0].id;
const cs = (await q("select *, (due_date - (now() at time zone 'America/Lima')::date) as plazo from sales where id=$1", [creditSale]))[0];
ok("venta desde cotización respeta el precio cotizado", Number(cs.total) === expectedTotal && cs.customer_id === cust, `total=${cs.total} (el precio de lista subió)`);
ok("venta al crédito: pendiente, vence según el plazo del cliente", cs.credit_status === "pendiente" && Number(cs.plazo) === 15 && Number(cs.amount_received) === 0, `plazo=${cs.plazo} días`);
ok("cotización queda aceptada y enlazada", (await q("select status, sale_id from quotations where id=$1", [quote]))[0].sale_id === creditSale);
ok("venta desde cotización descuenta stock", Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [prods[0].id, branch]))[0].quantity) === stockBeforeQuote - 2);
await fails("cotización no se vende dos veces", "select create_sale($1,null,'factura','credito',0,0,null,$2,null)", [branch, quote], "no está vigente");
await fails("crédito: no supera la línea", "select create_sale($1,$2,'factura','credito',0,0,$3::jsonb)", [branch, cust, JSON.stringify([{ product_id: prods[0].id, quantity: 20 }])], "supera la línea de crédito");
await as(alm);
await fails("quien no cobra no registra cobros", "select collect_payment($1,10,'efectivo',current_date,'')", [creditSale], "no puede registrar cobros");
await as(admin);
const cashBefore = Number((await q("select cash_session_expected($1) v", [adminSession]))[0].v);
const rest = Number((await q("select collect_payment($1,20,'efectivo',current_date,'') v", [creditSale]))[0].v);
ok("cobro parcial en efectivo entra a la caja de quien cobra", Math.abs(rest - (expectedTotal - 20)) < 0.001 && Number((await q("select cash_session_expected($1) v", [adminSession]))[0].v) === cashBefore + 20, `saldo=${rest}`);
await fails("cobro mayor al saldo", "select collect_payment($1,$2,'yape',current_date,'')", [creditSale, rest + 1], "supera el saldo");
await fails("venta al crédito con cobros no se anula", "select void_sale($1,'error de registro')", [creditSale], "ya tiene cobros");
await db.query("select collect_payment($1,$2,'transferencia',current_date,'OP-9')", [creditSale, rest]);
ok("cobro total cancela la deuda", (await q("select credit_status from sales where id=$1", [creditSale]))[0].credit_status === "pagada" && Number((await q("select customer_debt($1) v", [cust]))[0].v) === 0);
const cs2 = (await q("select create_sale($1,$2,'factura','credito',0,0,$3::jsonb) id", [branch, cust, JSON.stringify([{ product_id: prods[1].id, quantity: 1 }])]))[0].id;
await sudo();
await db.query("update sales set due_date = current_date - 5 where id=$1", [cs2]);
await as(admin);
await fails("crédito: bloqueado con deuda vencida", "select create_sale($1,$2,'factura','credito',0,0,$3::jsonb)", [branch, cust, JSON.stringify([{ product_id: prods[1].id, quantity: 1 }])], "deuda vencida");
await db.query("select void_sale($1,'venta de prueba')", [cs2]);
ok("venta al crédito sin cobros se anula y libera la deuda", Number((await q("select customer_debt($1) v", [cust]))[0].v) === 0);
const q2 = (await q("select create_quotation($1,null,3,0,'',$2::jsonb) id", [branch, items]))[0].id;
await db.query("select cancel_quotation($1,'El cliente desistió')", [q2]);
await fails("cotización anulada no se vende", "select create_sale($1,null,'boleta','tarjeta',0,0,null,$2,null)", [branch, q2], "no está vigente");
await db.query("select close_cash_session($1,$2,'')", [adminSession, Number((await q("select cash_session_expected($1) v", [adminSession]))[0].v)]);
await sudo();
await db.query("update profiles set role='vendedor' where id=$1", [cajero]);
await as(cajero);
ok("vendedor no edita clientes (solo los registra)", (await q("update customers set phone='999888777' where id=$1 returning id", [cust])).length === 0);
ok("vendedor no cambia la línea de crédito", (await q("update customers set credit_limit=99999 where id=$1 returning id", [cust])).length === 0);
await fails("vendedor no abre caja", "select open_cash_session($1, 50)", [branch], "permiso");
ok("vendedor ve solo sus cotizaciones", (await q("select * from quotations")).length === 0);
const cst = await q("select * from customer_credit_status() where customer_id=$1", [cust]);
ok("vendedor ve el crédito del cliente sin ver sus ventas", cst.length === 1 && Number(cst[0].debt) === 0 && (await q("select * from sales where customer_id=$1", [cust])).length === 0, `deuda=${cst[0]?.debt}`);
await sudo();
await db.query("update profiles set role='cajero' where id=$1", [cajero]);
await as(cajero);
ok("cajero ve las cotizaciones para cobrarlas", (await q("select * from quotations")).length >= 1);
ok("cajero no edita clientes", (await q("update customers set phone='999888777' where id=$1 returning id", [cust])).length === 0);
await as(admin);
await db.query("update profiles set role=$1 where id=$2", [supervisor, cajero]); // lo deja como estaba para las pruebas siguientes
const clog = await q("select summary from audit_log where action like 'cobro.%' order by id");
ok("auditoría de crédito y cobranza", clog.some((l) => l.summary.includes("Cambió la línea de crédito de Restaurante El Buen Sabor")) && clog.some((l) => l.summary.includes("Deuda cancelada")), clog.map((l) => l.summary).slice(0, 2).join(" | "));

// --- Super Administrador ---
await as(admin2);
ok("admin normal opera todo (ve gastos)", (await q("select * from expenses")).length > 0);
ok("admin normal no puede editar a otro admin", (await q("update profiles set full_name='hack' where id=$1 returning id", [admin])).length === 0);
await fails("admin normal no nombra administradores", "update profiles set role='admin' where id=$1", [alm], "Super Administrador");
await fails("admin normal no se concede el nivel super", "update profiles set is_super=true where id=$1", [alm], "Super Administrador");
ok("admin normal sí gestiona usuarios no-admin", (await q("update profiles set active=false where id=$1 returning id", [alm])).length === 1);
await as(admin);
ok("super admin nombra administradores", (await q("update profiles set role='admin', active=true where id=$1 returning id", [alm])).length === 1);
ok("super admin concede el nivel super", (await q("update profiles set is_super=true where id=$1 returning is_super", [admin2]))[0].is_super === true);
ok("con dos super, uno puede dejar de serlo", (await q("update profiles set is_super=false where id=$1 returning is_super", [admin2]))[0].is_super === false);

// --- Auditoría ---
const log = await q("select actor_name, action, summary from audit_log order by id");
const has = (text) => log.some((l) => l.summary.includes(text));
ok("auditoría: permiso quitado a un rol", has("Quitó al rol «Supervisor de Ventas» el permiso Eliminar en Ventas"), log.find((l) => l.action === "rol.permiso")?.summary);
ok("auditoría: creación de rol", has("Creó el rol «Supervisor de Ventas»"));
ok("auditoría: cambio de rol de usuario", has("Cambió el rol de cajero: de Cajero a Supervisor de Ventas"), log.find((l) => l.action === "usuario.rol")?.summary);
ok("auditoría: cuenta desactivada con su autor", log.some((l) => l.action === "usuario.acceso" && l.actor_name === "admin2"), log.find((l) => l.action === "usuario.acceso")?.summary);
ok("auditoría: nivel super concedido y retirado", has("Concedió el nivel Super Administrador a admin2") && has("Retiró el nivel Super Administrador a admin2"));
ok("auditoría: venta anulada con motivo", has("Motivo: error de digitación"), log.find((l) => l.action === "venta.anulacion")?.summary);
ok("auditoría: ajuste de stock", has("Motivo: conteo físico"), log.find((l) => l.action === "stock.ajuste")?.summary);
ok("auditoría: caja con faltante", has("Cerró caja con faltante de 5,00") || has("Cerró caja con faltante de 5.00"), log.find((l) => l.action === "caja.diferencia")?.summary);
ok("auditoría: configuración de empresa", has("Modificó la configuración de la empresa: name"));
ok("auditoría: cambio de comisión", has("Cambió la comisión de Carlos Enrique Vargas: de 0.00% a 2.00%"), log.find((l) => l.action === "personal.comision")?.summary);
await fails("auditoría: no se puede borrar", "delete from audit_log", [], "permission denied");
await fails("auditoría: no se puede editar", "update audit_log set summary='x'", [], "permission denied");
await fails("auditoría: no se puede falsificar", "select _audit('x','x','x','x','{}')", [], "permission denied");
await db.query("select save_role($1,'Supervisor de Ventas','',$2::jsonb)", [supervisor, JSON.stringify({ ventas: { view: true }, configuracion: { view: true } })]);
await as(cajero);
ok("auditoría: solo la ve quien entra a Configuración", (await q("select * from audit_log")).length > 0);
await as(admin);
await db.query("select save_role($1,'Supervisor de Ventas','',$2::jsonb)", [supervisor, JSON.stringify({ ventas: { view: true } })]);
await as(cajero);
ok("auditoría: sin Configuración no se ve", (await q("select * from audit_log")).length === 0);
await as(admin);
// --- Contabilidad ---
await sudo();
const bal = async (code) => Number((await q("select coalesce(sum(debit - credit), 0) v from journal_lines where account_code=$1", [code]))[0].v);
ok("contabilidad: todos los asientos cuadran", (await q("select entry_id from journal_lines group by entry_id having sum(debit) <> sum(credit)")).length === 0);
const sumq = async (sql) => Number((await q(sql))[0].v ?? 0);
const revenue = await sumq("select coalesce(sum(subtotal), 0) v from sales where status='completada'");
ok("ventas en libros = ventas registradas (anuladas extornadas)", Math.abs(-(await bal("7011")) - revenue) < 0.005, `7011=${-(await bal("7011"))} ventas=${revenue}`);
const salesTax = await sumq("select coalesce(sum(tax), 0) v from sales where status='completada'");
const creditTax = await sumq("select coalesce(sum(tax), 0) v from supplier_invoices where status<>'anulada'");
ok("IGV neto = débito fiscal de ventas − crédito fiscal de compras", Math.abs(-(await bal("40111")) - (salesTax - creditTax)) < 0.005, `40111=${-(await bal("40111"))}`);
const receivable = await sumq("select coalesce(sum(total - amount_paid), 0) v from sales where status='completada' and payment_method='credito'");
ok("cuentas por cobrar en libros = deuda de clientes", Math.abs((await bal("1212")) - receivable) < 0.005, `1212=${await bal("1212")} deuda=${receivable}`);
const payable = await sumq("select coalesce(sum(total - paid), 0) v from supplier_invoices where status<>'anulada'");
ok("cuentas por pagar en libros = deuda con proveedores", Math.abs(-(await bal("4212")) - payable) < 0.005, `4212=${-(await bal("4212"))} deuda=${payable}`);
const toInvoice = await sumq("select coalesce(sum(p.subtotal), 0) v from purchases p where p.status='recibida' and not exists (select 1 from supplier_invoices i where i.purchase_id=p.id and i.status<>'anulada')");
ok("mercadería recibida por facturar cuadra con las órdenes", Math.abs(-(await bal("4699")) - toInvoice) < 0.005, `4699=${-(await bal("4699"))}`);
const comm = await sumq("select coalesce(sum(amount), 0) v from commissions where status='generada'");
ok("comisiones en libros = comisiones generadas", Math.abs((await bal("6212")) - comm) < 0.005, `6212=${await bal("6212")}`);
const expTotal = await sumq("select coalesce(sum(amount), 0) v from expenses");
const expBooks = await sumq("select coalesce(sum(l.debit - l.credit), 0) v from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_type='gasto' and l.account_code like '6%'");
ok("gastos en libros = gastos registrados", Math.abs(expBooks - expTotal) < 0.005, `libros=${expBooks} gastos=${expTotal}`);
const e1 = (await q("select id, amount from expenses order by created_at limit 1"))[0];
await db.query("update expenses set amount = amount + 100 where id=$1", [e1.id]);
ok("corregir un gasto extorna y vuelve a contabilizar", Math.abs((await sumq("select coalesce(sum(l.debit - l.credit), 0) v from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_type='gasto' and l.account_code like '6%'")) - (expTotal + 100)) < 0.005);
ok("faltante de caja contabilizado como gasto", (await q("select 1 from journal_entries where source_type='caja' and description like 'Faltante%'")).length >= 1);
ok("ajuste de stock contabilizado", (await q("select 1 from journal_entries where source_type='inventario' and description like 'Merma%'")).length >= 1);

await as(cajero);
ok("sin permiso no se ven los libros", (await q("select * from journal_entries")).length === 0);
await fails("nadie escribe en el diario directamente", "insert into journal_lines (entry_id, account_code, debit) values (gen_random_uuid(), '1011', 1)", [], "permission denied");
await fails("el motor de asientos no es invocable", "select _post_entry(current_date,'x',null,'x',null,'[]'::jsonb)", [], "permission denied");
await fails("sin permiso no hay asientos manuales", "select post_manual_entry((now() at time zone 'America/Lima')::date,'x',null,'[]'::jsonb)", [], "no puede registrar asientos");
await as(admin);
const capital = JSON.stringify([{ account: "1041", debit: 5000, credit: 0 }, { account: "5011", debit: 0, credit: 5000, note: "Aporte" }]);
await fails("asiento manual descuadrado", "select post_manual_entry((now() at time zone 'America/Lima')::date,'Aporte',null,$1::jsonb)", [JSON.stringify([{ account: "1041", debit: 5000 }, { account: "5011", credit: 4000 }])], "descuadrado");
await fails("asiento manual con cuenta inexistente", "select post_manual_entry((now() at time zone 'America/Lima')::date,'x',null,$1::jsonb)", [JSON.stringify([{ account: "9999", debit: 1 }, { account: "5011", credit: 1 }])], "no existe");
await fails("asiento manual con fecha futura", "select post_manual_entry(current_date + 5,'x',null,$1::jsonb)", [capital], "fecha futura");
const manual = (await q("select post_manual_entry((now() at time zone 'America/Lima')::date,'Aporte de capital',null,$1::jsonb) id", [capital]))[0].id;
ok("asiento manual registrado", Number(await bal("5011")) === -5000);
await db.query("select reverse_manual_entry($1,'Registro duplicado')", [manual]);
ok("extorno de asiento manual", Number(await bal("5011")) === 0);
await fails("no se extorna dos veces", "select reverse_manual_entry($1,'x')", [manual], "ya fue extornado");
const autoEntry = (await q("select id from journal_entries where source_type='venta' and reverses is null and reversed_by is null limit 1"))[0].id;
await fails("los asientos automáticos no se extornan a mano", "select reverse_manual_entry($1,'x')", [autoEntry], "Solo se extornan asientos manuales");
const lastMonth = (await q("select to_char((now() at time zone 'America/Lima')::date - interval '1 month', 'YYYY-MM') p"))[0].p;
await fails("no se cierra el mes en curso", "select set_period_status(to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM'), true)", [], "meses ya terminados");
await db.query("select set_period_status($1, true)", [lastMonth]);
await fails("periodo cerrado bloquea operaciones con esa fecha", "insert into expenses (branch_id, category, description, amount, payment_method, expense_date) values ($1,'otros','Gasto atrasado',10,'efectivo', ((now() at time zone 'America/Lima')::date - interval '1 month')::date)", [branch], "está cerrado");
await db.query("select set_period_status($1, false)", [lastMonth]);
ok("periodo reabierto admite operaciones", (await q("insert into expenses (branch_id, category, description, amount, payment_method, expense_date) values ($1,'otros','Gasto atrasado',10,'efectivo', ((now() at time zone 'America/Lima')::date - interval '1 month')::date) returning id", [branch])).length === 1);
const tb = await q("select * from trial_balance(current_date - 60, current_date)");
ok("balance de comprobación cuadra", Math.abs(tb.reduce((s, r) => s + Number(r.closing), 0)) < 0.005 && tb.length > 10, `${tb.length} cuentas`);
const ledger = await q("select * from account_ledger('1011', current_date - 60, current_date)");
ok("libro mayor de caja", ledger.length > 0);
ok("auditoría de contabilidad", (await q("select 1 from audit_log where action like 'contabilidad.%'")).length >= 4);
// --- Centros de costo ---
const ccRows = await q("select * from cost_center_report(current_date - 60, current_date + 1)");
const ccAdm = (await q("select id from cost_centers where code='ADM'"))[0].id;
const ccVen = (await q("select id from cost_centers where code='VEN'"))[0].id;
ok("reporte por centro de costo y sucursal", ccRows.some((r) => r.cost_center_id === ccVen && r.account_code === "6911") && ccRows.some((r) => r.cost_center_id === ccAdm && r.account_code === "6352"), `${ccRows.length} filas`);
const ccExp = (await q("insert into expenses (branch_id, category, description, amount, payment_method, expense_date, cost_center_id) values ($1,'servicios','Luz del almacén',120,'transferencia',(now() at time zone 'America/Lima')::date,(select id from cost_centers where code='LOG')) returning id", [branch]))[0].id;
ok("gasto con centro de costo elegido", (await q("select c.code from journal_lines l join journal_entries e on e.id=l.entry_id join cost_centers c on c.id=l.cost_center_id where e.source_id=$1 and l.account_code='6361'", [ccExp]))[0]?.code === "LOG");
const ccDef = (await q("insert into expenses (branch_id, category, description, amount, payment_method, expense_date) values ($1,'marketing','Afiches',50,'efectivo',(now() at time zone 'America/Lima')::date) returning cost_center_id", [branch]))[0].cost_center_id;
ok("gasto sin centro toma el sugerido por categoría", ccDef === ccVen);
await db.query("update expenses set cost_center_id=$1 where id=$2", [ccAdm, ccExp]);
ok("cambiar el centro de un gasto lo vuelve a contabilizar", (await q("select c.code from journal_lines l join journal_entries e on e.id=l.entry_id join cost_centers c on c.id=l.cost_center_id where e.source_id=$1 and l.account_code='6361' and e.reversed_by is null and e.reverses is null", [ccExp]))[0]?.code === "ADM");
const ccManual = (await q("select post_manual_entry((now() at time zone 'America/Lima')::date,'Capacitación',null,$1::jsonb) id", [JSON.stringify([{ account: "6591", debit: 80, cost_center: ccVen }, { account: "1011", credit: 80 }])]))[0].id;
ok("asiento manual con centro de costo", (await q("select cost_center_id from journal_lines where entry_id=$1 and account_code='6591'", [ccManual]))[0].cost_center_id === ccVen);
await db.query("select reverse_manual_entry($1,'prueba de centros')", [ccManual]);
ok("el extorno conserva el centro de costo", (await q("select l.cost_center_id from journal_lines l join journal_entries e on e.id=l.entry_id where e.reverses=$1 and l.account_code='6591'", [ccManual]))[0].cost_center_id === ccVen);

// --- Lotes y vencimientos (FEFO) ---
await sudo();
const lp = (await q("select id from products where sku='LAC-002'"))[0].id;
const limaToday = (await q("select (now() at time zone 'America/Lima')::date::text d"))[0].d;
// Vencimientos siempre futuros, relativos al a?o en curso
const nextYear = Number(limaToday.slice(0, 4)) + 1;
const expA = `${nextYear}-03-31`;
const expB = `${nextYear}-04-30`;
const lpStock = Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [lp, branch]))[0].quantity);
await db.query("update products set track_lots=true where id=$1", [lp]);
const lotSum = async () => Number((await q("select coalesce(sum(quantity),0) v from lots where product_id=$1 and branch_id=$2", [lp, branch]))[0].v);
const lpQty = async () => Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [lp, branch]))[0].quantity);
ok("activar lotes crea el lote inicial con el stock actual", (await lotSum()) === lpStock, `${lpStock} u.`);
await as(admin);
const lpo = (await q("select create_purchase($1,$2,null,'',$3::jsonb) id", [sup, branch, JSON.stringify([{ product_id: lp, quantity: 30, unit_cost: 5 }])]))[0].id;
await fails("recepción exige lote y vencimiento", "select receive_purchase($1)", [lpo], "lote y la fecha de vencimiento");
await fails("no se recibe un lote vencido", "select receive_purchase($1,$2::jsonb)", [lpo, JSON.stringify([{ product_id: lp, lot_number: "L-OLD", expiry_date: "2020-01-01" }])], "ya está vencido");
await db.query("select receive_purchase($1,$2::jsonb)", [lpo, JSON.stringify([{ product_id: lp, lot_number: "l-2027", expiry_date: expA }])]);
ok("recepción crea el lote con su vencimiento", (await q("select quantity, expiry_date::text e from lots where product_id=$1 and branch_id=$2 and lot_number='L-2027'", [lp, branch]))[0]?.e === expA);
await sudo();
await db.query("update lots set expiry_date = (now() at time zone 'America/Lima')::date + 10 where product_id=$1 and lot_number='INICIAL'", [lp]);
await db.query("insert into lots (product_id, branch_id, lot_number, expiry_date, quantity) values ($1,$2,'L-VENCIDO','2020-01-01',0)", [lp, branch]);
await as(admin);
const lsess = (await q("select open_cash_session($1, 0) id", [branch]))[0].id;
const lsale = (await q("select create_sale($1,null,'ticket','tarjeta',0,0,$2::jsonb) id", [branch, JSON.stringify([{ product_id: lp, quantity: 3 }])]))[0].id;
const taken = await q("select lo.lot_number, -lm.quantity q from lot_movements lm join lots lo on lo.id=lm.lot_id join stock_movements m on m.id=lm.stock_movement_id where m.reference_id=$1", [lsale]);
ok("venta sale por FEFO (primero lo que vence antes)", taken.length === 1 && taken[0].lot_number === "INICIAL" && Number(taken[0].q) === 3, JSON.stringify(taken));
ok("lotes = stock tras la venta", (await lotSum()) === (await lpQty()));
await db.query("select void_sale($1,'prueba de lotes')", [lsale]);
ok("anular devuelve al mismo lote", (await lotSum()) === (await lpQty()) && Number((await q("select quantity from lots where product_id=$1 and branch_id=$2 and lot_number='INICIAL'", [lp, branch]))[0].quantity) === lpStock);
await sudo();
await db.query("update lots set expiry_date='2020-06-30' where product_id=$1 and lot_number='INICIAL'", [lp]);
await as(admin);
const valid = Number((await q("select quantity from lots where product_id=$1 and branch_id=$2 and lot_number='L-2027'", [lp, branch]))[0].quantity);
await fails("no se vende mercadería vencida", "select create_sale($1,null,'ticket','tarjeta',0,0,$2::jsonb)", [branch, JSON.stringify([{ product_id: lp, quantity: valid + 1 }])], "está vencido");
ok("una venta fallida no toca los lotes", (await lotSum()) === (await lpQty()));
const lsale2 = (await q("select create_sale($1,null,'ticket','tarjeta',0,0,$2::jsonb) id", [branch, JSON.stringify([{ product_id: lp, quantity: 2 }])]))[0].id;
ok("con stock vencido, la venta toma el lote vigente", (await q("select lo.lot_number from lot_movements lm join lots lo on lo.id=lm.lot_id join stock_movements m on m.id=lm.stock_movement_id where m.reference_id=$1", [lsale2]))[0].lot_number === "L-2027");
await db.query("select adjust_stock($1,$2,$3,'Retiro de vencidos')", [lp, branch, (await lpQty()) - lpStock]);
ok("el ajuste a la baja retira primero lo vencido", Number((await q("select quantity from lots where product_id=$1 and branch_id=$2 and lot_number='INICIAL'", [lp, branch]))[0].quantity) === 0 && (await lotSum()) === (await lpQty()));
await db.query("select transfer_stock($1,$2,$3,5,'')", [lp, branch, b2]);
ok("la transferencia lleva el lote y su vencimiento", (await q("select expiry_date::text e, quantity from lots where product_id=$1 and branch_id=$2 and lot_number='L-2027'", [lp, b2]))[0]?.e === expA);
const lotId = (await q("select id from lots where product_id=$1 and branch_id=$2 and lot_number='L-2027'", [lp, b2]))[0].id;
await db.query("select update_lot($1,'L-2027B',$2)", [lotId, expB]);
ok("corregir lote queda en auditoría", (await q("select 1 from audit_log where action='stock.lote'")).length === 1);
await db.query("select close_cash_session($1,0,'')", [lsess]);
await as(cajero);
await fails("vendedor no modifica lotes", "select update_lot($1,'X',null)", [lotId], "no puede modificar lotes");
await fails("nadie escribe lotes directo", "update lots set quantity=999", [], "permission denied");
await as(admin);
await sudo();
ok("lotes = stock en todas las sucursales", (await q("select s.branch_id from stock s join products p on p.id=s.product_id where p.track_lots and s.quantity <> (select coalesce(sum(quantity),0) from lots l where l.product_id=s.product_id and l.branch_id=s.branch_id)")).length === 0);

// --- Roles (0009): mínimo privilegio y separación por módulo ---
await sudo();
const roleIds = (await q("select id from roles")).map((r) => r.id);
ok("existen los roles del sistema", ["admin", "gerente", "gerente_area", "contador", "rrhh", "vendedor", "almacenero", "comprador", "cajero", "auditor", "empleado"].every((r) => roleIds.includes(r)));
const empUser = await mk("empleado@erp.test");
const empProfile = (await q("select role, active from profiles where id=$1", [empUser]))[0];
ok("alta sin rol nace como Empleado y sin acceso", empProfile.role === "empleado" && empProfile.active === false);
await grant(empUser, "empleado");
await as(empUser);
ok("empleado no ve ventas, kardex, proveedores ni fichas ajenas",
  (await q("select * from sales")).length === 0 && (await q("select * from stock_movements")).length === 0 &&
  (await q("select * from suppliers")).length === 0 && (await q("select * from employees")).length === 0);
await fails("empleado no crea clientes", "insert into customers (doc_type, doc_number, name) values ('DNI','11112222','X')", [], "row-level security");

await sudo();
const audUser = await mk("auditor@erp.test");
await grant(audUser, "auditor");
await as(audUser);
ok("auditor consulta ventas, compras, asientos y auditoría",
  (await q("select * from sales")).length > 0 && (await q("select * from purchases")).length > 0 &&
  (await q("select * from journal_entries")).length > 0 && (await q("select * from audit_log")).length > 0);
await fails("auditor no registra gastos", "insert into expenses (branch_id, category, description, amount, payment_method, expense_date) values ($1,'otros','x',1,'efectivo',current_date)", [branch], "row-level security");
await fails("auditor no ajusta stock", "select adjust_stock($1,$2,1,'x')", [prods[0].id, branch], "permiso");
await fails("auditor no anula ventas", "select void_sale($1,'prueba de auditor')", [saleId], "anular");

await sudo();
const contUser = await mk("contador@erp.test");
await grant(contUser, "contador");
await as(contUser);
ok("contador ve las órdenes y proveedores para registrar facturas (sin ser de Compras)", (await q("select * from purchases")).length > 0 && (await q("select * from suppliers")).length > 0);
ok("contador no ve el kardex de almacén", (await q("select * from stock_movements")).length === 0);
await fails("contador no crea solicitudes de pedido", "select create_requisition($1,'x',$2::jsonb)", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: 1 }])], "no puede crear");

// --- Vendedor cotiza, cajero cobra: la comisión es del vendedor ---
await sudo();
const vend = await mk("vendedor@erp.test");
await grant(vend, "vendedor");
const vendEmp = (await q("insert into employees (doc_number, full_name, position, salary, branch_id, profile_id, commission_rate) values ('70000001','Vendedora Uno','Vendedora',1200,$1,$2,3) returning id", [branch, vend]))[0].id;
await as(vend);
const vQuote = (await q("select create_quotation($1,null,5,0,'',$2::jsonb) id", [branch, JSON.stringify([{ product_id: prods[1].id, quantity: 2 }])]))[0].id;
const vQuoteTotal = Number((await q("select total from quotations where id=$1", [vQuote]))[0].total);
await fails("vendedor no cobra (no tiene caja)", "select create_sale($1,null,'boleta','efectivo',$3,0,null,$2,null)", [branch, vQuote, vQuoteTotal], "abrir caja");
await sudo();
await db.query("update profiles set role='cajero' where id=$1", [cajero]);
await as(cajero);
const cSession = (await q("select open_cash_session($1, 50) id", [branch]))[0].id;
const vSale = (await q("select create_sale($1,null,'boleta','efectivo',$3,0,null,$2,null) id", [branch, vQuote, vQuoteTotal]))[0].id;
const vSaleRow = (await q("select cashier_id, seller_id, subtotal from sales where id=$1", [vSale]))[0];
ok("venta desde cotización: cobra el cajero, vende el vendedor", vSaleRow.cashier_id === cajero && vSaleRow.seller_id === vend);
await db.query("select close_cash_session($1,$2,'')", [cSession, Number((await q("select cash_session_expected($1) v", [cSession]))[0].v)]);
await sudo();
const vCom = (await q("select employee_id, amount from commissions where sale_id=$1", [vSale]))[0];
ok("la comisión es del vendedor que cotizó", vCom?.employee_id === vendEmp && Number(vCom.amount) === Math.round(Number(vSaleRow.subtotal) * 3) / 100, JSON.stringify(vCom));
await as(vend);
ok("el vendedor ve su venta cobrada en caja", (await q("select id from sales where id=$1", [vSale])).length === 1);

// --- Planilla: sueldo + comisiones, con asiento ---
const period = (await q("select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM') p"))[0].p;
const payDay = (await q("select (now() at time zone 'America/Lima')::date::text d"))[0].d;
await fails("vendedor no paga planilla", "select pay_payroll($1,$2::uuid[],'transferencia',$3::date)", [period, [vendEmp], payDay], "no puede pagar");
await sudo();
const hrUser = await mk("rrhh@erp.test");
await grant(hrUser, "rrhh");
await as(hrUser);
await fails("planilla: fecha futura", "select pay_payroll($1,$2::uuid[],'transferencia',($3::date + 3))", [period, [vendEmp], payDay], "futura");
const vComTotal = Number((await q("select coalesce(sum(amount),0) v from commissions where employee_id=$1 and status='generada'", [vendEmp]))[0].v);
ok("planilla: paga a un colaborador", (await q("select pay_payroll($1,$2::uuid[],'transferencia',$3::date,'Planilla del mes') n", [period, [vendEmp], payDay]))[0].n === 1);
const pay = (await q("select * from payroll_payments where employee_id=$1 and status='pagado'", [vendEmp]))[0];
ok("planilla: sueldo + comisiones del mes", Number(pay.salary) === 1200 && Number(pay.commissions) === vComTotal && Number(pay.total) === 1200 + vComTotal && pay.number.startsWith("PL001-"), `${pay.number} total=${pay.total}`);
ok("planilla: las comisiones quedan pagadas", (await q("select count(*) c from commissions where employee_id=$1 and payroll_id=$2", [vendEmp, pay.id]))[0].c > 0);
await fails("planilla: no se paga dos veces el mismo mes", "select pay_payroll($1,$2::uuid[],'efectivo',$3::date)", [period, [vendEmp], payDay], "ya está pagada");
await sudo();
const pEntry = await q("select l.account_code, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_type='planilla' and e.source_id=$1", [pay.id]);
const pd = (acc) => pEntry.filter((l) => l.account_code === acc).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
ok("planilla: asiento sueldo (6211) + comisiones (4111) contra bancos (1041)", pd("6211") === 1200 && Math.abs(pd("4111") - vComTotal) < 0.001 && Math.abs(pd("1041") + 1200 + vComTotal) < 0.001, JSON.stringify(pEntry));
await as(vend);
ok("mis datos: el colaborador ve su ficha y su pago", (await q("select id from employees")).map((e) => e.id).join() === vendEmp && (await q("select id from payroll_payments")).length === 1);
await as(empUser);
ok("mis datos: nadie ve pagos ajenos", (await q("select id from payroll_payments")).length === 0);
await as(hrUser);
await fails("anular pago exige motivo", "select void_payroll_payment($1,'')", [pay.id], "motivo");
await db.query("select void_payroll_payment($1,'Monto equivocado')", [pay.id]);
ok("anular pago: libera las comisiones y extorna el asiento",
  (await q("select count(*) c from commissions where payroll_id=$1", [pay.id]))[0].c == 0 &&
  (await q("select count(*) c from payroll_payments where id=$1 and status='anulado'", [pay.id]))[0].c == 1);
ok("tras anular se puede volver a pagar", (await q("select pay_payroll($1,$2::uuid[],'efectivo',$3::date) n", [period, [vendEmp], payDay]))[0].n === 1);

// --- Compras: pedido por empaque, centro de costo y plazo del proveedor ---
await as(comp);
ok("proveedor con plazo de crédito de 30 días por defecto", Number((await q("select payment_terms from suppliers where id=$1", [sup]))[0].payment_terms) === 30);
const ccLog = (await q("select id from cost_centers where code='LOG'"))[0].id;
const packReq = (await q("select create_requisition($1,'Por cajas',$2::jsonb,$3) id", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: 24, pack_unit: "caja", pack_size: 12 }, { product_id: prods[1].id, quantity: 5 }]), ccLog]))[0].id;
const packItems = await q("select product_id, quantity, pack_unit, pack_size from purchase_requisition_items where requisition_id=$1 order by quantity desc", [packReq]);
ok("solicitud por cajas: guarda empaque y cantidad en unidades", packItems[0].pack_unit === "CAJA" && Number(packItems[0].pack_size) === 12 && Number(packItems[0].quantity) === 24 && packItems[1].pack_unit === "" && Number(packItems[1].pack_size) === 1);
ok("solicitud con centro de costo", (await q("select cost_center_id from purchase_requisitions where id=$1", [packReq]))[0].cost_center_id === ccLog);
await fails("empaque inválido", "select create_requisition($1,'x',$2::jsonb)", [branch, JSON.stringify([{ product_id: prods[0].id, quantity: 5, pack_unit: "caja", pack_size: 0 }])], "Empaque inválido");
await as(admin2);
await db.query("select decide_requisition($1,true,'Conforme')", [packReq]);
await as(comp);
const packPo = (await q("select create_purchase($1,$2,current_date+3,'',$3::jsonb,$4) id", [sup, branch, JSON.stringify([{ product_id: prods[0].id, quantity: 24, unit_cost: 2.5, pack_unit: "CAJA", pack_size: 12 }]), packReq]))[0].id;
const packPoRow = (await q("select cost_center_id, subtotal from purchases where id=$1", [packPo]))[0];
ok("la orden hereda el centro de costo de la solicitud", packPoRow.cost_center_id === ccLog && Number(packPoRow.subtotal) === 60);

// --- Líneas de crédito: control de crédito sin editar los demás datos del cliente ---
await as(contUser);
const crCust = (await q("select id from customers where doc_number='20481234567'"))[0].id;
ok("contador no edita datos del cliente", (await q("update customers set phone='000' where id=$1 returning id", [crCust])).length === 0);
await db.query("select set_customer_credit($1, 1500, 45)", [crCust]);
const crRow = (await q("select credit_limit, credit_days from customers where id=$1", [crCust]))[0];
ok("contador asigna la línea de crédito", Number(crRow.credit_limit) === 1500 && Number(crRow.credit_days) === 45);
await fails("plazo de crédito inválido", "select set_customer_credit($1, 100, 400)", [crCust], "Plazo inválido");
await as(vend);
await fails("vendedor no asigna crédito", "select set_customer_credit($1, 99999, 30)", [crCust], "no puede modificar la línea");
await sudo();
ok("el cambio de línea queda en la auditoría", (await q("select count(*) c from audit_log where action='cobro.credito' and summary like '%a 1,500.00%'"))[0].c > 0);

// --- RLS Tools (0010): ubicaciones, inventario físico y movimientos desde el celular ---
await sudo();
await db.exec(readFileSync(`${root}/supabase/migrations/0010_rls_tools.sql`, "utf8"));
ok("schema_version = 10 (RLS Tools)", (await q("select schema_version() v"))[0].v === 10);
const uid = () => crypto.randomUUID();
const almR = await mk("almacen.rls@erp.test");
await grant(almR, "almacenero");
const rp = (await q("select id, sku, barcode, cost from products where barcode is not null and active order by sku limit 2"));
const stockOf = async (pid) => Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [pid, branch]))[0]?.quantity ?? 0);

await as(almR);
const locA = (await q("insert into warehouse_locations (branch_id, code, zone) values ($1,'A-01-01','ABARROTES') returning id", [branch]))[0].id;
ok("almacén crea ubicaciones", Boolean(locA));
await fails("ubicación con código inválido", "insert into warehouse_locations (branch_id, code) values ($1,'a 1')", [branch], "check");

// Abrir y contar
const openOp = uid();
const open1 = (await q("select rls_open_count($1,$2,'Conteo de abarrotes','abarrotes',true,false) r", [openOp, branch]))[0].r;
ok("abre una sesión de inventario numerada", open1.number?.startsWith("IF001-"), open1.number);
ok("reabrir con el mismo id no crea otra (idempotente)", (await q("select rls_open_count($1,$2,'Conteo de abarrotes','',true,false) r", [openOp, branch]))[0].r.session_id === open1.session_id);
const sess = open1.session_id;
const c1 = uid();
await q("select rls_count($1,$2,$3,1,$4,'sumar')", [c1, sess, rp[0].barcode, locA]);
await q("select rls_count($1,$2,$3,1,$4,'sumar')", [uid(), sess, rp[0].barcode, locA]);
const again = (await q("select rls_count($1,$2,$3,1,$4,'sumar') r", [c1, sess, rp[0].barcode, locA]))[0].r;
ok("escaneo reenviado tras corte de señal no se cuenta dos veces", again.repetida === true && Number((await q("select counted from count_lines where session_id=$1 and product_id=(select id from products where barcode=$2)", [sess, rp[0].barcode]))[0].counted) === 2);
const bySku = (await q("select rls_count($1,$2,$3,5,null,'fijar') r", [uid(), sess, rp[1].sku.toLowerCase()]))[0].r;
ok("cuenta también por SKU y fija la cantidad", bySku.status === "ok" && Number(bySku.counted) === 5);
const unk = (await q("select rls_count($1,$2,'0000000099999',3,null,'sumar') r", [uid(), sess]))[0].r;
ok("código no registrado se reporta sin perderse", unk.status === "desconocido" && Number((await q("select quantity from count_unknown_codes where session_id=$1", [sess]))[0].quantity) === 3);
await fails("cantidad inválida", "select rls_count($1,$2,$3,-1,null,'sumar')", [uid(), sess, rp[0].barcode], "Cantidad inválida");

// Cerrar: foto del stock del ERP
const before0 = await stockOf(rp[0].id);
const before1 = await stockOf(rp[1].id);
await q("select rls_close_count($1,$2)", [uid(), sess]);
const snap = await q("select product_id, sum(counted) c, max(system_qty) s from count_lines where session_id=$1 group by product_id", [sess]);
ok("al cerrar guarda el stock del ERP para comparar", snap.every((l) => Number(l.s) === (l.product_id === rp[0].id ? before0 : before1)));
await fails("inventario cerrado no admite conteos", "select rls_count($1,$2,$3,1,null,'sumar')", [uid(), sess, rp[0].barcode], "ya está cerrada");

// Una venta entre el cierre y la aplicación no se pierde: se aplica solo la diferencia contada
await sudo();
await db.query("select _move_stock($1,$2,-1,'ajuste',0,'prueba',null,'Venta simulada entre cierre y aplicación')", [rp[1].id, branch]);
await as(comp);
await fails("quien solo consulta inventario no aplica", "select rls_apply_count($1,$2,'')", [uid(), sess], "Solo quien puede ajustar");
await as(almR);
const applied = (await q("select rls_apply_count($1,$2,'Conteo mensual') r", [uid(), sess]))[0].r;
ok("aplica el inventario al ERP", applied.adjustments === 2, JSON.stringify(applied));
ok("aplica la diferencia (contado − stock al cerrar) sin pisar movimientos posteriores",
  (await stockOf(rp[0].id)) === 2 && (await stockOf(rp[1].id)) === before1 - 1 + (5 - before1));
ok("los ajustes quedan en el kardex referidos al inventario", Number((await q("select count(*) c from stock_movements where reference_type='conteo' and reference_id=$1", [sess]))[0].c) === 2);
await fails("no se aplica dos veces", "select rls_apply_count($1,$2,'')", [uid(), sess], "Solo se aplica un inventario cerrado");

// Movimientos
await fails("salida exige motivo", "select rls_move($1,'salida',$2,$3,1)", [uid(), rp[0].barcode, branch], "Indica el motivo");
const stockIn = await stockOf(rp[0].id);
const mvOp = uid();
await q("select rls_move($1,'entrada',$2,$3,10,null,null,'Devolución de cliente')", [mvOp, rp[0].barcode, branch]);
await q("select rls_move($1,'entrada',$2,$3,10,null,null,'Devolución de cliente')", [mvOp, rp[0].barcode, branch]);
ok("entrada desde el celular (reenviada no se duplica)", (await stockOf(rp[0].id)) === stockIn + 10);
await q("select rls_move($1,'salida',$2,$3,4,null,null,'Merma por rotura')", [uid(), rp[0].barcode, branch]);
ok("salida desde el celular", (await stockOf(rp[0].id)) === stockIn + 6);
await fails("salida mayor al stock", "select rls_move($1,'salida',$2,$3,999999,null,null,'Merma')", [uid(), rp[0].barcode, branch], "Stock insuficiente");
await q("select rls_move($1,'ubicacion',$2,$3,null,null,$4,'')", [uid(), rp[0].barcode, branch, locA]);
ok("cambia la ubicación del producto", (await q("select location_id from product_locations where product_id=$1 and branch_id=$2", [rp[0].id, branch]))[0]?.location_id === locA);
await fails("código inexistente en movimiento", "select rls_move($1,'entrada','NOEXISTE',$2,1,null,null,'Prueba')", [uid(), branch], "no corresponde");
ok("bitácora de operaciones móviles del usuario", Number((await q("select count(*) c from mobile_operations where user_id=$1", [almR]))[0].c) >= 8);

await as(cajero);
await fails("cajero no abre inventarios", "select rls_open_count($1,$2,'Intento',  '',true,false)", [uid(), branch], "no puede abrir");
await fails("cajero no mueve stock", "select rls_move($1,'entrada',$2,$3,1,null,null,'Intento')", [uid(), rp[0].barcode, branch], "no puede registrar movimientos");
ok("cajero no ve sesiones de inventario", (await q("select * from count_sessions")).length === 0);
await fails("nadie escribe conteos directo", "insert into count_lines (session_id, product_id, counted) values ($1,$2,1)", [sess, rp[0].id], "permission denied");
await sudo();

// --- 0011: transferencias en tránsito y retornos a proveedor ---
await sudo();
await db.exec(readFileSync(`${root}/supabase/migrations/0011_transferencias_retornos.sql`, "utf8"));
ok("schema_version = 11", (await q("select schema_version() v"))[0].v === 11);
const tb2 = (await q("select id from branches where code='002'"))[0].id;
const tp = (await q("select id, barcode, sku, cost from products where barcode is not null and active and not track_lots order by sku desc limit 1"))[0];
const stockAt = async (b) => Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [tp.id, b]))[0]?.quantity ?? 0);
await as(almR);
const o0 = await stockAt(branch);
const d0 = await stockAt(tb2);
const trOp = uid();
const tr = (await q("select rls_send_transfer($1,$2,$3,$4::jsonb,'Reposición') r", [trOp, branch, tb2, JSON.stringify([{ code: tp.barcode, quantity: 6 }])]))[0].r;
ok("transferencia: guía numerada y en tránsito", tr.number?.startsWith("TR001-") && (await q("select status from transfer_orders where id=$1", [tr.transfer_id]))[0].status === "en_transito", tr.number);
ok("transferencia: sale del origen y aún no llega al destino", (await stockAt(branch)) === o0 - 6 && (await stockAt(tb2)) === d0);
ok("transferencia reenviada no sale dos veces", (await q("select rls_send_transfer($1,$2,$3,$4::jsonb,'') r", [trOp, branch, tb2, JSON.stringify([{ code: tp.barcode, quantity: 6 }])]))[0].r.repetida === true && (await stockAt(branch)) === o0 - 6);
await sudo();
const entriesBefore = Number((await q("select count(*) c from journal_entries"))[0].c);
await as(almR);
await q("select rls_receive_transfer($1,$2,$3::jsonb,'Llegó una caja abierta')", [uid(), tr.transfer_id, JSON.stringify([{ product_id: tp.id, quantity: 5 }])]);
ok("recepción con faltante: entra lo recibido en destino", (await stockAt(tb2)) === d0 + 5);
ok("la transferencia queda recibida con diferencias", (await q("select status from transfer_orders where id=$1", [tr.transfer_id]))[0].status === "recibida_con_diferencias");
await sudo();
ok("el faltante en tránsito se contabiliza como merma", Number((await q("select count(*) c from journal_entries"))[0].c) === entriesBefore + 1);
await as(almR);
await fails("no se recibe dos veces", "select rls_receive_transfer($1,$2,'[]'::jsonb,'')", [uid(), tr.transfer_id], "ya fue recibida");
await fails("transferencia a la misma tienda", "select rls_send_transfer($1,$2,$2,$3::jsonb,'')", [uid(), branch, JSON.stringify([{ code: tp.barcode, quantity: 1 }])], "distintos");

// Retorno a proveedor
const rsup = (await q("select id from suppliers limit 1"))[0].id;
const r0 = await stockAt(branch);
const retorno = (await q("select rls_supplier_return($1,$2,$3,null,$4::jsonb,'Producto dañado') r", [uid(), branch, rsup, JSON.stringify([{ code: tp.sku, quantity: 2 }])]))[0].r;
ok("retorno a proveedor numerado y descuenta stock", retorno.number?.startsWith("DV001-") && (await stockAt(branch)) === r0 - 2, retorno.number);
await sudo();
const retEntry = await q("select l.account_code, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_type='inventario' and e.description like 'Retorno a proveedor%'");
ok("el retorno se contabiliza como reclamo al proveedor (1673), no como merma", retEntry.some((l) => l.account_code === "1673" && Number(l.debit) > 0) && !retEntry.some((l) => l.account_code === "6591"), JSON.stringify(retEntry));
await as(comp);
await fails("comprador no envía transferencias", "select rls_send_transfer($1,$2,$3,$4::jsonb,'')", [uid(), branch, tb2, JSON.stringify([{ code: tp.barcode, quantity: 1 }])], "no puede transferir");
ok("comprador consulta los retornos", (await q("select * from supplier_returns")).length === 1);
await sudo();

// --- 0012: planilla pagada por Tesorería y notas de crédito parciales ---
await sudo();
await db.exec(readFileSync(`${root}/supabase/migrations/0012_tesoreria_notas_credito.sql`, "utf8"));
ok("schema_version = 12", (await q("select schema_version() v"))[0].v === 12);
const tesEmp = (await q("select e.id from employees e where e.status <> 'cesado' and e.salary > 0 and not exists (select 1 from payroll_payments p where p.employee_id = e.id and p.period = $1 and p.status = 'pagado') order by e.full_name limit 1", [period]))[0]?.id;
await as(hrUser);
await fails("RRHH ya no paga la planilla (lo hace Tesorería)", "select pay_payroll($1,$2::uuid[],'transferencia',$3::date)", [period, [tesEmp], payDay], "Tesorería");
ok("RRHH sigue viendo la planilla", (await q("select id from employees")).length > 0);
await as(contUser);
ok("Tesorería (contador) ve a quién paga", (await q("select id from employees where id=$1", [tesEmp])).length === 1);
ok("Tesorería paga la planilla", (await q("select pay_payroll($1,$2::uuid[],'transferencia',$3::date,'Pago por Tesorería') n", [period, [tesEmp], payDay]))[0].n === 1);
const tesPay = (await q("select id from payroll_payments where employee_id=$1 and period=$2 and status='pagado'", [tesEmp, period]))[0];
await as(hrUser);
await fails("RRHH no anula pagos de planilla", "select void_payroll_payment($1,'Error de monto')", [tesPay.id], "Tesorería");
await as(contUser);
await db.query("select void_payroll_payment($1,'Error de monto')", [tesPay.id]);
ok("Tesorería anula el pago", (await q("select status from payroll_payments where id=$1", [tesPay.id]))[0].status === "anulado");

// Nota de crédito parcial
await sudo();
const ncUser = await mk("caja-nc@erp.test");
await as(admin);
await grant(ncUser, "admin");
await sudo();
const ncProds = await q("select p.id, p.price from products p join stock s on s.product_id = p.id and s.branch_id = $1 where p.active and not p.track_lots and s.quantity >= 10 order by p.sku limit 2", [branch]);
const ncStock = async (pid) => Number((await q("select quantity from stock where product_id=$1 and branch_id=$2", [pid, branch]))[0].quantity);
await as(ncUser);
const ncSession = (await q("select open_cash_session($1, 500) id", [branch]))[0].id;
const ncItems = JSON.stringify(ncProds.map((p) => ({ product_id: p.id, quantity: 3 })));
const ncSale = (await q("select create_sale($1,null,'boleta','efectivo',1000,0,$2::jsonb) id", [branch, ncItems]))[0].id;
await fails("sin comprobante no hay nota de crédito", "select issue_partial_credit_note($1,$2::jsonb,'Producto con falla')", [ncSale, JSON.stringify([{ product_id: ncProds[0].id, quantity: 1 }])], "no tiene comprobante");
await q("select issue_e_document($1)", [ncSale]);
const a0 = await ncStock(ncProds[0].id);
const b0 = await ncStock(ncProds[1].id);
const cash0 = Number((await q("select cash_session_expected($1) v", [ncSession]))[0].v);
await fails("nota de crédito exige motivo", "select issue_partial_credit_note($1,$2::jsonb,'')", [ncSale, JSON.stringify([{ product_id: ncProds[0].id, quantity: 1 }])], "motivo");
await fails("no se devuelve más de lo vendido", "select issue_partial_credit_note($1,$2::jsonb,'Producto con falla')", [ncSale, JSON.stringify([{ product_id: ncProds[0].id, quantity: 4 }])], "Solo quedan 3");
const nc1 = (await q("select issue_partial_credit_note($1,$2::jsonb,'Producto con falla') id", [ncSale, JSON.stringify([{ product_id: ncProds[0].id, quantity: 2 }])]))[0].id;
const nc1Doc = (await q("select number, scope, total from e_documents where id=$1", [nc1]))[0];
const expected1 = Math.round(2 * Number(ncProds[0].price) * 100) / 100;
ok("nota de crédito parcial: solo lo devuelto", nc1Doc.scope === "parcial" && nc1Doc.number.startsWith("BC") && Math.abs(Number(nc1Doc.total) - expected1) < 0.01, `${nc1Doc.number} ${nc1Doc.total}`);
ok("nota de crédito parcial: reingresa solo ese stock", (await ncStock(ncProds[0].id)) === a0 + 2 && (await ncStock(ncProds[1].id)) === b0);
ok("nota de crédito parcial: el efectivo sale de la caja", Math.abs(Number((await q("select cash_session_expected($1) v", [ncSession]))[0].v) - (cash0 - expected1)) < 0.01);
await fails("una segunda nota no supera lo que queda", "select issue_partial_credit_note($1,$2::jsonb,'Otra falla')", [ncSale, JSON.stringify([{ product_id: ncProds[0].id, quantity: 2 }])], "Solo quedan 1");
await q("select issue_partial_credit_note($1,$2::jsonb,'Otra falla','yape')", [ncSale, JSON.stringify([{ product_id: ncProds[0].id, quantity: 1 }])]);
ok("varias notas parciales en una venta", Number((await q("select count(*) c from e_documents where sale_id=$1 and kind='nota_credito'", [ncSale]))[0].c) === 2);
await fails("con devoluciones parciales la venta no se anula entera", "select void_sale($1,'Cliente se arrepintió')", [ncSale], "devoluciones parciales");
await sudo();
const ncLines = await q("select l.account_code, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_type='nota_credito' and e.source_id=$1", [nc1]);
const nd = (acc) => ncLines.filter((l) => l.account_code === acc).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
ok("nota de crédito: revierte ingreso + IGV contra caja, y el costo", Math.abs(nd("7011") + nd("40111") - expected1) < 0.01 && Math.abs(nd("1011") + expected1) < 0.01 && nd("2011") > 0 && nd("6911") < 0, JSON.stringify(ncLines));
await as(cajero);
await fails("el cajero no emite notas de crédito", "select issue_partial_credit_note($1,$2::jsonb,'Producto con falla')", [ncSale, JSON.stringify([{ product_id: ncProds[1].id, quantity: 1 }])], "no puede emitir");
await sudo();

// --- 0013: reportes netos de devoluciones y comisiones ya pagadas ---
await sudo();
const today13 = (await q("select (now() at time zone 'America/Lima')::date::text d"))[0].d;
const salesDay = async () => Number((await q("select total from report_sales_by_day($1::date,$1::date,$2)", [today13, branch]))[0].total);
const topQty = async (pid) => Number((await q("select quantity from report_top_products($1::date,$1::date,$2,1000) where product_id=$3", [today13, branch, pid]))[0]?.quantity ?? 0);
const before13 = await salesDay();
const topBefore = await topQty(ncProds[0].id);
const ncToday = Number((await q("select coalesce(sum(total),0) t from e_documents where kind='nota_credito' and scope='parcial' and branch_id=$1", [branch]))[0].t);
const ncQtyA = Number((await q("select coalesce(sum(ci.quantity),0) q from credit_note_items ci where ci.product_id=$1", [ncProds[0].id]))[0].q);
await db.exec(readFileSync(`${root}/supabase/migrations/0013_reportes_netos_comisiones.sql`, "utf8"));
ok("schema_version = 13", (await q("select schema_version() v"))[0].v === 13);
ok("reporte por día descuenta las notas de crédito parciales", Math.abs(before13 - ncToday - (await salesDay())) < 0.01, `${before13} → ${await salesDay()} (notas ${ncToday})`);
ok("productos más vendidos descuentan lo devuelto", Math.abs((await topQty(ncProds[0].id)) - (topBefore - ncQtyA)) < 0.001, `${topBefore} → ${await topQty(ncProds[0].id)}`);
const brk = await q("select sum(total) t from report_sales_breakdown($1::date,$1::date,$2,'payment_method')", [today13, branch]);
ok("desglose por medio de pago cuadra con el total del día", Math.abs(Number(brk[0].t) - (await salesDay())) < 0.01);

// Comisión ya pagada: la devolución deja un ajuste negativo para la próxima planilla
const vPaid = (await q("select payroll_id from commissions where sale_id=$1 and kind='venta'", [vSale]))[0];
ok("la comisión de la venta del vendedor ya está pagada", vPaid?.payroll_id != null);
const vItem = (await q("select product_id, quantity from sale_items where sale_id=$1 order by product_id limit 1", [vSale]))[0];
await as(ncUser);
await q("select issue_e_document($1)", [vSale]);
await q("select issue_partial_credit_note($1,$2::jsonb,'Cliente devolvió un producto','tarjeta')", [vSale, JSON.stringify([{ product_id: vItem.product_id, quantity: 1 }])]);
await sudo();
const adj = (await q("select amount, payroll_id, kind from commissions where sale_id=$1 and kind='ajuste'", [vSale]))[0];
ok("comisión pagada: queda un ajuste negativo pendiente", adj && Number(adj.amount) < 0 && adj.payroll_id === null, JSON.stringify(adj));
ok("comisión pagada: el ajuste se contabiliza al revés", (await q("select 1 from journal_lines l join journal_entries e on e.id=l.entry_id join commissions c on c.id::text=e.source_id where c.kind='ajuste' and l.account_code='4111' and l.debit > 0")).length === 1);
await as(contUser);
const prevPay = (await q("select id, commissions from payroll_payments where employee_id=$1 and period=$2 and status='pagado'", [vendEmp, period]))[0];
await db.query("select void_payroll_payment($1,'Recalcular comisiones')", [prevPay.id]);
await q("select pay_payroll($1,$2::uuid[],'transferencia',$3::date,'Con ajuste')", [period, [vendEmp], payDay]);
const newPay = (await q("select commissions from payroll_payments where employee_id=$1 and period=$2 and status='pagado'", [vendEmp, period]))[0];
ok("la próxima planilla descuenta el ajuste", Math.abs(Number(newPay.commissions) - (Number(prevPay.commissions) + Number(adj.amount))) < 0.01, `${prevPay.commissions} → ${newPay.commissions}`);
await sudo();

ok("final: todos los asientos cuadran", (await q("select entry_id from journal_lines group by entry_id having sum(debit) <> sum(credit)")).length === 0);
const drift2 = await q(`select count(*) c from stock s where quantity <> (select sum(quantity) from stock_movements m where m.product_id=s.product_id and m.branch_id=s.branch_id)`);
ok("final: stock = suma de kardex", Number(drift2[0].c) === 0);

console.log(failed ? `\n${failed} PRUEBAS FALLARON` : "\nTODAS LAS PRUEBAS PASARON");
process.exit(failed ? 1 : 0);
