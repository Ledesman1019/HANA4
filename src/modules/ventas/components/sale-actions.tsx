"use client";

import { useState, useTransition } from "react";
import { Ban, Printer } from "lucide-react";
import { toast } from "sonner";
import { voidSale } from "@/modules/ventas/actions";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Textarea } from "@/components/ui";

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
