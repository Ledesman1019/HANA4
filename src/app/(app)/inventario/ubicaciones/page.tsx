import type { Metadata } from "next";
import { param } from "@/components/filters";
import { requireAccess } from "@/lib/auth";
import type { WarehouseLocation } from "@/modules/inventario/types";
import { LocationsView } from "@/modules/inventario/components/locations-view";

export const metadata: Metadata = { title: "Ubicaciones de almacén" };

/** Ubicaciones de cada sucursal; RLS Tools las descarga para contar y ubicar productos. */
export default async function LocationsPage({ searchParams }: PageProps<"/inventario/ubicaciones">) {
  const { supabase, branch, branches } = await requireAccess("inventario", "view");
  const [locationsRes, placesRes] = await Promise.all([
    supabase.from("warehouse_locations").select("id, branch_id, code, zone, description, active").order("code"),
    supabase.from("product_locations").select("location_id"),
  ]);
  const products: Record<string, number> = {};
  for (const p of (placesRes.data ?? []) as { location_id: string }[]) products[p.location_id] = (products[p.location_id] ?? 0) + 1;
  return (
    <LocationsView
      rows={(locationsRes.data ?? []) as WarehouseLocation[]}
      branches={branches.map((b) => ({ value: b.id, label: b.name }))}
      branchId={branch.id}
      products={products}
      startNew={param((await searchParams).nuevo) === "1"}
    />
  );
}
