// E2E de la interfaz real con un administrador temporal:
//  - Login: escribe usuario y clave en «Información de usuario», pulsa «Conectar» y llega al inicio.
//  - CRUD por módulo: crea un centro de costo y un cliente, los desactiva y lo comprueba en la base.
//  - Lanzador: Inicio → módulo → mosaico «Nuevo …» (abre el alta) → «Atrás»; Preferencias.
//  - Exportación: descarga Excel, PDF y CSV (datos en pantalla y desde el servidor) y valida cada archivo.
// Borra las filas, las descargas y el usuario temporal al terminar, aunque la prueba falle.
//
// Uso: npm run test:e2e -- http://localhost:3000   (o la URL de producción)
// Requiere .env.local con SUPABASE_SERVICE_ROLE_KEY y un Chrome/Edge instalado
// (ruta configurable con BROWSER_PATH).
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const base = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const require = createRequire(join(root, "package.json"));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const env = {
  ...Object.fromEntries(
    readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  ),
  ...process.env,
};
const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error("No se encontró Chrome ni Edge. Indica la ruta con BROWSER_PATH.");

const tag = randomBytes(2).toString("hex").toUpperCase();
const ccCode = `Q${tag}`;
const custName = `QA Cliente ${tag}`;
let failed = 0;
const report = (ok, name, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const email = `qa-temp-${randomBytes(4).toString("hex")}@hana4.test`;
const password = randomBytes(18).toString("base64url");
const { data: branch } = await admin.from("branches").select("id").eq("active", true).order("code").limit(1).single();
const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createError) throw new Error(`No se pudo crear el usuario temporal: ${createError.message}`);
const userId = created.user.id;
const profileDir = mkdtempSync(join(tmpdir(), "hana4-e2e-"));
const downloadDir = mkdtempSync(join(tmpdir(), "hana4-dl-"));
let browser;

try {
  // Igual que la aplicación: el rol y el acceso se asignan tras crear la cuenta.
  await admin.from("profiles").update({ role: "admin", branch_id: branch.id, active: true, full_name: "QA Temporal" }).eq("id", userId);
  const jar = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, publicKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) },
  });
  await client.auth.signInWithPassword({ email, password });

  const port = 9300 + Math.floor(Math.random() * 400);
  browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--window-size=1440,1000", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"]);
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try {
      ws = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
  }
  if (!ws) throw new Error("El navegador no respondió");
  const sock = new WebSocket(ws);
  await new Promise((r) => sock.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  sock.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const send = (method, params = {}) => new Promise((r) => { const n = ++seq; pending.set(n, r); sock.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const waitFor = async (expr, ms = 15000) => {
    for (let t = 0; t < ms; t += 250) {
      if (await evaluate(expr)) return true;
      await sleep(250);
    }
    return false;
  };

  // --- Login desde el formulario (sin cookies previas) ---
  await send("Page.enable");
  await send("Page.navigate", { url: base + "/login" });
  await waitFor(`!!document.querySelector('input[name="email"]')`);
  let loggedIn = false;
  for (let i = 0; i < 20 && !loggedIn; i++) {
    await evaluate(`(() => {
      const f = document.querySelector("form");
      f.elements.namedItem("email").value = ${JSON.stringify(email)};
      f.elements.namedItem("password").value = ${JSON.stringify(password)};
      [...f.querySelectorAll("button")].find(b => b.textContent.includes("Conectar")).click();
    })()`);
    loggedIn = await waitFor(`location.pathname === "/" && document.body.textContent.includes("Gestión de Materiales")`, 4000);
  }
  report(loggedIn, "login: «Conectar» entra al inicio con los módulos SAP");

  const url = new URL(base);
  for (const [name, value] of jar) await send("Network.setCookie", { name, value, domain: url.hostname, path: "/", secure: url.protocol === "https:" });
  await send("Page.enable");
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });

  async function createAndDeactivate(route, singular, values, rowText, table, match) {
    const button = `[...document.querySelectorAll("button")].find(b => b.textContent.includes("Nuevo ${singular}"))`;
    await send("Page.navigate", { url: base + route });
    report(await waitFor(`!!${button}`), `${route}: carga`);

    // El HTML llega antes de la hidratación: se reintenta el clic hasta que React abre el diálogo.
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) {
      await evaluate(`${button}?.click()`);
      await sleep(250);
      opened = await evaluate(`!!document.querySelector("dialog[open] form")`);
    }
    report(opened, `${route}: abre el formulario`);
    if (!opened) return null;

    await evaluate(`(() => {
      const v = ${JSON.stringify(values)};
      const f = document.querySelector("dialog[open] form");
      for (const [k, val] of Object.entries(v)) f.elements.namedItem(k).value = val;
      f.requestSubmit();
    })()`);
    await waitFor(`!document.querySelector("dialog[open] form")`);
    // Filtra con el buscador para no depender de la paginación.
    await evaluate(`(() => {
      const s = document.querySelector('[aria-label="Buscar"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(s, ${JSON.stringify(rowText)});
      s.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const row = `[...document.querySelectorAll("tbody tr")].find(r => r.textContent.includes(${JSON.stringify(rowText)}))`;
    const shown = await waitFor(`!!${row}`);
    const { data: saved } = await admin.from(table).select("id, active").match(match).maybeSingle();
    report(shown && saved?.active === true, `${route}: crear ${singular}`);
    if (!saved) return null;

    await evaluate(`${row}.querySelector('[aria-label="Desactivar"]').click()`);
    let off = false;
    for (let t = 0; t < 40 && !off; t++) {
      await sleep(250);
      off = (await admin.from(table).select("active").eq("id", saved.id).single()).data?.active === false;
    }
    report(off, `${route}: desactivar ${singular}`);
    return saved.id;
  }

  await createAndDeactivate("/contabilidad/centros", "centro de costo", { code: ccCode, name: `QA Centro ${tag}` }, ccCode, "cost_centers", { code: ccCode });
  await createAndDeactivate(
    "/clientes",
    "cliente",
    { doc_number: String(10000000 + Math.floor(Math.random() * 89999999)), name: custName },
    custName,
    "customers",
    { name: custName },
  );

  // --- Lanzador estilo ERP clásico ---
  const clickText = (selector, text) =>
    evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)})); el?.click(); return !!el; })()`);
  const path = () => evaluate("location.pathname + location.search");
  async function clickUntil(selector, text, condition) {
    for (let i = 0; i < 40; i++) {
      await clickText(selector, text);
      await sleep(250);
      if (await evaluate(condition)) return true;
    }
    return false;
  }

  await send("Page.navigate", { url: base + "/" });
  await waitFor(`!!document.querySelector('a[href="/?m=mm"]')`);
  report(await clickUntil("a", "Gestión de Materiales", `location.search.includes("m=mm")`), "lanzador: abre el módulo MM", await path());
  report(await waitFor(`document.body.textContent.includes("Listado de Productos")`), "lanzador: muestra las funciones de Inventario");
  report(await clickUntil("a", "Nuevo Producto", `!!document.querySelector("dialog[open] form")`), "mosaico «Nuevo Producto» abre el formulario de alta", await path());
  await evaluate(`document.querySelector("dialog[open]")?.close()`);
  report(await clickUntil("a", "Atrás", `location.pathname === "/" && location.search.includes("a=inventario")`), "«Atrás» vuelve a los mosaicos de Inventario", await path());
  await send("Page.navigate", { url: base + "/?m=general" });
  await waitFor(`document.body.textContent.includes("Preferencias de Estación")`);
  report(
    await clickUntil("button", "Preferencias de Estación", `[...document.querySelectorAll("dialog[open]")].some(d => d.textContent.includes("Sucursal de trabajo"))`),
    "mosaico «Preferencias de estación de trabajo» abre su ventana",
  );

  // --- Exportación ---
  // Abre «Exportar», elige el formato y espera el archivo descargado.
  async function download(route, label, ext) {
    const before = new Set(readdirSync(downloadDir));
    const menu = `[...document.querySelectorAll('button[aria-haspopup="menu"]')].find(b => b.textContent.includes("Exportar"))`;
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) {
      await evaluate(`${menu}?.click()`);
      await sleep(250);
      opened = await evaluate(`!!document.querySelector('[role="menu"]')`);
    }
    if (!opened) return report(false, `${route}: abre el menú Exportar`);
    await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
    let file;
    for (let t = 0; t < 60 && !file; t++) {
      await sleep(250);
      file = readdirSync(downloadDir).find((n) => !before.has(n) && n.endsWith(ext));
    }
    if (!file) return report(false, `${route}: exporta ${label}`, "(no se descargó)");
    await sleep(300);
    return readFileSync(join(downloadDir, file));
  }

  await send("Page.navigate", { url: base + "/clientes" });
  await waitFor(`!!document.querySelector("tbody tr")`);
  const xlsx = await download("/clientes", "Excel", ".xlsx");
  if (xlsx) report(xlsx.subarray(0, 2).toString() === "PK" && xlsx.length > 3000, "/clientes: exporta Excel (.xlsx válido)", `${xlsx.length} bytes`);
  const pdf = await download("/clientes", "PDF", ".pdf");
  if (pdf) report(pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 3000, "/clientes: exporta PDF (documento válido)", `${pdf.length} bytes`);
  const csv = await download("/clientes", "CSV", ".csv");
  if (csv) {
    const text = csv.toString("utf8");
    const lines = text.trim().split(/\r?\n/);
    const { count } = await admin.from("customers").select("id", { count: "exact", head: true });
    report(text.includes("Nombre o razón social") && lines.length >= count, "/clientes: exporta CSV con todas las filas", `${lines.length} líneas, ${count} clientes`);
  }

  // Ventas exporta desde el servidor (/api/export/ventas), no solo lo visible en pantalla.
  await send("Page.navigate", { url: base + "/ventas" });
  await waitFor(`!!document.querySelector("tbody tr")`);
  const salesXlsx = await download("/ventas", "Excel", ".xlsx");
  if (salesXlsx) report(salesXlsx.subarray(0, 2).toString() === "PK" && salesXlsx.length > 3000, "/ventas: exporta Excel desde el servidor", `${salesXlsx.length} bytes`);
} catch (e) {
  failed++;
  console.log("ERROR", e);
} finally {
  browser?.kill();
  await admin.from("cost_centers").delete().eq("code", ccCode);
  await admin.from("customers").delete().eq("name", custName);
  await admin.auth.admin.deleteUser(userId);
  await sleep(500);
  for (const dir of [profileDir, downloadDir]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log("usuario temporal y datos de prueba eliminados");
}

console.log(failed ? `\n${failed} PRUEBAS FALLARON` : "\nINTERFAZ OK");
process.exit(failed ? 1 : 0);
