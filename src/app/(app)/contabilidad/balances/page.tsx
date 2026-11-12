import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Card, CardHeader, EmptyState, Field, Input, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { cn, formatDate, formatMoney, isIsoDate, round2, todayIn } from "@/lib/utils";
import { debitNature, type TrialRow } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Balances" };

export default async function BalancesPage({ searchParams }: PageProps<"/contabilidad/balances">) {
  const { supabase, settings } = await requireAccess("contabilidad", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);
  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : `${today.slice(0, 4)}-01-01`;
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : today;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const { data } = await supabase.rpc("trial_balance", { p_from: from, p_to: to });
  const rows = ((data ?? []) as TrialRow[]).map((r) => ({ ...r, opening: Number(r.opening), debit: Number(r.debit), credit: Number(r.credit), closing: Number(r.closing) }));

  // Balance de comprobación: saldos finales en columnas deudor / acreedor
  const totals = rows.reduce(
    (t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit, dr: t.dr + Math.max(r.closing, 0), cr: t.cr + Math.max(-r.closing, 0) }),
    { debit: 0, credit: 0, dr: 0, cr: 0 },
  );

  // Estado de resultados: movimientos del rango en cuentas de ingreso y gasto
  const period = (r: TrialRow) => r.credit - r.debit; // positivo = ingreso
  const sales = rows.filter((r) => r.code.startsWith("70")).reduce((s, r) => s + period(r), 0);
  const cost = -rows.filter((r) => r.code.startsWith("69")).reduce((s, r) => s + period(r), 0);
  const expenses = rows.filter((r) => r.type === "gasto" && !r.code.startsWith("69"));
  const otherIncome = rows.filter((r) => r.type === "ingreso" && !r.code.startsWith("70")).reduce((s, r) => s + period(r), 0);
  const totalExpenses = -expenses.reduce((s, r) => s + period(r), 0);
  const gross = sales - cost;
  const operating = gross - totalExpenses + otherIncome;

  // Situación financiera al cierre del rango (saldos acumulados)
  const sumType = (type: string) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.closing, 0);
  const assets = sumType("activo");
  const liabilities = -sumType("pasivo");
  const equity = -sumType("patrimonio");
  const result = -(sumType("ingreso") + sumType("gasto"));
  const balanced = Math.abs(round2(assets - liabilities - equity - result)) < 0.01;

  const line = (label: string, value: number, strong = false, indent = false) => (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", strong ? "border-t border-slate-200 font-semibold text-slate-900" : "text-slate-600", indent && "pl-4")}>
      <dt>{label}</dt>
      <dd className={cn("tabular", strong && value < 0 && "text-red-600")}>{money(value)}</dd>
    </div>
  );

  return (
    <>
      <Card className="mb-6">
        <FilterBar action="/contabilidad/balances">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
        </FilterBar>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Sin movimientos contables" description="Cambia el rango de fechas." />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Estado de resultados" description={`Del ${formatDate(from)} al ${formatDate(to)}`} />
              <dl className="p-5 text-sm">
                {line("Ventas netas", sales)}
                {line("(−) Costo de ventas", -cost)}
                {line("Utilidad bruta", gross, true)}
                {expenses
                  .filter((r) => r.debit - r.credit !== 0)
                  .map((r) => (
                    <div key={r.code}>{line(`(−) ${r.name}`, period(r), false, true)}</div>
                  ))}
                {otherIncome !== 0 && line("(+) Otros ingresos de gestión", otherIncome)}
                {line("Resultado del periodo", operating, true)}
              </dl>
            </Card>

            <Card>
              <CardHeader
                title="Situación financiera"
                description={`Al ${formatDate(to)}`}
                action={
                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium", balanced ? "text-emerald-700" : "text-red-600")}>
                    {balanced ? <CircleCheck className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                    {balanced ? "Cuadra" : "No cuadra"}
                  </span>
                }
              />
              <dl className="p-5 text-sm">
                {rows
                  .filter((r) => r.type === "activo" && r.closing !== 0)
                  .map((r) => (
                    <div key={r.code}>{line(r.name, r.closing, false, true)}</div>
                  ))}
                {line("Total activo", assets, true)}
                {rows
                  .filter((r) => r.type === "pasivo" && r.closing !== 0)
                  .map((r) => (
                    <div key={r.code}>{line(r.name, -r.closing, false, true)}</div>
                  ))}
                {line("Total pasivo", liabilities, true)}
                {rows
                  .filter((r) => r.type === "patrimonio" && r.closing !== 0)
                  .map((r) => (
                    <div key={r.code}>{line(r.name, -r.closing, false, true)}</div>
                  ))}
                {line("Resultados acumulados del ejercicio", result, false, true)}
                {line("Total pasivo y patrimonio", liabilities + equity + result, true)}
              </dl>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Balance de comprobación"
              description={`Movimientos del ${formatDate(from)} al ${formatDate(to)} y saldos acumulados`}
              action={
                <ExportMenu
                  title="Balance de comprobación"
                  subtitle={`Del ${formatDate(from)} al ${formatDate(to)}`}
                  filename={`balance_comprobacion_${from}_${to}`}
                  size="sm"
                  columns={[
                    { key: "cuenta", header: "Cuenta" },
                    { key: "denominacion", header: "Denominación", width: 40 },
                    { key: "inicial", header: "Saldo inicial", type: "money" },
                    { key: "debe", header: "Debe", type: "money", total: true },
                    { key: "haber", header: "Haber", type: "money", total: true },
                    { key: "deudor", header: "Saldo deudor", type: "money", total: true },
                    { key: "acreedor", header: "Saldo acreedor", type: "money", total: true },
                  ]}
                  rows={rows.map((r) => ({
                    cuenta: r.code,
                    denominacion: r.name,
                    inicial: r.opening,
                    debe: r.debit,
                    haber: r.credit,
                    deudor: r.closing > 0 ? r.closing : null,
                    acreedor: r.closing < 0 ? -r.closing : null,
                  }))}
                />
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Cuenta</Th>
                  <Th className="text-right">Saldo inicial</Th>
                  <Th className="text-right">Debe</Th>
                  <Th className="text-right">Haber</Th>
                  <Th className="text-right">Saldo deudor</Th>
                  <Th className="text-right">Saldo acreedor</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.map((r) => (
                  <tr key={r.code} className="transition-colors hover:bg-slate-50/70">
                    <Td>
                      <Link href={`/contabilidad/mayor?cuenta=${r.code}&desde=${from}&hasta=${to}`} className="hover:underline">
                        <span className="font-mono text-xs text-slate-500">{r.code}</span> <span className="text-slate-900">{r.name}</span>
                      </Link>
                      {debitNature(r.type) !== r.closing >= 0 && r.closing !== 0 && <span className="ml-2 text-xs text-amber-700">saldo contrario</span>}
                    </Td>
                    <Td className="text-right text-slate-500">{r.opening ? money(r.opening) : "—"}</Td>
                    <Td className="text-right">{r.debit ? money(r.debit) : "—"}</Td>
                    <Td className="text-right">{r.credit ? money(r.credit) : "—"}</Td>
                    <Td className="text-right font-medium text-slate-900">{r.closing > 0 ? money(r.closing) : ""}</Td>
                    <Td className="text-right font-medium text-slate-900">{r.closing < 0 ? money(-r.closing) : ""}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="tabular font-semibold text-slate-900">
                  <Td>Totales</Td>
                  <Td />
                  <Td className="text-right">{money(totals.debit)}</Td>
                  <Td className="text-right">{money(totals.credit)}</Td>
                  <Td className="text-right">{money(totals.dr)}</Td>
                  <Td className="text-right">{money(totals.cr)}</Td>
                </tr>
              </tfoot>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
