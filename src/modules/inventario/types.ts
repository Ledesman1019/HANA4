/** Tipos y estados propios del módulo inventario. */

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
  /** Controla lotes y fechas de vencimiento (salida FEFO) */
  track_lots?: boolean;
  /** Presentación de compra: «CAJA» de pack_size unidades ("" = por unidad) */
  pack_unit?: string;
  pack_size?: number;
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
