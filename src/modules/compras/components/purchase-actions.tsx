"use client";

import { useState, useTransition } from "react";
import { Ban, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Input } from "@/components/ui";
import { cancelPurchase, receivePurchase } from "@/modules/compras/actions";

/** Producto de la orden que controla lotes: al recibirlo se pide lote y vencimiento. */
export type TrackedItem = { product_id: string; name: string; quantity: number };

export function PurchaseActions({
  purchaseId,
  number,
  canReceive,
  canCancel,
  trackedItems = [],
  today,
}: {
  purchaseId: string;
  number: string;
  canReceive: boolean;
  canCancel: boolean;
  trackedItems?: TrackedItem[];
  today: string;
}) {
  const [confirming, setConfirming] = useState<"receive" | "cancel" | null>(null);
  const [lots, setLots] = useState<Record<string, { lot_number: string; expiry_date: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    const kind = confirming;
    if (!kind) return;
    setError(null);
    if (kind === "receive") {
      const missing = trackedItems.find((t) => !lots[t.product_id]?.lot_number?.trim() || !lots[t.product_id]?.expiry_date);
      if (missing) return setError(`Indica el lote y el vencimiento de «${missing.name}»`);
    }
    startTransition(async () => {
      const res =
        kind === "receive"
          ? await receivePurchase(
              purchaseId,
              trackedItems.map((t) => ({ product_id: t.product_id, ...lots[t.product_id] })),
            )
          : await cancelPurchase(purchaseId);
      if (!res.ok) return setError(res.error);
      toast.success(kind === "receive" ? "Mercadería recibida. Stock actualizado" : "Orden anulada");
      setConfirming(null);
    });
  }

  const close = () => {
    setConfirming(null);
    setError(null);
  };

  const setLot = (id: string, patch: Partial<{ lot_number: string; expiry_date: string }>) =>
    setLots((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { lot_number: "", expiry_date: "" }), ...patch } }));

  return (
    <>
      {canCancel && (
        <Button variant="secondary" onClick={() => setConfirming("cancel")}>
          <Ban className="h-4 w-4 text-red-600" />
          Anular
        </Button>
      )}
      {canReceive && (
        <Button variant="success" onClick={() => setConfirming("receive")}>
          <PackageCheck className="h-4 w-4" />
          Recibir mercadería
        </Button>
      )}
      <Dialog
        open={confirming !== null}
        onClose={close}
        title={confirming === "cancel" ? `¿Anular la orden ${number}?` : `Recibir la orden ${number}`}
        description={
          confirming === "cancel"
            ? "La orden quedará anulada y no ingresará stock."
            : "Se ingresarán todas las cantidades al inventario y se recalculará el costo promedio de cada producto. No se puede deshacer."
        }
        size={confirming === "receive" && trackedItems.length > 0 ? "md" : "sm"}
      >
        {confirming === "receive" && trackedItems.length > 0 && (
          <div className="mb-4 space-y-3">
            <p className="text-sm text-slate-600">Estos productos controlan lotes. Copia el lote y el vencimiento del empaque:</p>
            {trackedItems.map((t) => (
              <div key={t.product_id} className="rounded-xl border border-slate-200 p-3">
                <p className="mb-2 text-sm font-medium text-slate-900">
                  {t.name} <span className="font-normal text-slate-500">· {t.quantity} u.</span>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="N.º de lote">
                    <Input value={lots[t.product_id]?.lot_number ?? ""} onChange={(e) => setLot(t.product_id, { lot_number: e.target.value })} maxLength={40} className="uppercase" />
                  </Field>
                  <Field label="Vence el">
                    <Input type="date" min={today} value={lots[t.product_id]?.expiry_date ?? ""} onChange={(e) => setLot(t.product_id, { expiry_date: e.target.value })} />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Volver
          </Button>
          <Button variant={confirming === "cancel" ? "danger" : "success"} loading={pending} onClick={run}>
            {confirming === "cancel" ? "Anular orden" : "Confirmar recepción"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
