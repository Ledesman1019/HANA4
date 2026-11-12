import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { param } from "@/components/filters";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { cn, formatMoney, todayIn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendario" };

type Kind = "cobro" | "pago" | "lote";
type Event = { date: string; kind: Kind; title: string; detail: string; href: string };

const KIND = {
  cobro: { label: "Cobro", tone: "green", dot: "bg-emerald-500" },
  pago: { label: "Pago", tone: "red", dot: "bg-red-500" },
  lote: { label: "Vence lote", tone: "amber", dot: "bg-amber-500" },
} as const;

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Calendario de vencimientos: cobros a clientes, pagos a proveedores y lotes que vencen.
 * Cada tipo aparece solo si el rol puede ver ese módulo.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendario">) {
  const { supabase, settings, branch, can } = await getContext();
  const today = todayIn(settings.timezone);
  const requested = param((await searchParams).mes);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0, 7);
  const [year, mon] = month.split("-").map(Number);
  const first = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const last = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const [receivables, payables, lots] = await Promise.all([
    can("cuentas_cobrar", "view")
      ? supabase
          .from("sales")
          .select("id, number, due_date, total, amount_paid, customer:customers(name)")
          .eq("status", "completada")
          .in("credit_status", ["pendiente", "parcial"])
          .gte("due_date", first)
          .lte("due_date", last)
          .limit(500)
      : null,
    can("cuentas_pagar", "view")
      ? supabase
          .from("supplier_invoices")
          .select("id, number, due_date, total, paid, supplier:suppliers(name)")
          .in("status", ["pendiente", "parcial", "bloqueada"])
          .gte("due_date", first)
          .lte("due_date", last)
          .limit(500)
      : null,
    can("inventario", "view")
      ? supabase
          .from("lots")
          .select("id, lot_number, expiry_date, quantity, product:products(name)")
          .eq("branch_id", branch.id)
          .gt("quantity", 0)
          .gte("expiry_date", first)
          .lte("expiry_date", last)
          .limit(500)
      : null,
  ]);

  const events: Event[] = [
    ...((receivables?.data ?? []) as { id: string; number: string; due_date: string; total: number; amount_paid: number; customer: { name: string } | { name: string }[] | null }[]).map((s) => ({
      date: s.due_date,
      kind: "cobro" as const,
      title: one(s.customer)?.name ?? "Cliente",
      detail: `${s.number} · saldo ${money(Number(s.total) - Number(s.amount_paid))}`,
      href: `/ventas/${s.id}`,
    })),
    ...((payables?.data ?? []) as { id: string; number: string; due_date: string; total: number; paid: number; supplier: { name: string } | { name: string }[] | null }[]).map((i) => ({
      date: i.due_date,
      kind: "pago" as const,
      title: one(i.supplier)?.name ?? "Proveedor",
      detail: `Factura ${i.number} · saldo ${money(Number(i.total) - Number(i.paid))}`,
      href: "/cuentas-por-pagar",
    })),
    ...((lots?.data ?? []) as { id: string; lot_number: string; expiry_date: string; quantity: number; product: { name: string } | { name: string }[] | null }[]).map((l) => ({
      date: l.expiry_date,
      kind: "lote" as const,
      title: one(l.product)?.name ?? "Producto",
      detail: `Lote ${l.lot_number} · ${Number(l.quantity)} und.`,
      href: "/inventario/lotes",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  const byDay = new Map<string, Event[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  // Lunes = 0
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const title = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, mon - 1, 1)));

  return (
    <>
      <PageHeader title="Calendario" description="Vencimientos de cobros, pagos y lotes del mes.">
        <div className="flex items-center gap-1.5">
          <Link href={`/calendario?mes=${shift(-1)}`} className={buttonClass("secondary", "sm")} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold text-slate-800 first-letter:uppercase">{title}</span>
          <Link href={`/calendario?mes=${shift(1)}`} className={buttonClass("secondary", "sm")} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Link>
          {month !== today.slice(0, 7) && (
            <Link href="/calendario" className={buttonClass("secondary", "sm")}>
              Hoy
            </Link>
          )}
        </div>
      </PageHeader>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const list = day ? (byDay.get(day) ?? []) : [];
            return (
              <div key={day ?? `empty-${i}`} className={cn("min-h-16 border-b border-r border-slate-100 p-1 sm:min-h-28 sm:p-1.5", !day && "bg-slate-50/60", (i + 1) % 7 === 0 && "border-r-0")}>
                {day && (
                  <>
                    <span
                      className={cn(
                        "tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold",
                        day === today ? "bg-brand-600 text-white" : day < today ? "text-slate-400" : "text-slate-700",
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                    {/* En celular solo puntos; el detalle va en la lista de abajo */}
                    <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                      {list.slice(0, 6).map((e, j) => (
                        <span key={j} className={cn("h-1.5 w-1.5 rounded-full", KIND[e.kind].dot)} />
                      ))}
                    </div>
                    <ul className="mt-1 hidden space-y-0.5 sm:block">
                      {list.slice(0, 3).map((e, j) => (
                        <li key={j}>
                          <Link href={e.href} title={`${KIND[e.kind].label}: ${e.title} — ${e.detail}`} className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100">
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", KIND[e.kind].dot)} />
                            <span className="truncate">{e.title}</span>
                          </Link>
                        </li>
                      ))}
                      {list.length > 3 && <li className="px-1 text-[11px] font-medium text-slate-500">+{list.length - 3} más</li>}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Vencimientos del mes" description={`${events.length} ${events.length === 1 ? "registro" : "registros"}`} />
        {events.length === 0 ? (
          <EmptyState title="Sin vencimientos este mes" description="No hay cobros, pagos ni lotes que venzan en este periodo." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Tipo</Th>
                <Th>Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td className={cn("tabular whitespace-nowrap", e.date < today && "font-semibold text-red-600")}>{e.date.split("-").reverse().join("/")}</Td>
                  <Td>
                    <Badge tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Badge>
                  </Td>
                  <Td>
                    <Link href={e.href} className="font-medium text-slate-900 hover:text-link hover:underline">
                      {e.title}
                    </Link>
                    <span className="block text-xs text-slate-500">{e.detail}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
