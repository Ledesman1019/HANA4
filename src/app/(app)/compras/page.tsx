import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, Pagination, param } from "@/components/filters";
import { Badge, buttonClass, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { INVOICE_STATUS } from "@/modules/cuentas-pagar/types";
import { PURCHASE_STATUS } from "@/modules/compras/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";
import { PurchasingTabs } from "@/modules/compras/components/purchasing-tabs";

export const metadata: Metadata = { title: "Compras" };

const PAGE_SIZE = 25;

type Row = {
  id: string;
  number: string;
  status: string;
  total: number;
  expected_date: string | null;
  created_at: string;
  supplier: { name: string } | null;
  requisition: { number: string } | null;
  invoices: { status: string }[];
};

export default async function PurchasesPage({ searchParams }: PageProps<"/compras">) {
  const { supabase, settings, branch, can } = await requireAccess("compras", "view");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  const { data, count } = await supabase
    .from("purchases")
    .select("id, number, status, total, expected_date, created_at, supplier:suppliers(name), requisition:purchase_requisitions!purchases_requisition_id_fkey(number), invoices:supplier_invoices(status)", {
      count: "exact",
    })
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Compras" description={`Ciclo de aprovisionamiento de ${branch.name}: solicitud, aprobación, orden, recepción, factura y pago.`}>
        <ExportMenu
          title="Órdenes de compra"
          subtitle={branch.name}
          filename="compras"
          source="/api/export/compras"
          columns={[
            { key: "numero", header: "Orden" },
            { key: "proveedor", header: "Proveedor" },
            { key: "ruc", header: "RUC" },
            { key: "creada", header: "Creada" },
            { key: "entrega", header: "Entrega estimada", type: "date" },
            { key: "estado", header: "Estado" },
            { key: "subtotal", header: "Subtotal", type: "money", total: true },
            { key: "impuesto", header: settings.tax_name, type: "money", total: true },
            { key: "total", header: "Total", type: "money", total: true },
          ]}
        />
        {can("compras", "edit") && (
          <Link href="/compras/nueva" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" />
            Orden directa
          </Link>
        )}
      </PageHeader>
      <PurchasingTabs />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title="Aún no hay órdenes de compra"
            description="Las órdenes nacen de una solicitud de pedido aprobada. Quien aprueba compras también puede emitir una orden directa."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Orden</Th>
                <Th>Proveedor</Th>
                <Th>Creada</Th>
                <Th>Entrega estimada</Th>
                <Th className="text-right">Total</Th>
                <Th>Recepción</Th>
                <Th>Factura</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const invoice = p.invoices.find((i) => i.status !== "anulada");
                return (
                  <tr key={p.id} className="transition-colors hover:bg-slate-50/70">
                    <Td>
                      <Link href={`/compras/${p.id}`} className="font-medium text-link hover:underline">
                        {p.number}
                      </Link>
                      {p.requisition && <p className="tabular text-xs text-slate-500">de {p.requisition.number}</p>}
                    </Td>
                    <Td>{p.supplier?.name ?? "—"}</Td>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(p.created_at, settings.timezone)}</Td>
                    <Td className="tabular">{formatDate(p.expected_date)}</Td>
                    <Td className="tabular text-right font-medium text-slate-900">{formatMoney(p.total, settings.currency_symbol)}</Td>
                    <Td>
                      <Badge tone={PURCHASE_STATUS[p.status]?.tone}>{PURCHASE_STATUS[p.status]?.label ?? p.status}</Badge>
                    </Td>
                    <Td>
                      {invoice ? (
                        <Badge tone={INVOICE_STATUS[invoice.status]?.tone}>{INVOICE_STATUS[invoice.status]?.label ?? invoice.status}</Badge>
                      ) : p.status === "recibida" ? (
                        <Badge tone="amber">Sin factura</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/compras${buildQuery({ pagina: p })}`} />
      </Card>
    </>
  );
}
