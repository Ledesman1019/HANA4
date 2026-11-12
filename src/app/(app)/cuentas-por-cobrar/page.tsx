import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleCheck, PiggyBank, TriangleAlert } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, CardHeader, EmptyState, Field, PageHeader, Select, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { CREDIT_STATUS } from "@/modules/cuentas-cobrar/types";
import { addDays, formatDate, formatMoney, todayIn } from "@/lib/utils";
import { CollectButton } from "@/modules/cuentas-cobrar/components/collect-button";

export const metadata: Metadata = { title: "Cuentas por cobrar" };

type Row = {
  id: string;
  number: string;
  created_at: string;
  due_date: string;
  total: number;
  amount_paid: number;
  credit_status: string;
  customer: { id: string; name: string; doc_type: string; doc_number: string; phone: string; credit_limit: number } | null;
};

const FILTERS: Record<string, string> = { abiertas: "Por cobrar", vencidas: "Vencidas", cobradas: "Cobradas", todas: "Todas" };
const OPEN = ["pendiente", "parcial"];

export default async function ReceivablesPage({ searchParams }: PageProps<"/cuentas-por-cobrar">) {
  const { supabase, settings, branch, can } = await requireAccess("cuentas_cobrar", "view");
  const sp = await searchParams;
  const filter = Object.hasOwn(FILTERS, param(sp.estado)) ? param(sp.estado) : "abiertas";
  const today = todayIn(settings.timezone);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const all = await fetchAll<Row>((a, b) =>
    supabase
      .from("sales")
      .select("id, number, created_at, due_date, total, amount_paid, credit_status, customer:customers(id, name, doc_type, doc_number, phone, credit_limit)")
      .eq("branch_id", branch.id)
      .eq("payment_method", "credito")
      .eq("status", "completada")
      .order("due_date")
      .order("id")
      .range(a, b),
  );

  const balance = (r: Row) => Number(r.total) - Number(r.amount_paid);
  const open = all.filter((r) => OPEN.includes(r.credit_status));
  const overdue = open.filter((r) => r.due_date < today);
  const soon = open.filter((r) => r.due_date >= today && r.due_date <= addDays(today, 7));
  const sum = (rows: Row[]) => rows.reduce((total, r) => total + balance(r), 0);
  const daysLate = (due: string) => Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);

  const rows = filter === "abiertas" ? open : filter === "vencidas" ? overdue : filter === "cobradas" ? all.filter((r) => r.credit_status === "pagada").reverse() : all;

  // Antigüedad de la deuda por cliente (aging): cuánto debe cada uno y qué tan atrasado
  type Aging = { name: string; doc: string; phone: string; limit: number; current: number; d30: number; d60: number; d90: number; total: number };
  const byCustomer = new Map<string, Aging>();
  for (const r of open) {
    if (!r.customer) continue;
    const a = byCustomer.get(r.customer.id) ?? { name: r.customer.name, doc: r.customer.doc_number, phone: r.customer.phone, limit: Number(r.customer.credit_limit), current: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    const late = daysLate(r.due_date);
    const b = balance(r);
    if (late <= 0) a.current += b;
    else if (late <= 30) a.d30 += b;
    else if (late <= 60) a.d60 += b;
    else a.d90 += b;
    a.total += b;
    byCustomer.set(r.customer.id, a);
  }
  const aging = [...byCustomer.values()].sort((x, y) => y.total - x.total);

  return (
    <>
      <PageHeader title="Cuentas por cobrar" description={`Ventas al crédito de ${branch.name}: quién debe, cuánto y desde cuándo.`}>
        <ExportMenu
          title="Cuentas por cobrar"
          subtitle={`${branch.name} · ${FILTERS[filter]} · al ${formatDate(today)}`}
          filename={`cuentas_por_cobrar_${today}`}
          columns={[
            { key: "cliente", header: "Cliente" },
            { key: "documento", header: "Documento" },
            { key: "comprobante", header: "Comprobante" },
            { key: "emision", header: "Emisión" },
            { key: "vence", header: "Vencimiento", type: "date" },
            { key: "estado", header: "Estado" },
            { key: "total", header: "Importe", type: "money", total: true },
            { key: "cobrado", header: "Cobrado", type: "money", total: true },
            { key: "saldo", header: "Saldo", type: "money", total: true },
          ]}
          rows={rows.map((r) => ({
            cliente: r.customer?.name ?? "",
            documento: r.customer ? `${r.customer.doc_type} ${r.customer.doc_number}` : "",
            comprobante: r.number,
            emision: formatDate(r.created_at.slice(0, 10)),
            vence: r.due_date,
            estado: OPEN.includes(r.credit_status) && r.due_date < today ? "Vencida" : (CREDIT_STATUS[r.credit_status]?.label ?? r.credit_status),
            total: Number(r.total),
            cobrado: Number(r.amount_paid),
            saldo: balance(r),
          }))}
        />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total por cobrar" value={money(sum(open))} icon={<PiggyBank className="h-4 w-4" />} hint={`${byCustomer.size} ${byCustomer.size === 1 ? "cliente" : "clientes"} con deuda`} />
        <StatCard label="Vencido" value={money(sum(overdue))} icon={<TriangleAlert className="h-4 w-4" />} tone="red" hint={overdue.length ? `${overdue.length} ventas atrasadas` : "Al día"} />
        <StatCard label="Vence en 7 días" value={money(sum(soon))} icon={<CalendarClock className="h-4 w-4" />} tone="amber" hint={`${soon.length} ventas`} />
        <StatCard
          label="Cobrado (historial)"
          value={money(all.reduce((t, r) => t + Number(r.amount_paid), 0))}
          icon={<CircleCheck className="h-4 w-4" />}
          tone="green"
          hint={`${all.filter((r) => r.credit_status === "pagada").length} ventas canceladas`}
        />
      </div>

      {aging.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Antigüedad de la deuda por cliente" description="Cuánto debe cada cliente según los días de atraso" />
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th className="text-right">Línea</Th>
                <Th className="text-right">Por vencer</Th>
                <Th className="text-right">1–30 días</Th>
                <Th className="text-right">31–60 días</Th>
                <Th className="text-right">Más de 60</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {aging.map((a) => (
                <tr key={a.doc + a.name}>
                  <Td>
                    <p className="font-medium text-slate-900">{a.name}</p>
                    <p className="text-xs text-slate-500">
                      {a.doc}
                      {a.phone && ` · ${a.phone}`}
                    </p>
                  </Td>
                  <Td className="text-right text-slate-500">{money(a.limit)}</Td>
                  <Td className="text-right">{a.current ? money(a.current) : "—"}</Td>
                  <Td className={`text-right ${a.d30 ? "text-amber-700" : ""}`}>{a.d30 ? money(a.d30) : "—"}</Td>
                  <Td className={`text-right ${a.d60 ? "font-medium text-red-600" : ""}`}>{a.d60 ? money(a.d60) : "—"}</Td>
                  <Td className={`text-right ${a.d90 ? "font-semibold text-red-700" : ""}`}>{a.d90 ? money(a.d90) : "—"}</Td>
                  <Td className="text-right font-semibold text-slate-900">{money(a.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <FilterBar action="/cuentas-por-cobrar">
          <Field label="Mostrar">
            <Select name="estado" defaultValue={filter}>
              {Object.entries(FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>

        {rows.length === 0 ? (
          <EmptyState
            icon={<PiggyBank className="h-5 w-5" />}
            title={all.length === 0 ? "Aún no hay ventas al crédito" : "Nada que mostrar con este filtro"}
            description={all.length === 0 ? "Asigna una línea de crédito a un cliente (Clientes → editar) y elige «Crédito» al cobrar en el punto de venta." : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Comprobante</Th>
                <Th>Vencimiento</Th>
                <Th className="text-right">Importe</Th>
                <Th className="text-right">Saldo</Th>
                <Th>Estado</Th>
                {can("cuentas_cobrar", "create") && <Th className="w-px" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const late = OPEN.includes(r.credit_status) && r.due_date < today;
                return (
                  <tr key={r.id} className="transition-colors hover:bg-slate-50/70">
                    <Td>
                      <p className="font-medium text-slate-900">{r.customer?.name}</p>
                      <p className="tabular text-xs text-slate-500">
                        {r.customer?.doc_type} {r.customer?.doc_number}
                      </p>
                    </Td>
                    <Td>
                      <Link href={`/ventas/${r.id}`} className="tabular font-medium text-link hover:underline">
                        {r.number}
                      </Link>
                      <p className="tabular text-xs text-slate-500">{formatDate(r.created_at.slice(0, 10))}</p>
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      {formatDate(r.due_date)}
                      {late && <p className="text-xs font-medium text-red-600">{daysLate(r.due_date)} días de atraso</p>}
                    </Td>
                    <Td className="tabular text-right">{money(Number(r.total))}</Td>
                    <Td className="tabular text-right font-semibold text-slate-900">{money(balance(r))}</Td>
                    <Td>
                      <Badge tone={late ? "red" : CREDIT_STATUS[r.credit_status]?.tone}>{late ? "Vencida" : CREDIT_STATUS[r.credit_status]?.label}</Badge>
                    </Td>
                    {can("cuentas_cobrar", "create") && (
                      <Td className="text-right">
                        {OPEN.includes(r.credit_status) && <CollectButton saleId={r.id} number={r.number} customer={r.customer?.name ?? ""} balance={balance(r)} today={today} compact />}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="px-4 py-3 text-xs text-slate-500">
          {rows.length} {rows.length === 1 ? "venta" : "ventas"}
        </p>
      </Card>
    </>
  );
}
