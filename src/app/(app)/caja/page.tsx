import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Banknote, CreditCard, History, Wallet } from "lucide-react";
import { Badge, buttonClass, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { CashSession } from "@/modules/caja/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { CashMovementButton, CloseCashButton, OpenCashCard } from "@/modules/caja/components/cash-forms";

export const metadata: Metadata = { title: "Caja" };

type Movement = { id: string; type: "ingreso" | "egreso"; amount: number; concept: string; created_at: string };

export default async function CashPage() {
  const { supabase, userId, settings, branch, can } = await requireAccess("caja");
  const money = (n: number | null) => formatMoney(n, settings.currency_symbol);
  const canOperate = can("caja", "create");

  const openRes = await supabase.from("cash_sessions").select("*, branch:branches(name)").eq("opened_by", userId).eq("status", "abierta").maybeSingle();
  const session = openRes.data as (CashSession & { branch: { name: string } | null }) | null;

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
      <PageHeader title="Caja: apertura y cierre" description="Tu turno: apertura, ingresos y retiros de efectivo y arqueo al cierre.">
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
      ) : (
        <EmptyState
          icon={<History className="h-5 w-5" />}
          title="Tu rol solo consulta la caja"
          description="Puedes revisar los arqueos de todas las cajas en el historial de cierres."
          action={
            <Link href="/caja/cierres" className={buttonClass("secondary")}>
              Ver cierres de caja
            </Link>
          }
        />
      )}

    </>
  );
}
