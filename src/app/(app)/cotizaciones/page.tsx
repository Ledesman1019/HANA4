import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, buttonClass, Card, EmptyState, Field, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { QUOTE_STATUS } from "@/modules/ventas/types";
import { formatDate, formatDateTime, formatMoney, todayIn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cotizaciones" };

const PAGE_SIZE = 25;

type Row = { id: string; number: string; status: string; total: number; valid_until: string; created_at: string; customer: { name: string } | null; creator: { full_name: string } | null };

export default async function QuotationsPage({ searchParams }: PageProps<"/cotizaciones">) {
  const { supabase, settings, branch, can } = await requireAccess("ventas", "access");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);
  const status = Object.hasOwn(QUOTE_STATUS, param(sp.estado)) ? param(sp.estado) : "";
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  let query = supabase
    .from("quotations")
    .select("id, number, status, total, valid_until, created_at, customer:customers(name), creator:profiles!quotations_created_by_fkey(full_name)", { count: "exact" })
    .eq("branch_id", branch.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  // "Vencida" no se guarda: es una vigente cuya fecha ya pasó
  if (status === "vencida") query = query.eq("status", "vigente").lt("valid_until", today);
  else if (status === "vigente") query = query.eq("status", "vigente").gte("valid_until", today);
  else if (status) query = query.eq("status", status);

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const shown = (r: Row) => (r.status === "vigente" && r.valid_until < today ? "vencida" : r.status);

  return (
    <>
      <PageHeader title="Cotizaciones" description={`Ofertas a clientes de ${branch.name}. El precio queda congelado durante la vigencia y se convierten en venta con un clic.`}>
        {can("ventas", "create") && (
          <Link href="/cotizaciones/nueva" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" />
            Nueva cotización
          </Link>
        )}
      </PageHeader>
      <Card>
        <FilterBar action="/cotizaciones">
          <Field label="Estado">
            <Select name="estado" defaultValue={status}>
              <option value="">Todas</option>
              {Object.entries(QUOTE_STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No hay cotizaciones" description="Emite una para enviar precios a un cliente antes de venderle." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cotización</Th>
                <Th>Cliente</Th>
                <Th>Emitida</Th>
                <Th>Válida hasta</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50/70">
                  <Td>
                    <Link href={`/cotizaciones/${r.id}`} className="font-medium text-link hover:underline">
                      {r.number}
                    </Link>
                    <p className="text-xs text-slate-500">{r.creator?.full_name}</p>
                  </Td>
                  <Td>{r.customer?.name ?? <span className="text-slate-400">Genérica</span>}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(r.created_at, settings.timezone)}</Td>
                  <Td className="tabular">{formatDate(r.valid_until)}</Td>
                  <Td className="tabular text-right font-medium text-slate-900">{formatMoney(r.total, settings.currency_symbol)}</Td>
                  <Td>
                    <Badge tone={QUOTE_STATUS[shown(r)].tone}>{QUOTE_STATUS[shown(r)].label}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/cotizaciones${buildQuery({ estado: status, pagina: p })}`} />
      </Card>
    </>
  );
}
