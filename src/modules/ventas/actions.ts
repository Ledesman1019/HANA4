"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, quantity, uuid } from "@/lib/validation";
// Ventas dispara la facturación a través de su servicio público (única dependencia entre módulos)
import { emitCreditNote, emitForSale } from "@/modules/facturacion/service";

/* Las acciones validan la entrada y delegan en funciones SQL transaccionales,
 * que verifican permisos, stock y totales. El cliente nunca envía precios. */

const saleSchema = z.object({
  customer_id: uuid.nullable(),
  doc_type: z.enum(["ticket", "boleta", "factura"]),
  payment_method: z.enum(["efectivo", "tarjeta", "yape", "plin", "transferencia"]),
  amount_received: amount,
  discount: amount,
  items: z.array(z.object({ product_id: uuid, quantity })).min(1, "Agrega al menos un producto").max(200),
});

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
    p_items: s.items,
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
