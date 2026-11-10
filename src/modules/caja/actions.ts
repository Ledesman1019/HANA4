"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, uuid } from "@/lib/validation";

export async function openCashSession(openingAmount: number): Promise<ActionResult> {
  const parsed = amount.safeParse(openingAmount);
  if (!parsed.success) return fail("Monto de apertura inválido");
  const { supabase, branch } = await getContext();
  const { error } = await supabase.rpc("open_cash_session", { p_branch: branch.id, p_opening_amount: parsed.data });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}

export async function closeCashSession(sessionId: string, countedAmount: number, note: string): Promise<ActionResult<{ difference: number }>> {
  const parsed = amount.safeParse(countedAmount);
  if (!uuid.safeParse(sessionId).success || !parsed.success) return fail("Datos de cierre inválidos");
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc("close_cash_session", {
    p_session: sessionId,
    p_counted_amount: parsed.data,
    p_note: String(note ?? "").trim().slice(0, 300),
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ difference: Number(data) });
}

export async function addCashMovement(sessionId: string, type: "ingreso" | "egreso", value: number, concept: string): Promise<ActionResult> {
  const parsed = z
    .object({ id: uuid, type: z.enum(["ingreso", "egreso"]), value: amount.gt(0, "El monto debe ser mayor a cero"), concept: z.string().trim().min(3, "Indica el concepto").max(200) })
    .safeParse({ id: sessionId, type, value, concept });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("add_cash_movement", {
    p_session: parsed.data.id,
    p_type: parsed.data.type,
    p_amount: parsed.data.value,
    p_concept: parsed.data.concept,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
