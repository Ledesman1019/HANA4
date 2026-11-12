import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { param } from "@/components/filters";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import type { Customer } from "@/modules/clientes/types";
import { CustomersView } from "@/modules/clientes/components/customers-view";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: PageProps<"/clientes">) {
  const { supabase } = await requireAccess("clientes", "view");
  const q = param((await searchParams).q).slice(0, 60);
  const data = await fetchAll<Customer>((a, b) => supabase.from("customers").select("*").order("name").order("id").range(a, b));

  return (
    <>
      <PageHeader title="Clientes" description="Personas y empresas a las que vendes. Para emitir factura el cliente debe tener RUC." />
      <CustomersView key={q} rows={data} initialQuery={q} />
    </>
  );
}
