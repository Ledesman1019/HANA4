/** Origen de cada asiento: de qué operación salió. */
export const SOURCE_LABELS: Record<string, string> = {
  venta: "Venta",
  cobro: "Cobro a cliente",
  recepcion: "Recepción de compra",
  factura_proveedor: "Factura de proveedor",
  pago_proveedor: "Pago a proveedor",
  gasto: "Gasto",
  comision: "Comisión",
  inventario: "Inventario",
  caja: "Arqueo de caja",
  manual: "Asiento manual",
};

export const ACCOUNT_TYPES: Record<string, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio",
  ingreso: "Ingreso",
  gasto: "Gasto",
};

/** Las cuentas de activo y gasto tienen saldo deudor; las demás, acreedor. */
export const debitNature = (type: string) => type === "activo" || type === "gasto";

export type Account = { code: string; name: string; type: string; active: boolean };
export type TrialRow = { code: string; name: string; type: string; opening: number; debit: number; credit: number; closing: number };
