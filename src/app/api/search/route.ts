import { NextResponse, type NextRequest } from "next/server";
import { loadContext } from "@/lib/auth";
import { formatMoney } from "@/lib/utils";

export type SearchItem = { title: string; subtitle: string; href: string };
export type SearchGroup = { label: string; items: SearchItem[] };

/** Búsqueda global de la barra superior. RLS limita lo que cada rol puede ver. */
export async function GET(request: NextRequest) {
  const ctx = await loadContext();
  if (ctx.status !== "ok") return NextResponse.json({ groups: [] }, { status: 401 });

  // Se quitan los caracteres con significado en los filtros de PostgREST.
  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/[%_,()*\\"']/g, " ").trim().slice(0, 40);
  if (q.length < 2) return NextResponse.json({ groups: [] });

  const { supabase, branch, settings, can } = ctx;
  const like = `%${q}%`;
  const seesSales = can("ventas", "access");
  const seesCustomers = can("clientes", "view");
  const seesStock = can("inventario", "view");

  const [products, customers, sales] = await Promise.all([
    supabase
      .from("inventory_view")
      .select("product_id, name, sku, price, quantity, unit")
      .eq("branch_id", branch.id)
      .or(`name.ilike.${like},sku.ilike.${like},barcode.eq.${q.replace(/\s/g, "")}`)
      .order("name")
      .limit(6),
    seesCustomers
      ? supabase.from("customers").select("id, name, doc_type, doc_number").or(`name.ilike.${like},doc_number.ilike.${like}`).order("name").limit(5)
      : null,
    seesSales
      ? supabase.from("sales").select("id, number, total, status").ilike("number", like).order("created_at", { ascending: false }).limit(5)
      : null,
  ]);

  const groups: SearchGroup[] = [
    {
      label: "Productos",
      items: (products.data ?? []).map((p) => ({
        title: p.name as string,
        subtitle: `${p.sku} · ${formatMoney(p.price as number, settings.currency_symbol)} · stock ${Number(p.quantity)} ${p.unit}`,
        href: seesStock ? `/inventario?q=${encodeURIComponent(p.sku as string)}` : "/pos",
      })),
    },
    {
      label: "Clientes",
      items: (customers?.data ?? []).map((c) => ({
        title: c.name as string,
        subtitle: `${c.doc_type} ${c.doc_number}`,
        href: `/clientes?q=${encodeURIComponent(c.doc_number as string)}`,
      })),
    },
    {
      label: "Comprobantes",
      items: (sales?.data ?? []).map((s) => ({
        title: s.number as string,
        subtitle: s.status === "anulada" ? "Anulada" : formatMoney(s.total as number, settings.currency_symbol),
        href: `/ventas/${s.id}`,
      })),
    },
  ].filter((g) => g.items.length > 0);

  return NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
}
