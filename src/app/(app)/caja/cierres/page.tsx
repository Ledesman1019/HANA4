import type { Metadata } from "next";
import { History } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, FilterBar, Pagination, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { CashSession } from "@/modules/caja/types";
import { addDays, formatDateTime, formatMoney, isIsoDate, todayIn, zonedDayStart } from "@/lib/utils";

export const metadata: Metadata = { title: "Cierres de caja" };

const PAGE_SIZE = 25;
type Row = CashSession & { opener: { full_name: string } | null; branch: { name: string } | null };

/** Historial de arqueos (cierres Z). Quien solo cobra ve los suyos; quien supervisa, todos. */
export default async function CashClosuresPage({ searchParams }: PageProps<"/caja/cierres">) {
  const { supabase, settings, userId, can } = await requireAccess("caja");
  const sp = await searchParams;
  const tz = settings.timezone;
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : todayIn(tz);
  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : todayIn(tz, -29);
  const result = param(sp.resultado);
  const page = Math.max(1, Number.parseInt(param(sp.pagina), 10) || 1);
  const money = (n: number | null) => formatMoney(n, settings.currency_symbol);
  const seesAll = can("caja", "view");

  let query = supabase
    .from("cash_sessions")
    .select("*, opener:profiles!cash_sessions_opened_by_fkey(full_name), branch:branches(name)", { count: "exact" })
    .eq("status", "cerrada")
    .gte("closed_at", zonedDayStart(from, tz))
    .lt("closed_at", zonedDayStart(addDays(to, 1), tz))
    .order("closed_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (!seesAll) query = query.eq("opened_by", userId);
  if (result === "cuadrado") query = query.eq("difference", 0);
  else if (result === "faltante") query = query.lt("difference", 0);
  else if (result === "sobrante") query = query.gt("difference", 0);
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader title="Cierres de caja (histórico)" description={seesAll ? "Arqueos de todas las cajas con su diferencia." : "Tus arqueos con su diferencia."}>
        <ExportMenu
          title="Cierres de caja"
          subtitle={`${from} a ${to}`}
          filename="cierres-de-caja"
          source={`/api/export/cierres${buildQuery({ desde: from, hasta: to })}`}
          columns={[
            { key: "cajero", header: "Cajero" },
            { key: "sucursal", header: "Sucursal" },
            { key: "apertura", header: "Apertura" },
            { key: "cierre", header: "Cierre" },
            { key: "fondo", header: "Fondo inicial", type: "money" },
            { key: "esperado", header: "Esperado", type: "money", total: true },
            { key: "contado", header: "Contado", type: "money", total: true },
            { key: "diferencia", header: "Diferencia", type: "money", total: true },
            { key: "nota", header: "Nota" },
          ]}
        />
      </PageHeader>
      <Card>
        <FilterBar action="/caja/cierres">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} max={to} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
          <Field label="Resultado">
            <Select name="resultado" defaultValue={result}>
              <option value="">Todos</option>
              <option value="cuadrado">Cuadrados</option>
              <option value="faltante">Con faltante</option>
              <option value="sobrante">Con sobrante</option>
            </Select>
          </Field>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="Sin cierres en este periodo" description="Ajusta las fechas o el resultado." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cierre</Th>
                <Th>Cajero</Th>
                <Th>Sucursal</Th>
                <Th className="text-right">Fondo</Th>
                <Th className="text-right">Esperado</Th>
                <Th className="text-right">Contado</Th>
                <Th className="text-right">Diferencia</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const diff = Number(s.difference ?? 0);
                return (
                  <tr key={s.id}>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(s.closed_at, tz)}</Td>
                    <Td>{s.opener?.full_name ?? "—"}</Td>
                    <Td>{s.branch?.name ?? "—"}</Td>
                    <Td className="tabular text-right">{money(s.opening_amount)}</Td>
                    <Td className="tabular text-right">{money(s.expected_amount)}</Td>
                    <Td className="tabular text-right">{money(s.counted_amount)}</Td>
                    <Td className="text-right">
                      <Badge tone={diff === 0 ? "green" : diff > 0 ? "amber" : "red"}>{diff === 0 ? "Cuadrado" : `${diff > 0 ? "+" : "−"} ${money(Math.abs(diff))}`}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} hrefFor={(p) => `/caja/cierres${buildQuery({ desde: from, hasta: to, resultado: result, pagina: p })}`} />
      </Card>
    </>
  );
}
