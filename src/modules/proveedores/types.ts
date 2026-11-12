/** Tipos y estados propios del módulo proveedores. */

export type Supplier = {
  id: string;
  tax_id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  /** Días de crédito que da el proveedor (vencimiento de sus facturas) */
  payment_terms: number;
  active: boolean;
};
