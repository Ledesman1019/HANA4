"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { firstIssue, quantity, uuid } from "@/lib/validation";

/** Ajuste por conteo físico: fija la cantidad real y deja rastro en el kardex. */
export async function adjustStock(productId: string, newQuantity: number, note: string): Promise<ActionResult> {
  const parsed = z
    .object({ id: uuid, quantity: z.coerce.number<number>().min(0, "La cantidad no puede ser negativa").max(9_999_999), note: z.string().trim().min(3, "Indica el motivo del ajuste").max(200) })
    .safeParse({ id: productId, quantity: newQuantity, note });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, branch } = await getContext();
  const { error } = await supabase.rpc("adjust_stock", {
    p_product: parsed.data.id,
    p_branch: branch.id,
    p_new_quantity: parsed.data.quantity,
    p_note: parsed.data.note,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}

export async function transferStock(productId: string, toBranchId: string, amount: number, note: string): Promise<ActionResult> {
  const parsed = z.object({ id: uuid, to: uuid, quantity }).safeParse({ id: productId, to: toBranchId, quantity: amount });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, branch } = await getContext();
  const { error } = await supabase.rpc("transfer_stock", {
    p_product: parsed.data.id,
    p_from: branch.id,
    p_to: parsed.data.to,
    p_quantity: parsed.data.quantity,
    p_note: String(note ?? "").trim().slice(0, 200),
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
