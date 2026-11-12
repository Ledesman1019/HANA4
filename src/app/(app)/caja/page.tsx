import type { Metadata } from "next";
import { ArrowDownLeft, ArrowUpRight, Banknote, CreditCard, History, Wallet } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { CashSession } from "@/modules/caja/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { CashMovementButton, CloseCashButton, OpenCashCard } from "@/modules/caja/components/cash-forms";

export const metadata: Metadata = { title: "Caja" };

type Movement = { id: string; type: "ingreso" | "egreso"; amount: number; concept: string; created_at: string };
type SessionRow = CashSession & { opener: { full_name: string } | null; branch: { name: string } | null };

export default async function CashPage() {
  const { supabase, userId, settings, branch, can } = await requireAccess("caja");
  const money = (n: number | null) => formatMoney(n, settings.currency_symbol);
  const canOperate = can("caja", "create");

  const [openRes, historyRes] = await Promise.all([
    supabase.from("cash_sessions").select("*, branch:branches(name)").eq("opened_by", userId).eq("status", "abierta").maybeSingle(),
    supabase
      .from("cash_sessions")
      .select("*, opener:profiles!cash_sessions_opened_by_fkey(full_name), branch:branches(name)")
      .eq("status", "cerrada")
      .order("closed_at", { ascending: false })
      .limit(30),
  ]);
  const session = openRes.data as (CashSession & { branch: { name: string } | null }) | null;
  const history = (historyRes.data ?? []) as SessionRow[];

  let detail: { expected: number; cashSales: number; otherSales: number; salesCount: number; movements: Movement[] } | null = null;
  if (session) {
    const [expectedRes, salesRes, movementsRes] = await Promise.all([
      supabase.rpc("cash_session_expected", { p_session: session.id }),
      supabase.from("sales").select("total, payment_method").eq("cash_session_id", session.id).eq("status", "completada"),
      supabase.from("cash_movements").select("*").eq("cash_session_id", session.id).order("created_at", { ascending: false }),
    ]);
    const sales = (salesRes.data ?? []) as { total: number; payment_method: string }[];
    const total = (cash: boolean) => sales.filter((s) => (s.payment_method === "efectivo") === cash).reduce((a, s) => a + Number(s.total), 0);
    detail = {
      expected: Number(expectedRes.data ?? session.opening_amount),
      cashSales: total(true),
      otherSales: total(false),
      salesCount: sales.length,
      movements: (movementsRes.data ?? []) as Movement[],
    };
  }

  return (
    <>
      <PageHeader title="Caja" description="Apertura, movimientos de efectivo y arqueo de cada turno.">
        {session && detail && (
          <>
            <CashMovementButton sessionId={session.id} type="ingreso" />
            <CashMovementButton sessionId={session.id} type="egreso" />
            <CloseCashButton sessionId={session.id} expected={detail.expected} />
          </>
        )}
      </PageHeader>

      {session && detail ? (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge tone="green">Caja abierta</Badge>
            {session.branch?.name} · desde {formatDateTime(session.opened_at, settings.timezone)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Efectivo inicial" value={money(session.opening_amount)} icon={<Wallet className="h-4 w-4" />} tone="slate" />
            <StatCard label="Ventas en efectivo" value={money(detail.cashSales)} icon={<Banknote className="h-4 w-4" />} tone="green" hint={`${detail.salesCount} ventas en el turno`} />
            <StatCard label="Ventas con otros medios" value={money(detail.otherSales)} icon={<CreditCard className="h-4 w-4" />} hint="No suman al efectivo en caja" />
            <StatCard label="Efectivo esperado en caja" value={money(detail.expected)} icon={<Wallet className="h-4 w-4" />} tone="amber" hint="Inicial + ventas en efectivo ± movimientos" />
          </div>

          <Card className="mt-6">
            <CardHeader title="Movimientos del turno" description="Ingresos y retiros de efectivo distintos a ventas" />
            {detail.movements.length === 0 ? (
              <EmptyState title="Sin movimientos" description="Usa «Ingreso» o «Retiro» para registrar efectivo que entra o sale de caja." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Hora</Th>
                    <Th>Concepto</Th>
                    <Th className="text-right">Monto</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((m) => (
                    <tr key={m.id}>
                      <Td className="tabular whitespace-nowrap">{formatDateTime(m.created_at, settings.timezone)}</Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          {m.type === "ingreso" ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowUpRight className="h-3.5 w-3.5 text-red-600" />}
                          {m.concept}
                        </span>
                      </Td>
                      <Td className="tabular text-right font-medium text-slate-900">
                        {m.type === "ingreso" ? "+" : "−"} {money(m.amount)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      ) : canOperate ? (
        <div className="mx-auto max-w-md">
          <OpenCashCard branchName={branch.name} />
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader title="Historial de cierres" description={can("caja", "view") ? "Últimos 30 arqueos de todas las cajas" : "Tus últimos arqueos"} />
        {history.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="Aún no hay cierres" description="Cada cierre de caja quedará registrado aquí con su diferencia." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cierre</Th>
                <Th>Cajero</Th>
                <Th>Sucursal</Th>
                <Th className="text-right">Esperado</Th>
                <Th className="text-right">Contado</Th>
                <Th className="text-right">Diferencia</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => {
                const diff = Number(s.difference ?? 0);
                return (
                  <tr key={s.id}>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(s.closed_at, settings.timezone)}</Td>
                    <Td>{s.opener?.full_name ?? "—"}</Td>
                    <Td>{s.branch?.name ?? "—"}</Td>
                    <Td className="tabular text-right">{money(s.expected_amount)}</Td>
                    <Td className="tabular text-right">{money(s.counted_amount)}</Td>
                    <Td className="text-right">
                      <Badge tone={diff === 0 ? "green" : diff > 0 ? "amber" : "red"}>{diff === 0 ? "Cuadrado" : `${diff > 0 ? "+" : "−"} ${money(Math.abs(diff))}`}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
