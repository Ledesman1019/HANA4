"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Ban, Banknote, FileInput, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { playSound } from "@/lib/sound";
import type { ActionResult } from "@/lib/types";
import { addDays, round2 } from "@/lib/utils";
import { paySupplierInvoice, registerSupplierInvoice, releaseSupplierInvoice, voidSupplierInvoice } from "@/modules/cuentas-pagar/actions";

const METHODS = [
  ["transferencia", "Transferencia"],
  ["cheque", "Cheque"],
  ["efectivo", "Efectivo"],
  ["tarjeta", "Tarjeta"],
  ["yape", "Yape"],
  ["plin", "Plin"],
];

/** Registrar la factura del proveedor de una orden ya recibida. */
export function RegisterInvoiceButton({ purchaseId, orderTotal, today, paymentTerms = 30 }: { purchaseId: string; orderTotal: number; today: string; paymentTerms?: number }) {
  const { money } = useApp();
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(orderTotal.toFixed(2));
  // El vencimiento sigue el plazo de crédito del proveedor desde la fecha de emisión
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, paymentTerms));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const diff = round2((Number(total) || 0) - orderTotal);
  const outOfTolerance = Math.abs(diff) > Math.max(1, round2(orderTotal * 0.01));

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FileInput className="h-4 w-4" />
        Registrar factura
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Factura del proveedor" description={`Se verifica contra la orden: ${money(orderTotal)}`} size="md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await registerSupplierInvoice({
                purchase_id: purchaseId,
                number: String(form.get("number") ?? ""),
                issue_date: String(form.get("issue_date") ?? ""),
                due_date: String(form.get("due_date") ?? ""),
                total: Number(total),
                note: String(form.get("note") ?? ""),
              });
              if (!res.ok) return setError(res.error);
              if (res.data.blocked) toast.warning("Factura registrada y bloqueada para pago", { description: "Su importe no coincide con la orden. Compras debe revisarla." });
              else toast.success("Factura registrada. Ya figura en cuentas por pagar");
              setOpen(false);
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="N.º de factura del proveedor *">
              <Input name="number" required minLength={3} maxLength={30} placeholder="F001-00012345" autoFocus className="tabular uppercase" />
            </Field>
            <Field label="Importe total (con impuesto) *">
              <Input type="number" min={0.01} step="0.01" inputMode="decimal" required value={total} onChange={(e) => setTotal(e.target.value)} className="tabular" />
            </Field>
            <Field label="Fecha de emisión *">
              <Input
                name="issue_date"
                type="date"
                required
                value={issueDate}
                max={today}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  if (e.target.value) setDueDate(addDays(e.target.value, paymentTerms));
                }}
              />
            </Field>
            <Field label="Fecha de vencimiento *" hint={paymentTerms > 0 ? `Crédito del proveedor: ${paymentTerms} días.` : "Proveedor al contado."}>
              <Input name="due_date" type="date" required value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          {outOfTolerance && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Difiere de la orden en <strong className="tabular font-semibold">{money(diff)}</strong>. Quedará <strong className="font-semibold">bloqueada para pago</strong> hasta que Compras
              la revise. Explica la diferencia en la nota.
            </p>
          )}
          <Field label={outOfTolerance ? "Nota (obligatoria) *" : "Nota"}>
            <Textarea name="note" rows={2} maxLength={300} required={outOfTolerance} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar factura
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

/** Registrar un pago (total o parcial) a una factura de proveedor. */
export function PayInvoiceButton({ invoiceId, number, balance, today, compact }: { invoiceId: string; number: string; balance: number; today: string; compact?: boolean }) {
  const { money } = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant={compact ? "secondary" : "success"} size={compact ? "sm" : "md"} onClick={() => setOpen(true)}>
        <Banknote className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Pagar
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Pago de la factura ${number}`} description={`Saldo pendiente: ${money(balance)}`} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await paySupplierInvoice({
                invoice_id: invoiceId,
                amount: Number(form.get("amount")),
                method: String(form.get("method") ?? "") as "transferencia",
                paid_at: String(form.get("paid_at") ?? ""),
                reference: String(form.get("reference") ?? ""),
              });
              if (!res.ok) return setError(res.error);
              playSound("success");
              toast.success(res.data.balance > 0 ? `Pago registrado. Saldo: ${money(res.data.balance)}` : "Pago registrado. Factura cancelada");
              setOpen(false);
            });
          }}
        >
          <Field label="Importe a pagar *" hint="Puedes pagar una parte y el resto después.">
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
            <Field label="Fecha de pago *">
              <Input name="paid_at" type="date" required defaultValue={today} max={today} />
            </Field>
          </div>
          <Field label="N.º de operación o cheque">
            <Input name="reference" maxLength={60} className="tabular" />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="success" loading={pending}>
              Registrar pago
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

/** Botón + ventana que pide un motivo y ejecuta una acción (liberar, anular). */
function NoteAction({
  label,
  icon,
  title,
  description,
  fieldLabel,
  confirmLabel,
  danger,
  run,
  successMessage,
}: {
  label: string;
  icon: ReactNode;
  title: string;
  description: string;
  fieldLabel: string;
  confirmLabel: string;
  danger?: boolean;
  run: (note: string) => Promise<ActionResult>;
  successMessage: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await run(note);
              if (!res.ok) return setError(res.error);
              toast.success(successMessage);
              setOpen(false);
              setNote("");
            });
          }}
        >
          <Field label={fieldLabel}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} maxLength={300} autoFocus />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export function ReleaseInvoiceButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  return (
    <NoteAction
      label="Liberar"
      icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
      title={`Liberar la factura ${number}`}
      description="Confirmas que la diferencia con la orden de compra es correcta. Quedará lista para pagar y se registra en la auditoría."
      fieldLabel="¿Por qué se acepta la diferencia?"
      confirmLabel="Liberar para pago"
      run={(note) => releaseSupplierInvoice(invoiceId, note)}
      successMessage="Factura liberada para pago"
    />
  );
}

export function VoidInvoiceButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  return (
    <NoteAction
      label="Anular"
      icon={<Ban className="h-3.5 w-3.5 text-red-600" />}
      title={`Anular la factura ${number}`}
      description="Solo se puede anular si no tiene pagos. La orden de compra podrá recibir otra factura."
      fieldLabel="Motivo de la anulación"
      confirmLabel="Anular factura"
      danger
      run={(note) => voidSupplierInvoice(invoiceId, note)}
      successMessage="Factura anulada"
    />
  );
}
