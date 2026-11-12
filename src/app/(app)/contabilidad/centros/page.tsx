import type { Metadata } from "next";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Card, CardHeader, EmptyState, Field, Input, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { cn, formatDate, formatMoney, isIsoDate, todayIn } from "@/lib/utils";
import { CostCentersView, type CostCenter } from "@/modules/contabilidad/components/cost-centers-view";

export const metadata: Metadata = { title: "Centros de costo" };

type Row = { branch_id: string | null; cost_center_id: string | null; account_code: string; type: string; amount: number };

export default async function CostCentersPage({ searchParams }: PageProps<"/contabilidad/centros">) {
  const { supabase, settings, branches } = await requireAccess("contabilidad", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);
  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : `${today.slice(0, 7)}-01`;
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : today;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const [reportRes, centersRes] = await Promise.all([
    supabase.rpc("cost_center_report", { p_from: from, p_to: to }),
    supabase.from("cost_centers").select("id, code, name, active").order("code"),
  ]);
  const rows = ((reportRes.data ?? []) as Row[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  const centers = (centersRes.data ?? []) as CostCenter[];

  // Columnas: cada sucursal (centro de beneficio) y, si hay, lo que no tiene sucursal
  const columns = [...branches.map((b) => ({ id: b.id as string | null, name: b.name })), ...(rows.some((r) => !r.branch_id) ? [{ id: null, name: "Empresa" }] : [])];
  const pick = (branch: string | null, test: (r: Row) => boolean) => rows.filter((r) => r.branch_id === branch && test(r)).reduce((s, r) => s + r.amount, 0);

  // Resultado por sucursal (ingreso = haber − debe; gasto = debe − haber)
  const lines = [
    { label: "Ventas netas", test: (r: Row) => r.account_code.startsWith("70"), sign: -1 },
    { label: "(−) Costo de ventas", test: (r: Row) => r.account_code.startsWith("69"), sign: 1 },
    { label: "(−) Gastos de operación", test: (r: Row) => r.type === "gasto" && !r.account_code.startsWith("69"), sign: 1 },
    { label: "(+) Otros ingresos", test: (r: Row) => r.type === "ingreso" && !r.account_code.startsWith("70"), sign: -1 },
  ];
  const result = (branch: string | null) => -rows.filter((r) => r.branch_id === branch).reduce((s, r) => s + r.amount, 0);

  // Gasto por centro de costo y sucursal
  const expenseRows = rows.filter((r) => r.type === "gasto");
  const centerRows = [...centers.map((c) => ({ id: c.id as string | null, label: `${c.code} · ${c.name}` })), ...(expenseRows.some((r) => !r.cost_center_id) ? [{ id: null, label: "Sin centro de costo" }] : [])];
  const spend = (center: string | null, branch: string | null | "all") =>
    expenseRows.filter((r) => r.cost_center_id === center && (branch === "all" || r.branch_id === branch)).reduce((s, r) => s + r.amount, 0);
  const totalSpend = expenseRows.reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <Card className="mb-6">
        <FilterBar action="/contabilidad/centros">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
        </FilterBar>
      </Card>

      {rows.length === 0 ? (
        <Card className="mb-6">
          <EmptyState title="Sin movimientos en el periodo" description="Cambia el rango de fechas." />
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader
              title="Resultado por sucursal"
              description={`Cada sucursal como centro de beneficio · del ${formatDate(from)} al ${formatDate(to)}`}
              action={
                <ExportMenu
                  title="Resultado por sucursal"
                  subtitle={`Del ${formatDate(from)} al ${formatDate(to)}`}
                  filename={`resultado_sucursales_${from}_${to}`}
                  size="sm"
                  columns={[{ key: "concepto", header: "Concepto", width: 28 }, ...columns.map((c, i) => ({ key: `b${i}`, header: c.name, type: "money" as const }))]}
                  rows={[
                    ...lines.map((l) => ({ concepto: l.label, ...Object.fromEntries(columns.map((c, i) => [`b${i}`, l.sign * pick(c.id, l.test)])) })),
                    { concepto: "Resultado", ...Object.fromEntries(columns.map((c, i) => [`b${i}`, result(c.id)])) },
                  ]}
                />
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Concepto</Th>
                  {columns.map((c) => (
                    <Th key={c.id ?? "empresa"} className="text-right">
                      {c.name}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {lines.map((l) => (
                  <tr key={l.label}>
                    <Td className="text-slate-700">{l.label}</Td>
                    {columns.map((c) => (
                      <Td key={c.id ?? "empresa"} className="text-right">
                        {money(l.sign * pick(c.id, l.test))}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="tabular font-semibold text-slate-900">
                  <Td>Resultado</Td>
                  {columns.map((c) => (
                    <Td key={c.id ?? "empresa"} className={cn("text-right", result(c.id) < 0 && "text-red-600")}>
                      {money(result(c.id))}
                    </Td>
                  ))}
                </tr>
              </tfoot>
            </Table>
          </Card>

          <Card className="mb-6">
            <CardHeader title="Gasto por centro de costo" description="Costo de ventas, gastos de operación, mermas y comisiones según el área que los generó" />
            <Table>
              <thead>
                <tr>
                  <Th>Centro de costo</Th>
                  {columns.map((c) => (
                    <Th key={c.id ?? "empresa"} className="text-right">
                      {c.name}
                    </Th>
                  ))}
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">%</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {centerRows
                  .filter((c) => spend(c.id, "all") !== 0)
                  .map((c) => (
                    <tr key={c.id ?? "none"}>
                      <Td className="text-slate-900">{c.label}</Td>
                      {columns.map((b) => (
                        <Td key={b.id ?? "empresa"} className="text-right">
                          {spend(c.id, b.id) ? money(spend(c.id, b.id)) : "—"}
                        </Td>
                      ))}
                      <Td className="text-right font-semibold text-slate-900">{money(spend(c.id, "all"))}</Td>
                      <Td className="text-right text-slate-500">{totalSpend ? `${((spend(c.id, "all") / totalSpend) * 100).toFixed(1)}%` : "—"}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Centros de costo</h2>
      <CostCentersView rows={centers} startNew={param(sp.nuevo) === "1"} />
    </>
  );
}
