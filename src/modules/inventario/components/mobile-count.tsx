"use client";

import { useState, useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Field, FormError, Input } from "@/components/ui";
import { applyMobileCount } from "@/modules/inventario/actions";

/** Aplicar al stock un inventario contado con RLS Tools. */
export function ApplyCountButton({ sessionId, number, adjustments }: { sessionId: string; number: string; adjustments: number }) {
  const { money } = useApp();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="success" onClick={() => setOpen(true)}>
        <CheckCheck className="h-4 w-4" /> Aplicar ajustes
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Aplicar el inventario ${number}`}
        description={`Se registran ${adjustments} ajustes en el kardex (y su asiento contable) con la diferencia contada.`}
        size="sm"
      >
        <Field label="Referencia (opcional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Ej. Conteo mensual de noviembre" />
        </Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="success"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await applyMobileCount(sessionId, note);
                if (!res.ok) return setError(res.error);
                toast.success(`Inventario aplicado: ${res.data.adjustments} ajustes`, { description: `Diferencia valorizada ${money(res.data.value)}` });
                setOpen(false);
              })
            }
          >
            Aplicar
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
