import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatMoney, todayIn } from "@/lib/utils";
import { ACCOUNT_TYPES, debitNature, type Account, type TrialRow } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Plan de cuentas" };

export default async function ChartPage() {
  const { supabase, settings } = await requireAccess("contabilidad", "view");
  const today = todayIn(settings.timezone);

  const [accountsRes, trialRes] = await Promise.all([
    supabase.from("accounts").select("code, name, type, active").order("code"),
    supabase.rpc("trial_balance", { p_from: today, p_to: today }),
  ]);
  const accounts = (accountsRes.data ?? []) as Account[];
  const balances = new Map(((trialRes.data ?? []) as TrialRow[]).map((r) => [r.code, Number(r.closing)]));

  return (
    <Card>
      <CardHeader title="Plan de cuentas" description="Cuentas del Plan Contable General Empresarial que usa el sistema. Saldo acumulado a hoy." />
      <Table>
        <thead>
          <tr>
            <Th>Código</Th>
            <Th>Denominación</Th>
            <Th>Tipo</Th>
            <Th>Naturaleza</Th>
            <Th className="text-right">Saldo</Th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const sign = debitNature(a.type) ? 1 : -1;
            const balance = sign * (balances.get(a.code) ?? 0);
            return (
              <tr key={a.code} className="transition-colors hover:bg-slate-50/70">
                <Td className="font-mono">{a.code}</Td>
                <Td>
                  <Link href={`/contabilidad/mayor?cuenta=${a.code}`} className="text-slate-900 hover:underline">
                    {a.name}
                  </Link>
                </Td>
                <Td>
                  <Badge>{ACCOUNT_TYPES[a.type]}</Badge>
                </Td>
                <Td className="text-slate-500">{debitNature(a.type) ? "Deudora" : "Acreedora"}</Td>
                <Td className={`tabular text-right font-medium ${balance < 0 ? "text-red-600" : "text-slate-900"}`}>{balance ? formatMoney(balance, settings.currency_symbol) : "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
