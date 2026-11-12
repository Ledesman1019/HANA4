"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Input } from "@/components/ui";
import { updateLot } from "@/modules/inventario/actions";

/** Corregir el número o el vencimiento de un lote (por ejemplo, el lote INICIAL). */
export function LotEditor({ lotId, lotNumber, expiry, product }: { lotId: string; lotNumber: string; expiry: string | null; product: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="ghost" size="icon" title="Corregir lote" aria-label={`Corregir el lote ${lotNumber}`} onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Corregir lote" description={product} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const res = await updateLot(lotId, String(form.get("lot_number") ?? ""), String(form.get("expiry") ?? ""));
              if (!res.ok) return setError(res.error);
              toast.success("Lote actualizado");
              setOpen(false);
            });
          }}
        >
          <Field label="N.º de lote">
            <Input name="lot_number" defaultValue={lotNumber} required maxLength={40} className="uppercase" autoFocus />
          </Field>
          <Field label="Vence el" hint="Déjalo vacío si el producto no tiene fecha de vencimiento.">
            <Input name="expiry" type="date" defaultValue={expiry ?? ""} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
