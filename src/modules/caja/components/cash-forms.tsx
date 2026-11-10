"use client";

import { useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { addCashMovement, closeCashSession, openCashSession } from "@/modules/caja/actions";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Card, Field, FormError, Input, Textarea } from "@/components/ui";
import { cn, round2 } from "@/lib/utils";

export function OpenCashCard({ branchName }: { branchName: string }) {
  const { settings } = useApp();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-link">
        <Wallet className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-900">Abrir caja</h2>
      <p className="mt-1 text-sm text-slate-500">Cuenta el efectivo con el que inicias el turno en {branchName}. Al cierre se comparará contra lo vendido.</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await openCashSession(Number(amount) || 0);
            if (!res.ok) return setError(res.error);
            toast.success("Caja abierta. ¡Buen turno!");
          });
        }}
      >
        <Field label={`Efectivo inicial (${settings.currency_symbol})`}>
          <Input type="number" min={0} step="0.01" inputMode="decimal" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="tabular h-11 text-lg" />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Abrir caja
        </Button>
      </form>
    </Card>
  );
}

export function CashMovementButton({ sessionId, type }: { sessionId: string; type: "ingreso" | "egreso" }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isIn = type === "ingreso";

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {isIn ? <ArrowDownLeft className="h-4 w-4 text-emerald-600" /> : <ArrowUpRight className="h-4 w-4 text-red-600" />}
        {isIn ? "Ingreso" : "Retiro"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={isIn ? "Registrar ingreso de efectivo" : "Registrar retiro de efectivo"}
        description={isIn ? "Dinero que entra a caja sin ser una venta (p. ej. sencillo)." : "Dinero que sale de caja (p. ej. pago a un proveedor menor)."}
        size="sm"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await addCashMovement(sessionId, type, Number(form.get("amount")), String(form.get("concept") ?? ""));
              if (!res.ok) return setError(res.error);
              toast.success("Movimiento registrado");
              setOpen(false);
            });
          }}
        >
          <Field label="Monto">
            <Input name="amount" type="number" min={0.01} step="0.01" inputMode="decimal" required autoFocus className="tabular" />
          </Field>
          <Field label="Concepto">
            <Input name="concept" required minLength={3} maxLength={200} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export function CloseCashButton({ sessionId, expected }: { sessionId: string; expected: number }) {
  const { money } = useApp();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const diff = counted === "" ? null : round2(Number(counted) - expected);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Lock className="h-4 w-4" />
        Cerrar caja
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Cierre de caja" description="Cuenta el efectivo físico e ingrésalo. El sistema calcula la diferencia." size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await closeCashSession(sessionId, Number(counted), note);
              if (!res.ok) return setError(res.error);
              const d = res.data.difference;
              if (d === 0) toast.success("Caja cerrada sin diferencias");
              else toast.warning(`Caja cerrada con ${d > 0 ? "sobrante" : "faltante"} de ${money(Math.abs(d))}`);
              setOpen(false);
              setCounted("");
              setNote("");
            });
          }}
        >
          <div className="flex items-baseline justify-between rounded-lg bg-slate-100 px-4 py-2.5">
            <span className="text-sm text-slate-600">Efectivo esperado</span>
            <span className="tabular text-lg font-semibold text-slate-900">{money(expected)}</span>
          </div>
          <Field label="Efectivo contado">
            <Input type="number" min={0} step="0.01" inputMode="decimal" required autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} className="tabular h-11 text-lg" />
          </Field>
          {diff !== null && (
            <p className={cn("rounded-lg px-3 py-2 text-sm font-medium", diff === 0 ? "bg-emerald-50 text-emerald-700" : diff > 0 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700")}>
              {diff === 0 ? "Cuadra exacto" : `${diff > 0 ? "Sobrante" : "Faltante"} de ${money(Math.abs(diff))}`}
            </p>
          )}
          <Field label="Observaciones (opcional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Cerrar caja
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
