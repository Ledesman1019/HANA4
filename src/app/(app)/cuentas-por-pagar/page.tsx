import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleCheck, HandCoins, TriangleAlert } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, EmptyState, Field, PageHeader, Select, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { INVOICE_STATUS } from "@/modules/cuentas-pagar/types";
import { addDays, formatDate, formatMoney, todayIn } from "@/lib/utils";
import { PayInvoiceButton, ReleaseInvoiceButton, VoidInvoiceButton } from "@/modules/cuentas-pagar/components/invoice-actions";

export const metadata: Metadata = { title: "Cuentas por pagar" };

type Row = {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total: number;
  paid: number;
  difference: number;
  supplier: { name: string; tax_id: string } | null;
  purchase: { id: string; number: string } | null;
};

const FILTERS: Record<string, string> = { abiertas: "Por pagar", vencidas: "Vencidas", bloqueadas: "Bloqueadas", pagadas: "Pagadas", todas: "Todas" };
const OPEN = ["pendiente", "parcial", "bloqueada"];

export default async function PayablesPage({ searchParams }: PageProps<"/cuentas-por-pagar">) {
  const { supabase, settings, branch, can } = await requireAccess("cuentas_pagar", "view");
  const sp = await searchParams;
  const filter = Object.hasOwn(FILTERS, param(sp.estado)) ? param(sp.estado) : "abiertas";
  const today = todayIn(settings.timezone);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  // Se traen todas las facturas de la sucursal: los indicadores usan el total, la tabla el filtro
  const all = await fetchAll<Row>((a, b) =>
    supabase
      .from("supplier_invoices")
      .select("id, number, status, issue_date, due_date, total, paid, difference, supplier:suppliers(name, tax_id), purchase:purchases(id, number)")
      .eq("branch_id", branch.id)
      .order("due_date")
      .order("id")
      .range(a, b),
  );

  const balance = (r: Row) => Number(r.total) - Number(r.paid);
  const open = all.filter((r) => OPEN.includes(r.status));
  const overdue = open.filter((r) => r.due_date < today);
  const soon = open.filter((r) => r.due_date >= today && r.due_date <= addDays(today, 7));
  const paidThisMonth = all.filter((r) => r.status === "pagada" && r.issue_date.startsWith(today.slice(0, 7)));
  const sum = (rows: Row[]) => rows.reduce((total, r) => total + balance(r), 0);

  const rows =
    filter === "abiertas"
      ? open
      : filter === "vencidas"
        ? overdue
        : filter === "bloqueadas"
          ? all.filter((r) => r.status === "bloqueada")
          : filter === "pagadas"
            ? all.filter((r) => r.status === "pagada").reverse()
            : all;

  const daysLate = (due: string) => Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);

  return (
    <>
      <PageHeader title="Cuentas por pagar" description={`Facturas de proveedores de ${branch.name}: qué se debe, a quién y cuándo vence.`}>
        <ExportMenu
          title="Cuentas por pagar"
          subtitle={`${branch.name} · ${FILTERS[filter]} · al ${formatDate(today)}`}
          filename={`cuentas_por_pagar_${today}`}
          columns={[
            { key: "proveedor", header: "Proveedor" },
            { key: "ruc", header: "RUC" },
            { key: "factura", header: "Factura" },
            { key: "orden", header: "Orden de compra" },
            { key: "emision", header: "Emisión", type: "date" },
            { key: "vence", header: "Vencimiento", type: "date" },
            { key: "estado", header: "Estado" },
            { key: "total", header: "Importe", type: "money", total: true },
            { key: "pagado", header: "Pagado", type: "money", total: true },
            { key: "saldo", header: "Saldo", type: "money", total: true },
          ]}
          rows={rows.map((r) => ({
            proveedor: r.supplier?.name ?? "",
            ruc: r.supplier?.tax_id ?? "",
            factura: r.number,
            orden: r.purchase?.number ?? "",
            emision: r.issue_date,
            vence: r.due_date,
            estado: OPEN.includes(r.status) && r.due_date < today ? "Vencida" : (INVOICE_STATUS[r.status]?.label ?? r.status),
            total: r.status === "anulada" ? null : Number(r.total),
            pagado: r.status === "anulada" ? null : Number(r.paid),
            saldo: r.status === "anulada" ? null : balance(r),
          }))}
        />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total por pagar" value={money(sum(open))} icon={<HandCoins className="h-4 w-4" />} hint={`${open.length} ${open.length === 1 ? "factura abierta" : "facturas abiertas"}`} />
        <StatCard label="Vencido" value={money(sum(overdue))} icon={<TriangleAlert className="h-4 w-4" />} tone="red" hint={overdue.length ? `${overdue.length} con atraso` : "Al día"} />
        <StatCard label="Vence en 7 días" value={money(sum(soon))} icon={<CalendarClock className="h-4 w-4" />} tone="amber" hint={`${soon.length} ${soon.length === 1 ? "factura" : "facturas"}`} />
        <StatCard
          label="Facturas canceladas este mes"
          value={money(paidThisMonth.reduce((t, r) => t + Number(r.total), 0))}
          icon={<CircleCheck className="h-4 w-4" />}
          tone="green"
          hint={`${paidThisMonth.length} pagadas`}
        />
      </div>

      <Card>
        <FilterBar action="/cuentas-por-pagar">
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
            icon={<HandCoins className="h-5 w-5" />}
            title={all.length === 0 ? "Aún no hay facturas de proveedor" : "Nada que mostrar con este filtro"}
            description={all.length === 0 ? "Se registran desde la orden de compra, después de recibir la mercadería." : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Proveedor</Th>
                <Th>Factura</Th>
                <Th>Vencimiento</Th>
                <Th className="text-right">Importe</Th>
                <Th className="text-right">Saldo</Th>
                <Th>Estado</Th>
                <Th className="w-px text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const late = OPEN.includes(r.status) && r.due_date < today;
                return (
                  <tr key={r.id} className="transition-colors hover:bg-slate-50/70">
                    <Td>
                      <p className="font-medium text-slate-900">{r.supplier?.name}</p>
                      <p className="tabular text-xs text-slate-500">RUC {r.supplier?.tax_id}</p>
                    </Td>
                    <Td>
                      <p className="tabular font-medium text-slate-900">{r.number}</p>
                      {r.purchase &&
                        (can("compras", "view") ? (
                          <Link href={`/compras/${r.purchase.id}`} className="tabular text-xs text-link hover:underline">
                            {r.purchase.number}
                          </Link>
                        ) : (
                          <span className="tabular text-xs text-slate-500">{r.purchase.number}</span>
                        ))}
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      {formatDate(r.due_date)}
                      {late && <p className="text-xs font-medium text-red-600">{daysLate(r.due_date)} días de atraso</p>}
                    </Td>
                    <Td className="tabular text-right">{money(Number(r.total))}</Td>
                    <Td className="tabular text-right font-semibold text-slate-900">{r.status === "anulada" ? "—" : money(balance(r))}</Td>
                    <Td>
                      <Badge tone={late ? "red" : INVOICE_STATUS[r.status]?.tone}>{late && r.status !== "bloqueada" ? "Vencida" : INVOICE_STATUS[r.status]?.label}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.status === "bloqueada" && can("compras", "edit") && <ReleaseInvoiceButton invoiceId={r.id} number={r.number} />}
                        {OPEN.includes(r.status) && Number(r.paid) === 0 && can("cuentas_pagar", "delete") && <VoidInvoiceButton invoiceId={r.id} number={r.number} />}
                        {(r.status === "pendiente" || r.status === "parcial") && can("cuentas_pagar", "edit") && (
                          <PayInvoiceButton invoiceId={r.id} number={r.number} balance={balance(r)} today={today} compact />
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="px-4 py-3 text-xs text-slate-500">
          {rows.length} {rows.length === 1 ? "factura" : "facturas"}
        </p>
      </Card>
    </>
  );
}
