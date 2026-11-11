import { NextResponse, type NextRequest } from "next/server";
import { loadContext, type AppContext } from "@/lib/auth";
import type { ExportRow } from "@/lib/export";
import { fetchAll } from "@/lib/supabase/paginate";
import { DOC_LABELS, MOVEMENT_LABELS, PAYMENT_LABELS, PURCHASE_STATUS } from "@/lib/types";
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

async function compras(ctx: AppContext): Promise<ExportRow[]> {
  type Row = { number: string; status: string; subtotal: number; tax: number; total: number; expected_date: string | null; created_at: string; supplier: { name: string; tax_id: string } | null };
  const rows = await fetchAll<Row>(
    (a, b) =>
      ctx.supabase
        .from("purchases")
        .select("number, status, subtotal, tax, total, expected_date, created_at, supplier:suppliers(name, tax_id)")
        .eq("branch_id", ctx.branch.id)
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

export async function GET(request: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return NextResponse.json({ rows: [] }, { status: 401 });

  const { dataset } = await params;
  const sp = request.nextUrl.searchParams;
  let rows: ExportRow[];

  if (dataset === "ventas" && ctx.can("ventas", "access")) rows = await ventas(ctx, sp);
  else if (dataset === "kardex" && ctx.can("inventario", "view")) rows = await kardex(ctx, sp);
  else if (dataset === "compras" && ctx.can("compras", "view")) rows = await compras(ctx);
  else if (dataset === "facturacion" && ctx.can("facturacion", "view")) rows = await facturacion(ctx, sp);
  else return NextResponse.json({ rows: [] }, { status: 403 });

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
}
