import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DocumentFlow } from "@/components/document-flow";
import { Badge, buttonClass } from "@/components/ui";
import { amountInWords } from "@/lib/amount-words";
import { requireAccess } from "@/lib/auth";
import { QUOTE_STATUS } from "@/lib/types";
import { formatDate, formatDateTime, formatMoney, formatQty, todayIn } from "@/lib/utils";
import { PrintButton } from "@/modules/ventas/components/sale-actions";
import { CancelQuotationButton, ConvertQuotationButton } from "@/modules/ventas/components/quotation";

export const metadata: Metadata = { title: "Cotización" };

type Detail = {
  id: string;
  number: string;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  valid_until: string;
  note: string;
  created_at: string;
  created_by: string;
  customer: { name: string; doc_type: string; doc_number: string; address: string } | null;
  creator: { full_name: string } | null;
  sale: { id: string; number: string } | null;
  items: { id: string; product_name: string; sku: string; quantity: number; unit_price: number; total: number }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuotationDetailPage({ params }: PageProps<"/cotizaciones/[id]">) {
  const { supabase, settings, userId, can } = await requireAccess("ventas", "access");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { data } = await supabase
    .from("quotations")
    .select(
      "*, customer:customers(name, doc_type, doc_number, address), creator:profiles!quotations_created_by_fkey(full_name), sale:sales!quotations_sale_id_fkey(id, number), items:quotation_items(id, product_name, sku, quantity, unit_price, total)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const q = data as unknown as Detail;
  const today = todayIn(settings.timezone);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const expired = q.status === "vigente" && q.valid_until < today;
  const shown = expired ? "vencida" : q.status;
  const open = q.status === "vigente" && !expired;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/cotizaciones" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Cotizaciones
        </Link>
        <div className="flex flex-wrap gap-2">
          {q.status === "vigente" && (q.created_by === userId || can("ventas", "edit")) && <CancelQuotationButton quotationId={q.id} />}
          <PrintButton />
          {open && can("ventas", "create") && <ConvertQuotationButton quotationId={q.id} total={Number(q.total)} hasRuc={q.customer?.doc_type === "RUC"} hasCustomer={Boolean(q.customer)} />}
        </div>
      </div>

      <div className="no-print mb-4">
        <DocumentFlow
          steps={[
            { label: "Cotización", state: q.status === "anulada" ? "failed" : "done", detail: q.number },
            { label: "Venta", state: q.sale ? "done" : open ? "current" : "pending", detail: q.sale?.number ?? (expired ? "Vencida" : undefined) },
            { label: "Comprobante", state: q.sale ? "done" : "pending" },
            { label: "Cobro", state: q.sale ? "current" : "pending" },
          ]}
        />
      </div>

      <article className="print-page rounded-xl border border-slate-200 bg-surface p-6 text-sm shadow-xs sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{settings.name}</h1>
            {settings.tax_id && <p className="tabular text-xs text-slate-600">RUC {settings.tax_id}</p>}
            <p className="text-xs text-slate-600">{settings.address}</p>
            <p className="text-xs text-slate-600">{[settings.phone, settings.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Cotización</p>
            <p className="tabular font-mono text-lg font-bold text-slate-900">{q.number}</p>
            <Badge tone={QUOTE_STATUS[shown].tone}>{QUOTE_STATUS[shown].label}</Badge>
          </div>
        </header>

        <dl className="mt-6 grid gap-x-8 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-xs sm:grid-cols-2">
          {[
            ["Cliente", q.customer?.name ?? "—"],
            ["Emitida", formatDateTime(q.created_at, settings.timezone)],
            [q.customer?.doc_type ?? "Documento", q.customer?.doc_number ?? "—"],
            ["Válida hasta", formatDate(q.valid_until)],
            ["Atendido por", q.creator?.full_name ?? "—"],
            ...(q.sale ? [["Venta", q.sale.number]] : []),
          ].map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-28 shrink-0 font-semibold text-slate-600">{label}</dt>
              <dd className="tabular min-w-0 text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>

        <table className="mt-5 w-full text-xs">
          <thead>
            <tr className="border-y border-slate-300 text-left text-[11px] uppercase tracking-wide text-slate-600">
              <th className="py-2 pr-2 font-semibold">Cant.</th>
              <th className="py-2 pr-2 font-semibold">Código</th>
              <th className="py-2 pr-2 font-semibold">Descripción</th>
              <th className="py-2 pl-2 text-right font-semibold">P. unit.</th>
              <th className="py-2 pl-2 text-right font-semibold">Importe</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {q.items.map((i) => (
              <tr key={i.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-2">{formatQty(i.quantity)}</td>
                <td className="py-1.5 pr-2 text-slate-600">{i.sku}</td>
                <td className="py-1.5 pr-2 text-slate-900">{i.product_name}</td>
                <td className="py-1.5 pl-2 text-right">{money(i.unit_price)}</td>
                <td className="py-1.5 pl-2 text-right text-slate-900">{money(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_15rem]">
          <div className="space-y-2 text-xs text-slate-600">
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-medium text-slate-700">SON: {amountInWords(Number(q.total), settings.currency_code === "PEN" ? "SOLES" : settings.currency_code)}</p>
            {q.note && <p>Condiciones: {q.note}</p>}
            <p>Precios incluyen {settings.tax_name}. Válidos hasta el {formatDate(q.valid_until)} o hasta agotar stock.</p>
          </div>
          <dl className="tabular space-y-1 text-xs text-slate-700">
            {Number(q.discount) > 0 && (
              <div className="flex justify-between">
                <dt>Descuento</dt>
                <dd>− {money(q.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Op. gravada</dt>
              <dd>{money(q.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{settings.tax_name}</dt>
              <dd>{money(q.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold text-slate-900">
              <dt>Total</dt>
              <dd>{money(q.total)}</dd>
            </div>
          </dl>
        </div>
      </article>
    </div>
  );
}
