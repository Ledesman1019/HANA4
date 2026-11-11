import type { Metadata } from "next";
import { Receipt, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { BarList, SalesTrendChart } from "@/components/charts";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { PAYMENT_LABELS } from "@/lib/types";
import { addDays, formatDate, formatMoney, formatQty, isIsoDate, todayIn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reportes" };

type Day = { day: string; total: number; cost: number; tickets: number };
type Top = { product_id: string; name: string; sku: string; quantity: number; total: number; profit: number };
type Breakdown = { label: string; total: number; tickets: number };

const MAX_RANGE_DAYS = 366;

export default async function ReportsPage({ searchParams }: PageProps<"/reportes">) {
  const { supabase, settings, branch, branches } = await requireAccess("reportes", "view");
  const sp = await searchParams;
  const tz = settings.timezone;
  const today = todayIn(tz);

  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : today;
  let from = isIsoDate(param(sp.desde)) ? param(sp.desde) : addDays(to, -29);
  if (from > to) from = to;
  if (from < addDays(to, -MAX_RANGE_DAYS)) from = addDays(to, -MAX_RANGE_DAYS);

  const scope = param(sp.sucursal) || branch.id;
  const branchId = scope === "todas" ? null : branches.some((b) => b.id === scope) ? scope : branch.id;
  const range = { p_from: from, p_to: to, p_branch: branchId };
  const breakdown = (dimension: string) => supabase.rpc("report_sales_breakdown", { ...range, p_dimension: dimension });

  const [daysRes, topRes, catRes, payRes, cashierRes, branchRes] = await Promise.all([
    supabase.rpc("report_sales_by_day", range),
    supabase.rpc("report_top_products", { ...range, p_limit: 15 }),
    breakdown("category"),
    breakdown("payment_method"),
    breakdown("cashier"),
    breakdown("branch"),
  ]);

  const days = ((daysRes.data ?? []) as Day[]).map((d) => ({ day: d.day, total: Number(d.total), cost: Number(d.cost), tickets: Number(d.tickets) }));
  const top = (topRes.data ?? []) as Top[];
  const toItems = (rows: Breakdown[] | null, labels?: Record<string, string>) =>
    (rows ?? []).map((r) => ({ label: labels?.[r.label] ?? r.label, value: Number(r.total), hint: `${r.tickets} vtas.` }));

  const total = days.reduce((a, d) => a + d.total, 0);
  const tickets = days.reduce((a, d) => a + d.tickets, 0);
  const netSales = total / (1 + Number(settings.tax_rate) / 100);
  const profit = netSales - days.reduce((a, d) => a + d.cost, 0);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const scopeName = branchId ? branches.find((b) => b.id === branchId)?.name : "Todas las sucursales";

  return (
    <>
      <PageHeader title="Reportes" description={`${scopeName} · del ${formatDate(from)} al ${formatDate(to)}`}>
        <ExportMenu
          title="Ventas por día"
          subtitle={`${scopeName} · del ${formatDate(from)} al ${formatDate(to)}`}
          filename={`ventas_por_dia_${from}_${to}`}
          label="Exportar ventas por día"
          columns={[
            { key: "fecha", header: "Fecha", type: "date" },
            { key: "comprobantes", header: "Comprobantes", type: "number", total: true },
            { key: "ventas", header: "Ventas", type: "money", total: true },
            { key: "costo", header: "Costo de ventas", type: "money", total: true },
          ]}
          rows={days.map((d) => ({ fecha: d.day, comprobantes: d.tickets, ventas: d.total, costo: d.cost }))}
        />
      </PageHeader>

      <Card className="mb-6">
        <FilterBar action="/reportes">
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} max={today} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} max={today} />
          </Field>
          <Field label="Sucursal">
            <Select name="sucursal" defaultValue={branchId ?? "todas"}>
              <option value="todas">Todas</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ventas" value={money(total)} icon={<Wallet className="h-4 w-4" />} hint="Con impuesto incluido" />
        <StatCard label="Comprobantes" value={String(tickets)} icon={<Receipt className="h-4 w-4" />} tone="slate" />
        <StatCard label="Ticket promedio" value={money(tickets > 0 ? total / tickets : 0)} icon={<ShoppingBag className="h-4 w-4" />} tone="slate" />
        <StatCard
          label="Utilidad bruta"
          value={money(profit)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="green"
          hint={netSales > 0 ? `Margen ${((profit / netSales) * 100).toFixed(1)}% sobre ventas netas` : undefined}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Ventas por día" />
        <div className="p-4">
          <SalesTrendChart data={days} height={300} />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader title="Por categoría" />
          <div className="p-5">
            <BarList items={toItems(catRes.data as Breakdown[] | null)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Por medio de pago" />
          <div className="p-5">
            <BarList items={toItems(payRes.data as Breakdown[] | null, PAYMENT_LABELS)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Por cajero" />
          <div className="p-5">
            <BarList items={toItems(cashierRes.data as Breakdown[] | null)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Por sucursal" />
          <div className="p-5">
            <BarList items={toItems(branchRes.data as Breakdown[] | null)} />
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Productos más vendidos"
          description="Top 15 por importe"
          action={
            <ExportMenu
              title="Productos más vendidos"
              subtitle={`${scopeName} · del ${formatDate(from)} al ${formatDate(to)}`}
              filename={`top_productos_${from}_${to}`}
              size="sm"
              columns={[
                { key: "sku", header: "SKU" },
                { key: "producto", header: "Producto" },
                { key: "cantidad", header: "Unidades", type: "number", total: true },
                { key: "ventas", header: "Ventas", type: "money", total: true },
                { key: "utilidad", header: "Utilidad", type: "money", total: true },
              ]}
              rows={top.map((t) => ({ sku: t.sku, producto: t.name, cantidad: Number(t.quantity), ventas: Number(t.total), utilidad: Number(t.profit) }))}
            />
          }
        />
        {top.length === 0 ? (
          <EmptyState title="Sin ventas en el periodo" description="Cambia el rango de fechas o la sucursal." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>Producto</Th>
                <Th className="text-right">Unidades</Th>
                <Th className="text-right">Ventas</Th>
                <Th className="text-right">Participación</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((t, i) => (
                <tr key={t.product_id}>
                  <Td className="tabular text-slate-400">{i + 1}</Td>
                  <Td>
                    <p className="font-medium text-slate-900">{t.name}</p>
                    <p className="tabular text-xs text-slate-500">{t.sku}</p>
                  </Td>
                  <Td className="tabular text-right">{formatQty(t.quantity)}</Td>
                  <Td className="tabular text-right font-medium text-slate-900">{money(Number(t.total))}</Td>
                  <Td className="tabular text-right">{total > 0 ? `${((Number(t.total) / total) * 100).toFixed(1)}%` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
