import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenText, Plus } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, buttonClass, Card, EmptyState, Field, Input, Select } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatDate, formatMoney, isIsoDate, todayIn } from "@/lib/utils";
import { ReverseEntryButton } from "@/modules/contabilidad/components/entry-tools";
import { SOURCE_LABELS } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Libro diario" };

const PAGE_SIZE = 20;

type Entry = {
  id: string;
  number: string;
  entry_date: string;
  description: string;
  source_type: string;
  reverses: string | null;
  reversed_by: string | null;
  lines: { id: number; account_code: string; debit: number; credit: number; note: string; account: { name: string } | null }[];
};

export default async function JournalPage({ searchParams }: PageProps<"/contabilidad">) {
  const { supabase, settings, can } = await requireAccess("contabilidad", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);
  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : `${today.slice(0, 7)}-01`;
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : today;
  const source = Object.hasOwn(SOURCE_LABELS, param(sp.origen)) ? param(sp.origen) : "";
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  let query = supabase
    .from("journal_entries")
    .select("id, number, entry_date, description, source_type, reverses, reversed_by, lines:journal_lines(id, account_code, debit, credit, note, account:accounts(name))", { count: "exact" })
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false })
    .order("number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (source) query = query.eq("source_type", source);

  const { data, count } = await query;
  const entries = (data ?? []) as unknown as Entry[];

  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <ExportMenu
          title="Libro diario"
          subtitle={`Del ${formatDate(from)} al ${formatDate(to)}`}
          filename={`libro_diario_${from}_${to}`}
          source={`/api/export/diario${buildQuery({ desde: from, hasta: to, origen: source })}`}
          columns={[
            { key: "asiento", header: "Asiento" },
            { key: "fecha", header: "Fecha", type: "date" },
            { key: "glosa", header: "Glosa", width: 40 },
            { key: "cuenta", header: "Cuenta" },
            { key: "denominacion", header: "Denominación", width: 34 },
            { key: "debe", header: "Debe", type: "money", total: true },
            { key: "haber", header: "Haber", type: "money", total: true },
          ]}
        />
        {can("contabilidad", "create") && (
          <Link href="/contabilidad/asiento" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" />
            Asiento manual
          </Link>
        )}
      </div>

      <Card>
        <FilterBar action="/contabilidad">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
          <Field label="Origen">
            <Select name="origen" defaultValue={source}>
              <option value="">Todos</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>

        {entries.length === 0 ? (
          <EmptyState icon={<BookOpenText className="h-5 w-5" />} title="Sin asientos en este periodo" description="Los asientos se generan solos con cada operación del sistema." />
        ) : (
          <div className="divide-y divide-slate-100">
            {entries.map((e) => {
              const debit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
              return (
                <section key={e.id} className="px-4 py-3">
                  <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="tabular font-mono text-sm font-semibold text-slate-900">{e.number}</span>
                    <span className="tabular text-sm text-slate-500">{formatDate(e.entry_date)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={e.description}>
                      {e.description}
                    </span>
                    <Badge tone={e.source_type === "manual" ? "blue" : "neutral"}>{SOURCE_LABELS[e.source_type] ?? e.source_type}</Badge>
                    {e.reverses && <Badge tone="amber">Extorno</Badge>}
                    {e.reversed_by && <Badge tone="red">Extornado</Badge>}
                    {e.source_type === "manual" && !e.reverses && !e.reversed_by && can("contabilidad", "create") && <ReverseEntryButton entryId={e.id} number={e.number} />}
                  </header>
                  <table className="w-full text-sm">
                    <tbody className="tabular">
                      {[...e.lines]
                        .sort((a, b) => Number(b.debit) - Number(a.debit) || a.id - b.id)
                        .map((l) => (
                          <tr key={l.id}>
                            <td className={`w-full py-0.5 ${Number(l.credit) > 0 ? "pl-8" : ""}`}>
                              <span className="font-mono text-xs text-slate-500">{l.account_code}</span> <span className="text-slate-800">{l.account?.name}</span>
                              {l.note && <span className="text-xs text-slate-500"> · {l.note}</span>}
                            </td>
                            <td className="w-32 whitespace-nowrap py-0.5 text-right text-slate-900">{Number(l.debit) > 0 ? money(l.debit) : ""}</td>
                            <td className="w-32 whitespace-nowrap py-0.5 text-right text-slate-900">{Number(l.credit) > 0 ? money(l.credit) : ""}</td>
                          </tr>
                        ))}
                      <tr className="border-t border-slate-100 text-xs text-slate-500">
                        <td className="pt-1 text-right">Total</td>
                        <td className="pt-1 text-right">{money(debit)}</td>
                        <td className="pt-1 text-right">{money(debit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/contabilidad${buildQuery({ desde: from, hasta: to, origen: source, pagina: p })}`} />
      </Card>
    </>
  );
}
