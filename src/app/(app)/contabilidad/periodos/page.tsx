import type { Metadata } from "next";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, CardHeader, Field, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { formatDateTime, todayIn } from "@/lib/utils";
import { PeriodToggle } from "@/modules/contabilidad/components/entry-tools";

export const metadata: Metadata = { title: "Periodos contables" };

type Period = { period: string; closed_at: string | null; closer: { full_name: string } | null };

const monthName = (period: string) =>
  new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export default async function PeriodsPage({ searchParams }: PageProps<"/contabilidad/periodos">) {
  const { supabase, settings, can } = await requireAccess("contabilidad", "view");
  const state = ["abiertos", "cerrados"].includes(param((await searchParams).estado)) ? param((await searchParams).estado) : "";
  const current = todayIn(settings.timezone).slice(0, 7);

  const [periodsRes, entries] = await Promise.all([
    supabase.from("accounting_periods").select("period, closed_at, closer:profiles!accounting_periods_closed_by_fkey(full_name)"),
    fetchAll<{ period: string }>((a, b) => supabase.from("journal_entries").select("period").order("period").order("id").range(a, b), { max: 200_000 }),
  ]);
  const stored = new Map(((periodsRes.data ?? []) as unknown as Period[]).map((p) => [p.period, p]));
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.period, (counts.get(e.period) ?? 0) + 1);

  // Todos los meses desde el primer asiento hasta el actual
  const first = entries[0]?.period ?? current;
  const months: string[] = [];
  for (let [y, m] = first.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= current; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  months.reverse();
  const shown = months.filter((m) => !state || (state === "cerrados") === Boolean(stored.get(m)?.closed_at));

  return (
    <Card>
      <CardHeader
        title="Periodos contables"
        description="Cerrar un mes impide registrar operaciones con fecha de ese mes: así los libros ya presentados no cambian. El mes en curso siempre está abierto."
        action={
          <ExportMenu
            title="Periodos contables"
            filename="periodos-contables"
            size="sm"
            columns={[
              { key: "periodo", header: "Periodo" },
              { key: "asientos", header: "Asientos", type: "number", total: true },
              { key: "estado", header: "Estado" },
              { key: "cerrado", header: "Cerrado por" },
            ]}
            rows={shown.map((m) => {
              const p = stored.get(m);
              return {
                periodo: monthName(m),
                asientos: counts.get(m) ?? 0,
                estado: m === current ? "En curso" : p?.closed_at ? "Cerrado" : "Abierto",
                cerrado: p?.closed_at ? `${p.closer?.full_name ?? ""} · ${formatDateTime(p.closed_at, settings.timezone)}` : "",
              };
            })}
          />
        }
      />
      <FilterBar action="/contabilidad/periodos">
        <Field label="Estado">
          <Select name="estado" defaultValue={state}>
            <option value="">Todos</option>
            <option value="abiertos">Abiertos</option>
            <option value="cerrados">Cerrados</option>
          </Select>
        </Field>
      </FilterBar>
      <Table>
        <thead>
          <tr>
            <Th>Periodo</Th>
            <Th className="text-right">Asientos</Th>
            <Th>Estado</Th>
            <Th>Cerrado por</Th>
            {can("contabilidad", "edit") && <Th className="w-px" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((period) => {
            const p = stored.get(period);
            const closed = Boolean(p?.closed_at);
            return (
              <tr key={period}>
                <Td className="font-medium capitalize text-slate-900">{monthName(period)}</Td>
                <Td className="tabular text-right">{counts.get(period) ?? 0}</Td>
                <Td>{period === current ? <Badge tone="blue">En curso</Badge> : closed ? <Badge tone="neutral">Cerrado</Badge> : <Badge tone="green">Abierto</Badge>}</Td>
                <Td className="text-slate-500">{closed ? `${p?.closer?.full_name ?? "—"} · ${formatDateTime(p?.closed_at, settings.timezone)}` : "—"}</Td>
                {can("contabilidad", "edit") && <Td className="text-right">{period !== current && <PeriodToggle period={period} label={monthName(period)} closed={closed} />}</Td>}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
