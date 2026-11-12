import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClass, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { RequisitionForm, type RequisitionProduct } from "@/modules/compras/components/requisition";

export const metadata: Metadata = { title: "Nueva solicitud de pedido" };

export default async function NewRequisitionPage() {
  const { supabase, branch } = await requireAccess("compras", "create");

  const [products, centersRes] = await Promise.all([
    fetchAll<RequisitionProduct>((a, b) =>
      supabase
        .from("inventory_view")
        .select("product_id, sku, name, unit, quantity, min_stock, pack_unit, pack_size")
        .eq("branch_id", branch.id)
        .eq("active", true)
        .order("name")
        .order("product_id")
        .range(a, b),
    ),
    supabase.from("cost_centers").select("id, code, name").eq("active", true).order("code"),
  ]);

  return (
    <>
      <PageHeader title="Nueva solicitud de pedido" description={`Pide la mercadería que necesita ${branch.name}. Compras la revisará antes de ordenarla al proveedor.`}>
        <Link href="/compras/solicitudes" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Solicitudes
        </Link>
      </PageHeader>
      <RequisitionForm products={products} costCenters={((centersRes.data ?? []) as { id: string; code: string; name: string }[]).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
    </>
  );
}
