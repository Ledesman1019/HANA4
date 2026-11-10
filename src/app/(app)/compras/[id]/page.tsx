import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, buttonClass, Card, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/utils";
import { PURCHASE_STATUS } from "@/lib/types";
import { PurchaseActions } from "@/modules/compras/components/purchase-actions";

export const metadata: Metadata = { title: "Orden de compra" };

type Detail = {
  id: string;
  number: string;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  expected_date: string | null;
  received_at: string | null;
  note: string;
  created_at: string;
  supplier: { name: string; tax_id: string; phone: string } | null;
  branch: { name: string } | null;
  creator: { full_name: string } | null;
  items: { id: string; quantity: number; unit_cost: number; total: number; product: { name: string; sku: string; unit: string } | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PurchaseDetailPage({ params }: PageProps<"/compras/[id]">) {
  const { supabase, settings, can } = await requireAccess("compras", "view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { data } = await supabase
    .from("purchases")
    .select("*, supplier:suppliers(name, tax_id, phone), branch:branches(name), creator:profiles(full_name), items:purchase_items(id, quantity, unit_cost, total, product:products(name, sku, unit))")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const po = data as unknown as Detail;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const status = PURCHASE_STATUS[po.status];

  return (
    <>
      <PageHeader title={`Orden ${po.number}`} description={`${po.supplier?.name ?? ""} · ${po.branch?.name ?? ""}`}>
        <Link href="/compras" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Compras
        </Link>
        {po.status === "ordenada" && (
          <PurchaseActions purchaseId={po.id} number={po.number} canReceive={can("compras", "edit")} canCancel={can("compras", "delete")} />
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Productos" description="Costos unitarios sin impuesto" />
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th className="text-right">Cantidad</Th>
                <Th className="text-right">Costo unit.</Th>
                <Th className="text-right">Importe</Th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{i.product?.name}</p>
                    <p className="tabular text-xs text-slate-500">{i.product?.sku}</p>
                  </Td>
                  <Td className="tabular text-right">
                    {formatQty(i.quantity)} <span className="text-xs text-slate-500">{i.product?.unit}</span>
                  </Td>
                  <Td className="tabular text-right">{money(i.unit_cost)}</Td>
                  <Td className="tabular text-right font-medium text-slate-900">{money(i.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="tabular ml-auto max-w-xs space-y-1 p-5 text-sm text-slate-600">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{money(po.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{settings.tax_name}</dt>
              <dd>{money(po.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <dt>Total</dt>
              <dd>{money(po.total)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="self-start p-5">
          <Badge tone={status?.tone}>{status?.label ?? po.status}</Badge>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Proveedor", po.supplier?.name],
              ["RUC", po.supplier?.tax_id],
              ["Teléfono", po.supplier?.phone],
              ["Registrada", formatDateTime(po.created_at, settings.timezone)],
              ["Registrada por", po.creator?.full_name],
              ["Entrega estimada", formatDate(po.expected_date)],
              ["Recibida", po.received_at ? formatDateTime(po.received_at, settings.timezone) : null],
              ["Notas", po.note],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-0.5 text-slate-900">{value}</dd>
                </div>
              ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
