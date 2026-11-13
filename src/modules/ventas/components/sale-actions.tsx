"use client";

import { useState, useTransition } from "react";
import { Ban, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { issuePartialCreditNote, voidSale } from "@/modules/ventas/actions";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Imprimir
    </Button>
  );
}

export function VoidSaleButton({ saleId, number }: { saleId: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Ban className="h-4 w-4 text-red-600" />
        Anular
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Anular ${number}`}
        description="Los productos regresan al inventario y la venta deja de contar en caja y reportes. No se puede deshacer."
        size="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await voidSale(saleId, reason);
              if (!res.ok) return setError(res.error);
              toast.success("Venta anulada");
              setOpen(false);
              setReason("");
            });
          }}
          className="space-y-4"
        >
          <Field label="Motivo de la anulación">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} autoFocus />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Anular venta
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export type ReturnableLine = { product_id: string; name: string; sku: string; sold: number; returned: number; price: number };

/**
 * Nota de crédito parcial: el cliente devuelve solo algunos productos (o parte de
 * sus cantidades). El stock regresa, se devuelve el dinero (o baja la deuda si fue
 * al crédito) y la nota se envía a SUNAT.
 */
export function CreditNoteButton({
  saleId,
  number,
  lines,
  credit,
  paymentMethod,
  money,
}: {
  saleId: string;
  number: string;
  lines: ReturnableLine[];
  credit: boolean;
  paymentMethod: string;
  money: { symbol: string };
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(paymentMethod === "credito" ? "efectivo" : paymentMethod);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fmt = (n: number) => `${money.symbol} ${n.toFixed(2)}`;

  const chosen = lines
    .map((l) => ({ ...l, q: Math.min(Number(qty[l.product_id] || 0), l.sold - l.returned) }))
    .filter((l) => l.q > 0);
  const total = chosen.reduce((s, l) => s + l.q * l.price, 0);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Undo2 className="h-4 w-4 text-amber-600" />
        Nota de crédito
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Nota de crédito · ${number}`}
        description="Indica cuántas unidades devuelve el cliente de cada producto. Lo devuelto regresa al inventario."
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (chosen.length === 0) return setError("Indica al menos una unidad a devolver");
            startTransition(async () => {
              const res = await issuePartialCreditNote({
                sale_id: saleId,
                items: chosen.map((l) => ({ product_id: l.product_id, quantity: l.q })),
                reason,
                refund_method: credit ? null : (method as "efectivo"),
              });
              if (!res.ok) return setError(res.error);
              toast.success("Nota de crédito emitida");
              setOpen(false);
              setQty({});
              setReason("");
            });
          }}
          className="space-y-4"
        >
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Producto</th>
                  <th className="px-3 py-2 text-right font-medium">Puede devolver</th>
                  <th className="px-3 py-2 text-right font-medium">Devuelve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => {
                  const left = l.sold - l.returned;
                  return (
                    <tr key={l.product_id}>
                      <td className="px-3 py-2">
                        <span className="block text-slate-900">{l.name}</span>
                        <span className="tabular text-xs text-slate-500">
                          {l.sku} · {fmt(l.price)} c/u{l.returned > 0 && ` · ya devuelto ${l.returned}`}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2 text-right">{left}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={0}
                          max={left}
                          step="any"
                          disabled={left <= 0}
                          value={qty[l.product_id] ?? ""}
                          onChange={(e) => setQty((x) => ({ ...x, [l.product_id]: e.target.value }))}
                          className="ml-auto w-20 text-right"
                          aria-label={`Unidades a devolver de ${l.name}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!credit ? (
            <Field label="Devolver el dinero en">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="efectivo">Efectivo (sale de tu caja abierta)</option>
                <option value="tarjeta">Tarjeta (extorno)</option>
                <option value="yape">Yape</option>
                <option value="plin">Plin</option>
                <option value="transferencia">Transferencia</option>
              </Select>
            </Field>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Venta al crédito: el importe se descuenta de la deuda del cliente.</p>
          )}
          <Field label="Motivo">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={300} placeholder="Ej. producto con falla de fábrica" />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <span className="mr-auto self-center text-sm text-slate-600">
              Total de la nota: <strong className="tabular text-slate-900">{fmt(total)}</strong>
            </span>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={chosen.length === 0}>
              Emitir nota de crédito
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
