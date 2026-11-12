import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { DOC_LABELS, type Sale } from "@/modules/ventas/types";
import { PAYMENT_LABELS } from "@/lib/types";
import { addDays, formatDate, formatDateTime, formatMoney, isIsoDate, todayIn, zonedDayStart } from "@/lib/utils";

export const metadata: Metadata = { title: "Ventas" };

const PAGE_SIZE = 25;
type Row = Sale & { customer: { name: string } | null; cashier: { full_name: string } | null };

export default async function SalesPage({ searchParams }: PageProps<"/ventas">) {
  const { supabase, settings, branch, can } = await requireAccess("ventas");
  const sp = await searchParams;
  const tz = settings.timezone;

  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : todayIn(tz, -29);
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : todayIn(tz);
  const status = ["completada", "anulada"].includes(param(sp.estado)) ? param(sp.estado) : "";
  const q = param(sp.q).trim().slice(0, 30);
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);

  let query = supabase
    .from("sales")
    .select("*, customer:customers(name), cashier:profiles!sales_cashier_id_fkey(full_name)", { count: "exact" })
    .eq("branch_id", branch.id)
    .gte("created_at", zonedDayStart(from, tz))
    .lt("created_at", zonedDayStart(addDays(to, 1), tz))
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("number", `%${q.replace(/[%_\\]/g, "")}%`);

  const { data, count } = await query;
  const rows = (data ?? []) as Row[];
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  return (
    <>
      <PageHeader
        title="Ventas"
        description={!can("ventas", "view") ? `Tus comprobantes emitidos en ${branch.name}.` : `Comprobantes emitidos en ${branch.name}.`}
      >
        <ExportMenu
          title="Registro de ventas"
          subtitle={`${branch.name} · del ${formatDate(from)} al ${formatDate(to)}`}
          filename={`ventas_${from}_${to}`}
          source={`/api/export/ventas${buildQuery({ desde: from, hasta: to, estado: status, q })}`}
          columns={[
            { key: "numero", header: "Comprobante" },
            { key: "tipo", header: "Tipo" },
            { key: "fecha", header: "Fecha" },
            { key: "cliente", header: "Cliente" },
            { key: "vendedor", header: "Vendedor" },
            { key: "pago", header: "Pago" },
            { key: "estado", header: "Estado" },
            { key: "subtotal", header: "Op. gravada", type: "money", total: true },
            { key: "impuesto", header: settings.tax_name, type: "money", total: true },
            { key: "total", header: "Total", type: "money", total: true },
          ]}
        />
      </PageHeader>
      <Card>
        <FilterBar action="/ventas">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} max={to} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
          <Field label="Estado">
            <Select name="estado" defaultValue={status}>
              <option value="">Todos</option>
              <option value="completada">Completadas</option>
              <option value="anulada">Anuladas</option>
            </Select>
          </Field>
          <Field label="N.º de comprobante">
            <Input type="search" name="q" defaultValue={q} placeholder="B001-00000123" />
          </Field>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="Sin ventas en este periodo" description="Ajusta los filtros o registra una venta desde el punto de venta." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Comprobante</Th>
                <Th>Fecha</Th>
                <Th>Cliente</Th>
                <Th>Cajero</Th>
                <Th>Pago</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <Td>
                    <Link href={`/ventas/${s.id}`} className="font-medium text-link hover:underline">
                      {s.number}
                    </Link>
                    <p className="text-xs text-slate-500">{DOC_LABELS[s.doc_type]}</p>
                  </Td>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(s.created_at, tz)}</Td>
                  <Td>{s.customer?.name ?? <span className="text-slate-400">Cliente genérico</span>}</Td>
                  <Td>{s.cashier?.full_name ?? "—"}</Td>
                  <Td>{PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</Td>
                  <Td className="tabular text-right font-medium text-slate-900">{money(s.total)}</Td>
                  <Td>
                    <Badge tone={s.status === "completada" ? "green" : "red"}>{s.status === "completada" ? "Completada" : "Anulada"}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
          hrefFor={(p) => `/ventas${buildQuery({ desde: from, hasta: to, estado: status, q, pagina: p })}`}
        />
      </Card>
    </>
  );
}
