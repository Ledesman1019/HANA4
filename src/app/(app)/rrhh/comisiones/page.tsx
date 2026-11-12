import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Card, EmptyState, Field, Input, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import type { Employee } from "@/modules/rrhh/types";
import { formatMoney, todayIn, zonedDayStart } from "@/lib/utils";

export const metadata: Metadata = { title: "Comisiones" };

type CommissionRow = { employee_id: string; base: number; amount: number; payroll_id: string | null };

/** Comisiones generadas por las ventas del mes, por colaborador. */
export default async function CommissionsPage({ searchParams }: PageProps<"/rrhh/comisiones">) {
  const { supabase, settings } = await requireAccess("rrhh", "view");
  const sp = await searchParams;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.mes)) ? param(sp.mes) : today.slice(0, 7);
  const q = param(sp.q).trim().toLowerCase().slice(0, 40);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const monthLabel = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));

  const [employeesRes, commissions] = await Promise.all([
    supabase.from("employees").select("*").order("full_name").limit(1000),
    fetchAll<CommissionRow>((a, b) =>
      supabase
        .from("commissions")
        .select("employee_id, base, amount, payroll_id")
        .eq("status", "generada")
        .gte("created_at", zonedDayStart(from, tz))
        .lt("created_at", zonedDayStart(next, tz))
        .order("created_at")
        .range(a, b),
    ),
  ]);
  const employees = (employeesRes.data ?? []) as Employee[];

  const bySeller = new Map<string, { sales: number; base: number; amount: number; paid: number }>();
  for (const c of commissions) {
    const row = bySeller.get(c.employee_id) ?? { sales: 0, base: 0, amount: 0, paid: 0 };
    row.sales += 1;
    row.base += Number(c.base);
    row.amount += Number(c.amount);
    if (c.payroll_id) row.paid += Number(c.amount);
    bySeller.set(c.employee_id, row);
  }
  const sellers = [...bySeller.entries()]
    .map(([id, totals]) => ({ employee: employees.find((e) => e.id === id)!, ...totals }))
    .filter((s) => s.employee && (!q || s.employee.full_name.toLowerCase().includes(q) || s.employee.doc_number.includes(q)))
    .sort((a, b) => b.amount - a.amount);
  const total = sellers.reduce((sum, s) => sum + s.amount, 0);
  const pending = sellers.reduce((sum, s) => sum + s.amount - s.paid, 0);

  return (
    <>
      <PageHeader title="Comisiones por ventas" description={`Se generan solas con cada venta completada y se anulan si la venta se anula. ${monthLabel}.`}>
        <ExportMenu
          title="Comisiones por ventas"
          subtitle={monthLabel}
          filename={`comisiones_${month}`}
          columns={[
            { key: "colaborador", header: "Colaborador" },
            { key: "cargo", header: "Cargo" },
            { key: "ventas", header: "Ventas", type: "number", total: true },
            { key: "base", header: "Venta neta", type: "money", total: true },
            { key: "tasa", header: "Comisión %", type: "number" },
            { key: "comision", header: "Comisión", type: "money", total: true },
            { key: "pagada", header: "Pagada en planilla", type: "money", total: true },
            { key: "pendiente", header: "Por pagar", type: "money", total: true },
          ]}
          rows={sellers.map((s) => ({
            colaborador: s.employee.full_name,
            cargo: s.employee.position,
            ventas: s.sales,
            base: s.base,
            tasa: Number(s.employee.commission_rate),
            comision: s.amount,
            pagada: s.paid,
            pendiente: s.amount - s.paid,
          }))}
        />
      </PageHeader>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label={`Comisiones de ${monthLabel}`} value={money(total)} icon={<HandCoins className="h-4 w-4" />} tone="green" hint={`${commissions.length} ventas con comisión`} />
        <StatCard label="Pagadas en planilla" value={money(total - pending)} icon={<HandCoins className="h-4 w-4" />} tone="slate" />
        <StatCard label="Por pagar" value={money(pending)} icon={<HandCoins className="h-4 w-4" />} tone="amber" />
      </div>
      <Card>
        <FilterBar action="/rrhh/comisiones">
          <Field label="Mes">
            <Input type="month" name="mes" defaultValue={month} max={today.slice(0, 7)} />
          </Field>
          <Field label="Colaborador">
            <Input type="search" name="q" defaultValue={q} placeholder="Nombre o documento" />
          </Field>
        </FilterBar>
        {sellers.length === 0 ? (
          <EmptyState
            icon={<HandCoins className="h-5 w-5" />}
            title="Sin comisiones"
            description="Para activarlas, vincula al colaborador con su usuario del sistema y asígnale un porcentaje. Desde entonces, cada venta suya la genera."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Colaborador</Th>
                <Th className="text-right">Ventas</Th>
                <Th className="text-right">Venta neta</Th>
                <Th className="text-right">%</Th>
                <Th className="text-right">Comisión</Th>
                <Th className="text-right">Pagada</Th>
                <Th className="text-right">Por pagar</Th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.employee.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{s.employee.full_name}</p>
                    <p className="text-xs text-slate-500">{s.employee.position}</p>
                  </Td>
                  <Td className="tabular text-right">{s.sales}</Td>
                  <Td className="tabular text-right">{money(s.base)}</Td>
                  <Td className="tabular text-right">{Number(s.employee.commission_rate)}%</Td>
                  <Td className="tabular text-right font-medium text-emerald-700">{money(s.amount)}</Td>
                  <Td className="tabular text-right">{money(s.paid)}</Td>
                  <Td className="tabular text-right font-semibold text-slate-900">{money(s.amount - s.paid)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
