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
  await page(a, "/", ["Ventas de hoy", "Ventas por día", "ERP", "HANA4", "Buscar productos, clientes, comprobantes"]);
  await page(a, "/pos", ["Punto de venta"]);
  const ventas = await page(a, "/ventas", ["Comprobante", "B001-"]);
  const saleId = ventas.match(/\/ventas\/([0-9a-f-]{36})/)?.[1];
  if (saleId) await page(a, `/ventas/${saleId}`, ["Op. gravada", "Total"], "/ventas/[id]");
  else report(false, "/ventas/[id]", "no se encontró ningún comprobante en la lista");
  await page(a, "/caja", ["Historial de cierres"]);
  await page(a, "/clientes", ["Cliente", "Documento"]);
  await page(a, "/inventario", ["Productos activos", "Arroz Extra 5 kg"]);
  await page(a, "/inventario/movimientos", ["Saldo"]);
  await page(a, "/inventario/categorias", ["Abarrotes"]);
  await page(a, "/compras", ["Compras", "Órdenes de compra", "Orden directa"]);
  await page(a, "/compras/solicitudes", ["Solicitudes de pedido", "Nueva solicitud"]);
  await page(a, "/compras/solicitudes/nueva", ["Productos solicitados", "Enviar a aprobación"]);
  await page(a, "/cuentas-por-pagar", ["Total por pagar", "Vencido"]);
  await page(a, "/cotizaciones", ["Cotizaciones", "Nueva cotización"]);
  await page(a, "/cotizaciones/nueva", ["Productos cotizados", "Emitir cotización"]);
  await page(a, "/cuentas-por-cobrar", ["Total por cobrar", "Vencido"]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  await page(a, `/contabilidad?desde=${today.slice(0, 4)}-01-01`, ["Libro diario", "Ventas - mercaderías", "IGV - Cuenta propia"], "/contabilidad (libro diario)");
  await page(a, "/contabilidad/mayor?cuenta=1011", ["Saldo inicial", "Caja"], "/contabilidad/mayor");
  const balances = await page(a, "/contabilidad/balances", ["Balance de comprobación", "Estado de resultados", "Situación financiera"]);
  report(balances.includes("Cuadra") && !balances.includes("No cuadra"), "situación financiera cuadra");
  await page(a, "/contabilidad/plan", ["Plan de cuentas", "Mercaderías"]);
  await page(a, "/contabilidad/centros", ["Resultado por sucursal", "Gasto por centro de costo", "Administración"]);
  await page(a, "/inventario/lotes", ["Lotes con stock", "FEFO"]);
  await page(a, "/finanzas", ["Centro de costo"], "/finanzas con centro de costo");
  await page(a, "/contabilidad/periodos", ["Periodos contables", "En curso"]);
  await page(a, "/contabilidad/asiento", ["Registrar asiento"]);
  const diario = await get(a, `/api/export/diario?desde=${today.slice(0, 4)}-01-01`);
  let drows = null;
  try { drows = JSON.parse(diario.body).rows; } catch {}
  report(diario.status === 200 && Array.isArray(drows) && drows.length > 1000, "/api/export/diario", drows ? `→ ${drows.length} líneas` : diario.body.slice(0, 80));
  await page(a, "/clientes", ["Crédito", "Contado"], "/clientes con línea de crédito");
  await page(a, "/compras/nueva", ["Productos de la orden"]);
  await page(a, "/proveedores", ["Proveedor"]);
  await page(a, "/finanzas", ["Estado de resultados", "Utilidad bruta"]);
  await page(a, "/rrhh", ["Planilla mensual", "Comisiones por ventas"]);
  await page(a, "/reportes", ["Productos más vendidos", "Por categoría"]);
  await page(a, "/configuracion", ["Datos de la empresa"]);
  await page(a, "/configuracion/sucursales", ["Tienda Principal"]);
  await page(a, "/configuracion/usuarios", ["Usuarios del sistema"]);
  await page(a, "/configuracion/roles", ["Supervisor de Ventas", "Vendedor", "Almacén"]);
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
  for (const dataset of ["ventas", "kardex", "compras"]) {
    const r = await get(a, `/api/export/${dataset}`);
    let rows = null;
    try { rows = JSON.parse(r.body).rows; } catch {}
    report(r.status === 200 && Array.isArray(rows) && (dataset === "compras" || rows.length > 0), `/api/export/${dataset}`, rows ? `→ ${rows.length} filas${rows[0] ? " · columnas: " + Object.keys(rows[0]).join(", ") : ""}` : r.body.slice(0, 80));
  }
  for (const extra of process.argv.slice(4)) await page(a, extra, []);

  console.log("— Vendedor (rol cajero) —");
  const c = await login("cajero");
  const home = await page(c, "/", ["Ventas de hoy"]);
  report(!home.includes('href="/finanzas"') && !home.includes('href="/configuracion"') && home.includes('href="/pos"'), "menú del vendedor: ve POS, no ve Finanzas ni Configuración");
  await page(c, "/pos", ["Punto de venta"]);
  await page(c, "/cotizaciones/nueva", ["Emitir cotización"], "vendedor cotiza");
  await denied(c, "/cuentas-por-cobrar");
  await denied(c, "/contabilidad");
  const dexp = await get(c, "/api/export/diario");
  report(dexp.status === 403, "vendedor no exporta el libro diario", `status=${dexp.status}`);
  const cli = await get(c, "/clientes");
  report(cli.status === 200 && !cli.body.includes("Línea de crédito"), "vendedor no ve el campo de línea de crédito");
  await page(c, "/inventario", ["Productos activos"]);
  for (const p of ["/finanzas", "/rrhh", "/reportes", "/configuracion", "/configuracion/roles", "/compras", "/compras/solicitudes", "/cuentas-por-pagar", "/proveedores", "/facturacion"]) await denied(c, p);

  console.log("— Almacenero —");
  const w = await login("almacenero");
  await page(w, "/compras/solicitudes/nueva", ["Productos solicitados"], "almacenero crea solicitudes");
  const direct = await get(w, "/compras/nueva");
  report(direct.status === 307 || direct.body.includes("NEXT_REDIRECT"), "almacenero no emite órdenes directas (lo envía a solicitudes)");
  await denied(w, "/cuentas-por-pagar");
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
