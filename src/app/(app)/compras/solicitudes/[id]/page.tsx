import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { DocumentFlow, type FlowStep } from "@/components/document-flow";
import { Badge, buttonClass, Card, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { REQUISITION_STATUS } from "@/lib/types";
import { formatDate, formatDateTime, formatQty } from "@/lib/utils";
import { RequisitionDecision } from "@/modules/compras/components/requisition";

export const metadata: Metadata = { title: "Solicitud de pedido" };

type Detail = {
  id: string;
  number: string;
  status: string;
  justification: string;
  decision_note: string;
  decided_at: string | null;
  created_at: string;
  requested_by: string;
  branch_id: string;
  requester: { full_name: string } | null;
  decider: { full_name: string } | null;
  branch: { name: string } | null;
  purchase: { id: string; number: string; status: string } | null;
  items: { id: string; quantity: number; product_id: string; product: { name: string; sku: string; unit: string; min_stock: number } | null }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequisitionDetailPage({ params }: PageProps<"/compras/solicitudes/[id]">) {
  const { supabase, settings, userId, profile, can } = await requireAccess("compras", "access");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { data } = await supabase
    .from("purchase_requisitions")
    .select(
      "*, requester:profiles!purchase_requisitions_requested_by_fkey(full_name), decider:profiles!purchase_requisitions_decided_by_fkey(full_name), branch:branches(name), purchase:purchases!purchase_requisitions_purchase_id_fkey(id, number, status), items:purchase_requisition_items(id, quantity, product_id, product:products(name, sku, unit, min_stock))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const req = data as unknown as Detail;

  // Stock actual de los productos pedidos, para decidir con datos
  const stockRes = await supabase
    .from("stock")
    .select("product_id, quantity")
    .eq("branch_id", req.branch_id)
    .in(
      "product_id",
      req.items.map((i) => i.product_id),
    );
  const stock = new Map(((stockRes.data ?? []) as { product_id: string; quantity: number }[]).map((s) => [s.product_id, Number(s.quantity)]));

  const status = REQUISITION_STATUS[req.status];
  const pending = req.status === "pendiente";
  const rejected = req.status === "rechazada";
  // Nadie aprueba su propia solicitud (salvo el administrador)
  const own = req.requested_by === userId && profile.role !== "admin";

  const flow: FlowStep[] = [
    { label: "Solicitud", state: "done", detail: req.number },
    { label: "Aprobación", state: pending ? "current" : rejected ? "failed" : "done", detail: pending ? "Pendiente" : rejected ? "Rechazada" : req.decided_at ? formatDate(req.decided_at) : undefined },
    { label: "Orden de compra", state: req.purchase ? "done" : req.status === "aprobada" ? "current" : "pending", detail: req.purchase?.number ?? (req.status === "aprobada" ? "Por emitir" : undefined) },
    { label: "Recepción", state: req.purchase?.status === "recibida" ? "done" : req.purchase ? "current" : "pending" },
    { label: "Factura", state: "pending" },
    { label: "Pago", state: "pending" },
  ];

  return (
    <>
      <PageHeader title={`Solicitud ${req.number}`} description={`${req.branch?.name ?? ""} · solicitada por ${req.requester?.full_name ?? "—"}`}>
        <Link href="/compras/solicitudes" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Solicitudes
        </Link>
        {pending && can("compras", "edit") && !own && <RequisitionDecision requisitionId={req.id} number={req.number} />}
        {req.status === "aprobada" && can("compras", "edit") && (
          <Link href={`/compras/nueva?solicitud=${req.id}`} className={buttonClass("primary")}>
            <FilePlus2 className="h-4 w-4" />
            Emitir orden de compra
          </Link>
        )}
      </PageHeader>

      <div className="mb-6">
        <DocumentFlow steps={flow} />
      </div>

      {pending && own && can("compras", "edit") && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Esta solicitud es tuya: por control interno debe aprobarla otra persona con permiso de Compras.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Productos solicitados" />
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th className="text-right">Stock actual</Th>
                <Th className="text-right">Mínimo</Th>
                <Th className="text-right">Cantidad pedida</Th>
              </tr>
            </thead>
            <tbody>
              {req.items.map((i) => {
                const current = stock.get(i.product_id) ?? 0;
                const low = current <= Number(i.product?.min_stock ?? 0);
                return (
                  <tr key={i.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{i.product?.name}</p>
                      <p className="tabular text-xs text-slate-500">{i.product?.sku}</p>
                    </Td>
                    <Td className="tabular text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {low && <Badge tone={current <= 0 ? "red" : "amber"}>{current <= 0 ? "Agotado" : "Bajo"}</Badge>}
                        {formatQty(current)}
                      </span>
                    </Td>
                    <Td className="tabular text-right">{formatQty(i.product?.min_stock)}</Td>
                    <Td className="tabular text-right font-semibold text-slate-900">
                      {formatQty(i.quantity)} <span className="text-xs font-normal text-slate-500">{i.product?.unit}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card className="self-start p-5">
          <Badge tone={status?.tone}>{status?.label ?? req.status}</Badge>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Solicitante", req.requester?.full_name],
              ["Fecha", formatDateTime(req.created_at, settings.timezone)],
              ["Justificación", req.justification],
              [rejected ? "Rechazada por" : "Aprobada por", req.decider?.full_name],
              ["Fecha de la decisión", req.decided_at ? formatDateTime(req.decided_at, settings.timezone) : null],
              [rejected ? "Motivo del rechazo" : "Nota de aprobación", req.decision_note],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="mt-0.5 text-slate-900">{value}</dd>
                </div>
              ))}
            {req.purchase && (
              <div>
                <dt className="text-xs font-medium text-slate-500">Orden de compra</dt>
                <dd className="mt-0.5">
                  <Link href={`/compras/${req.purchase.id}`} className="tabular font-medium text-link hover:underline">
                    {req.purchase.number}
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
