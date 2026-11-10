import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, buttonClass } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { DOC_LABELS, PAYMENT_LABELS, type Sale, type SaleItem } from "@/lib/types";
import { formatDateTime, formatMoney, formatQty } from "@/lib/utils";
import { PrintButton, VoidSaleButton } from "@/modules/ventas/components/sale-actions";

export const metadata: Metadata = { title: "Comprobante" };

type Detail = Sale & {
  customer: { name: string; doc_type: string; doc_number: string; address: string } | null;
  cashier: { full_name: string } | null;
  branch: { name: string; address: string } | null;
  items: SaleItem[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SaleDetailPage({ params }: PageProps<"/ventas/[id]">) {
  const { supabase, settings, can } = await requireAccess("ventas");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { data } = await supabase
    .from("sales")
    .select("*, customer:customers(name, doc_type, doc_number, address), cashier:profiles!sales_cashier_id_fkey(full_name), branch:branches(name, address), items:sale_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const sale = data as Detail;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const voided = sale.status === "anulada";
  const gross = sale.items.reduce((a, i) => a + Number(i.total), 0);

  return (
    <div className="mx-auto max-w-md">
      <div className="no-print mb-4 flex items-center justify-between gap-2">
        <Link href="/ventas" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Ventas
        </Link>
        <div className="flex gap-2">
          {!voided && can("ventas", "delete") && <VoidSaleButton saleId={sale.id} number={sale.number} />}
          <PrintButton />
        </div>
      </div>

      <article className="print-area rounded-xl border border-slate-200 bg-surface p-6 text-sm shadow-xs">
        <header className="text-center">
          <h1 className="text-base font-semibold text-slate-900">{settings.name}</h1>
          {settings.tax_id && <p className="tabular text-slate-600">RUC {settings.tax_id}</p>}
          <p className="text-xs text-slate-500">{sale.branch?.address || settings.address}</p>
          {settings.phone && <p className="text-xs text-slate-500">Tel. {settings.phone}</p>}
          <div className="mt-3 border-y border-dashed border-slate-300 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{DOC_LABELS[sale.doc_type]} de venta</p>
            <p className="tabular font-mono text-sm font-semibold text-slate-900">{sale.number}</p>
          </div>
          {voided && (
            <div className="mt-3">
              <Badge tone="red">ANULADA</Badge>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(sale.voided_at, settings.timezone)} · {sale.void_reason}
              </p>
            </div>
          )}
        </header>

        <dl className="mt-3 space-y-0.5 text-xs text-slate-600">
          <div className="flex justify-between gap-4">
            <dt>Fecha</dt>
            <dd className="tabular">{formatDateTime(sale.created_at, settings.timezone)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Cajero</dt>
            <dd>{sale.cashier?.full_name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Cliente</dt>
            <dd className="text-right">{sale.customer?.name ?? "Cliente genérico"}</dd>
          </div>
          {sale.customer && (
            <div className="flex justify-between gap-4">
              <dt>{sale.customer.doc_type}</dt>
              <dd className="tabular">{sale.customer.doc_number}</dd>
            </div>
          )}
        </dl>

        <table className="mt-3 w-full border-t border-dashed border-slate-300 text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th scope="col" className="py-1.5 font-medium">
                Descripción
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Cant.
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                P. unit.
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Importe
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {sale.items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="py-1 pr-2 text-slate-900">{i.product_name}</td>
                <td className="py-1 text-right">{formatQty(i.quantity)}</td>
                <td className="py-1 pl-2 text-right">{Number(i.unit_price).toFixed(2)}</td>
                <td className="py-1 pl-2 text-right text-slate-900">{Number(i.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="tabular mt-2 space-y-0.5 border-t border-dashed border-slate-300 pt-2 text-xs text-slate-600">
          {Number(sale.discount) > 0 && (
            <>
              <div className="flex justify-between">
                <dt>Importe bruto</dt>
                <dd>{money(gross)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Descuento</dt>
                <dd>− {money(sale.discount)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <dt>Op. gravada</dt>
            <dd>{money(sale.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>
              {settings.tax_name} ({Number(settings.tax_rate)}%)
            </dt>
            <dd>{money(sale.tax)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{money(sale.total)}</dd>
          </div>
          <div className="flex justify-between pt-1">
            <dt>Pago: {PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method}</dt>
            <dd>{money(sale.amount_received)}</dd>
          </div>
          {Number(sale.change_amount) > 0 && (
            <div className="flex justify-between">
              <dt>Vuelto</dt>
              <dd>{money(sale.change_amount)}</dd>
            </div>
          )}
        </dl>

        <footer className="mt-4 border-t border-dashed border-slate-300 pt-3 text-center text-xs text-slate-500">
          <p>{settings.receipt_footer}</p>
          <p className="mt-1 text-[10px]">Representación interna. No válido como comprobante electrónico SUNAT.</p>
        </footer>
      </article>
    </div>
  );
}
