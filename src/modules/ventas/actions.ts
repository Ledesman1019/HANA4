"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, isoDate, quantity, uuid } from "@/lib/validation";
// Ventas dispara la facturación a través de su servicio público (única dependencia entre módulos)
import { emitCreditNote, emitForSale } from "@/modules/facturacion/api";

/* Las acciones validan la entrada y delegan en funciones SQL transaccionales,
 * que verifican permisos, stock, crédito y totales. El cliente nunca envía precios. */

const lines = z.array(z.object({ product_id: uuid, quantity })).max(200);

const saleSchema = z
  .object({
    customer_id: uuid.nullable(),
    doc_type: z.enum(["ticket", "boleta", "factura"]),
    payment_method: z.enum(["efectivo", "tarjeta", "yape", "plin", "transferencia", "credito"]),
    amount_received: amount,
    discount: amount,
    items: lines,
    /** Cotización vigente que se convierte en venta: fija productos, precios y descuento */
    quotation_id: uuid.nullable().optional(),
    /** Vencimiento de una venta al crédito (por defecto, el plazo del cliente) */
    due_date: isoDate.nullable().optional(),
  })
  .refine((s) => s.quotation_id || s.items.length > 0, { message: "Agrega al menos un producto" });

export async function createSale(input: z.input<typeof saleSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const ctx = await getContext();
  const { supabase, branch } = ctx;
  const s = parsed.data;

  const { data, error } = await supabase.rpc("create_sale", {
    p_branch: branch.id,
    p_customer: s.customer_id,
    p_doc_type: s.doc_type,
    p_payment_method: s.payment_method,
    p_amount_received: s.amount_received,
    p_discount: s.discount,
    p_items: s.quotation_id ? null : s.items,
    p_quotation: s.quotation_id ?? null,
    p_due_date: s.payment_method === "credito" ? (s.due_date ?? null) : null,
  });
  if (error) return fail(friendlyError(error));

  // Boletas y facturas generan su comprobante electrónico. Si el envío falla,
  // la venta ya está guardada y el comprobante queda pendiente de reenvío.
  if (s.doc_type !== "ticket") await emitForSale(ctx, data as string);

  revalidatePath("/", "layout");
  return success({ id: data as string });
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(saleId).success) return fail("Venta inválida");
  const text = String(reason ?? "").trim();
  if (text.length < 5) return fail("Describe el motivo de la anulación (mínimo 5 caracteres)");
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("void_sale", { p_sale: saleId, p_reason: text.slice(0, 300) });
  if (error) return fail(friendlyError(error));

  // Si la venta tenía comprobante electrónico, se revierte con una nota de crédito
  await emitCreditNote(ctx, saleId);

  revalidatePath("/", "layout");
  return success(undefined);
}

/* ---------- Cotizaciones ---------- */
const quotationSchema = z.object({
  customer_id: uuid.nullable(),
  valid_days: z.coerce.number<number>().int("Vigencia inválida").min(1, "La vigencia mínima es 1 día").max(90, "La vigencia máxima es 90 días"),
  discount: amount,
  note: z.string().trim().max(300),
  items: lines.min(1, "Agrega al menos un producto"),
});

/** Cotización: congela los precios de hoy durante su vigencia. No mueve stock. */
export async function createQuotation(input: z.input<typeof quotationSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, branch } = await getContext();
  const v = parsed.data;
  const { data, error } = await supabase.rpc("create_quotation", {
    p_branch: branch.id,
    p_customer: v.customer_id,
    p_valid_days: v.valid_days,
    p_discount: v.discount,
    p_note: v.note,
    p_items: v.items,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ id: data as string });
}

export async function cancelQuotation(id: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail("Cotización inválida");
  const text = String(reason ?? "").trim();
  if (text.length < 5) return fail("Indica el motivo (mínimo 5 caracteres)");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("cancel_quotation", { p_id: id, p_reason: text.slice(0, 200) });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
