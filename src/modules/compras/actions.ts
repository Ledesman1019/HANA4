"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, quantity, uuid } from "@/lib/validation";

const purchaseSchema = z.object({
  supplier_id: z.uuid("Selecciona un proveedor"),
  expected_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")]),
  note: z.string().trim().max(300),
  items: z
    .array(z.object({ product_id: uuid, quantity, unit_cost: amount }))
    .min(1, "Agrega al menos un producto")
    .max(200),
});

export async function createPurchase(input: z.input<typeof purchaseSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const p = parsed.data;
  if (new Set(p.items.map((i) => i.product_id)).size !== p.items.length) return fail("Hay productos repetidos en la orden");

  const { supabase, branch } = await getContext();
  const { data, error } = await supabase.rpc("create_purchase", {
    p_supplier: p.supplier_id,
    p_branch: branch.id,
    p_expected_date: p.expected_date || null,
    p_note: p.note,
    p_items: p.items,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ id: data as string });
}

/** Recepción: ingresa el stock y recalcula el costo promedio ponderado. */
export async function receivePurchase(purchaseId: string): Promise<ActionResult> {
  if (!uuid.safeParse(purchaseId).success) return fail("Orden inválida");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("receive_purchase", { p_purchase: purchaseId });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}

export async function cancelPurchase(purchaseId: string): Promise<ActionResult> {
  if (!uuid.safeParse(purchaseId).success) return fail("Orden inválida");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("cancel_purchase", { p_purchase: purchaseId });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
