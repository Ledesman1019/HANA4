import type { Metadata } from "next";
import Form from "next/form";
import { ExportMenu } from "@/components/export-menu";
import { param } from "@/components/filters";
import { Button, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { Expense } from "@/modules/finanzas/types";
import { addDays, cn, formatMoney, todayIn } from "@/lib/utils";

export const metadata: Metadata = { title: "Estado de resultados" };

type Day = { total: number; cost: number };

/** Estado de resultados del mes de la sucursal activa. */
export default async function IncomeStatementPage({ searchParams }: PageProps<"/finanzas/resultados">) {
  const { supabase, settings, branch } = await requireAccess("finanzas", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.mes)) ? param(sp.mes) : today.slice(0, 7);
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const to = addDays(nextMonth, -1);

  const [salesRes, expensesRes] = await Promise.all([
    supabase.rpc("report_sales_by_day", { p_from: from, p_to: to, p_branch: branch.id }),
    supabase.from("expenses").select("*").eq("branch_id", branch.id).gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }),
  ]);

  const days = (salesRes.data ?? []) as Day[];
  const expenses = (expensesRes.data ?? []) as Expense[];
  const rate = Number(settings.tax_rate) / 100;

  const grossSales = days.reduce((a, d) => a + Number(d.total), 0);
  const netSales = grossSales / (1 + rate);
  const cogs = days.reduce((a, d) => a + Number(d.cost), 0);
  const grossProfit = netSales - cogs;
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.amount), 0);
  const operating = grossProfit - totalExpenses;

  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const pct = (n: number) => (netSales > 0 ? `${((n / netSales) * 100).toFixed(1)}%` : "—");
  const monthLabel = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));

  const lines: { label: string; value: number; strong?: boolean; negative?: boolean; note?: string }[] = [
    { label: "Ventas brutas (con impuesto)", value: grossSales },
    { label: `(−) ${settings.tax_name} de ventas`, value: grossSales - netSales, negative: true },
    { label: "Ventas netas", value: netSales, strong: true, note: "100%" },
    { label: "(−) Costo de ventas", value: cogs, negative: true, note: pct(cogs) },
    { label: "Utilidad bruta", value: grossProfit, strong: true, note: pct(grossProfit) },
    { label: "(−) Gastos operativos", value: totalExpenses, negative: true, note: pct(totalExpenses) },
    { label: "Resultado operativo", value: operating, strong: true, note: pct(operating) },
  ];

  return (
    <>
      <PageHeader title="Estado de resultados" description={`${branch.name} — ${monthLabel}. Simplificado, antes de impuesto a la renta.`}>
        <Form action="/finanzas/resultados" className="flex items-end gap-2">
          <Field label="Mes">
            <Input type="month" name="mes" defaultValue={month} max={today.slice(0, 7)} required />
          </Field>
          <Button type="submit" variant="secondary">
            Ver
          </Button>
        </Form>
      </PageHeader>

      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader
            title="Estado de resultados"
            description="Simplificado, antes de impuesto a la renta"
            action={
              <ExportMenu
                title="Estado de resultados"
                subtitle={`${branch.name} · ${monthLabel}`}
                filename={`estado_resultados_${month}`}
                size="sm"
                columns={[
                  { key: "concepto", header: "Concepto", width: 38 },
                  { key: "importe", header: "Importe", type: "money" },
                  { key: "porcentaje", header: "% de ventas netas" },
                ]}
                rows={lines.map((l) => ({ concepto: l.label, importe: l.negative ? -l.value : l.value, porcentaje: l.note ?? "" }))}
              />
            }
          />
          <dl className="tabular p-5 text-sm">
            {lines.map((l) => (
              <div key={l.label} className={cn("flex items-baseline justify-between gap-4 py-2", l.strong && "border-t border-slate-200 font-semibold text-slate-900", !l.strong && "text-slate-600")}>
                <dt>{l.label}</dt>
                <dd className="flex items-baseline gap-3">
                  {l.note && <span className="w-14 text-right text-xs font-normal text-slate-500">{l.note}</span>}
                  <span className={cn("w-32 text-right", l.strong && l.value < 0 && "text-red-700")}>{l.negative ? `(${money(l.value)})` : money(l.value)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
