import type { Metadata } from "next";
import Form from "next/form";
import { Banknote, HandCoins, Palmtree, Users } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { param } from "@/components/filters";
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import type { Employee } from "@/modules/rrhh/types";
import { formatMoney, todayIn, zonedDayStart } from "@/lib/utils";
import { EmployeesView } from "@/modules/rrhh/components/employees-view";

export const metadata: Metadata = { title: "Personal" };

type CommissionRow = { employee_id: string; base: number; amount: number };

export default async function HrPage({ searchParams }: PageProps<"/rrhh">) {
  const { supabase, settings, branches } = await requireAccess("rrhh", "view");
  const sp = await searchParams;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  // Mes de las comisiones
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.mes)) ? param(sp.mes) : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const monthLabel = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));

  const [employeesRes, usersRes, commissions] = await Promise.all([
    supabase.from("employees").select("*").order("full_name").limit(1000),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
    // Cada venta completada del mes generó la comisión de su vendedor
    fetchAll<CommissionRow>((a, b) =>
      supabase
        .from("commissions")
        .select("employee_id, base, amount")
        .eq("status", "generada")
        .gte("created_at", zonedDayStart(from, tz))
        .lt("created_at", zonedDayStart(next, tz))
        .order("created_at")
        .range(a, b),
    ),
  ]);
  const employees = (employeesRes.data ?? []) as Employee[];
  const users = (usersRes.data ?? []) as { id: string; full_name: string; email: string }[];

  const onPayroll = employees.filter((e) => e.status !== "cesado");
  const payroll = onPayroll.reduce((sum, e) => sum + Number(e.salary), 0);

  const bySeller = new Map<string, { sales: number; base: number; amount: number }>();
  for (const c of commissions) {
    const row = bySeller.get(c.employee_id) ?? { sales: 0, base: 0, amount: 0 };
    row.sales += 1;
    row.base += Number(c.base);
    row.amount += Number(c.amount);
    bySeller.set(c.employee_id, row);
  }
  const sellers = [...bySeller.entries()]
    .map(([id, totals]) => ({ employee: employees.find((e) => e.id === id), ...totals }))
    .filter((s) => s.employee)
    .sort((a, b) => b.amount - a.amount);
  const totalCommission = sellers.reduce((sum, s) => sum + s.amount, 0);
  const withRate = employees.filter((e) => Number(e.commission_rate) > 0 && e.profile_id && e.status !== "cesado").length;

  return (
    <>
      <PageHeader title="Personal" description="Colaboradores, planilla mensual y comisiones generadas por las ventas." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Colaboradores en planilla" value={String(onPayroll.length)} icon={<Users className="h-4 w-4" />} hint={`${employees.filter((e) => e.status === "activo").length} activos hoy`} />
        <StatCard
          label="De vacaciones o licencia"
          value={String(employees.filter((e) => e.status === "vacaciones" || e.status === "licencia").length)}
          icon={<Palmtree className="h-4 w-4" />}
          tone="amber"
        />
        <StatCard label="Planilla mensual" value={money(payroll)} icon={<Banknote className="h-4 w-4" />} tone="slate" hint="Suma de sueldos brutos" />
        <StatCard label={`Comisiones de ${monthLabel}`} value={money(totalCommission)} icon={<HandCoins className="h-4 w-4" />} tone="green" hint={`${commissions.length} ventas con comisión`} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Comisiones por ventas"
          description={`Se calculan solas: cada venta completada genera la comisión de quien la vendió; si se anula, la comisión también. ${monthLabel}.`}
          action={
            <div className="flex flex-wrap items-end gap-2">
              <Form action="/rrhh" className="flex items-end gap-2">
                <Field label="Mes">
                  <Input type="month" name="mes" defaultValue={month} max={today.slice(0, 7)} required className="h-8" />
                </Field>
                <Button type="submit" variant="secondary" size="sm">
                  Ver
                </Button>
              </Form>
              <ExportMenu
                title="Comisiones por ventas"
                subtitle={monthLabel}
                filename={`comisiones_${month}`}
                size="sm"
                columns={[
                  { key: "colaborador", header: "Colaborador" },
                  { key: "cargo", header: "Cargo" },
                  { key: "ventas", header: "Ventas", type: "number", total: true },
                  { key: "base", header: "Venta neta", type: "money", total: true },
                  { key: "tasa", header: "Comisión %", type: "number" },
                  { key: "comision", header: "Comisión", type: "money", total: true },
                  { key: "sueldo", header: "Sueldo", type: "money", total: true },
                  { key: "total", header: "Total a pagar", type: "money", total: true },
                ]}
                rows={sellers.map((s) => ({
                  colaborador: s.employee!.full_name,
                  cargo: s.employee!.position,
                  ventas: s.sales,
                  base: s.base,
                  tasa: Number(s.employee!.commission_rate),
                  comision: s.amount,
                  sueldo: Number(s.employee!.salary),
                  total: Number(s.employee!.salary) + s.amount,
                }))}
              />
            </div>
          }
        />
        {sellers.length === 0 ? (
          <EmptyState
            icon={<HandCoins className="h-5 w-5" />}
            title="Sin comisiones en este mes"
            description={
              withRate === 0
                ? "Para activarlas, edita a un colaborador: vincúlalo con su usuario del sistema y asígnale un porcentaje de comisión. Desde entonces, cada venta suya la genera."
                : "Los colaboradores con comisión aún no registran ventas en este mes."
            }
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
                <Th className="text-right">Sueldo</Th>
                <Th className="text-right">Total a pagar</Th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.employee!.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{s.employee!.full_name}</p>
                    <p className="text-xs text-slate-500">{s.employee!.position}</p>
                  </Td>
                  <Td className="tabular text-right">{s.sales}</Td>
                  <Td className="tabular text-right">{money(s.base)}</Td>
                  <Td className="tabular text-right">{Number(s.employee!.commission_rate)}%</Td>
                  <Td className="tabular text-right font-medium text-emerald-700">{money(s.amount)}</Td>
                  <Td className="tabular text-right">{money(Number(s.employee!.salary))}</Td>
                  <Td className="tabular text-right font-semibold text-slate-900">{money(Number(s.employee!.salary) + s.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <EmployeesView
        rows={employees}
        branches={branches.map((b) => ({ value: b.id, label: b.name }))}
        users={users.map((u) => ({ value: u.id, label: `${u.full_name} · ${u.email}` }))}
        today={today}
      />
    </>
  );
}
