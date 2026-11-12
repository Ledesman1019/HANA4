import type { Metadata } from "next";
import { param } from "@/components/filters";
import { PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { Supplier } from "@/modules/proveedores/types";
import { SuppliersView } from "@/modules/proveedores/components/suppliers-view";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: PageProps<"/proveedores">) {
  const { supabase } = await requireAccess("proveedores", "view");
  const { data } = await supabase.from("suppliers").select("*").order("name").limit(2000);

  return (
    <>
      <PageHeader title="Proveedores" description="Empresas a las que les compras mercadería." />
      <SuppliersView rows={(data ?? []) as Supplier[]} startNew={param((await searchParams).nuevo) === "1"} />
    </>
  );
}
