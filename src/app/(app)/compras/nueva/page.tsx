import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { param } from "@/components/filters";
import { buttonClass, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { PurchaseForm, type PurchaseProduct } from "@/modules/compras/components/purchase-form";

export const metadata: Metadata = { title: "Nueva orden de compra" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewPurchasePage({ searchParams }: PageProps<"/compras/nueva">) {
  // Emitir órdenes es de quien aprueba compras; el resto crea solicitudes de pedido
  const { supabase, branch, can } = await requireAccess("compras", "access");
  if (!can("compras", "edit")) redirect("/compras/solicitudes/nueva");

  const requisitionId = param((await searchParams).solicitud);

  const [suppliersRes, products, requisitionRes] = await Promise.all([
    supabase.from("suppliers").select("id, name, tax_id").eq("active", true).order("name"),
    fetchAll<PurchaseProduct>((a, b) =>
      supabase.from("inventory_view").select("product_id, sku, name, unit, cost, quantity, min_stock").eq("branch_id", branch.id).eq("active", true).order("name").order("product_id").range(a, b),
    ),
    UUID.test(requisitionId)
      ? supabase.from("purchase_requisitions").select("id, number, status, branch_id, items:purchase_requisition_items(product_id, quantity)").eq("id", requisitionId).maybeSingle()
      : null,
  ]);

  const req = requisitionRes?.data as { id: string; number: string; status: string; branch_id: string; items: { product_id: string; quantity: number }[] } | null | undefined;
  // Solo se convierte una solicitud aprobada de la sucursal activa
  if (requisitionId && (!req || req.status !== "aprobada" || req.branch_id !== branch.id)) redirect("/compras/solicitudes");

  return (
    <>
      <PageHeader
        title={req ? `Orden de compra de la solicitud ${req.number}` : "Orden de compra directa"}
        description={`Elige proveedor y costos. La mercadería ingresará a ${branch.name} cuando el almacén registre la recepción.`}
      >
        <Link href={req ? `/compras/solicitudes/${req.id}` : "/compras"} className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          {req ? "Solicitud" : "Compras"}
        </Link>
      </PageHeader>
      <PurchaseForm
        key={req?.id ?? "directa"}
        suppliers={(suppliersRes.data ?? []).map((s) => ({ value: s.id as string, label: `${s.name} · ${s.tax_id}` }))}
        products={products}
        requisition={req ? { id: req.id, number: req.number, items: req.items } : undefined}
      />
    </>
  );
}
