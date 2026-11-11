/** Identificador del rol (tabla `roles`). "admin" tiene acceso total. */
export type Role = string;

export type RoleRow = { id: string; name: string; description: string; is_system: boolean };
export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  branch_id: string | null;
  active: boolean;
  /** Super Administrador: el único que nombra o modifica administradores */
  is_super: boolean;
  created_at: string;
};

export type Settings = {
  name: string;
  tax_id: string;
  address: string;
  phone: string;
  email: string;
  currency_code: string;
  currency_symbol: string;
  tax_name: string;
  tax_rate: number;
  timezone: string;
  receipt_footer: string;
};

export type Branch = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  active: boolean;
};

export type Category = {
  id: string;
  name: string;
  description: string;
  active: boolean;
};

export type InventoryRow = {
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string;
  unit: string;
  cost: number;
  price: number;
  min_stock: number;
  active: boolean;
  category_id: string | null;
  category_name: string | null;
  branch_id: string;
  branch_name: string;
  quantity: number;
  stock_value: number;
  low_stock: boolean;
  image_url?: string | null;
};

export type Customer = {
  id: string;
  doc_type: "DNI" | "RUC" | "CE" | "PASAPORTE";
  doc_number: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
};

export type Supplier = {
  id: string;
  tax_id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
};

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

export type Expense = {
  id: string;
  branch_id: string;
  category: string;
  description: string;
  amount: number;
  payment_method: string;
  expense_date: string;
};

export type Employee = {
  id: string;
  branch_id: string | null;
  doc_number: string;
  full_name: string;
  position: string;
  email: string;
  phone: string;
  salary: number;
  /** Usuario del sistema del colaborador: sus ventas le generan comisión */
  profile_id: string | null;
  /** % de comisión sobre la venta neta */
  commission_rate: number;
  hire_date: string;
  status: "activo" | "vacaciones" | "licencia" | "cesado";
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia",
};

export const DOC_LABELS: Record<string, string> = {
  ticket: "Ticket",
  boleta: "Boleta",
  factura: "Factura",
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

export const INVOICE_STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" | "blue" | "neutral" }> = {
  bloqueada: { label: "Bloqueada", tone: "red" },
  pendiente: { label: "Por pagar", tone: "amber" },
  parcial: { label: "Pago parcial", tone: "blue" },
  pagada: { label: "Pagada", tone: "green" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export const MOVEMENT_LABELS: Record<string, string> = {
  inicial: "Inventario inicial",
  compra: "Compra",
  venta: "Venta",
  ajuste: "Ajuste",
  devolucion: "Devolución",
  transferencia_entrada: "Transferencia (entrada)",
  transferencia_salida: "Transferencia (salida)",
};
