import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import type { Category, InventoryRow } from "@/modules/inventario/types";
import { PhysicalCount } from "@/modules/inventario/components/physical-count";

export const metadata: Metadata = { title: "Inventario físico" };

/** Conteo físico de la sucursal activa: las diferencias se registran como ajustes del kardex. */
export default async function PhysicalCountPage() {
  const { supabase, branch } = await requireAccess("inventario", "edit");
  const [rows, categoriesRes] = await Promise.all([
    fetchAll<InventoryRow>((a, b) => supabase.from("inventory_view").select("*").eq("branch_id", branch.id).eq("active", true).order("name").order("product_id").range(a, b)),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
  ]);
  return (
    <PhysicalCount
      rows={rows}
      categories={((categoriesRes.data ?? []) as Category[]).map((c) => ({ value: c.id, label: c.name }))}
      branchName={branch.name}
    />
  );
}
