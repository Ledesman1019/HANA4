import { formatQty } from "@/lib/utils";

/** Tipos y estados propios del módulo compras. */

export const PURCHASE_STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" }> = {
  ordenada: { label: "Por recibir", tone: "amber" },
  recibida: { label: "Recibida", tone: "green" },
  anulada: { label: "Anulada", tone: "red" },
};

export const REQUISITION_STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" | "blue" }> = {
  pendiente: { label: "Por aprobar", tone: "amber" },
  aprobada: { label: "Aprobada", tone: "green" },
  rechazada: { label: "Rechazada", tone: "red" },
  convertida: { label: "Con orden de compra", tone: "blue" },
};

/** Presentación de una línea guardada: «10 CAJA × 12 = 120 UND» o, en unidades, null. */
export function packLabel(quantity: number, unit: string, packUnit: string | null | undefined, packSize: number | null | undefined) {
  if (!packUnit || Number(packSize) <= 1) return null;
  return `${formatQty(Number(quantity) / Number(packSize))} ${packUnit} × ${formatQty(packSize)} = ${formatQty(quantity)} ${unit}`;
}
