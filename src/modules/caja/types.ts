/** Tipos y estados propios del módulo caja. */

export type CashSession = {
  id: string;
  branch_id: string;
  opened_by: string;
  opened_at: string;
  opening_amount: number;
  status: "abierta" | "cerrada";
  closed_at: string | null;
  expected_amount: number | null;
  counted_amount: number | null;
  difference: number | null;
  note: string;
};
