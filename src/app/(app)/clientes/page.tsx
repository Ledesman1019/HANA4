import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { param } from "@/components/filters";
import { requireAccess } from "@/lib/auth";
import type { Customer } from "@/lib/types";
import { CustomersView } from "@/modules/clientes/components/customers-view";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: PageProps<"/clientes">) {
  const { supabase } = await requireAccess("clientes", "view");
  const q = param((await searchParams).q).slice(0, 60);
  const { data } = await supabase.from("customers").select("*").order("name").limit(5000);

  return (
    <>
      <PageHeader title="Clientes" description="Personas y empresas a las que vendes. Para emitir factura el cliente debe tener RUC." />
      <CustomersView key={q} rows={(data ?? []) as Customer[]} initialQuery={q} />
    </>
  );
}
