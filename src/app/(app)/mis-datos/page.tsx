import type { Metadata } from "next";
import { Banknote, HandCoins, IdCard, UserRound } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { getContext } from "@/lib/auth";
import type { Employee } from "@/modules/rrhh/types";
import { formatDate, formatDateTime, formatMoney, todayIn, zonedDayStart } from "@/lib/utils";

export const metadata: Metadata = { title: "Mis datos" };

type Payment = { id: string; number: string; period: string; salary: number; commissions: number; total: number; method: string; paid_at: string; status: string };
type Commission = { id: string; base: number; rate: number; amount: number; status: string; created_at: string; payroll_id: string | null; sale: { number: string } | null };

/**
 * Autoservicio: cada usuario ve solo su ficha de colaborador, sus pagos de planilla
 * y sus comisiones. La base de datos lo garantiza (RLS), no esta pantalla.
 */
export default async function MyDataPage() {
  const { supabase, profile, roleName, branch, settings } = await getContext();
  const tz = settings.timezone;
  const money = (n: number) => formatMoney(n, settings.currency_symbol);
  const month = todayIn(tz).slice(0, 7);

  const { data: employee } = await supabase.from("employees").select("*").eq("profile_id", profile.id).maybeSingle();
  const me = employee as Employee | null;

  const [paymentsRes, commissionsRes] = me
    ? await Promise.all([
        supabase.from("payroll_payments").select("id, number, period, salary, commissions, total, method, paid_at, status").eq("employee_id", me.id).order("period", { ascending: false }).limit(24),
        supabase
          .from("commissions")
          .select("id, base, rate, amount, status, created_at, payroll_id, sale:sales(number)")
          .eq("employee_id", me.id)
          .gte("created_at", zonedDayStart(`${month}-01`, tz))
          .order("created_at", { ascending: false })
          .limit(200),
      ])
    : [{ data: [] }, { data: [] }];
  const payments = (paymentsRes.data ?? []) as Payment[];
  const commissions = (commissionsRes.data ?? []) as unknown as Commission[];
  const monthCommission = commissions.filter((c) => c.status === "generada").reduce((sum, c) => sum + Number(c.amount), 0);

  return (
    <>
      <PageHeader title="Mis datos" description="Tu ficha de colaborador, tus pagos de planilla y tus comisiones del mes. Solo tú los ves." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Usuario" value={profile.full_name} icon={<UserRound className="h-4 w-4" />} tone="slate" hint={`${roleName} · ${branch.name}`} />
        <StatCard label="Cargo" value={me?.position ?? "—"} icon={<IdCard className="h-4 w-4" />} tone="slate" hint={me ? `Desde ${formatDate(me.hire_date)}` : "Sin ficha de colaborador"} />
        <StatCard label="Sueldo mensual" value={me ? money(Number(me.salary)) : "—"} icon={<Banknote className="h-4 w-4" />} tone="slate" />
        <StatCard label="Comisiones del mes" value={money(monthCommission)} icon={<HandCoins className="h-4 w-4" />} tone="green" hint={me ? `${Number(me.commission_rate)}% sobre tus ventas` : undefined} />
      </div>

      {!me ? (
        <Card>
          <EmptyState
            icon={<IdCard className="h-5 w-5" />}
            title="Tu usuario no está vinculado a una ficha de colaborador"
            description="Pídele a Recursos Humanos que vincule tu ficha con tu usuario para ver aquí tus pagos y comisiones."
          />
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader title="Mis pagos de planilla" description="Últimos 24 periodos." />
            {payments.length === 0 ? (
              <EmptyState icon={<Banknote className="h-5 w-5" />} title="Aún no tienes pagos registrados" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Periodo</Th>
                    <Th>Pago</Th>
                    <Th>Fecha</Th>
                    <Th className="text-right">Sueldo</Th>
                    <Th className="text-right">Comisiones</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <Td className="tabular font-medium">{p.period}</Td>
                      <Td className="tabular">{p.number}</Td>
                      <Td className="tabular">{formatDate(p.paid_at)}</Td>
                      <Td className="tabular text-right">{money(Number(p.salary))}</Td>
                      <Td className="tabular text-right">{money(Number(p.commissions))}</Td>
                      <Td className="tabular text-right font-semibold">{money(Number(p.total))}</Td>
                      <Td>{p.status === "pagado" ? <Badge tone="green">Pagado</Badge> : <Badge tone="neutral">Anulado</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Mis comisiones del mes" description="Cada venta tuya genera su comisión; si la venta se anula, la comisión también." />
            {commissions.length === 0 ? (
              <EmptyState icon={<HandCoins className="h-5 w-5" />} title="Sin comisiones este mes" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Comprobante</Th>
                    <Th className="text-right">Venta neta</Th>
                    <Th className="text-right">%</Th>
                    <Th className="text-right">Comisión</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id}>
                      <Td className="tabular whitespace-nowrap">{formatDateTime(c.created_at, tz)}</Td>
                      <Td className="tabular">{c.sale?.number ?? "—"}</Td>
                      <Td className="tabular text-right">{money(Number(c.base))}</Td>
                      <Td className="tabular text-right">{Number(c.rate)}%</Td>
                      <Td className="tabular text-right font-medium">{money(Number(c.amount))}</Td>
                      <Td>
                        {c.status === "anulada" ? <Badge tone="neutral">Anulada</Badge> : c.payroll_id ? <Badge tone="green">Pagada</Badge> : <Badge tone="amber">Por pagar</Badge>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
