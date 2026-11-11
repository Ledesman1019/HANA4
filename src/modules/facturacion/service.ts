import "server-only";
import type { AppContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getBillingProvider, type BillingDocument } from "./provider";
import type { EDocument, EDocumentKind } from "./types";
import { buildXml } from "./xml";

type SaleItemRow = { sku: string; product_name: string; quantity: number; unit_price: number; total: number };

/** Arma el documento tal como se envía al proveedor (y como se muestra y descarga). */
export async function loadBillingDocument(ctx: AppContext, id: string): Promise<{ doc: EDocument; billing: BillingDocument } | null> {
  const { data } = await ctx.supabase
    .from("e_documents")
    .select("*, sale:sales(discount, items:sale_items(sku, product_name, quantity, unit_price, total))")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as EDocument & { sale: { discount: number; items: SaleItemRow[] } | null };
  const { settings } = ctx;

  // Nota de crédito: comprobante que modifica
  let reference: { number: string; kind: EDocumentKind } | null = null;
  if (row.reference_id) {
    const ref = await ctx.supabase.from("e_documents").select("number, kind").eq("id", row.reference_id).maybeSingle();
    reference = ref.data as { number: string; kind: EDocumentKind } | null;
  }

  const billing: BillingDocument = {
    kind: row.kind,
    number: row.number,
    issuedAt: row.created_at,
    currency: settings.currency_code,
    taxRate: Number(settings.tax_rate),
    company: { name: settings.name, taxId: settings.tax_id, address: settings.address },
    customer: { docType: row.customer_doc_type, docNumber: row.customer_doc_number, name: row.customer_name },
    items: (row.sale?.items ?? []).map((i) => ({
      sku: i.sku,
      description: i.product_name,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      total: Number(i.total),
    })),
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    total: Number(row.total),
    reference: reference ? { number: reference.number, kind: reference.kind, reason: row.reason ?? "Anulación de la operación" } : undefined,
  };
  return { doc: row, billing };
}

/**
 * Envía un comprobante al proveedor y registra su respuesta.
 * La respuesta la escribe solo el servidor (clave de servicio): ningún
 * usuario puede marcar un comprobante como aceptado.
 */
export async function sendDocument(ctx: AppContext, id: string): Promise<{ ok: boolean; message: string }> {
  const loaded = await loadBillingDocument(ctx, id);
  if (!loaded) return { ok: false, message: "Comprobante no encontrado" };
  if (loaded.doc.status === "aceptado") return { ok: true, message: "El comprobante ya fue aceptado" };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en el servidor" };

  const provider = getBillingProvider();
  let result;
  try {
    result = await provider.send(loaded.billing, buildXml(loaded.billing));
  } catch (e) {
    // Sin respuesta del proveedor: queda pendiente para reintentar
    console.error("[facturacion] envío", e);
    await admin.from("e_documents").update({ attempts: loaded.doc.attempts + 1, response_message: "Sin respuesta del servicio. Reintenta el envío." }).eq("id", id);
    return { ok: false, message: "No hubo respuesta del servicio de facturación. Quedó pendiente de envío" };
  }

  const { error } = await admin
    .from("e_documents")
    .update({
      status: result.status,
      hash: result.hash,
      response_code: result.code,
      response_message: result.message,
      attempts: loaded.doc.attempts + 1,
      sent_at: new Date().toISOString(),
      environment: provider.environment,
      provider: provider.id,
    })
    .eq("id", id);
  if (error) {
    console.error("[facturacion] registro", error);
    return { ok: false, message: "No se pudo registrar la respuesta del envío" };
  }
  return { ok: result.status === "aceptado", message: result.message };
}

/** ¿La base ya tiene la migración de facturación? (PGRST202/42P01 = aún no) */
const missing = (error: { code?: string } | null) => error?.code === "PGRST202" || error?.code === "42P01" || error?.code === "PGRST205";

/**
 * Genera y envía el comprobante electrónico de una venta. Nunca hace
 * fallar la venta: si algo sale mal, el comprobante queda pendiente.
 */
export async function emitForSale(ctx: AppContext, saleId: string): Promise<{ ok: boolean; message: string } | null> {
  try {
    const { data, error } = await ctx.supabase.rpc("issue_e_document", { p_sale: saleId });
    if (error) return missing(error) ? null : { ok: false, message: error.message ?? "No se pudo generar el comprobante" };
    return await sendDocument(ctx, data as string);
  } catch (e) {
    console.error("[facturacion] emitForSale", e);
    return { ok: false, message: "No se pudo generar el comprobante electrónico" };
  }
}

/** Tras anular una venta con comprobante, emite su nota de crédito. */
export async function emitCreditNote(ctx: AppContext, saleId: string): Promise<void> {
  try {
    const { data, error } = await ctx.supabase.rpc("issue_credit_note", { p_sale: saleId });
    if (error || !data) return;
    await sendDocument(ctx, data as string);
  } catch (e) {
    console.error("[facturacion] emitCreditNote", e);
  }
}
