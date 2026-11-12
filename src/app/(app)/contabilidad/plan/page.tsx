import type { Metadata } from "next";
import Link from "next/link";
import { ExportMenu } from "@/components/export-menu";
import { FilterBar, param } from "@/components/filters";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatMoney, todayIn } from "@/lib/utils";
import { ACCOUNT_TYPES, debitNature, type Account, type TrialRow } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Plan de cuentas" };

export default async function ChartPage({ searchParams }: PageProps<"/contabilidad/plan">) {
  const { supabase, settings } = await requireAccess("contabilidad", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);
  const q = param(sp.q).trim().toLowerCase().slice(0, 40);
  const type = Object.hasOwn(ACCOUNT_TYPES, param(sp.tipo)) ? param(sp.tipo) : "";

  const [accountsRes, trialRes] = await Promise.all([
    supabase.from("accounts").select("code, name, type, active").order("code"),
    supabase.rpc("trial_balance", { p_from: today, p_to: today }),
  ]);
  const accounts = (accountsRes.data ?? []) as Account[];
  const balances = new Map(((trialRes.data ?? []) as TrialRow[]).map((r) => [r.code, Number(r.closing)]));
  const balanceOf = (a: Account) => (debitNature(a.type) ? 1 : -1) * (balances.get(a.code) ?? 0);
  const shown = accounts.filter((a) => (!type || a.type === type) && (!q || a.code.startsWith(q) || a.name.toLowerCase().includes(q)));

  return (
    <Card>
      <CardHeader
        title="Cuentas contables"
        description="Saldo acumulado a hoy. Haz clic en una cuenta para ver su libro mayor."
        action={
          <ExportMenu
            title="Plan de cuentas"
            subtitle={`Saldos al ${today}`}
            filename="plan-de-cuentas"
            size="sm"
            columns={[
              { key: "codigo", header: "Código" },
              { key: "cuenta", header: "Denominación", width: 40 },
              { key: "tipo", header: "Tipo" },
              { key: "naturaleza", header: "Naturaleza" },
              { key: "saldo", header: "Saldo", type: "money" },
            ]}
            rows={shown.map((a) => ({ codigo: a.code, cuenta: a.name, tipo: ACCOUNT_TYPES[a.type], naturaleza: debitNature(a.type) ? "Deudora" : "Acreedora", saldo: balanceOf(a) || null }))}
          />
        }
      />
      <FilterBar action="/contabilidad/plan">
        <Field label="Cuenta">
          <Input type="search" name="q" defaultValue={q} placeholder="Código o nombre" />
        </Field>
        <Field label="Tipo">
          <Select name="tipo" defaultValue={type}>
            <option value="">Todos</option>
            {Object.entries(ACCOUNT_TYPES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      {shown.length === 0 && <EmptyState title="Sin cuentas con ese filtro" />}
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
          {shown.map((a) => {
            const balance = balanceOf(a);
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
