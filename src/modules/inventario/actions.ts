"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { crudSave, crudSetActive } from "@/lib/crud/engine";
import { firstIssue, isoDate, quantity, uuid } from "@/lib/validation";
import { categories, locations, products } from "./schema";

export async function saveProduct(id: string | null, values: Record<string, unknown>) {
  return crudSave(products, id, values);
}

export async function setProductActive(id: string, active: boolean) {
  return crudSetActive(products, id, active);
}

export async function saveCategory(id: string | null, values: Record<string, unknown>) {
  return crudSave(categories, id, values);
}

export async function setCategoryActive(id: string, active: boolean) {
  return crudSetActive(categories, id, active);
}

export async function saveLocation(id: string | null, values: Record<string, unknown>) {
  return crudSave(locations, id, values);
}

export async function setLocationActive(id: string, active: boolean) {
  return crudSetActive(locations, id, active);
}

/** Aplica al stock un inventario contado con RLS Tools (diferencia contada vs. stock al cerrar). */
export async function applyMobileCount(sessionId: string, note: string): Promise<ActionResult<{ adjustments: number; value: number }>> {
  const parsed = z.object({ id: uuid, note: z.string().trim().max(120) }).safeParse({ id: sessionId, note });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, can } = await getContext();
  if (!can("inventario", "edit")) return fail("Solo quien puede ajustar stock aplica inventarios");
  const { data, error } = await supabase.rpc("rls_apply_count", { p_op: crypto.randomUUID(), p_session: parsed.data.id, p_note: parsed.data.note });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  const r = data as { adjustments: number; value: number };
  return success({ adjustments: Number(r.adjustments), value: Number(r.value) });
}

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

export async function updateLot(lotId: string, lotNumber: string, expiry: string): Promise<ActionResult> {
  const parsed = z
    .object({ id: uuid, lot: z.string().trim().min(1, "Indica el número de lote").max(40), expiry: z.union([z.literal(""), isoDate]) })
    .safeParse({ id: lotId, lot: lotNumber, expiry });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("update_lot", { p_lot: parsed.data.id, p_lot_number: parsed.data.lot, p_expiry: parsed.data.expiry || null });
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

const countSchema = z.object({
  note: z.string().trim().min(3, "Indica una referencia del conteo (ej. «Conteo mensual de abarrotes»)").max(150),
  items: z.array(z.object({ id: uuid, quantity: z.coerce.number<number>().min(0, "La cantidad no puede ser negativa").max(9_999_999) })).min(1, "No hay diferencias que ajustar").max(1000),
});

/**
 * Inventario físico: registra el conteo real. Cada diferencia es un ajuste en el kardex
 * con la misma referencia, para revisarlo después en «Ajustes (histórico)».
 */
export async function registerPhysicalCount(input: z.input<typeof countSchema>): Promise<ActionResult<{ adjusted: number }>> {
  const parsed = countSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, branch, can } = await getContext();
  if (!can("inventario", "edit")) return fail("Tu rol no puede ajustar el inventario");
  let adjusted = 0;
  for (const item of parsed.data.items) {
    const { error } = await supabase.rpc("adjust_stock", {
      p_product: item.id,
      p_branch: branch.id,
      p_new_quantity: item.quantity,
      p_note: `Inventario físico: ${parsed.data.note}`,
    });
    if (error) {
      revalidatePath("/", "layout");
      return fail(`${adjusted} ajustes registrados; se detuvo en un producto: ${friendlyError(error)}`);
    }
    adjusted++;
  }
  revalidatePath("/", "layout");
  return success({ adjusted });
}
