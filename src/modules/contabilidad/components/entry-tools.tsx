"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, Plus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { cn, round2 } from "@/lib/utils";
import { postManualEntry, reverseManualEntry, setPeriodStatus } from "@/modules/contabilidad/actions";
import type { Account } from "@/modules/contabilidad/shared";

type Line = { account: string; note: string; debit: string; credit: string; cost_center: string };
const empty = (): Line => ({ account: "", note: "", debit: "", credit: "", cost_center: "" });

/** Asiento manual con líneas dinámicas; no se registra si no cuadra. */
export function ManualEntryForm({
  accounts,
  branches,
  costCenters,
  today,
}: {
  accounts: Account[];
  branches: { value: string; label: string }[];
  costCenters: { value: string; label: string }[];
  today: string;
}) {
  const { money } = useApp();
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState("");
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const debit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const credit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const diff = round2(debit - credit);
  const update = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function submit() {
    setError(null);
    const used = lines.filter((l) => l.account || Number(l.debit) || Number(l.credit));
    if (diff !== 0) return setError(`El asiento no cuadra: diferencia de ${money(Math.abs(diff))}`);
    startTransition(async () => {
      const res = await postManualEntry({
        entry_date: date,
        description,
        branch_id: branch || null,
        lines: used.map((l) => ({ account: l.account, note: l.note, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, cost_center: l.cost_center || null })),
      });
      if (!res.ok) return setError(res.error);
      toast.success("Asiento registrado");
      router.push("/contabilidad");
    });
  }

  return (
    <Card>
      <CardHeader title="Datos del asiento" description="Cada línea va al debe o al haber. El total del debe debe igualar al del haber." />
      <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-[10rem_minmax(0,1fr)_14rem]">
        <Field label="Fecha *">
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Glosa (motivo) *">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Aporte de capital, retiro de caja para depósito…" />
        </Field>
        <Field label="Sucursal">
          <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Toda la empresa</option>
            {branches.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Cuenta</Th>
            <Th>Detalle</Th>
            <Th className="w-44">Centro de costo</Th>
            <Th className="w-36 text-right">Debe</Th>
            <Th className="w-36 text-right">Haber</Th>
            <Th className="w-px" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <Td className="min-w-64">
                <Select value={l.account} onChange={(e) => update(i, { account: e.target.value })} aria-label={`Cuenta de la línea ${i + 1}`}>
                  <option value="">Elige una cuenta…</option>
                  {accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td>
                <Input value={l.note} onChange={(e) => update(i, { note: e.target.value })} maxLength={120} aria-label={`Detalle de la línea ${i + 1}`} />
              </Td>
              <Td>
                {/* El centro de costo solo aplica a cuentas de gasto (clase 6) */}
                <Select value={l.cost_center} disabled={!l.account.startsWith("6")} onChange={(e) => update(i, { cost_center: e.target.value })} aria-label={`Centro de costo de la línea ${i + 1}`}>
                  <option value="">—</option>
                  {costCenters.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={l.debit}
                  onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                  aria-label={`Debe de la línea ${i + 1}`}
                  className="tabular text-right"
                />
              </Td>
              <Td>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={l.credit}
                  onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                  aria-label={`Haber de la línea ${i + 1}`}
                  className="tabular text-right"
                />
              </Td>
              <Td>
                <Button variant="ghost" size="icon" disabled={lines.length <= 2} aria-label={`Quitar la línea ${i + 1}`} onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="tabular font-semibold text-slate-900">
            <Td>
              <Button variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, empty()])}>
                <Plus className="h-3.5 w-3.5" />
                Agregar línea
              </Button>
            </Td>
            <Td />
            <Td className="text-right text-xs font-medium text-slate-500">Totales</Td>
            <Td className="text-right">{money(debit)}</Td>
            <Td className="text-right">{money(credit)}</Td>
            <Td />
          </tr>
        </tfoot>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className={cn("text-sm font-medium", diff === 0 && debit > 0 ? "text-emerald-700" : "text-amber-700")}>
          {debit === 0 ? "Ingresa los importes." : diff === 0 ? "El asiento cuadra." : `Diferencia: ${money(Math.abs(diff))}`}
        </p>
        <div className="flex items-center gap-3">
          <FormError message={error} />
          <Button loading={pending} disabled={diff !== 0 || debit === 0} onClick={submit}>
            Registrar asiento
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ReverseEntryButton({ entryId, number }: { entryId: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Undo2 className="h-3.5 w-3.5" />
        Extornar
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Extornar el asiento ${number}`} description="Se registra un asiento inverso con fecha de hoy. El original no se borra." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await reverseManualEntry(entryId, reason);
              if (!res.ok) return setError(res.error);
              toast.success("Asiento extornado");
              setOpen(false);
            });
          }}
        >
          <Field label="Motivo">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={200} autoFocus />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Extornar
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export function PeriodToggle({ period, label, closed }: { period: string; label: string; closed: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant={closed ? "secondary" : "primary"} size="sm" onClick={() => setOpen(true)}>
        {closed ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {closed ? "Reabrir" : "Cerrar"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${closed ? "Reabrir" : "Cerrar"} ${label}`}
        description={
          closed
            ? "Se podrán volver a registrar operaciones con fecha de este mes. Queda en la auditoría."
            : "Nadie podrá registrar operaciones con fecha de este mes (gastos, facturas, pagos, asientos). Queda en la auditoría."
        }
        size="sm"
      >
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Volver
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await setPeriodStatus(period, !closed);
                if (!res.ok) return setError(res.error);
                toast.success(closed ? "Periodo reabierto" : "Periodo cerrado");
                setOpen(false);
              })
            }
          >
            {closed ? "Reabrir periodo" : "Cerrar periodo"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
