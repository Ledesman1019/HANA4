/** Tipos y estados propios del módulo clientes. */

export type Customer = {
  id: string;
  doc_type: "DNI" | "RUC" | "CE" | "PASAPORTE";
  doc_number: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
  /** Línea de crédito (0 = solo contado) y plazo de pago en días */
  credit_limit: number;
  credit_days: number;
};
