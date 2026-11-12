import type { Metadata } from "next";
import { param } from "@/components/filters";
import { requireAccess } from "@/lib/auth";
import { CostCentersView, type CostCenter } from "@/modules/contabilidad/components/cost-centers-view";

export const metadata: Metadata = { title: "Centros de costo" };

/** Maestro de centros de costo (áreas a las que se cargan los gastos). */
export default async function CostCentersPage({ searchParams }: PageProps<"/contabilidad/centros">) {
  const { supabase } = await requireAccess("contabilidad", "view");
  const sp = await searchParams;
  const { data } = await supabase.from("cost_centers").select("id, code, name, active").order("code");
  return <CostCentersView rows={(data ?? []) as CostCenter[]} startNew={param(sp.nuevo) === "1"} />;
}
