"use client";

import { useMemo, useState, useTransition } from "react";
import { Banknote, Search } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, Input, Select, Table, Td, Th, Textarea } from "@/components/ui";
import { payPayroll, voidPayrollPayment } from "@/modules/rrhh/actions";

export type PayrollLine = {
  employeeId: string;
  name: string;
  position: string;
  salary: number;
  commissions: number;
  /** Número del pago si ya se pagó el mes */
  paid: string | null;
};

/** Planilla del mes: selecciona colaboradores y registra el pago (sueldo + comisiones). */
export function PayrollForm({ period, lines, today, canPay }: { period: string; lines: PayrollLine[]; today: string; canPay: boolean }) {
  const { money } = useApp();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"todos" | "pendientes" | "pagados">("pendientes");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter(
      (l) => (state === "todos" || (state === "pagados") === Boolean(l.paid)) && (!q || l.name.toLowerCase().includes(q) || l.position.toLowerCase().includes(q)),
    );
  }, [lines, query, state]);
  const payable = shown.filter((l) => !l.paid && l.salary + l.commissions > 0);
  const chosen = lines.filter((l) => selected.has(l.employeeId));
  const total = chosen.reduce((sum, l) => sum + l.salary + l.commissions, 0);
  const allChosen = payable.length > 0 && payable.every((l) => selected.has(l.employeeId));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title={`Planilla de ${period}`}
        description="Sueldo del mes más las comisiones generadas y aún no pagadas."
        action={
          canPay && (
            <Button disabled={chosen.length === 0} onClick={() => setOpen(true)}>
              <Banknote className="h-4 w-4" />
              Pagar {chosen.length > 0 ? `${chosen.length} · ${money(total)}` : "seleccionados"}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar colaborador o cargo…" aria-label="Buscar" className="pl-9" />
        </div>
        <Select value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label="Estado" className="w-44">
          <option value="pendientes">Por pagar</option>
          <option value="pagados">Pagados</option>
          <option value="todos">Todos</option>
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Banknote className="h-5 w-5" />} title="Sin colaboradores en esta vista" description="Cambia el filtro o el mes." />
      ) : (
        <Table>
          <thead>
            <tr>
              {canPay && (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={allChosen}
                    onChange={() => setSelected(allChosen ? new Set() : new Set(payable.map((l) => l.employeeId)))}
                    className="h-4 w-4 cursor-pointer accent-brand-600"
                  />
                </Th>
              )}
              <Th>Colaborador</Th>
              <Th className="text-right">Sueldo</Th>
              <Th className="text-right">Comisiones</Th>
              <Th className="text-right">Total</Th>
              <Th>Estado</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const can = !l.paid && l.salary + l.commissions > 0;
              return (
                <tr key={l.employeeId} className={selected.has(l.employeeId) ? "bg-brand-50/60" : undefined}>
                  {canPay && (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar a ${l.name}`}
                        disabled={!can}
                        checked={selected.has(l.employeeId)}
                        onChange={() => toggle(l.employeeId)}
                        className="h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
                      />
                    </Td>
                  )}
                  <Td>
                    <p className="font-medium text-slate-900">{l.name}</p>
                    <p className="text-xs text-slate-500">{l.position}</p>
                  </Td>
                  <Td className="tabular text-right">{money(l.salary)}</Td>
                  <Td className="tabular text-right">{money(l.commissions)}</Td>
                  <Td className="tabular text-right font-semibold text-slate-900">{money(l.salary + l.commissions)}</Td>
                  <Td>{l.paid ? <Badge tone="green">Pagado · {l.paid}</Badge> : <Badge tone="amber">Por pagar</Badge>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Pagar planilla" description={`${chosen.length} colaboradores · total ${money(total)}`} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await payPayroll({
                period,
                employees: chosen.map((l) => l.employeeId),
                method: String(form.get("method")) as "efectivo" | "transferencia",
                date: String(form.get("date")),
                note: String(form.get("note") ?? ""),
              });
              if (!res.ok) return setError(res.error);
              toast.success(`Planilla pagada: ${res.data.count} ${res.data.count === 1 ? "colaborador" : "colaboradores"}`);
              setSelected(new Set());
              setOpen(false);
            });
          }}
        >
          <Field label="Medio de pago">
            <Select name="method" defaultValue="transferencia">
              <option value="transferencia">Transferencia bancaria</option>
              <option value="efectivo">Efectivo</option>
            </Select>
          </Field>
          <Field label="Fecha de pago">
            <Input type="date" name="date" defaultValue={today} max={today} required />
          </Field>
          <Field label="Nota (opcional)">
            <Textarea name="note" rows={2} maxLength={200} />
          </Field>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Se registra el asiento: sueldos (6211) y comisiones por pagar (4111) contra {""}
            caja o bancos. Queda en la auditoría.
          </p>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Confirmar pago
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </Card>
  );
}

export function VoidPayrollButton({ id, number }: { id: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-red-600">
        Anular
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Anular pago ${number}`} description="Se extorna el asiento y las comisiones vuelven a quedar por pagar." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            setError(null);
            startTransition(async () => {
              const res = await voidPayrollPayment(id, reason);
              if (!res.ok) return setError(res.error);
              toast.success("Pago anulado");
              setOpen(false);
            });
          }}
        >
          <Field label="Motivo">
            <Textarea name="reason" rows={2} required minLength={5} maxLength={200} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Anular pago
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
