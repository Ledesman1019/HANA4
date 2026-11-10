import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { CashSession } from "@/lib/types";
import { OpenCashCard } from "@/modules/caja/components/cash-forms";
import { PosClient, type PosCustomer, type PosProduct } from "@/modules/ventas/components/pos-client";

export const metadata: Metadata = { title: "Punto de venta" };

export default async function PosPage() {
  const { supabase, userId, branch, branches } = await requireAccess("ventas", "create");

  const { data: sessionData } = await supabase.from("cash_sessions").select("*").eq("opened_by", userId).eq("status", "abierta").maybeSingle();
  const session = sessionData as CashSession | null;

  if (!session) {
    return (
      <>
        <PageHeader title="Punto de venta" description={`Para vender en ${branch.name} primero abre tu caja.`} />
        <div className="mx-auto max-w-md">
          <OpenCashCard branchName={branch.name} />
        </div>
      </>
    );
  }

  if (session.branch_id !== branch.id) {
    const other = branches.find((b) => b.id === session.branch_id)?.name ?? "otra sucursal";
    return (
      <>
        <PageHeader title="Punto de venta" />
        <Card>
          <EmptyState
            icon={<Store className="h-5 w-5" />}
            title={`Tienes una caja abierta en ${other}`}
            description={`Cambia a esa sucursal desde la barra superior, o cierra esa caja antes de vender en ${branch.name}.`}
            action={
              <Link href="/caja" className={buttonClass("secondary")}>
                Ir a Caja
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const [productsRes, customersRes] = await Promise.all([
    supabase
      .from("inventory_view")
      .select("product_id, sku, barcode, name, unit, price, quantity, category_name, image_url")
      .eq("branch_id", branch.id)
      .eq("active", true)
      .order("name")
      .limit(5000),
    supabase.from("customers").select("id, name, doc_type, doc_number").eq("active", true).order("name").limit(5000),
  ]);

  return <PosClient products={(productsRes.data ?? []) as PosProduct[]} customers={(customersRes.data ?? []) as PosCustomer[]} />;
}
