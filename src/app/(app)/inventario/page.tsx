import type { Metadata } from "next";
import { AlertTriangle, Boxes, PackageX, Warehouse } from "lucide-react";
import { param } from "@/components/filters";
import { StatCard } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { Category, InventoryRow } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import { InventoryView } from "@/modules/inventario/components/inventory-view";

export const metadata: Metadata = { title: "Inventario" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventario">) {
  const { supabase, settings, branch, branches, can } = await requireAccess("inventario", "view");
  const sp = await searchParams;

  const [inventoryRes, categoriesRes] = await Promise.all([
    supabase.from("inventory_view").select("*").eq("branch_id", branch.id).order("name").limit(5000),
    supabase.from("categories").select("*").eq("active", true).order("name"),
  ]);
  const rows = (inventoryRes.data ?? []) as InventoryRow[];
  const active = rows.filter((r) => r.active);
  // El costo es dato sensible: solo lo ve quien gestiona inventario, compras o finanzas
  const showCosts = can("inventario", "edit") || can("compras", "view") || can("finanzas", "view");

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Productos activos" value={String(active.length)} icon={<Boxes className="h-4 w-4" />} />
        {showCosts && (
          <StatCard
            label="Valor del inventario"
            value={formatMoney(active.reduce((a, r) => a + Number(r.stock_value), 0), settings.currency_symbol)}
            icon={<Warehouse className="h-4 w-4" />}
            tone="slate"
            hint={`Al costo, en ${branch.name}`}
          />
        )}
        <StatCard label="En o bajo el mínimo" value={String(active.filter((r) => r.low_stock && Number(r.quantity) > 0).length)} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
        <StatCard label="Agotados" value={String(active.filter((r) => Number(r.quantity) <= 0).length)} icon={<PackageX className="h-4 w-4" />} tone="red" />
      </div>
      <InventoryView
        rows={rows}
        categories={((categoriesRes.data ?? []) as Category[]).map((c) => ({ value: c.id, label: c.name }))}
        otherBranches={branches.filter((b) => b.id !== branch.id).map((b) => ({ value: b.id, label: b.name }))}
        showCosts={showCosts}
        initialFilter={param(sp.filtro) === "bajo" ? "bajo" : "todos"}
        initialQuery={param(sp.q).slice(0, 60)}
        // Al llegar desde la búsqueda global o un aviso, la tabla arranca ya filtrada
        key={`${param(sp.filtro)}|${param(sp.q)}`}
      />
    </>
  );
}
