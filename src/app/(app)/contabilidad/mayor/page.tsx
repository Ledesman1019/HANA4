import type { Metadata } from "next";
import Form from "next/form";
import { ExportMenu } from "@/components/export-menu";
import { param } from "@/components/filters";
import { Button, Card, CardHeader, EmptyState, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { formatDate, formatMoney, isIsoDate, todayIn } from "@/lib/utils";
import { debitNature, SOURCE_LABELS, type Account, type TrialRow } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Libro mayor" };

type Move = { entry_id: string; number: string; entry_date: string; description: string; source_type: string; note: string; debit: number; credit: number };

export default async function LedgerPage({ searchParams }: PageProps<"/contabilidad/mayor">) {
  const { supabase, settings } = await requireAccess("contabilidad", "view");
  const sp = await searchParams;
  const today = todayIn(settings.timezone);
  const from = isIsoDate(param(sp.desde)) ? param(sp.desde) : `${today.slice(0, 7)}-01`;
  const to = isIsoDate(param(sp.hasta)) ? param(sp.hasta) : today;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const { data: accountsData } = await supabase.from("accounts").select("code, name, type, active").order("code");
  const accounts = (accountsData ?? []) as Account[];
  const code = accounts.some((a) => a.code === param(sp.cuenta)) ? param(sp.cuenta) : "1011";
  const account = accounts.find((a) => a.code === code);

  const [movesRes, trialRes] = await Promise.all([
    supabase.rpc("account_ledger", { p_account: code, p_from: from, p_to: to }),
    supabase.rpc("trial_balance", { p_from: from, p_to: to }),
  ]);
  const moves = (movesRes.data ?? []) as Move[];
  const row = ((trialRes.data ?? []) as TrialRow[]).find((r) => r.code === code);

  // El saldo se muestra en el sentido natural de la cuenta (deudor o acreedor)
  const sign = account && debitNature(account.type) ? 1 : -1;
  const opening = sign * Number(row?.opening ?? 0);
  const rows = moves.reduce<(Move & { balance: number })[]>((acc, m) => {
    const previous = acc.length ? acc[acc.length - 1].balance : opening;
    acc.push({ ...m, balance: previous + sign * (Number(m.debit) - Number(m.credit)) });
    return acc;
  }, []);
  const running = rows.length ? rows[rows.length - 1].balance : opening;

  return (
    <>
      <Card className="mb-4">
        <Form action="/contabilidad/mayor" className="flex flex-wrap items-end gap-3 p-3">
          <Field label="Cuenta" className="min-w-72 flex-1">
            <Select name="cuenta" defaultValue={code}>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Desde">
            <Input type="date" name="desde" defaultValue={from} />
          </Field>
          <Field label="Hasta">
            <Input type="date" name="hasta" defaultValue={to} />
          </Field>
          <Button type="submit" variant="secondary">
            Ver
          </Button>
        </Form>
      </Card>

      <Card>
        <CardHeader
          title={`${code} · ${account?.name ?? ""}`}
          description={`Del ${formatDate(from)} al ${formatDate(to)} · saldo ${account && debitNature(account.type) ? "deudor" : "acreedor"}`}
          action={
            <ExportMenu
              title={`Libro mayor · ${code} ${account?.name ?? ""}`}
              subtitle={`Del ${formatDate(from)} al ${formatDate(to)}`}
              filename={`libro_mayor_${code}_${from}_${to}`}
              size="sm"
              columns={[
                { key: "fecha", header: "Fecha", type: "date" },
                { key: "asiento", header: "Asiento" },
                { key: "glosa", header: "Glosa", width: 44 },
                { key: "debe", header: "Debe", type: "money", total: true },
                { key: "haber", header: "Haber", type: "money", total: true },
                { key: "saldo", header: "Saldo", type: "money" },
              ]}
              rows={[
                { fecha: from, asiento: "", glosa: "Saldo inicial", debe: null, haber: null, saldo: opening },
                ...rows.map((m) => ({ fecha: m.entry_date, asiento: m.number, glosa: m.description, debe: Number(m.debit) || null, haber: Number(m.credit) || null, saldo: m.balance })),
              ]}
            />
          }
        />
        {rows.length === 0 && opening === 0 ? (
          <EmptyState title="Sin movimientos" description="Esta cuenta no tiene movimientos en el rango elegido." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Asiento</Th>
                <Th>Glosa</Th>
                <Th className="text-right">Debe</Th>
                <Th className="text-right">Haber</Th>
                <Th className="text-right">Saldo</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              <tr className="bg-slate-50/70">
                <Td>{formatDate(from)}</Td>
                <Td />
                <Td className="font-medium text-slate-700">Saldo inicial</Td>
                <Td />
                <Td />
                <Td className="text-right font-medium text-slate-900">{money(opening)}</Td>
              </tr>
              {rows.map((m, i) => (
                <tr key={`${m.entry_id}-${i}`}>
                  <Td className="whitespace-nowrap">{formatDate(m.entry_date)}</Td>
                  <Td className="font-mono text-xs">{m.number}</Td>
                  <Td>
                    {m.description}
                    <span className="ml-2 text-xs text-slate-400">{SOURCE_LABELS[m.source_type]}</span>
                  </Td>
                  <Td className="text-right">{Number(m.debit) > 0 ? money(m.debit) : ""}</Td>
                  <Td className="text-right">{Number(m.credit) > 0 ? money(m.credit) : ""}</Td>
                  <Td className={`text-right font-medium ${m.balance < 0 ? "text-red-600" : "text-slate-900"}`}>{money(m.balance)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tabular font-semibold text-slate-900">
                <Td colSpan={3} className="text-right">
                  Movimientos del periodo
                </Td>
                <Td className="text-right">{money(Number(row?.debit ?? 0))}</Td>
                <Td className="text-right">{money(Number(row?.credit ?? 0))}</Td>
                <Td className="text-right">{money(running)}</Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
