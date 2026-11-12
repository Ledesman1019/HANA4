/** Tipos y estados propios del módulo cuentas-cobrar. */

export const CREDIT_STATUS: Record<string, { label: string; tone: "amber" | "green" | "blue" }> = {
  pendiente: { label: "Por cobrar", tone: "amber" },
  parcial: { label: "Abono parcial", tone: "blue" },
  pagada: { label: "Cobrada", tone: "green" },
};
