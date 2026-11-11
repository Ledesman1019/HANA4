import { NextResponse } from "next/server";
import { loadContext } from "@/lib/auth";

export type AlertItem = { id: string; tone: "red" | "amber" | "blue"; title: string; detail: string; href: string };

/** Avisos operativos de la campana: se calculan en vivo, no se almacenan. */
export async function GET() {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return NextResponse.json({ items: [] }, { status: 401 });
  const { supabase, branch, userId, can } = ctx;

  const stockQuery = () => supabase.from("inventory_view").select("product_id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("active", true);
  const seesStock = can("inventario", "view");
  const seesPurchases = can("compras", "view");

  const seesBilling = can("facturacion", "view");

  const [out, low, pending, session, unsent] = await Promise.all([
    seesStock ? stockQuery().lte("quantity", 0) : null,
    seesStock ? stockQuery().eq("low_stock", true).gt("quantity", 0) : null,
    seesPurchases ? supabase.from("purchases").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).eq("status", "ordenada") : null,
    supabase.from("cash_sessions").select("id, opened_at").eq("opened_by", userId).eq("status", "abierta").maybeSingle(),
    // Comprobantes electrónicos sin aceptar (si la tabla aún no existe, devuelve error y se ignora)
    seesBilling ? supabase.from("e_documents").select("id", { count: "exact", head: true }).eq("branch_id", branch.id).neq("status", "aceptado") : null,
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
