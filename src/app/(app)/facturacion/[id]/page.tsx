import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import QRCode from "qrcode";
import { Badge, buttonClass } from "@/components/ui";
import { amountInWords } from "@/lib/amount-words";
import { getContext } from "@/lib/auth";
import { formatDateTime, formatQty } from "@/lib/utils";
import { PrintDocButton, ResendButton } from "@/modules/facturacion/components/doc-actions";
import { loadBillingDocument } from "@/modules/facturacion/service";
import { IDENTITY_CODES, KIND_CODES, KIND_LABELS, STATUS_META } from "@/modules/facturacion/types";

export const metadata: Metadata = { title: "Comprobante electrónico" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n2 = (value: number) => new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export default async function BillingDocumentPage({ params }: PageProps<"/facturacion/[id]">) {
  // RLS decide: quien emitió la venta o quien tiene "Ver" en Facturación
  const ctx = await getContext();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const loaded = await loadBillingDocument(ctx, id);
  if (!loaded) notFound();
  const { doc, billing } = loaded;
  const { settings } = ctx;

  const status = STATUS_META[doc.status];
  const [series, correlative] = doc.number.split("-");
  const issued = formatDateTime(doc.created_at, settings.timezone);
  const gross = billing.items.reduce((sum, i) => sum + i.total, 0);
  const discount = Math.max(gross - billing.total, 0);

  // Contenido del QR según el formato de SUNAT para la representación impresa
  const qrText = [
    settings.tax_id || "00000000000",
    KIND_CODES[doc.kind],
    series,
    correlative,
    billing.tax.toFixed(2),
    billing.total.toFixed(2),
    doc.created_at.slice(0, 10),
    IDENTITY_CODES[doc.customer_doc_type] ?? "0",
    doc.customer_doc_number || "-",
    doc.hash ?? "",
  ].join("|");
  const qr = await QRCode.toString(qrText, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/facturacion" className={buttonClass("ghost")}>
          <ArrowLeft className="h-4 w-4" />
          Facturación
        </Link>
        <div className="flex flex-wrap gap-2">
          {doc.status !== "aceptado" && ctx.can("facturacion", "create") && <ResendButton documentId={doc.id} />}
          <a href={`/api/facturacion/${doc.id}/xml`} download className={buttonClass("secondary")}>
            <Download className="h-4 w-4" />
            XML
          </a>
          <PrintDocButton />
        </div>
      </div>

      {doc.status !== "aceptado" && (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong className="font-semibold">{status.label}.</strong> {doc.response_message ?? "Aún no se ha enviado."}
        </div>
      )}

      <article className="print-page rounded-xl border border-slate-200 bg-surface p-6 text-sm shadow-xs sm:p-8">
        <header className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">{settings.name}</h1>
            {settings.address && <p className="mt-1 text-xs text-slate-600">{settings.address}</p>}
            <p className="text-xs text-slate-600">{[settings.phone && `Tel. ${settings.phone}`, settings.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="rounded-xl border-2 border-slate-900 px-5 py-3 text-center">
            <p className="tabular text-sm font-semibold text-slate-900">RUC {settings.tax_id || "—"}</p>
            <p className="my-1 text-xs font-bold uppercase tracking-wide text-slate-900">{KIND_LABELS[doc.kind]}</p>
            <p className="tabular font-mono text-base font-bold text-slate-900">{doc.number}</p>
          </div>
        </header>

        <dl className="mt-6 grid gap-x-8 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-xs sm:grid-cols-2">
          {[
            ["Cliente", doc.customer_name],
            ["Fecha de emisión", issued],
            [doc.customer_doc_type || "Documento", doc.customer_doc_number || "—"],
            ["Moneda", `${settings.currency_code} (${settings.currency_symbol})`],
            ...(billing.reference ? [["Documento que modifica", billing.reference.number], ["Motivo", billing.reference.reason]] : []),
          ].map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-32 shrink-0 font-semibold text-slate-600">{label}</dt>
              <dd className="tabular min-w-0 text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>

        <table className="mt-5 w-full text-xs">
          <thead>
            <tr className="border-y border-slate-300 text-left text-[11px] uppercase tracking-wide text-slate-600">
              <th scope="col" className="py-2 pr-2 font-semibold">
                Cant.
              </th>
              <th scope="col" className="py-2 pr-2 font-semibold">
                Código
              </th>
              <th scope="col" className="py-2 pr-2 font-semibold">
                Descripción
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-semibold">
                P. unit.
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-semibold">
                Importe
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {billing.items.map((item, i) => (
              <tr key={i} className="border-b border-slate-100 align-top">
                <td className="py-1.5 pr-2">{formatQty(item.quantity)}</td>
                <td className="py-1.5 pr-2 text-slate-600">{item.sku}</td>
                <td className="py-1.5 pr-2 text-slate-900">{item.description}</td>
                <td className="py-1.5 pl-2 text-right">{n2(item.unitPrice)}</td>
                <td className="py-1.5 pl-2 text-right text-slate-900">{n2(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_15rem]">
          <p className="self-start rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">SON: {amountInWords(billing.total, settings.currency_code === "PEN" ? "SOLES" : settings.currency_code)}</p>
          <dl className="tabular space-y-1 text-xs text-slate-700">
            {discount > 0.004 && (
              <div className="flex justify-between">
                <dt>Descuento</dt>
                <dd>− {n2(discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Op. gravada</dt>
              <dd>{n2(billing.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>
                {settings.tax_name} ({Number(settings.tax_rate)}%)
              </dt>
              <dd>{n2(billing.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold text-slate-900">
              <dt>Importe total</dt>
              <dd>
                {settings.currency_symbol} {n2(billing.total)}
              </dd>
            </div>
          </dl>
        </div>

        <footer className="mt-6 flex flex-wrap items-end gap-5 border-t border-slate-200 pt-5">
          {/* El QR siempre va en negro sobre blanco para que cualquier lector lo reconozca */}
          <div className="h-28 w-28 shrink-0 rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label="Código QR del comprobante" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="min-w-0 flex-1 space-y-1 text-xs text-slate-600">
            <p>
              Representación impresa de la {KIND_LABELS[doc.kind].toLowerCase()}. <Badge tone={status.tone}>{status.label}</Badge>
            </p>
            {doc.hash && (
              <p className="break-all">
                Resumen: <span className="font-mono text-slate-900">{doc.hash}</span>
              </p>
            )}
            {doc.response_code && doc.status === "aceptado" && <p>Constancia: [{doc.response_code}] {doc.response_message}</p>}
            {doc.environment === "demo" && (
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-red-600">Documento de demostración — sin validez tributaria ante SUNAT</p>
            )}
          </div>
        </footer>
      </article>
    </div>
  );
}
