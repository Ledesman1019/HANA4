import { NextResponse, type NextRequest } from "next/server";
import { loadContext, type AppContext } from "@/lib/auth";
import type { ExportRow } from "@/lib/export";
import { fetchAll } from "@/lib/supabase/paginate";
import { DOC_LABELS } from "@/modules/ventas/types";
import { MOVEMENT_LABELS } from "@/modules/inventario/types";
import { PAYMENT_LABELS } from "@/lib/types";
import { PURCHASE_STATUS, REQUISITION_STATUS } from "@/modules/compras/types";
import { QUOTE_STATUS } from "@/modules/ventas/types";
import { addDays, formatDateTime, isIsoDate, todayIn, zonedDayStart } from "@/lib/utils";

/**
 * Listados completos para exportar (los de pantalla van paginados).
 * Respeta los mismos filtros de la página y los permisos del rol; RLS
 * vuelve a filtrar en la base de datos.
 */

const MAX_ROWS = 20_000;
type Params = URLSearchParams;
const clean = (value: string | null, max = 40) => (value ?? "").trim().slice(0, max).replace(/[%_\\,()]/g, "");

function period(ctx: AppContext, sp: Params) {
  const tz = ctx.settings.timezone;
  const to = isIsoDate(sp.get("hasta")) ? sp.get("hasta")! : todayIn(tz);
  const from = isIsoDate(sp.get("desde")) ? sp.get("desde")! : todayIn(tz, -29);
  return { tz, start: zonedDayStart(from, tz), end: zonedDayStart(addDays(to, 1), tz) };
}

async function ventas(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const { tz, start, end } = period(ctx, sp);
  const status = ["completada", "anulada"].includes(sp.get("estado") ?? "") ? sp.get("estado")! : "";
  const q = clean(sp.get("q"), 30);
  type Row = { number: string; doc_type: string; created_at: string; payment_method: string; status: string; subtotal: number; discount: number; tax: number; total: number; customer: { name: string } | null; cashier: { full_name: string } | null };

  const rows = await fetchAll<Row>(
    (a, b) => {
      let query = ctx.supabase
        .from("sales")
        .select("number, doc_type, created_at, payment_method, status, subtotal, discount, tax, total, customer:customers(name), cashier:profiles!sales_cashier_id_fkey(full_name)")
        .eq("branch_id", ctx.branch.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false });
      if (status) query = query.eq("status", status);
      if (q) query = query.ilike("number", `%${q}%`);
      return query.range(a, b);
    },
    { max: MAX_ROWS },
  );

  return rows.map((s) => ({
    numero: s.number,
    tipo: DOC_LABELS[s.doc_type] ?? s.doc_type,
    fecha: formatDateTime(s.created_at, tz),
    cliente: s.customer?.name ?? "Cliente genérico",
    vendedor: s.cashier?.full_name ?? "",
    pago: PAYMENT_LABELS[s.payment_method] ?? s.payment_method,
    estado: s.status === "anulada" ? "Anulada" : "Completada",
    // Las anuladas no suman al total del reporte
    descuento: s.status === "anulada" ? null : Number(s.discount),
    subtotal: s.status === "anulada" ? null : Number(s.subtotal),
    impuesto: s.status === "anulada" ? null : Number(s.tax),
    total: s.status === "anulada" ? null : Number(s.total),
  }));
}

async function kardex(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const { tz, start, end } = period(ctx, sp);
  const type = Object.hasOwn(MOVEMENT_LABELS, sp.get("tipo") ?? "") ? sp.get("tipo")! : "";
  const q = clean(sp.get("q"));
  type Row = { type: string; quantity: number; balance_after: number; unit_cost: number; note: string; created_at: string; product: { name: string; sku: string } | null; user: { full_name: string } | null };

  const rows = await fetchAll<Row>(
    (a, b) => {
      let query = ctx.supabase
        .from("stock_movements")
        .select("type, quantity, balance_after, unit_cost, note, created_at, product:products!inner(name, sku), user:profiles(full_name)")
        .eq("branch_id", ctx.branch.id)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (type) query = query.eq("type", type);
      if (q) query = query.ilike("product.name", `%${q}%`);
      return query.range(a, b);
    },
    { max: MAX_ROWS },
  );

  return rows.map((m) => ({
    fecha: formatDateTime(m.created_at, tz),
    sku: m.product?.sku ?? "",
    producto: m.product?.name ?? "",
    tipo: MOVEMENT_LABELS[m.type] ?? m.type,
    cantidad: Number(m.quantity),
    saldo: Number(m.balance_after),
    costo: Number(m.unit_cost),
    referencia: m.note,
    usuario: m.user?.full_name ?? "",
  }));
}

async function compras(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const status = Object.hasOwn(PURCHASE_STATUS, sp.get("estado") ?? "") ? sp.get("estado")! : "";
  const q = clean(sp.get("q"), 30);
  type Row = { number: string; status: string; subtotal: number; tax: number; total: number; expected_date: string | null; created_at: string; supplier: { name: string; tax_id: string } | null };
  const rows = await fetchAll<Row>(
    (a, b) =>
      ctx.supabase
        .from("purchases")
        .select("number, status, subtotal, tax, total, expected_date, created_at, supplier:suppliers(name, tax_id)")
        .eq("branch_id", ctx.branch.id)
        .match(status ? { status } : {})
        .ilike("number", `%${q}%`)
        .order("created_at", { ascending: false })
        .range(a, b),
    { max: MAX_ROWS },
  );

  return rows.map((p) => ({
    numero: p.number,
    proveedor: p.supplier?.name ?? "",
    ruc: p.supplier?.tax_id ?? "",
    creada: formatDateTime(p.created_at, ctx.settings.timezone),
    entrega: p.expected_date,
    estado: PURCHASE_STATUS[p.status]?.label ?? p.status,
    subtotal: p.status === "anulada" ? null : Number(p.subtotal),
    impuesto: p.status === "anulada" ? null : Number(p.tax),
    total: p.status === "anulada" ? null : Number(p.total),
  }));
}

async function facturacion(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const status = ["pendiente", "aceptado", "rechazado"].includes(sp.get("estado") ?? "") ? sp.get("estado")! : "";
  const kind = ["boleta", "factura", "nota_credito"].includes(sp.get("tipo") ?? "") ? sp.get("tipo")! : "";
  type Row = { number: string; kind: string; status: string; created_at: string; customer_doc_type: string; customer_doc_number: string; customer_name: string; subtotal: number; tax: number; total: number };
  const KINDS: Record<string, string> = { boleta: "Boleta", factura: "Factura", nota_credito: "Nota de crédito" };
  const STATES: Record<string, string> = { pendiente: "Pendiente", aceptado: "Aceptado", rechazado: "Rechazado" };

  const rows = await fetchAll<Row>(
    (a, b) => {
      let query = ctx.supabase
        .from("e_documents")
        .select("number, kind, status, created_at, customer_doc_type, customer_doc_number, customer_name, subtotal, tax, total")
        .eq("branch_id", ctx.branch.id)
        .order("created_at", { ascending: false });
      if (status) query = query.eq("status", status);
      if (kind) query = query.eq("kind", kind);
      return query.range(a, b);
    },
    { max: MAX_ROWS },
  );

  // Las notas de crédito restan: así el total del reporte es el neto facturado
  const sign = (r: Row) => (r.kind === "nota_credito" ? -1 : 1);
  return rows.map((d) => ({
    numero: d.number,
    tipo: KINDS[d.kind] ?? d.kind,
    fecha: formatDateTime(d.created_at, ctx.settings.timezone),
    documento: [d.customer_doc_type, d.customer_doc_number].filter(Boolean).join(" "),
    cliente: d.customer_name,
    estado: STATES[d.status] ?? d.status,
    subtotal: sign(d) * Number(d.subtotal),
    impuesto: sign(d) * Number(d.tax),
    total: sign(d) * Number(d.total),
  }));
}

async function diario(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const tz = ctx.settings.timezone;
  const to = isIsoDate(sp.get("hasta")) ? sp.get("hasta")! : todayIn(tz);
  const from = isIsoDate(sp.get("desde")) ? sp.get("desde")! : `${to.slice(0, 7)}-01`;
  const source = clean(sp.get("origen"), 30);
  type Row = { id: number; account_code: string; debit: number; credit: number; account: { name: string } | null; entry: { number: string; entry_date: string; description: string } };

  const rows = await fetchAll<Row>(
    (a, b) => {
      let query = ctx.supabase
        .from("journal_lines")
        .select("id, account_code, debit, credit, account:accounts(name), entry:journal_entries!inner(number, entry_date, description, source_type)")
        .gte("entry.entry_date", from)
        .lte("entry.entry_date", to)
        .order("id");
      if (source) query = query.eq("entry.source_type", source);
      return query.range(a, b);
    },
    { max: MAX_ROWS * 3 },
  );

  return rows
    .sort((x, y) => x.entry.entry_date.localeCompare(y.entry.entry_date) || x.entry.number.localeCompare(y.entry.number) || Number(y.debit) - Number(x.debit) || x.id - y.id)
    .map((l) => ({
      asiento: l.entry.number,
      fecha: l.entry.entry_date,
      glosa: l.entry.description,
      cuenta: l.account_code,
      denominacion: l.account?.name ?? "",
      debe: Number(l.debit) || null,
      haber: Number(l.credit) || null,
    }));
}

async function solicitudes(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const status = Object.hasOwn(REQUISITION_STATUS, sp.get("estado") ?? "") ? sp.get("estado")! : "";
  const q = clean(sp.get("q"), 30);
  type Row = { number: string; status: string; justification: string; created_at: string; requester: { full_name: string } | null; cost_center: { code: string; name: string } | null; items: { id: string }[] };
  const rows = await fetchAll<Row>(
    (a, b) =>
      ctx.supabase
        .from("purchase_requisitions")
        .select("number, status, justification, created_at, requester:profiles!purchase_requisitions_requested_by_fkey(full_name), cost_center:cost_centers(code, name), items:purchase_requisition_items(id)")
        .eq("branch_id", ctx.branch.id)
        .match(status ? { status } : {})
        .ilike("number", `%${q}%`)
        .order("created_at", { ascending: false })
        .range(a, b),
    { max: MAX_ROWS },
  );
  return rows.map((r) => ({
    numero: r.number,
    fecha: formatDateTime(r.created_at, ctx.settings.timezone),
    solicitante: r.requester?.full_name ?? "",
    centro: r.cost_center ? `${r.cost_center.code} · ${r.cost_center.name}` : "",
    justificacion: r.justification,
    productos: r.items.length,
    estado: REQUISITION_STATUS[r.status]?.label ?? r.status,
  }));
}

async function cotizaciones(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const today = todayIn(ctx.settings.timezone);
  const status = Object.hasOwn(QUOTE_STATUS, sp.get("estado") ?? "") ? sp.get("estado")! : "";
  type Row = { number: string; status: string; total: number; valid_until: string; created_at: string; customer: { name: string } | null; creator: { full_name: string } | null };
  const rows = await fetchAll<Row>((a, b) => {
    let query = ctx.supabase
      .from("quotations")
      .select("number, status, total, valid_until, created_at, customer:customers(name), creator:profiles!quotations_created_by_fkey(full_name)")
      .eq("branch_id", ctx.branch.id)
      .order("created_at", { ascending: false })
      .range(a, b);
    if (status === "vencida") query = query.eq("status", "vigente").lt("valid_until", today);
    else if (status === "vigente") query = query.eq("status", "vigente").gte("valid_until", today);
    else if (status) query = query.eq("status", status);
    return query;
  }, { max: MAX_ROWS });
  return rows.map((r) => {
    const key = r.status === "vigente" && r.valid_until < today ? "vencida" : r.status;
    return {
      numero: r.number,
      fecha: formatDateTime(r.created_at, ctx.settings.timezone),
      cliente: r.customer?.name ?? "Cliente varios",
      vendedor: r.creator?.full_name ?? "",
      vigencia: r.valid_until,
      estado: QUOTE_STATUS[key]?.label ?? key,
      total: Number(r.total),
    };
  });
}

async function cierres(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const tz = ctx.settings.timezone;
  const from = isIsoDate(sp.get("desde") ?? "") ? sp.get("desde")! : todayIn(tz, -29);
  const to = isIsoDate(sp.get("hasta") ?? "") ? sp.get("hasta")! : todayIn(tz);
  type Row = { opened_at: string; closed_at: string; opening_amount: number; expected_amount: number; counted_amount: number; difference: number; note: string; opener: { full_name: string } | null; branch: { name: string } | null };
  const rows = await fetchAll<Row>((a, b) => {
    let query = ctx.supabase
      .from("cash_sessions")
      .select("opened_at, closed_at, opening_amount, expected_amount, counted_amount, difference, note, opener:profiles!cash_sessions_opened_by_fkey(full_name), branch:branches(name)")
      .eq("status", "cerrada")
      .gte("closed_at", zonedDayStart(from, tz))
      .lt("closed_at", zonedDayStart(addDays(to, 1), tz))
      .order("closed_at", { ascending: false })
      .range(a, b);
    if (!ctx.can("caja", "view")) query = query.eq("opened_by", ctx.userId);
    return query;
  }, { max: MAX_ROWS });
  return rows.map((s) => ({
    cajero: s.opener?.full_name ?? "",
    sucursal: s.branch?.name ?? "",
    apertura: formatDateTime(s.opened_at, tz),
    cierre: formatDateTime(s.closed_at, tz),
    fondo: Number(s.opening_amount),
    esperado: Number(s.expected_amount),
    contado: Number(s.counted_amount),
    diferencia: Number(s.difference),
    nota: s.note,
  }));
}

async function planilla(ctx: AppContext, sp: Params): Promise<ExportRow[]> {
  const period = /^d{4}-(0[1-9]|1[0-2])$/.test(sp.get("periodo") ?? "") ? sp.get("periodo")! : "";
  type Row = { number: string; period: string; salary: number; commissions: number; total: number; method: string; paid_at: string; status: string; employee: { full_name: string; doc_number: string } | null };
  const rows = await fetchAll<Row>(
    (a, b) =>
      ctx.supabase
        .from("payroll_payments")
        .select("number, period, salary, commissions, total, method, paid_at, status, employee:employees(full_name, doc_number)")
        .match(period ? { period } : {})
        .order("created_at", { ascending: false })
        .range(a, b),
    { max: MAX_ROWS },
  );
  return rows.map((r) => ({
    numero: r.number,
    periodo: r.period,
    colaborador: r.employee?.full_name ?? "",
    documento: r.employee?.doc_number ?? "",
    fecha: r.paid_at,
    medio: r.method === "efectivo" ? "Efectivo" : "Transferencia",
    estado: r.status === "pagado" ? "Pagado" : "Anulado",
    sueldo: r.status === "pagado" ? Number(r.salary) : null,
    comisiones: r.status === "pagado" ? Number(r.commissions) : null,
    total: r.status === "pagado" ? Number(r.total) : null,
  }));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return NextResponse.json({ rows: [] }, { status: 401 });

  const { dataset } = await params;
  const sp = request.nextUrl.searchParams;
  let rows: ExportRow[];

  if (dataset === "ventas" && ctx.can("ventas", "access")) rows = await ventas(ctx, sp);
  else if (dataset === "kardex" && ctx.can("inventario", "view")) rows = await kardex(ctx, sp);
  else if (dataset === "compras" && ctx.can("compras", "view")) rows = await compras(ctx, sp);
  else if (dataset === "facturacion" && ctx.can("facturacion", "view")) rows = await facturacion(ctx, sp);
  else if (dataset === "diario" && ctx.can("contabilidad", "view")) rows = await diario(ctx, sp);
  else if (dataset === "solicitudes" && ctx.can("compras", "view")) rows = await solicitudes(ctx, sp);
  else if (dataset === "cotizaciones" && ctx.can("ventas", "access")) rows = await cotizaciones(ctx, sp);
  else if (dataset === "cierres" && ctx.can("caja", "access")) rows = await cierres(ctx, sp);
  else if (dataset === "planilla" && ctx.can("rrhh", "view")) rows = await planilla(ctx, sp);
  else return NextResponse.json({ rows: [] }, { status: 403 });

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
}
