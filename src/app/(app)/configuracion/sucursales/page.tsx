import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import type { Branch } from "@/lib/types";
import { BranchesView } from "@/modules/configuracion/components/branches-view";

export const metadata: Metadata = { title: "Sucursales" };

export default async function BranchesPage() {
  const { supabase } = await requireAccess("configuracion", "view");
  const { data } = await supabase.from("branches").select("*").order("code");
  return <BranchesView rows={(data ?? []) as Branch[]} />;
}
