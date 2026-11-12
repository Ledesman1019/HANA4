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
