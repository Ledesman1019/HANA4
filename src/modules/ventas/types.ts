/** Tipos y estados propios del módulo ventas. */

export type Sale = {
  id: string;
  number: string;
  doc_type: "ticket" | "boleta" | "factura";
  branch_id: string;
  customer_id: string | null;
  cashier_id: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cost_total: number;
  payment_method: string;
  amount_received: number;
  change_amount: number;
  status: "completada" | "anulada";
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
};

export type SaleItem = {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  total: number;
};

export const DOC_LABELS: Record<string, string> = {
  ticket: "Ticket",
  boleta: "Boleta",
  factura: "Factura",
};

export const QUOTE_STATUS: Record<string, { label: string; tone: "blue" | "green" | "neutral" | "amber" }> = {
  vigente: { label: "Vigente", tone: "blue" },
  aceptada: { label: "Vendida", tone: "green" },
  anulada: { label: "Anulada", tone: "neutral" },
  vencida: { label: "Vencida", tone: "amber" },
};
