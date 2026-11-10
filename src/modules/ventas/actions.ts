"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, quantity, uuid } from "@/lib/validation";

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
  const { supabase, branch } = await getContext();
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
  revalidatePath("/", "layout");
  return success({ id: data as string });
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(saleId).success) return fail("Venta inválida");
  const text = String(reason ?? "").trim();
  if (text.length < 5) return fail("Describe el motivo de la anulación (mínimo 5 caracteres)");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("void_sale", { p_sale: saleId, p_reason: text.slice(0, 300) });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
