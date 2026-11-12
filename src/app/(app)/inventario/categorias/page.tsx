import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import type { Category } from "@/modules/inventario/types";
import { CategoriesView } from "@/modules/inventario/components/categories-view";

export const metadata: Metadata = { title: "Categorías" };

export default async function CategoriesPage() {
  const { supabase } = await requireAccess("inventario", "view");
  const { data } = await supabase.from("categories").select("*").order("name");
  return <CategoriesView rows={(data ?? []) as Category[]} />;
}
