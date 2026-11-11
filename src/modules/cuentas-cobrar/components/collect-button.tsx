"use client";

import { useState, useTransition } from "react";
import { HandCoins } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { playSound } from "@/lib/sound";
import { collectPayment } from "@/modules/cuentas-cobrar/actions";

const METHODS = [
  ["efectivo", "Efectivo (entra a tu caja)"],
  ["transferencia", "Transferencia"],
  ["yape", "Yape"],
  ["plin", "Plin"],
  ["tarjeta", "Tarjeta"],
  ["cheque", "Cheque"],
];

/** Registrar el cobro de una venta al crédito. */
export function CollectButton({ saleId, number, customer, balance, today, compact }: { saleId: string; number: string; customer: string; balance: number; today: string; compact?: boolean }) {
  const { money } = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant={compact ? "secondary" : "success"} size={compact ? "sm" : "md"} onClick={() => setOpen(true)}>
        <HandCoins className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Cobrar
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Cobro de ${number}`} description={`${customer} · saldo ${money(balance)}`} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await collectPayment({
                sale_id: saleId,
                amount: Number(form.get("amount")),
                method: String(form.get("method") ?? "") as "efectivo",
                paid_at: String(form.get("paid_at") ?? ""),
                reference: String(form.get("reference") ?? ""),
              });
              if (!res.ok) {
                playSound("error");
                return setError(res.error);
              }
              playSound("success");
              toast.success(res.data.balance > 0 ? `Cobro registrado. Saldo: ${money(res.data.balance)}` : "Cobro registrado. Deuda cancelada");
              setOpen(false);
            });
          }}
        >
          <Field label="Importe cobrado *" hint="Puede ser un abono parcial.">
            <Input name="amount" type="number" min={0.01} max={balance} step="0.01" inputMode="decimal" required defaultValue={balance.toFixed(2)} autoFocus className="tabular h-11 text-lg" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Medio de pago *">
              <Select name="method" defaultValue="transferencia" required>
                {METHODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha del cobro *">
              <Input name="paid_at" type="date" required defaultValue={today} max={today} />
            </Field>
          </div>
          <Field label="N.º de operación">
            <Input name="reference" maxLength={60} className="tabular" />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="success" loading={pending}>
              Registrar cobro
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
