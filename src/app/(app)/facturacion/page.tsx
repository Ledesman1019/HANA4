import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Clock, DatabaseZap, FileCheck2, FileX2, FlaskConical, TriangleAlert } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, PageHeader, Select, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { ResendButton } from "@/modules/facturacion/components/doc-actions";
import { KIND_SHORT, STATUS_META, type EDocument } from "@/modules/facturacion/types";

export const metadata: Metadata = { title: "Facturación electrónica" };

const PAGE_SIZE = 25;

export default async function BillingPage({ searchParams }: PageProps<"/facturacion">) {
  const { supabase, settings, branch, can } = await requireAccess("facturacion", "view");
  const sp = await searchParams;

  const status = Object.hasOwn(STATUS_META, param(sp.estado)) ? param(sp.estado) : "";
  const kind = Object.hasOwn(KIND_SHORT, param(sp.tipo)) ? param(sp.tipo) : "";
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  const count = (value?: string) => {
    const query = supabase.from("e_documents").select("id", { count: "exact", head: true }).eq("branch_id", branch.id);
    return value ? query.eq("status", value) : query;
  };

  let list = supabase
    .from("e_documents")
    .select("*", { count: "exact" })
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) list = list.eq("status", status);
  if (kind) list = list.eq("kind", kind);

  const [listRes, total, accepted, pending, rejected] = await Promise.all([list, count(), count("aceptado"), count("pendiente"), count("rechazado")]);

  // La tabla aún no existe: falta la migración de facturación
  if (listRes.error) {
    return (
      <>
        <PageHeader title="Facturación electrónica" />
        <Card>
          <EmptyState
            icon={<DatabaseZap className="h-5 w-5" />}
            title="Falta activar la facturación"
            description="En Supabase → SQL Editor, pega y ejecuta el archivo supabase/migrations/0003_facturacion_demo.sql. No borra datos. Luego recarga esta página."
          />
        </Card>
      </>
    );
  }

  const rows = (listRes.data ?? []) as EDocument[];
  const canSend = can("facturacion", "create");
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const hasTaxId = /^(10|15|17|20)\d{9}$/.test(settings.tax_id);

  return (
    <>
      <PageHeader title="Facturación electrónica" description={`Boletas, facturas y notas de crédito emitidas en ${branch.name}.`}>
        <ExportMenu
          title="Comprobantes electrónicos"
          subtitle={branch.name}
          filename="comprobantes_electronicos"
          source={`/api/export/facturacion${buildQuery({ estado: status, tipo: kind })}`}
          columns={[
            { key: "numero", header: "Comprobante" },
            { key: "tipo", header: "Tipo" },
            { key: "fecha", header: "Emisión" },
            { key: "documento", header: "Doc. cliente" },
            { key: "cliente", header: "Cliente" },
            { key: "estado", header: "Estado" },
            { key: "subtotal", header: "Op. gravada", type: "money", total: true },
            { key: "impuesto", header: settings.tax_name, type: "money", total: true },
            { key: "total", header: "Total", type: "money", total: true },
          ]}
        />
      </PageHeader>

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-slate-700">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-link" />
        <p>
          <strong className="font-semibold text-slate-900">Modo demostración.</strong> Los comprobantes recorren el flujo completo (emisión, validación, constancia, nota de crédito) pero la respuesta
          de SUNAT es simulada: <strong className="font-semibold">no tienen validez tributaria</strong>. Para facturar de verdad se conecta un proveedor autorizado (PSE/OSE) sin cambiar el resto
          del sistema.
        </p>
      </div>

      {!hasTaxId && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            La empresa no tiene un RUC válido registrado, así que los comprobantes serán rechazados. Regístralo en{" "}
            <Link href="/configuracion" className="font-semibold underline">
              Configuración → Empresa
            </Link>{" "}
            y usa «Reenviar».
          </p>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Comprobantes emitidos" value={String(total.count ?? 0)} icon={<FileCheck2 className="h-4 w-4" />} />
        <StatCard label="Aceptados" value={String(accepted.count ?? 0)} icon={<CircleCheck className="h-4 w-4" />} tone="green" />
        <StatCard label="Pendientes de envío" value={String(pending.count ?? 0)} icon={<Clock className="h-4 w-4" />} tone="amber" />
        <StatCard label="Rechazados" value={String(rejected.count ?? 0)} icon={<FileX2 className="h-4 w-4" />} tone="red" hint={rejected.count ? "Corrige el motivo y reenvía" : undefined} />
      </div>

      <Card>
        <FilterBar action="/facturacion">
          <Field label="Estado">
            <Select name="estado" defaultValue={status}>
              <option value="">Todos</option>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select name="tipo" defaultValue={kind}>
              <option value="">Todos</option>
              {Object.entries(KIND_SHORT).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            icon={<FileCheck2 className="h-5 w-5" />}
            title="Aún no hay comprobantes electrónicos"
            description="Se generan solos al cobrar una boleta o factura en el punto de venta. Las ventas anteriores se pueden emitir desde su detalle."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Comprobante</Th>
                <Th>Emisión</Th>
                <Th>Cliente</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
                <Th>Respuesta</Th>
                {canSend && <Th className="w-px" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="transition-colors hover:bg-slate-50/70">
                  <Td>
                    <Link href={`/facturacion/${d.id}`} className="font-medium text-link hover:underline">
                      {d.number}
                    </Link>
                    <p className="text-xs text-slate-500">{KIND_SHORT[d.kind]}</p>
                  </Td>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(d.created_at, settings.timezone)}</Td>
                  <Td>
                    <p className="text-slate-900">{d.customer_name}</p>
                    {d.customer_doc_number && (
                      <p className="tabular text-xs text-slate-500">
                        {d.customer_doc_type} {d.customer_doc_number}
                      </p>
                    )}
                  </Td>
                  <Td className="tabular text-right font-medium text-slate-900">{money(d.total)}</Td>
                  <Td>
                    <Badge tone={STATUS_META[d.status].tone}>{STATUS_META[d.status].label}</Badge>
                  </Td>
                  <Td className="max-w-72 text-xs text-slate-500">
                    {d.response_code && <span className="tabular mr-1 font-medium text-slate-700">[{d.response_code}]</span>}
                    {d.response_message ?? "—"}
                  </Td>
                  {canSend && <Td className="text-right">{d.status !== "aceptado" && <ResendButton documentId={d.id} compact />}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={listRes.count ?? 0} hrefFor={(p) => `/facturacion${buildQuery({ estado: status, tipo: kind, pagina: p })}`} />
      </Card>
    </>
  );
}
