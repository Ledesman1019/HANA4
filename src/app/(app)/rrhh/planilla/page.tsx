import type { Metadata } from "next";
import { Banknote, History } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { buildQuery, FilterBar, param } from "@/components/filters";
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import type { Employee } from "@/modules/rrhh/types";
import { formatDate, formatMoney, todayIn, zonedDayStart } from "@/lib/utils";
import { PayrollForm, VoidPayrollButton, type PayrollLine } from "@/modules/rrhh/components/payroll";

export const metadata: Metadata = { title: "Pago de planilla" };

type Payment = {
  id: string;
  number: string;
  employee_id: string;
  salary: number;
  commissions: number;
  total: number;
  method: string;
  paid_at: string;
  status: "pagado" | "anulado";
  void_reason: string | null;
  employee: { full_name: string } | null;
};

/** Pago mensual de sueldos y comisiones, con su asiento contable. */
export default async function PayrollPage({ searchParams }: PageProps<"/rrhh/planilla">) {
  const { supabase, settings, can } = await requireAccess("rrhh", "view");
  const sp = await searchParams;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.periodo)) && param(sp.periodo) <= today.slice(0, 7) ? param(sp.periodo) : today.slice(0, 7);
  const [y, m] = period.split("-").map(Number);
  const from = `${period}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [employeesRes, paymentsRes, commissions] = await Promise.all([
    supabase.from("employees").select("*").neq("status", "cesado").order("full_name").limit(1000),
    supabase
      .from("payroll_payments")
      .select("id, number, employee_id, salary, commissions, total, method, paid_at, status, void_reason, employee:employees(full_name)")
      .eq("period", period)
      .order("created_at", { ascending: false }),
    fetchAll<{ employee_id: string; amount: number }>((a, b) =>
      supabase
        .from("commissions")
        .select("employee_id, amount")
        .eq("status", "generada")
        .is("payroll_id", null)
        .gte("created_at", zonedDayStart(from, tz))
        .lt("created_at", zonedDayStart(next, tz))
        .range(a, b),
    ),
  ]);
  const employees = (employeesRes.data ?? []) as Employee[];
  const payments = (paymentsRes.data ?? []) as unknown as Payment[];
  const paidBy = new Map(payments.filter((p) => p.status === "pagado").map((p) => [p.employee_id, p]));
  const pendingCommission = new Map<string, number>();
  for (const c of commissions) pendingCommission.set(c.employee_id, (pendingCommission.get(c.employee_id) ?? 0) + Number(c.amount));

  const lines: PayrollLine[] = employees.map((e) => {
    const paid = paidBy.get(e.id);
    return {
      employeeId: e.id,
      name: e.full_name,
      position: e.position,
      salary: paid ? Number(paid.salary) : Number(e.salary),
      commissions: paid ? Number(paid.commissions) : (pendingCommission.get(e.id) ?? 0),
      paid: paid?.number ?? null,
    };
  });
  const paidTotal = payments.filter((p) => p.status === "pagado").reduce((sum, p) => sum + Number(p.total), 0);
  const pendingTotal = lines.filter((l) => !l.paid).reduce((sum, l) => sum + l.salary + l.commissions, 0);

  return (
    <>
      <PageHeader title="Pago de planilla" description="Sueldos y comisiones del mes. Cada pago genera su asiento contable y su constancia en la auditoría.">
        <ExportMenu
          title="Pagos de planilla"
          subtitle={period}
          filename={`planilla_${period}`}
          source={`/api/export/planilla${buildQuery({ periodo: period })}`}
          columns={[
            { key: "numero", header: "Pago" },
            { key: "periodo", header: "Periodo" },
            { key: "colaborador", header: "Colaborador" },
            { key: "documento", header: "Documento" },
            { key: "fecha", header: "Fecha", type: "date" },
            { key: "medio", header: "Medio" },
            { key: "estado", header: "Estado" },
            { key: "sueldo", header: "Sueldo", type: "money", total: true },
            { key: "comisiones", header: "Comisiones", type: "money", total: true },
            { key: "total", header: "Total", type: "money", total: true },
          ]}
        />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Pagado en el mes" value={money(paidTotal)} icon={<Banknote className="h-4 w-4" />} tone="green" hint={`${paidBy.size} colaboradores`} />
        <StatCard label="Por pagar" value={money(pendingTotal)} icon={<Banknote className="h-4 w-4" />} tone="amber" hint={`${lines.filter((l) => !l.paid).length} colaboradores`} />
        <StatCard label="Colaboradores en planilla" value={String(employees.length)} icon={<Banknote className="h-4 w-4" />} tone="slate" />
      </div>

      <Card className="mb-6">
        <FilterBar action="/rrhh/planilla">
          <Field label="Periodo">
            <Input type="month" name="periodo" defaultValue={period} max={today.slice(0, 7)} />
          </Field>
        </FilterBar>
      </Card>

      <PayrollForm key={period} period={period} lines={lines} today={today} canPay={can("rrhh", "create")} />

      <Card className="mt-6">
        <CardHeader title="Pagos registrados" description={`Constancias del periodo ${period}, incluidas las anuladas.`} />
        {payments.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="Aún no hay pagos en este periodo" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pago</Th>
                <Th>Colaborador</Th>
                <Th>Fecha</Th>
                <Th>Medio</Th>
                <Th className="text-right">Total</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td className="tabular font-medium text-slate-900">{p.number}</Td>
                  <Td>{p.employee?.full_name ?? "—"}</Td>
                  <Td className="tabular">{formatDate(p.paid_at)}</Td>
                  <Td>{p.method === "efectivo" ? "Efectivo" : "Transferencia"}</Td>
                  <Td className="tabular text-right font-medium">{money(Number(p.total))}</Td>
                  <Td>
                    {p.status === "pagado" ? (
                      <Badge tone="green">Pagado</Badge>
                    ) : (
                      <span title={p.void_reason ?? undefined}>
                        <Badge tone="neutral">Anulado</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">{p.status === "pagado" && can("rrhh", "delete") && <VoidPayrollButton id={p.id} number={p.number} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
