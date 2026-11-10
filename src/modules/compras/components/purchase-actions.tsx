"use client";

import { useState, useTransition } from "react";
import { Ban, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { cancelPurchase, receivePurchase } from "@/modules/compras/actions";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, FormError } from "@/components/ui";

export function PurchaseActions({ purchaseId, number, canReceive, canCancel }: { purchaseId: string; number: string; canReceive: boolean; canCancel: boolean }) {
  const [confirming, setConfirming] = useState<"receive" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    const kind = confirming;
    if (!kind) return;
    setError(null);
    startTransition(async () => {
      const res = kind === "receive" ? await receivePurchase(purchaseId) : await cancelPurchase(purchaseId);
      if (!res.ok) return setError(res.error);
      toast.success(kind === "receive" ? "Mercadería recibida. Stock actualizado" : "Orden anulada");
      setConfirming(null);
    });
  }

  const close = () => {
    setConfirming(null);
    setError(null);
  };

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
        title={confirming === "cancel" ? `¿Anular la orden ${number}?` : `¿Recibir la orden ${number}?`}
        description={
          confirming === "cancel"
            ? "La orden quedará anulada y no ingresará stock."
            : "Se ingresarán todas las cantidades al inventario y se recalculará el costo promedio de cada producto. No se puede deshacer."
        }
        size="sm"
      >
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
