import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClass, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { PurchaseForm, type PurchaseProduct } from "@/modules/compras/components/purchase-form";

export const metadata: Metadata = { title: "Nueva orden de compra" };

export default async function NewPurchasePage() {
  const { supabase, branch } = await requireAccess("compras", "create");

  const [suppliersRes, productsRes] = await Promise.all([
    supabase.from("suppliers").select("id, name, tax_id").eq("active", true).order("name"),
    supabase.from("inventory_view").select("product_id, sku, name, unit, cost, quantity, min_stock").eq("branch_id", branch.id).eq("active", true).order("name").limit(5000),
  ]);

  return (
    <>
      <PageHeader title="Nueva orden de compra" description={`La mercadería ingresará a ${branch.name} cuando marques la orden como recibida.`}>
        <Link href="/compras" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Compras
        </Link>
      </PageHeader>
      <PurchaseForm
        suppliers={(suppliersRes.data ?? []).map((s) => ({ value: s.id as string, label: `${s.name} · ${s.tax_id}` }))}
        products={(productsRes.data ?? []) as PurchaseProduct[]}
      />
    </>
  );
}
