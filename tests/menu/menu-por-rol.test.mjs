// Verifica qué módulos y mosaicos ve cada rol del sistema, sin base de datos:
// compila el menú real (src/shell/menu.ts) y le aplica la matriz de permisos
// que siembra la migración 0009. Uso: npm run test:menu
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const ts = require("typescript");

// --- Compilar modules.ts y menu.ts a un directorio temporal ---
const out = mkdtempSync(join(tmpdir(), "hana4-menu-"));
const compile = (src, dest, rewrite = (s) => s) => {
  const code = ts.transpileModule(readFileSync(join(root, src), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(out, dest), rewrite(code));
};
compile("src/lib/modules.ts", "modules.mjs");
const lucide = pathToFileURL(require.resolve("lucide-react")).href;
compile("src/shell/menu.ts", "menu.mjs", (s) => s.replace('"@/lib/modules"', '"./modules.mjs"').replace('"lucide-react"', JSON.stringify(lucide)));
const { menuFor, backHref, locate, launcherHref } = await import(pathToFileURL(join(out, "menu.mjs")).href);

// --- Matriz de permisos de la migración 0009 ---
const migration = readdirSync(join(root, "supabase/migrations")).find((f) => f.startsWith("0009_"));
const sql = readFileSync(join(root, "supabase/migrations", migration), "utf8");
const block = sql.slice(sql.indexOf("insert into role_permissions"), sql.indexOf(") as m(role_id, module, flags)"));
const permissions = {};
for (const [, role, module, flags] of block.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([vced]+)'\)/g)) {
  permissions[role] ??= {};
  permissions[role][module] = { view: flags.includes("v"), create: flags.includes("c"), edit: flags.includes("e"), delete: flags.includes("d") };
}

let failed = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`);
};

// Qué módulos SAP debe ver cada rol (según la tabla de responsabilidades)
const EXPECTED = {
  admin: ["mm", "sd", "fi", "co", "hcm", "general"],
  gerente: ["mm", "sd", "fi", "co", "hcm", "general"],
  gerente_area: ["mm", "sd", "co", "general"],
  contador: ["fi", "co", "general"],
  rrhh: ["hcm", "general"],
  vendedor: ["sd", "general"],
  almacenero: ["mm", "general"],
  comprador: ["mm", "general"],
  cajero: ["sd", "general"],
  auditor: ["mm", "sd", "fi", "co", "hcm", "general"],
  empleado: ["general"],
};
const menus = {};
for (const [role, expected] of Object.entries(EXPECTED)) {
  const menu = menuFor(role, permissions[role] ?? {});
  menus[role] = menu;
  const keys = menu.map((m) => m.key);
  ok(`${role}: ve solo sus módulos`, JSON.stringify(keys) === JSON.stringify(expected), `→ ${keys.join(", ")}`);
}

const tiles = (role) => new Set(menus[role].flatMap((m) => m.areas.flatMap((a) => a.tiles.map((t) => t.label))));
const areas = (role, module) => (menus[role].find((m) => m.key === module)?.areas ?? []).map((a) => a.key);
const has = (role, label) => tiles(role).has(label);

ok("almacenero: no ve Nuevo Proveedor ni Nueva Solicitud", !has("almacenero", "Nuevo Proveedor") && !has("almacenero", "Nueva Solicitud de Pedido"));
ok("almacenero: recibe mercadería e inventario físico", has("almacenero", "Recepción de Mercadería") && has("almacenero", "Inventario Físico"));
ok("almacenero: en MM solo Inventario y Almacén", JSON.stringify(areas("almacenero", "mm")) === JSON.stringify(["inventario", "almacen"]), `→ ${areas("almacenero", "mm").join(", ")}`);
ok("comprador: proveedores, solicitudes y órdenes", has("comprador", "Nuevo Proveedor") && has("comprador", "Nueva Solicitud de Pedido") && has("comprador", "Nueva Orden de Compra"));
ok("comprador: no recibe ni ajusta inventario", !has("comprador", "Recepción de Mercadería") && !has("comprador", "Inventario Físico"));
ok("vendedor: cotiza y registra clientes, no cobra en caja", has("vendedor", "Nueva Orden de Venta (Cotización)") && has("vendedor", "Nuevo Cliente") && !has("vendedor", "Nueva Venta") && !has("vendedor", "Caja: Apertura y Cierre"));
ok("cajero: vende, cobra órdenes y créditos, maneja su caja", ["Nueva Venta", "Cobrar Órdenes de Venta", "Cobrar Ventas al Crédito", "Caja: Apertura y Cierre"].every((l) => has("cajero", l)));
ok("cajero: no ve contabilidad ni líneas de crédito", !has("cajero", "Libro Diario") && !has("cajero", "Líneas de Crédito"));
ok("contador: asigna líneas de crédito y registra asientos", has("contador", "Líneas de Crédito") && has("contador", "Nuevo Asiento Manual"));
ok("rrhh: prepara la planilla pero no la paga", has("rrhh", "Planilla del Mes") && !has("rrhh", "Pago de Planilla") && has("rrhh", "Nuevo Colaborador"));
ok("tesorería (contador) paga la planilla", has("contador", "Pago de Planilla"));
ok("gerente general: consulta sin registrar ventas ni compras directas", !has("gerente", "Nueva Venta") && !has("gerente", "Nueva Solicitud de Pedido") && has("gerente", "Panel del Negocio"));
ok("auditor: solo consulta (sin mosaicos «Nuevo …»)", [...tiles("auditor")].every((l) => !l.startsWith("Nuevo") && !l.startsWith("Nueva") && l !== "Inventario Físico" && l !== "Líneas de Crédito"), [...tiles("auditor")].filter((l) => /^Nuev/.test(l)).join(", "));
ok("empleado: solo autoservicio", JSON.stringify([...tiles("empleado")].sort()) === JSON.stringify(["Calendario", "Mensajes de Tienda", "Mis Datos", "Preferencias de Estación de Trabajo"]), `→ ${[...tiles("empleado")].join(", ")}`);
ok("todos tienen «Mis Datos» y nadie más que RRHH ve HCM por eso", Object.keys(EXPECTED).every((r) => has(r, "Mis Datos")));

// Sin mosaicos repetidos dentro de una misma área (antes causaba bloques fantasma al cambiar de pestaña)
const dupes = [];
for (const m of menuFor("admin", {})) for (const a of m.areas) {
  const labels = a.tiles.map((t) => t.label);
  if (new Set(labels).size !== labels.length) dupes.push(`${m.code}/${a.label}`);
}
ok("sin mosaicos repetidos en un área", dupes.length === 0, dupes.join(", "));


// «Atrás» independiente: cada pantalla del menú vuelve a los mosaicos de su área,
// no a otra pantalla cuya ruta la contenga (ej. Kardex /inventario/movimientos ≠ Listado /inventario)
const wrongBack = [];
for (const role of Object.keys(EXPECTED)) {
  const menu = menus[role];
  const launchers = menu.flatMap((mm) => mm.areas.map((aa) => launcherHref(mm.key, aa.key)));
  for (const m of menu) for (const a of m.areas) for (const t of a.tiles) {
    const path = t.href.split("?")[0];
    if (!path.startsWith("/") || path === "/") continue;
    const back = backHref(menu, path, locate(menu, path));
    if (!launchers.includes(back)) wrongBack.push(role + ": " + t.label + " (" + path + ") → " + back);
  }
}
ok("Atrás de cada mosaico vuelve a su área (no a otra pantalla)", wrongBack.length === 0, wrongBack.slice(0, 5).join(" | "));
ok("Atrás del Kardex vuelve a MM › Inventario", backHref(menus.admin, "/inventario/movimientos", locate(menus.admin, "/inventario/movimientos")) === launcherHref("mm", "inventario"));
ok("Atrás de un detalle vuelve a su listado", backHref(menus.admin, "/inventario/conteos/abc", locate(menus.admin, "/inventario/conteos/abc")) === "/inventario/conteos");
// «Atrás» y pestaña activa cuando la misma pantalla está en varias áreas
const adm = menus.admin;
const where = (path, search = "", ctx = null) => { const p = locate(adm, path, search, ctx); return p ? `${p.module.key}/${p.area.key}` : "—"; };
const cxcAreas = adm.flatMap((m) => m.areas.filter((a) => a.tiles.some((t) => t.href.split("?")[0] === "/cuentas-por-cobrar")).map((a) => `${m.key}/${a.key}`));
ok("Cuentas por cobrar abierta desde FI vuelve a FI", cxcAreas.includes("fi/cobrar") && where("/cuentas-por-cobrar", "", { module: "fi", area: "cobrar" }) === "fi/cobrar", `áreas: ${cxcAreas.join(", ")}`);
const otherCxc = cxcAreas.find((x) => x !== "fi/cobrar");
if (otherCxc) {
  const [om, oa] = otherCxc.split("/");
  ok("Cuentas por cobrar abierta desde la otra área vuelve a esa área", where("/cuentas-por-cobrar", "", { module: om, area: oa }) === otherCxc);
}
ok("Cobrar órdenes de venta (Caja) vuelve a Caja", where("/cotizaciones", "estado=vigente", null).endsWith("/caja") || where("/cotizaciones", "estado=vigente", null).includes("caja"), where("/cotizaciones", "estado=vigente"));
ok("Recibos de mercadería (histórico) vuelve a Almacén", where("/inventario/movimientos", "tipo=compra") === "mm/almacen", where("/inventario/movimientos", "tipo=compra"));
ok("Órdenes de compra (histórico) abierta desde Compras vuelve a Compras", where("/compras", "", { module: "mm", area: "compras" }) === "mm/compras", where("/compras", "", { module: "mm", area: "compras" }));
ok("Kardex sin contexto sigue en Inventario", where("/inventario/movimientos") === "mm/inventario");
ok("Pago de planilla desde FI vuelve a Tesorería", where("/rrhh/planilla", "", { module: "fi", area: "tesoreria" }) === "fi/tesoreria");

console.log(failed ? `\n${failed} PRUEBAS FALLARON` : "\nMENÚ POR ROL OK");
process.exit(failed ? 1 : 0);
