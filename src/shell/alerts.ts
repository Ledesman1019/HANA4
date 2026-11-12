import "server-only";
import type { getContext } from "@/lib/auth";
import type { AlertItem } from "./types";

type Ctx = Awaited<ReturnType<typeof getContext>>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Avisos operativos de la sucursal activa: se calculan en vivo, no se almacenan.
 * Los usan la campana de la barra inferior y la pantalla «Mensajes de tienda».
 * Cada consulta solo corre si el rol puede ver ese módulo.
 */
export async function computeAlerts(ctx: Ctx): Promise<AlertItem[]> {
  const { supabase, branch, userId, can } = ctx;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.settings.timezone }).format(new Date());
  const soon = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);

  const seesStock = can("inventario", "view");
  const stock = () => supabase.from("inventory_view").select("product_id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("active", true);
  const lots = () => supabase.from("lots").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).gt("quantity", 0);
  const count = async (query: PromiseLike<{ count: number | null }> | null) => (query ? ((await query).count ?? 0) : 0);

  const [out, low, toReceive, toApprove, latePayables, lateReceivables, expiredLots, expiringLots, unsent, session, toApply] = await Promise.all([
    count(seesStock ? stock().lte("quantity", 0) : null),
    count(seesStock ? stock().eq("low_stock", true).gt("quantity", 0) : null),
    count(can("compras", "view") ? supabase.from("purchases").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("status", "ordenada") : null),
    count(can("compras", "edit") ? supabase.from("purchase_requisitions").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("status", "pendiente") : null),
    count(can("cuentas_pagar", "view") ? supabase.from("supplier_invoices").select("id", { count: "exact", head: true }).in("status", ["pendiente", "parcial", "bloqueada"]).lt("due_date", today) : null),
    count(
      can("cuentas_cobrar", "view")
        ? supabase.from("sales").select("id", { count: "exact", head: true }).eq("status", "completada").in("credit_status", ["pendiente", "parcial"]).lt("due_date", today)
        : null,
    ),
    count(seesStock ? lots().lt("expiry_date", today) : null),
    count(seesStock ? lots().gte("expiry_date", today).lte("expiry_date", soon) : null),
    count(can("facturacion", "view") ? supabase.from("e_documents").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).neq("status", "aceptado") : null),
    supabase.from("cash_sessions").select("id, opened_at").eq("opened_by", userId).eq("status", "abierta").maybeSingle(),
    // Inventarios contados en el celular (RLS Tools) esperando que alguien los aplique
    count(can("inventario", "edit") ? supabase.from("count_sessions").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("status", "cerrada") : null),
  ]);

  const items: AlertItem[] = [];
  if (out) items.push({ id: "out", tone: "red", title: plural(out, "producto agotado", "productos agotados"), detail: `Sin stock en ${branch.name}`, href: "/inventario?filtro=bajo" });
  if (low) items.push({ id: "low", tone: "amber", title: plural(low, "producto por reponer", "productos por reponer"), detail: "En o bajo su stock mínimo", href: "/inventario?filtro=bajo" });
  if (toReceive) items.push({ id: "po", tone: "blue", title: plural(toReceive, "compra por recibir", "compras por recibir"), detail: "Órdenes pendientes de recepción", href: "/compras" });
  if (toApprove) {
    items.push({ id: "solped", tone: "blue", title: plural(toApprove, "solicitud de pedido por aprobar", "solicitudes de pedido por aprobar"), detail: "Revísalas para emitir la orden de compra", href: "/compras/solicitudes" });
  }
  if (latePayables) {
    items.push({ id: "ap", tone: "red", title: plural(latePayables, "factura de proveedor vencida", "facturas de proveedor vencidas"), detail: "Pagos atrasados a proveedores", href: "/cuentas-por-pagar?estado=vencidas" });
  }
  if (expiredLots) {
    items.push({ id: "lots-expired", tone: "red", title: plural(expiredLots, "lote vencido con stock", "lotes vencidos con stock"), detail: "No se pueden vender: retíralos con un ajuste", href: "/inventario/lotes?estado=vencidos" });
  }
  if (expiringLots) items.push({ id: "lots-soon", tone: "amber", title: plural(expiringLots, "lote vence en 30 días", "lotes vencen en 30 días"), detail: "Prioriza su venta", href: "/inventario/lotes" });
  if (lateReceivables) {
    items.push({ id: "ar", tone: "red", title: plural(lateReceivables, "venta al crédito vencida", "ventas al crédito vencidas"), detail: "Clientes con pagos atrasados", href: "/cuentas-por-cobrar?estado=vencidas" });
  }
  if (toApply) {
    items.push({ id: "rls", tone: "blue", title: plural(toApply, "inventario del celular por aplicar", "inventarios del celular por aplicar"), detail: "Contados con RLS Tools: revisa diferencias y aplícalos", href: "/inventario/conteos?estado=cerrada" });
  }
  if (unsent) items.push({ id: "edoc", tone: "red", title: plural(unsent, "comprobante sin aceptar", "comprobantes sin aceptar"), detail: "Pendientes o rechazados: revísalos y reenvía", href: "/facturacion" });
  if (session.data) {
    const hours = (Date.now() - new Date(session.data.opened_at as string).getTime()) / 3_600_000;
    if (hours > 16) items.push({ id: "cash", tone: "amber", title: "Tu caja sigue abierta", detail: `Abierta hace ${Math.floor(hours)} horas. Haz el arqueo y ciérrala`, href: "/caja" });
  }
  return items;
}
