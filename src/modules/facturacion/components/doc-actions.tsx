"use client";

import { useTransition } from "react";
import { FileCheck2, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { playSound } from "@/lib/sound";
import { emitSaleDocument, resendDocument } from "@/modules/facturacion/actions";

function report(res: { ok: true; data: { accepted: boolean; message: string } } | { ok: false; error: string }) {
  if (!res.ok) {
    playSound("error");
    return void toast.error(res.error);
  }
  if (res.data.accepted) {
    playSound("success");
    toast.success("Comprobante aceptado", { description: res.data.message });
  } else {
    playSound("error");
    toast.error("Comprobante rechazado", { description: res.data.message, duration: 9000 });
  }
}

/** Reenvía un comprobante pendiente o rechazado. */
export function ResendButton({ documentId, compact }: { documentId: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant={compact ? "ghost" : "primary"} size={compact ? "sm" : "md"} loading={pending} onClick={() => startTransition(async () => report(await resendDocument(documentId)))}>
      {!pending && <Send className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      Reenviar
    </Button>
  );
}

/** Emite el comprobante electrónico de una venta que todavía no lo tiene. */
export function EmitButton({ saleId }: { saleId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="secondary" loading={pending} onClick={() => startTransition(async () => report(await emitSaleDocument(saleId)))}>
      {!pending && <FileCheck2 className="h-4 w-4 text-link" />}
      Emitir comprobante electrónico
    </Button>
  );
}

export function PrintDocButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Imprimir
    </Button>
  );
}
