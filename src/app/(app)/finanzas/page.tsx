import type { Metadata } from "next";
import Form from "next/form";
import { param } from "@/components/filters";
import { BarList } from "@/components/charts";
import { Button, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { EXPENSE_LABELS, type Expense } from "@/modules/finanzas/types";
import { addDays, formatMoney, todayIn } from "@/lib/utils";
import { ExpensesView } from "@/modules/finanzas/components/expenses-view";

export const metadata: Metadata = { title: "Gastos" };

export default async function FinancePage({ searchParams }: PageProps<"/finanzas">) {
  const { supabase, settings, branch, branches } = await requireAccess("finanzas", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(param(sp.mes)) ? param(sp.mes) : today.slice(0, 7);
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const to = addDays(nextMonth, -1);

  const [expensesRes, centersRes] = await Promise.all([
    supabase.from("expenses").select("*").eq("branch_id", branch.id).gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: false }),
    supabase.from("cost_centers").select("id, code, name").eq("active", true).order("code"),
  ]);

  const expenses = (expensesRes.data ?? []) as Expense[];
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.amount), 0);

  const byCategory = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount);
      return acc;
    }, {}),
  )
    .map(([category, value]) => ({ label: EXPENSE_LABELS[category] ?? category, value }))
    .sort((a, b) => b.value - a.value);

  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const monthLabel = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));

  return (
    <>
      <PageHeader title="Gastos" description={`Gastos operativos de ${branch.name} — ${monthLabel}. Cada gasto genera su asiento con su centro de costo.`}>
        <Form action="/finanzas" className="flex items-end gap-2">
          <Field label="Mes">
            <Input type="month" name="mes" defaultValue={month} max={today.slice(0, 7)} required />
          </Field>
          <Button type="submit" variant="secondary">
            Ver
          </Button>
        </Form>
      </PageHeader>

      <div className="mb-6">
        <Card>
          <CardHeader title="Gastos por categoría" description={`Total: ${money(totalExpenses)}`} />
          <div className="p-5">
            <BarList items={byCategory} emptyText="Sin gastos registrados este mes" />
          </div>
        </Card>
      </div>

      <ExpensesView
        rows={expenses}
        branchId={branch.id}
        branches={branches.map((b) => ({ value: b.id, label: b.name }))}
        costCenters={((centersRes.data ?? []) as { id: string; code: string; name: string }[]).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        defaultDate={today.startsWith(month) ? today : from}
        startNew={param(sp.nuevo) === "1"}
      />
    </>
  );
}
