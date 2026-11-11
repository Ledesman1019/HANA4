import "server-only";
import { createHash } from "node:crypto";
import type { EDocumentKind } from "./types";

/* ------------------------------------------------------------------
 * Proveedor de facturación electrónica.
 *
 * Hoy solo existe el proveedor DEMO, que simula la respuesta de SUNAT.
 * Para facturar de verdad se implementa esta misma interfaz contra un
 * PSE/OSE (Nubefact, Efact, SUNAT directo…) y se selecciona con la
 * variable de entorno BILLING_PROVIDER. Nada más del sistema cambia.
 * ------------------------------------------------------------------ */

export type BillingDocument = {
  kind: EDocumentKind;
  number: string;
  issuedAt: string; // ISO
  currency: string;
  taxRate: number;
  company: { name: string; taxId: string; address: string };
  customer: { docType: string; docNumber: string; name: string };
  items: { sku: string; description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  tax: number;
  total: number;
  /** Solo notas de crédito: comprobante que modifica y motivo */
  reference?: { number: string; kind: EDocumentKind; reason: string };
};

export type BillingResult = {
  status: "aceptado" | "rechazado";
  /** Resumen (digest) del XML firmado */
  hash: string;
  /** Código de la constancia de recepción (CDR): "0" = aceptado */
  code: string;
  message: string;
};

export interface BillingProvider {
  id: string;
  environment: "demo" | "produccion";
  send(doc: BillingDocument, xml: string): Promise<BillingResult>;
}

const KIND_NAMES: Record<EDocumentKind, string> = { boleta: "La Boleta", factura: "La Factura", nota_credito: "La Nota de Crédito" };

/**
 * Simulador: aplica las validaciones más comunes de SUNAT y responde como
 * lo haría la constancia de recepción. No envía nada fuera del sistema.
 */
export const demoProvider: BillingProvider = {
  id: "demo",
  environment: "demo",
  async send(doc, xml) {
    const hash = createHash("sha256").update(xml).digest("base64").slice(0, 28);
    const reject = (code: string, message: string): BillingResult => ({ status: "rechazado", hash, code, message });

    if (!/^(10|15|17|20)\d{9}$/.test(doc.company.taxId)) {
      return reject("1034", "El RUC del emisor no es válido. Regístralo en Configuración → Empresa y reenvía el comprobante.");
    }
    if (doc.kind === "factura" && !/^(10|15|17|20)\d{9}$/.test(doc.customer.docNumber)) {
      return reject("2017", "La factura requiere el RUC del cliente (11 dígitos).");
    }
    if (doc.items.length === 0 || doc.total <= 0) {
      return reject("2023", "El comprobante no tiene ítems o su importe total es cero.");
    }
    if (Math.abs(doc.subtotal + doc.tax - doc.total) > 0.011) {
      return reject("3105", "La suma de la operación gravada y el impuesto no coincide con el total.");
    }
    return { status: "aceptado", hash, code: "0", message: `${KIND_NAMES[doc.kind]} número ${doc.number}, ha sido aceptada (simulación DEMO).` };
  },
};

export function getBillingProvider(): BillingProvider {
  switch (process.env.BILLING_PROVIDER) {
    // case "nubefact": return nubefactProvider;   ← aquí se conecta el proveedor real
    default:
      return demoProvider;
  }
}
