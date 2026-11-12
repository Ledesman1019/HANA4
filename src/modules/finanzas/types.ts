/** Tipos y estados propios del módulo finanzas. */

export type Expense = {
  id: string;
  branch_id: string;
  category: string;
  description: string;
  amount: number;
  payment_method: string;
  expense_date: string;
  cost_center_id: string | null;
};

export const EXPENSE_LABELS: Record<string, string> = {
  alquiler: "Alquiler",
  servicios: "Servicios",
  planilla: "Planilla",
  marketing: "Marketing",
  transporte: "Transporte",
  mantenimiento: "Mantenimiento",
  impuestos: "Impuestos",
  otros: "Otros",
};
