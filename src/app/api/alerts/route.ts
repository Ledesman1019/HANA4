import { NextResponse } from "next/server";
import { loadContext } from "@/lib/auth";

import type { AlertItem } from "@/shell/types";

/** Avisos operativos de la campana: se calculan en vivo, no se almacenan. */
export async function GET() {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return NextResponse.json({ items: [] }, { status: 401 });
  const { supabase, branch, userId, can } = ctx;

  const stockQuery = () => supabase.from("inventory_view").select("product_id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("active", true);
  const seesStock = can("inventario", "view");
  const seesPurchases = can("compras", "view");

  const seesBilling = can("facturacion", "view");
  const approves = can("compras", "edit");
  const seesPayables = can("cuentas_pagar", "view");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.settings.timezone }).format(new Date());

  const seesReceivables = can("cuentas_cobrar", "view");

  const soon = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);

  const [out, low, pending, session, unsent, toApprove, overdue, lateCustomers, expiredLots, expiringLots] = await Promise.all([
    seesStock ? stockQuery().lte("quantity", 0) : null,
    seesStock ? stockQuery().eq("low_stock", true).gt("quantity", 0) : null,
    seesPurchases ? supabase.from("purchases").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("status", "ordenada") : null,
    supabase.from("cash_sessions").select("id, opened_at").eq("opened_by", userId).eq("status", "abierta").maybeSingle(),
    // Comprobantes electrónicos sin aceptar (si la tabla aún no existe, devuelve error y se ignora)
    seesBilling ? supabase.from("e_documents").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).neq("status", "aceptado") : null,
    // Ciclo de compras: solicitudes por aprobar y facturas de proveedor vencidas
    approves ? supabase.from("purchase_requisitions").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("status", "pendiente") : null,
    seesPayables ? supabase.from("supplier_invoices").select("id", { count: "exact", head: true }).in("status", ["pendiente", "parcial", "bloqueada"]).lt("due_date", today) : null,
    // Ventas al crédito vencidas sin cobrar
    // Lotes vencidos o por vencer con stock en esta sucursal
    seesStock ? supabase.from("lots").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).gt("quantity", 0).lt("expiry_date", today) : null,
    seesStock ? supabase.from("lots").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).gt("quantity", 0).gte("expiry_date", today).lte("expiry_date", soon) : null,
    seesReceivables ? supabase.from("sales").select("id", { count: "exact", head: true }).eq("status", "completada").in("credit_status", ["pendiente", "parcial"]).lt("due_date", today) : null,
  ]);

  const items: AlertItem[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (out?.count) {
    items.push({ id: "out", tone: "red", title: plural(out.count, "producto agotado", "productos agotados"), detail: `Sin stock en ${branch.name}`, href: "/inventario?filtro=bajo" });
  }
  if (low?.count) {
    items.push({ id: "low", tone: "amber", title: plural(low.count, "producto por reponer", "productos por reponer"), detail: "En o bajo su stock mínimo", href: "/inventario?filtro=bajo" });
  }
  if (pending?.count) {
    items.push({ id: "po", tone: "blue", title: plural(pending.count, "compra por recibir", "compras por recibir"), detail: "Órdenes pendientes de recepción", href: "/compras" });
  }
  if (toApprove?.count) {
    items.push({ id: "solped", tone: "blue", title: plural(toApprove.count, "solicitud de pedido por aprobar", "solicitudes de pedido por aprobar"), detail: "Revísalas para emitir la orden de compra", href: "/compras/solicitudes" });
  }
  if (overdue?.count) {
    items.push({ id: "ap", tone: "red", title: plural(overdue.count, "factura de proveedor vencida", "facturas de proveedor vencidas"), detail: "Pagos atrasados a proveedores", href: "/cuentas-por-pagar?estado=vencidas" });
  }
  if (expiredLots?.count) {
    items.push({ id: "lots-expired", tone: "red", title: plural(expiredLots.count, "lote vencido con stock", "lotes vencidos con stock"), detail: "No se pueden vender: retíralos con un ajuste", href: "/inventario/lotes?estado=vencidos" });
  }
  if (expiringLots?.count) {
    items.push({ id: "lots-soon", tone: "amber", title: plural(expiringLots.count, "lote vence en 30 días", "lotes vencen en 30 días"), detail: "Prioriza su venta", href: "/inventario/lotes" });
  }
  if (lateCustomers?.count) {
    items.push({ id: "ar", tone: "red", title: plural(lateCustomers.count, "venta al crédito vencida", "ventas al crédito vencidas"), detail: "Clientes con pagos atrasados", href: "/cuentas-por-cobrar?estado=vencidas" });
  }
  if (unsent?.count) {
    items.push({ id: "edoc", tone: "red", title: plural(unsent.count, "comprobante sin aceptar", "comprobantes sin aceptar"), detail: "Pendientes o rechazados: revísalos y reenvía", href: "/facturacion" });
  }
  if (session.data) {
    const hours = (Date.now() - new Date(session.data.opened_at as string).getTime()) / 3_600_000;
    if (hours > 16) {
      items.push({ id: "cash", tone: "amber", title: "Tu caja sigue abierta", detail: `Abierta hace ${Math.floor(hours)} horas. Haz el arqueo y ciérrala`, href: "/caja" });
    }
  }

  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
