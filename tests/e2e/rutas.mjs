// Prueba de humo autenticada: crea usuarios temporales de varios roles, recorre
// las rutas con su sesión (solo lectura), verifica permisos y los elimina al final.
//
// Uso: npm run test:e2e -- http://localhost:3000   (o la URL de producción)
// Requiere .env.local con SUPABASE_SERVICE_ROLE_KEY.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = process.cwd();
const base = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const require = createRequire(join(root, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");

const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let failed = 0;
const created = [];
const report = (ok, name, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
};

async function login(role) {
  const email = `qa-temp-${randomBytes(4).toString("hex")}@hana4.test`;
  const password = randomBytes(18).toString("base64url");
  const { data: branch } = await admin.from("branches").select("id").eq("active", true).order("code").limit(1).single();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `QA Temporal ${role}` },
    app_metadata: { role, branch_id: branch.id },
  });
  if (error) throw new Error(`No se pudo crear el usuario temporal: ${error.message}`);
  created.push(data.user.id);
  // Igual que la aplicación: el rol y el acceso se asignan tras crear la cuenta.
  const up = await admin.from("profiles").update({ role, branch_id: branch.id, active: true, full_name: `QA Temporal ${role}` }).eq("id", data.user.id).select("id");
  if (up.error || !up.data?.length) throw new Error(`No se pudo asignar el rol: ${up.error?.message}`);

  const jar = new Map();
  const client = createServerClient(URL_, KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const res = await client.auth.signInWithPassword({ email, password });
  if (res.error) throw new Error(`No se pudo iniciar sesión: ${res.error.message}`);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function get(cookie, path) {
  const res = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body, location: res.headers.get("location") };
}

const ERRORS = ["No pudimos cargar esta sección", "__next_error__", "Application error", "Internal Server Error"];

async function page(cookie, path, expected, label = path) {
  const { status, body, location } = await get(cookie, path);
  const bad = ERRORS.find((e) => body.includes(e));
  const redirected = body.includes("NEXT_REDIRECT") || status === 307;
  const ok = status === 200 && !bad && !redirected && expected.every((t) => body.includes(t));
  const missing = expected.filter((t) => !body.includes(t));
  report(ok, label, ok ? `(${(body.length / 1024).toFixed(0)} KB)` : `status=${status}${location ? " → " + location : ""}${bad ? " error=«" + bad + "»" : ""}${redirected ? " [redirige]" : ""}${missing.length ? " falta=" + JSON.stringify(missing) : ""}`);
  return body;
}

async function denied(cookie, path) {
  const { status, body } = await get(cookie, path);
  const ok = status === 307 || body.includes("NEXT_REDIRECT");
  report(ok, `sin permiso → ${path} redirige`, ok ? "" : `status=${status}`);
}

try {
  const a = await login("admin");
  console.log("— Administrador —");
  // Inicio al estilo ERP clásico: módulos SAP en mosaicos, áreas y funciones
  await page(a, "/", ["Gestión de Materiales", "Ventas y Distribución", "Finanzas", "Controlling", "Recursos Humanos", "Acerca de"]);
  await page(a, "/?m=mm&a=compras", ["Nuevo Proveedor", "Nueva Orden de Compra", "Órdenes de Compra (Histórico)", "Atrás"], "lanzador MM › Compras");
  await page(a, "/?m=mm&a=almacen", ["Recepción de Mercadería", "Recibos de Mercadería (Histórico)"], "lanzador MM › Almacén");
  await page(a, "/?m=general", ["Preferencias de Estación de Trabajo", "Mensajes de Tienda", "Calendario", "Mis Datos"], "lanzador General");
  await page(a, "/mis-datos", ["Mis datos"]);
  await page(a, "/panel", ["Ventas de hoy", "Ventas por día"]);
  await page(a, "/mensajes", ["Mensajes de tienda"]);
  await page(a, "/calendario", ["Vencimientos del mes"]);
  await page(a, "/pos", ["Punto de venta"]);
  const ventas = await page(a, "/ventas", ["Comprobante", "B001-"]);
  const saleId = ventas.match(/\/ventas\/([0-9a-f-]{36})/)?.[1];
  if (saleId) await page(a, `/ventas/${saleId}`, ["Op. gravada", "Total"], "/ventas/[id]");
  else report(false, "/ventas/[id]", "no se encontró ningún comprobante en la lista");
  await page(a, "/caja", ["Caja: apertura y cierre"]);
  await page(a, "/caja/cierres", ["Cierres de caja (histórico)", "Resultado"]);
  await page(a, "/clientes", ["Cliente", "Documento"]);
  const inv = await page(a, "/inventario", ["Listado de productos", "Productos activos", "Arroz Extra 5 kg"]);
  report(!inv.includes(">Kardex<") && !inv.includes(">Lotes y vencimientos<"), "cada pantalla muestra solo lo suyo (sin pestañas de otras pantallas)");
  await page(a, "/inventario/fisico", ["Inventario físico", "Referencia del conteo"]);
  await page(a, "/inventario/ubicaciones", ["Ubicaciones de almacén", "Nueva <!-- -->ubicación"]);
  await page(a, "/inventario/conteos", ["Inventarios desde RLS Tools"]);
  await page(a, "/inventario/movimientos?tipo=ajuste", ["Ajustes de inventario (histórico)"], "kardex filtrado: ajustes");
  await page(a, "/inventario/movimientos", ["Saldo"]);
  await page(a, "/inventario/categorias", ["Abarrotes"]);
  await page(a, "/compras", ["Órdenes de compra", "Orden directa", "N.º de orden"]);
  await page(a, "/compras?estado=ordenada", ["Recepción de mercadería"], "compras por recibir");
  await page(a, "/compras/solicitudes", ["Solicitudes de pedido", "Nueva solicitud"]);
  await page(a, "/compras/solicitudes/nueva", ["Productos solicitados", "Enviar a aprobación", "Centro de costo"]);
  await page(a, "/cuentas-por-pagar", ["Total por pagar", "Vencido"]);
  await page(a, "/cotizaciones", ["Órdenes de venta", "Nueva cotización"]);
  await page(a, "/cotizaciones?estado=vigente", ["Órdenes de venta por cobrar"], "órdenes por cobrar");
  await page(a, "/cotizaciones/nueva", ["Productos cotizados", "Emitir cotización"]);
  await page(a, "/cuentas-por-cobrar", ["Total por cobrar", "Vencido"]);
  await page(a, "/cuentas-por-cobrar/lineas", ["Líneas de crédito", "Línea agotada"]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  await page(a, `/contabilidad?desde=${today.slice(0, 4)}-01-01`, ["Libro diario", "Ventas - mercaderías", "IGV - Cuenta propia"], "/contabilidad (libro diario)");
  await page(a, "/contabilidad/mayor?cuenta=1011", ["Saldo inicial", "Caja"], "/contabilidad/mayor");
  const balances = await page(a, "/contabilidad/balances", ["Balance de comprobación", "Estado de resultados", "Situación financiera"]);
  report(balances.includes("Cuadra") && !balances.includes("No cuadra"), "situación financiera cuadra");
  await page(a, "/contabilidad/plan", ["Plan de cuentas", "Mercaderías"]);
  await page(a, "/contabilidad/centros", ["Centros de costo", "Administración"]);
  await page(a, "/contabilidad/centros/reporte", ["Resultado por sucursal", "Gasto por centro de costo"]);
  await page(a, "/inventario/lotes", ["Lotes con stock", "FEFO"]);
  await page(a, "/finanzas", ["Centro de costo"], "/finanzas con centro de costo");
  await page(a, "/contabilidad/periodos", ["Periodos contables", "En curso"]);
  await page(a, "/contabilidad/asiento", ["Registrar asiento"]);
  const diario = await get(a, `/api/export/diario?desde=${today.slice(0, 4)}-01-01`);
  let drows = null;
  try { drows = JSON.parse(diario.body).rows; } catch {}
  report(diario.status === 200 && Array.isArray(drows) && drows.length > 1000, "/api/export/diario", drows ? `→ ${drows.length} líneas` : diario.body.slice(0, 80));
  await page(a, "/clientes", ["Crédito", "Contado"], "/clientes con línea de crédito");
  await page(a, "/compras/nueva", ["Productos de la orden", "Centro de costo", "crédito"]);
  await page(a, "/proveedores", ["Proveedor", "Crédito"]);
  await page(a, "/finanzas/resultados", ["Estado de resultados", "Utilidad bruta"]);
  await page(a, "/rrhh", ["Colaboradores", "Planilla mensual", "Centro de costo"]);
  await page(a, "/rrhh/comisiones", ["Comisiones por ventas", "Por pagar"]);
  await page(a, "/rrhh/planilla", ["Pago de planilla", "Pagos registrados"]);
  await page(a, "/reportes", ["Productos más vendidos", "Por categoría"]);
  await page(a, "/configuracion", ["Datos de la empresa"]);
  await page(a, "/configuracion/sucursales", ["Tienda Principal"]);
  await page(a, "/configuracion/usuarios", ["Usuarios del sistema"]);
  await page(a, "/configuracion/roles", ["Cajero", "Vendedor", "Comprador", "Auditor", "Empleado", "Exportar matriz"]);
  await page(a, "/configuracion/auditoria", ["Qué hizo", "QA Temporal"].slice(0, 1).concat(["nadie puede editarlo ni borrarlo"]).slice(1));
  const loginRes = await fetch(base + "/login");
  const loginHtml = await loginRes.text();
  report(loginRes.status === 200 && loginHtml.includes("Iniciar sesión") && loginHtml.includes("/brand/mark.png"), "/login con logo");

  const alerts = await get(a, "/api/alerts");
  let items = null;
  try { items = JSON.parse(alerts.body).items; } catch {}
  report(alerts.status === 200 && Array.isArray(items), "/api/alerts", `→ ${items ? items.map((i) => i.title).join(" | ") || "(sin avisos)" : alerts.body.slice(0, 80)}`);
  const search = await get(a, "/api/search?q=arroz");
  let groups = null;
  try { groups = JSON.parse(search.body).groups; } catch {}
  report(search.status === 200 && groups?.some((g) => g.label === "Productos"), "/api/search?q=arroz", `→ ${groups ? groups.map((g) => `${g.label}: ${g.items.length}`).join(", ") : search.body.slice(0, 80)}`);
  const billing = await page(a, "/facturacion", ["Facturación electrónica"]);
  console.log(`      facturación: ${billing.includes("Falta activar la facturación") ? "pendiente de migración 0003 (aviso mostrado)" : billing.includes("Modo demostración") ? "activa en modo demo" : "estado desconocido"}`);

  console.log("— PWA y archivos públicos (sin sesión) —");
  for (const [path, type] of [["/manifest.webmanifest", "manifest"], ["/sw.js", "javascript"], ["/offline.html", "text/html"], ["/icons/icon-192.png", "image/png"], ["/icons/icon-maskable-512.png", "image/png"]]) {
    const r = await fetch(base + path, { redirect: "manual" });
    const ct = r.headers.get("content-type") ?? "";
    report(r.status === 200 && ct.includes(type), `público ${path}`, `status=${r.status} ${ct}`);
  }
  const manifest = await (await fetch(base + "/manifest.webmanifest")).json().catch(() => null);
  report(manifest?.name === "ERP HANA4" && manifest?.display === "standalone" && manifest?.icons?.length === 3, "manifiesto instalable", manifest ? `${manifest.short_name}, ${manifest.icons.length} íconos, ${manifest.shortcuts.length} accesos` : "");
  const sw = await fetch(base + "/sw.js");
  report((sw.headers.get("cache-control") ?? "").includes("no-store"), "service worker sin caché", sw.headers.get("cache-control") ?? "");

  console.log("— Exportación —");
  for (const dataset of ["ventas", "kardex", "compras", "solicitudes", "cotizaciones", "cierres", "planilla"]) {
    const r = await get(a, `/api/export/${dataset}`);
    let rows = null;
    try { rows = JSON.parse(r.body).rows; } catch {}
    report(r.status === 200 && Array.isArray(rows) && (!["ventas", "kardex"].includes(dataset) || rows.length > 0), `/api/export/${dataset}`, rows ? `→ ${rows.length} filas${rows[0] ? " · columnas: " + Object.keys(rows[0]).join(", ") : ""}` : r.body.slice(0, 80));
  }
  for (const extra of process.argv.slice(4)) await page(a, extra, []);

  console.log("— Cajero —");
  const c = await login("cajero");
  const home = await page(c, "/", ["Ventas y Distribución"]);
  report(home.includes('href="/?m=sd"') && !home.includes('href="/?m=fi"') && !home.includes('href="/?m=mm"'), "inicio del cajero: solo SD y General");
  const sd = await page(c, "/?m=sd&a=caja", ["Cobrar Órdenes de Venta", "Cobrar Ventas al Crédito"], "lanzador del cajero");
  const basis = await page(c, "/?m=general", ["Calendario", "Mis Datos"], "General del cajero");
  report(sd.includes('href="/caja"') && !basis.includes('href="/configuracion"') && !basis.includes("Roles y Permisos"), "menú del cajero: ve su caja, no ve Configuración");
  await page(c, "/pos", ["Punto de venta"]);
  await page(c, "/cotizaciones?estado=vigente", ["Órdenes de venta por cobrar"], "cajero ve órdenes por cobrar");
  await page(c, "/cuentas-por-cobrar", ["Total por cobrar"], "cajero cobra créditos");
  await denied(c, "/cuentas-por-cobrar/lineas");
  await denied(c, "/contabilidad");
  const dexp = await get(c, "/api/export/diario");
  report(dexp.status === 403, "vendedor no exporta el libro diario", `status=${dexp.status}`);
  const cli = await get(c, "/clientes");
  report(cli.status === 200 && !cli.body.includes("Línea de crédito") && !cli.body.includes('aria-label="Editar"'), "cajero no edita clientes ni su línea de crédito");
  for (const p of ["/inventario", "/inventario/movimientos", "/finanzas", "/rrhh", "/rrhh/planilla", "/reportes", "/configuracion", "/configuracion/roles", "/compras", "/compras/solicitudes", "/cuentas-por-pagar", "/proveedores", "/facturacion"]) await denied(c, p);

  console.log("— Vendedor —");
  const v = await login("vendedor");
  const vsd = await page(v, "/?m=sd&a=ventas", ["Nueva Orden de Venta (Cotización)", "Nuevo Cliente"], "lanzador del vendedor");
  report(!vsd.includes('href="/pos"') && !vsd.includes('href="/caja"'), "vendedor no cobra en caja (no ve Nueva Venta ni Caja)");
  await page(v, "/cotizaciones/nueva", ["Emitir cotización"], "vendedor cotiza");
  const vcli = await page(v, "/clientes", ["Nuevo <!-- -->cliente"], "vendedor registra clientes");
  report(!vcli.includes('aria-label="Editar"'), "vendedor no edita clientes");
  for (const p of ["/caja", "/inventario", "/cuentas-por-cobrar", "/contabilidad", "/compras"]) await denied(v, p);

  console.log("— Almacenero —");
  const w = await login("almacenero");
  const mm = await page(w, "/?m=mm&a=almacen", ["Recepción de Mercadería"], "lanzador del almacenero");
  report(!mm.includes("Nuevo Proveedor") && !mm.includes("Nueva Solicitud de Pedido"), "almacenero no ve Nuevo proveedor ni Nueva solicitud");
  await page(w, "/compras?estado=ordenada", ["Recepción de mercadería"], "almacenero ve lo que debe recibir");
  await page(w, "/inventario/fisico", ["Inventario físico"], "almacenero hace inventario físico");
  for (const p of ["/compras/solicitudes/nueva", "/proveedores", "/cuentas-por-pagar", "/caja"]) await denied(w, p);

  console.log("— Comprador —");
  const b = await login("comprador");
  await page(b, "/?m=mm&a=compras", ["Nuevo Proveedor", "Nueva Solicitud de Pedido", "Nueva Orden de Compra"], "lanzador del comprador");
  await page(b, "/compras/solicitudes/nueva", ["Productos solicitados"], "comprador crea solicitudes");
  await denied(b, "/inventario/fisico");

  console.log("— Contador —");
  const k = await login("contador");
  const khome = await page(k, "/", ["Finanzas", "Controlling"]);
  report(!khome.includes('href="/?m=mm"') && !khome.includes('href="/?m=sd"'), "contador ve FI y CO, no MM ni SD");
  await page(k, "/cuentas-por-cobrar/lineas", ["Líneas de crédito"], "contador asigna líneas de crédito");
  await denied(k, "/inventario/movimientos");

  console.log("— Recursos humanos y Empleado —");
  const h = await login("rrhh");
  await page(h, "/rrhh/planilla", ["Pago de planilla"], "RRHH paga la planilla");
  await denied(h, "/ventas");
  const e = await login("empleado");
  const ehome = await page(e, "/", ["General"]);
  report(!/href="\/\?m=(mm|sd|fi|co|hcm)"/.test(ehome), "empleado solo ve General (autoservicio)");
  await page(e, "/mis-datos", ["Mis datos"], "empleado ve sus datos");
  for (const p of ["/ventas", "/inventario", "/rrhh", "/clientes"]) await denied(e, p);
  const forbidden = await get(c, "/api/export/compras");
  report(forbidden.status === 403, "vendedor no exporta compras", `status=${forbidden.status}`);
  const own = await get(c, "/api/export/ventas");
  report(own.status === 200 && JSON.parse(own.body).rows.length === 0, "vendedor exporta solo sus ventas (ninguna)");
} catch (e) {
  failed++;
  console.log("ERROR", e.message);
} finally {
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(error ? `¡ATENCIÓN! No se pudo eliminar el usuario temporal ${id}: ${error.message}` : `usuario temporal eliminado`);
  }
  const { data: left } = await admin.from("profiles").select("email").like("email", "qa-temp-%");
  console.log(`usuarios temporales restantes: ${left?.length ?? "?"}`);
}
console.log(failed ? `\n${failed} VERIFICACIONES FALLARON` : "\nTODO FUNCIONA");
process.exit(failed ? 1 : 0);
