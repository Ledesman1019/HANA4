import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DocumentFlow, type FlowStep } from "@/components/document-flow";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { INVOICE_STATUS, PAYMENT_LABELS, PURCHASE_STATUS } from "@/lib/types";
import { formatDate, formatDateTime, formatMoney, formatQty, todayIn } from "@/lib/utils";
import { PurchaseActions } from "@/modules/compras/components/purchase-actions";
import { PayInvoiceButton, RegisterInvoiceButton, ReleaseInvoiceButton, VoidInvoiceButton } from "@/modules/cuentas-pagar/components/invoice-actions";

export const metadata: Metadata = { title: "Orden de compra" };

type Invoice = {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  difference: number;
  note: string;
  payments: { id: string; amount: number; method: string; paid_at: string; reference: string }[];
};

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
  requisition: { id: string; number: string; decided_at: string | null } | null;
  items: { id: string; product_id: string; quantity: number; unit_cost: number; total: number; product: { name: string; sku: string; unit: string; track_lots: boolean } | null }[];
  invoices: Invoice[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PurchaseDetailPage({ params }: PageProps<"/compras/[id]">) {
  const { supabase, settings, can } = await requireAccess("compras", "view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { data } = await supabase
    .from("purchases")
    .select(
      "*, supplier:suppliers(name, tax_id, phone), branch:branches(name), creator:profiles(full_name), requisition:purchase_requisitions!purchases_requisition_id_fkey(id, number, decided_at), items:purchase_items(id, product_id, quantity, unit_cost, total, lot_number, expiry_date, product:products(name, sku, unit, track_lots)), invoices:supplier_invoices(id, number, status, issue_date, due_date, total, paid, difference, note, payments:supplier_payments(id, amount, method, paid_at, reference))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const po = data as unknown as Detail;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const status = PURCHASE_STATUS[po.status];
  const invoice = po.invoices.find((i) => i.status !== "anulada");
  const balance = invoice ? Number(invoice.total) - Number(invoice.paid) : 0;
  const cancelled = po.status === "anulada";
  const received = po.status === "recibida";

  // Flujo de documentos: dónde está la compra y qué falta
  const flow: FlowStep[] = [
    { label: "Solicitud", state: po.requisition ? "done" : "skipped", detail: po.requisition?.number ?? "Orden directa" },
    { label: "Aprobación", state: po.requisition ? "done" : "skipped", detail: po.requisition?.decided_at ? formatDate(po.requisition.decided_at) : undefined },
    { label: "Orden de compra", state: cancelled ? "failed" : "done", detail: cancelled ? "Anulada" : po.number },
    { label: "Recepción", state: cancelled ? "pending" : received ? "done" : "current", detail: po.received_at ? formatDate(po.received_at) : cancelled ? undefined : "Pendiente" },
    {
      label: "Factura",
      state: !received ? "pending" : !invoice ? "current" : invoice.status === "bloqueada" ? "failed" : "done",
      detail: invoice ? (invoice.status === "bloqueada" ? "Bloqueada" : invoice.number) : received ? "Por registrar" : undefined,
    },
    {
      label: "Pago",
      state: !invoice || invoice.status === "bloqueada" ? "pending" : invoice.status === "pagada" ? "done" : "current",
      detail: invoice && invoice.status !== "bloqueada" ? (invoice.status === "pagada" ? "Cancelada" : `Saldo ${money(balance)}`) : undefined,
    },
  ];

  return (
    <>
      <PageHeader title={`Orden ${po.number}`} description={`${po.supplier?.name ?? ""} · ${po.branch?.name ?? ""}`}>
        <Link href="/compras" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Compras
        </Link>
        {po.status === "ordenada" && (
          // La recepción es del almacén; anular, de quien tiene "Eliminar" en Compras
          <PurchaseActions
            purchaseId={po.id}
            number={po.number}
            canReceive={can("inventario", "edit")}
            canCancel={can("compras", "delete")}
            trackedItems={po.items.filter((i) => i.product?.track_lots).map((i) => ({ product_id: i.product_id, name: i.product?.name ?? "", quantity: Number(i.quantity) }))}
            today={today}
          />
        )}
        {received && !invoice && can("cuentas_pagar", "create") && <RegisterInvoiceButton purchaseId={po.id} orderTotal={Number(po.total)} today={today} />}
      </PageHeader>

      <div className="mb-6">
        <DocumentFlow steps={flow} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
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

          {/* Factura del proveedor y pagos */}
          <Card>
            <CardHeader
              title="Factura del proveedor y pagos"
              description={invoice ? `Factura ${invoice.number} · vence el ${formatDate(invoice.due_date)}` : "Se registra después de recibir la mercadería"}
              action={
                invoice && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {invoice.status === "bloqueada" && can("compras", "edit") && <ReleaseInvoiceButton invoiceId={invoice.id} number={invoice.number} />}
                    {Number(invoice.paid) === 0 && can("cuentas_pagar", "delete") && <VoidInvoiceButton invoiceId={invoice.id} number={invoice.number} />}
                    {(invoice.status === "pendiente" || invoice.status === "parcial") && can("cuentas_pagar", "edit") && (
                      <PayInvoiceButton invoiceId={invoice.id} number={invoice.number} balance={balance} today={today} compact />
                    )}
                  </div>
                )
              }
            />
            {!invoice ? (
              <EmptyState
                title={received ? "Falta registrar la factura" : "Aún no corresponde"}
                description={
                  received
                    ? "Cuando llegue la factura del proveedor, regístrala: el sistema la compara con esta orden antes de habilitar el pago."
                    : "Primero el almacén debe registrar la entrada de la mercadería."
                }
              />
            ) : (
              <>
                <dl className="grid gap-4 border-b border-slate-100 p-5 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Estado</dt>
                    <dd className="mt-1">
                      <Badge tone={INVOICE_STATUS[invoice.status]?.tone}>{INVOICE_STATUS[invoice.status]?.label}</Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Importe</dt>
                    <dd className="tabular mt-1 font-semibold text-slate-900">{money(invoice.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Pagado</dt>
                    <dd className="tabular mt-1 text-slate-900">{money(invoice.paid)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Saldo</dt>
                    <dd className={`tabular mt-1 font-semibold ${balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{money(balance)}</dd>
                  </div>
                </dl>
                {Math.abs(Number(invoice.difference)) > 0.004 && (
                  <p className="border-b border-slate-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
                    La factura difiere de la orden en <strong className="tabular font-semibold">{money(invoice.difference)}</strong>. {invoice.note}
                  </p>
                )}
                {invoice.payments.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-slate-500">Sin pagos registrados.</p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Fecha de pago</Th>
                        <Th>Medio</Th>
                        <Th>Operación</Th>
                        <Th className="text-right">Importe</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...invoice.payments]
                        .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
                        .map((p) => (
                          <tr key={p.id}>
                            <Td className="tabular">{formatDate(p.paid_at)}</Td>
                            <Td className="capitalize">{PAYMENT_LABELS[p.method] ?? p.method}</Td>
                            <Td className="tabular">{p.reference || "—"}</Td>
                            <Td className="tabular text-right font-medium text-slate-900">{money(p.amount)}</Td>
                          </tr>
                        ))}
                    </tbody>
                  </Table>
                )}
              </>
            )}
          </Card>
        </div>

        <Card className="self-start p-5">
          <Badge tone={status?.tone}>{status?.label ?? po.status}</Badge>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Proveedor", po.supplier?.name],
              ["RUC", po.supplier?.tax_id],
              ["Teléfono", po.supplier?.phone],
              ["Emitida", formatDateTime(po.created_at, tz)],
              ["Emitida por", po.creator?.full_name],
              ["Entrega estimada", po.expected_date ? formatDate(po.expected_date) : null],
              ["Recibida", po.received_at ? formatDateTime(po.received_at, tz) : null],
              ["Notas", po.note],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-0.5 text-slate-900">{value}</dd>
                </div>
              ))}
            {po.requisition && (
              <div>
                <dt className="text-xs font-medium text-slate-500">Solicitud de pedido</dt>
                <dd className="mt-0.5">
                  <Link href={`/compras/solicitudes/${po.requisition.id}`} className="font-medium text-link hover:underline">
                    {po.requisition.number}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>
    </>
  );
}
