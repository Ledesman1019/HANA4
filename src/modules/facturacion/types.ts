export type EDocumentKind = "boleta" | "factura" | "nota_credito";
export type EDocumentStatus = "pendiente" | "aceptado" | "rechazado";

export type EDocument = {
  id: string;
  sale_id: string;
  kind: EDocumentKind;
  number: string;
  branch_id: string;
  customer_doc_type: string;
  customer_doc_number: string;
  customer_name: string;
  subtotal: number;
  tax: number;
  total: number;
  status: EDocumentStatus;
  environment: "demo" | "produccion";
  provider: string;
  hash: string | null;
  response_code: string | null;
  response_message: string | null;
  reference_id: string | null;
  reason: string | null;
  attempts: number;
  sent_at: string | null;
  created_at: string;
};

export const KIND_LABELS: Record<EDocumentKind, string> = {
  boleta: "Boleta de venta electrónica",
  factura: "Factura electrónica",
  nota_credito: "Nota de crédito electrónica",
};

export const KIND_SHORT: Record<EDocumentKind, string> = { boleta: "Boleta", factura: "Factura", nota_credito: "Nota de crédito" };

/** Catálogo 01 de SUNAT: tipo de comprobante */
export const KIND_CODES: Record<EDocumentKind, string> = { factura: "01", boleta: "03", nota_credito: "07" };

/** Catálogo 06 de SUNAT: tipo de documento de identidad */
export const IDENTITY_CODES: Record<string, string> = { DNI: "1", CE: "4", RUC: "6", PASAPORTE: "7" };

export const STATUS_META: Record<EDocumentStatus, { label: string; tone: "green" | "amber" | "red" }> = {
  aceptado: { label: "Aceptado", tone: "green" },
  pendiente: { label: "Pendiente de envío", tone: "amber" },
  rechazado: { label: "Rechazado", tone: "red" },
};
