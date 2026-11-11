import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClass, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { QuotationForm, type QuoteCustomer, type QuoteProduct } from "@/modules/ventas/components/quotation";

export const metadata: Metadata = { title: "Nueva cotización" };

export default async function NewQuotationPage() {
  const { supabase, branch } = await requireAccess("ventas", "create");

  const [products, customers] = await Promise.all([
    fetchAll<QuoteProduct>((a, b) =>
      supabase.from("inventory_view").select("product_id, sku, name, unit, price, quantity").eq("branch_id", branch.id).eq("active", true).order("name").order("product_id").range(a, b),
    ),
    fetchAll<QuoteCustomer>((a, b) => supabase.from("customers").select("id, name, doc_type, doc_number").eq("active", true).order("name").order("id").range(a, b)),
  ]);

  return (
    <>
      <PageHeader title="Nueva cotización" description="Una oferta formal al cliente. No mueve stock hasta que se convierta en venta.">
        <Link href="/cotizaciones" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Cotizaciones
        </Link>
      </PageHeader>
      <QuotationForm products={products} customers={customers} />
    </>
  );
}
