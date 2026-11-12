/** Tipos y estados propios del módulo cuentas-pagar. */

export const INVOICE_STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" | "blue" | "neutral" }> = {
  bloqueada: { label: "Bloqueada", tone: "red" },
  pendiente: { label: "Por pagar", tone: "amber" },
  parcial: { label: "Pago parcial", tone: "blue" },
  pagada: { label: "Pagada", tone: "green" },
  anulada: { label: "Anulada", tone: "neutral" },
};
