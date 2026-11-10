import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, PackageCheck, Receipt, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { BarList, SalesTrendChart } from "@/components/charts";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { PAYMENT_LABELS, type InventoryRow, type Sale } from "@/lib/types";
import { formatDateTime, formatMoney, formatQty, todayIn } from "@/lib/utils";

export const metadata: Metadata = { title: "Panel" };

type Day = { day: string; total: number; cost: number; tickets: number };
type Top = { product_id: string; name: string; quantity: number; total: number };
type Breakdown = { label: string; total: number; tickets: number };

export default async function DashboardPage() {
  const { supabase, profile, settings, branch, can } = await getContext();
  const tz = settings.timezone;
  const today = todayIn(tz);
  const from = todayIn(tz, -29);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const range = { p_from: from, p_to: today, p_branch: branch.id };

  const [daysRes, topRes, payRes, lowRes, recentRes] = await Promise.all([
    supabase.rpc("report_sales_by_day", range),
    supabase.rpc("report_top_products", { ...range, p_limit: 5 }),
    supabase.rpc("report_sales_breakdown", { ...range, p_dimension: "payment_method" }),
    supabase
      .from("inventory_view")
      .select("*", { count: "exact" })
      .eq("branch_id", branch.id)
      .eq("active", true)
      .eq("low_stock", true)
      .order("quantity")
      .limit(6),
    supabase.from("sales").select("*").eq("branch_id", branch.id).order("created_at", { ascending: false }).limit(6),
  ]);

  const days = ((daysRes.data ?? []) as Day[]).map((d) => ({ ...d, total: Number(d.total), cost: Number(d.cost), tickets: Number(d.tickets) }));
  const sum = (list: Day[], key: "total" | "cost" | "tickets") => list.reduce((a, d) => a + d[key], 0);

  const todayRow = days.at(-1);
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  const total30 = sum(days, "total");
  const tickets30 = sum(days, "tickets");
  // Los precios incluyen impuesto y los costos no: la utilidad se mide sobre ventas netas.
  const net30 = total30 / (1 + Number(settings.tax_rate) / 100);
  const profit30 = net30 - sum(days, "cost");
  const week = sum(last7, "total");
  const prevWeek = sum(prev7, "total");
  const delta = prevWeek > 0 ? ((week - prevWeek) / prevWeek) * 100 : null;

  const top = (topRes.data ?? []) as Top[];
  const payments = (payRes.data ?? []) as Breakdown[];
  const low = (lowRes.data ?? []) as InventoryRow[];
  const recent = (recentRes.data ?? []) as Sale[];
  // Sin permiso de ver todas las ventas, el panel resume solo las propias
  const ownOnly = !can("ventas", "view") && !can("reportes", "view");

  return (
    <>
      <PageHeader
        title={`Hola, ${profile.full_name.split(" ")[0]}`}
        description={`${branch.name} · ${ownOnly ? "tus ventas de" : "resumen de"} los últimos 30 días`}
      >
        {can("ventas", "create") && (
          <Link href="/pos" className={buttonClass("primary")}>
            <ShoppingCart className="h-4 w-4" />
            Nueva venta
          </Link>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ventas de hoy"
          value={money(todayRow?.total ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
          hint={`${todayRow?.tickets ?? 0} ${todayRow?.tickets === 1 ? "comprobante" : "comprobantes"}`}
        />
        <StatCard
          label="Últimos 7 días"
          value={money(week)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="green"
          hint={
            delta === null ? (
              "Sin semana previa para comparar"
            ) : (
              <span className="inline-flex items-center gap-1">
                {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowDownRight className="h-3.5 w-3.5 text-red-600" />}
                <span className={delta >= 0 ? "font-medium text-emerald-700" : "font-medium text-red-700"}>
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}%
                </span>
                vs. semana anterior
              </span>
            )
          }
        />
        <StatCard
          label="Ticket promedio"
          value={money(tickets30 > 0 ? total30 / tickets30 : 0)}
          icon={<Receipt className="h-4 w-4" />}
          tone="slate"
          hint={`${tickets30} ventas en 30 días`}
        />
        {ownOnly ? (
          <StatCard label="Vendido en 30 días" value={money(total30)} icon={<PackageCheck className="h-4 w-4" />} tone="slate" />
        ) : (
          <StatCard
            label="Utilidad bruta (30 días)"
            value={money(profit30)}
            icon={<PackageCheck className="h-4 w-4" />}
            tone="amber"
            hint={total30 > 0 ? `Margen ${((profit30 / net30) * 100).toFixed(1)}% sobre ventas netas` : "Sin ventas en el periodo"}
          />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Ventas por día" description={`Total del periodo: ${money(total30)}`} />
          <div className="p-4">
            <SalesTrendChart data={days} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Medios de pago" description="Últimos 30 días" />
          <div className="p-5">
            <BarList items={payments.map((p) => ({ label: PAYMENT_LABELS[p.label] ?? p.label, value: Number(p.total), hint: `${p.tickets} vtas.` }))} />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Productos más vendidos" description="Por importe, últimos 30 días" />
          <div className="p-5">
            <BarList items={top.map((t) => ({ label: t.name, value: Number(t.total), hint: `${formatQty(t.quantity)} u.` }))} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Stock por reponer"
            description={lowRes.count ? `${lowRes.count} ${lowRes.count === 1 ? "producto" : "productos"} en o bajo el mínimo` : "Inventario saludable"}
            action={
              <Link href="/inventario?filtro=bajo" className="text-xs font-medium text-link hover:underline">
                Ver todo
              </Link>
            }
          />
          {low.length === 0 ? (
            <EmptyState icon={<PackageCheck className="h-5 w-5" />} title="Todo en orden" description="Ningún producto está por debajo de su stock mínimo." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {low.map((p) => (
                <li key={p.product_id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">Mínimo {formatQty(p.min_stock)}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm">
                    <AlertTriangle className={Number(p.quantity) === 0 ? "h-3.5 w-3.5 text-red-600" : "h-3.5 w-3.5 text-amber-600"} />
                    <span className="tabular font-semibold text-slate-900">{formatQty(p.quantity)}</span>
                    <span className="text-xs text-slate-500">{Number(p.quantity) === 0 ? "agotado" : "en stock"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Últimas ventas"
            action={
              can("ventas", "access") ? (
                <Link href="/ventas" className="text-xs font-medium text-link hover:underline">
                  Ver todas
                </Link>
              ) : undefined
            }
          />
          {recent.length === 0 ? (
            <EmptyState icon={<Receipt className="h-5 w-5" />} title="Aún no hay ventas" description="Las ventas del punto de venta aparecerán aquí." />
          ) : (
            <Table>
              <thead className="sr-only">
                <tr>
                  <Th>Comprobante</Th>
                  <Th>Total</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link href={`/ventas/${s.id}`} className="font-medium text-slate-900 hover:text-link">
                        {s.number}
                      </Link>
                      <p className="text-xs text-slate-500">{formatDateTime(s.created_at, tz)}</p>
                    </Td>
                    <Td className="tabular text-right">
                      {s.status === "anulada" ? <Badge tone="red">Anulada</Badge> : <span className="font-medium text-slate-900">{money(s.total)}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
