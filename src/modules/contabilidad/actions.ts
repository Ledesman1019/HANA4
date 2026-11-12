"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, isoDate, uuid } from "@/lib/validation";

const manualSchema = z.object({
  entry_date: isoDate,
  description: z.string().trim().min(5, "Describe el motivo del asiento (mínimo 5 caracteres)").max(200),
  branch_id: uuid.nullable(),
  lines: z
    .array(
      z.object({
        account: z.string().regex(/^[0-9]{2,8}$/, "Elige la cuenta de cada línea"),
        debit: amount,
        credit: amount,
        note: z.string().trim().max(120),
      }),
    )
    .min(2, "Un asiento necesita al menos dos líneas")
    .max(50),
});

/** Asiento manual: la base verifica cuentas, cuadre y que el periodo esté abierto. */
export async function postManualEntry(input: z.input<typeof manualSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc("post_manual_entry", {
    p_date: v.entry_date,
    p_description: v.description,
    p_branch: v.branch_id,
    p_lines: v.lines,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ id: data as string });
}

export async function reverseManualEntry(entryId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(entryId).success) return fail("Asiento inválido");
  const text = String(reason ?? "").trim();
  if (text.length < 5) return fail("Indica el motivo del extorno (mínimo 5 caracteres)");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("reverse_manual_entry", { p_entry: entryId, p_reason: text.slice(0, 200) });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}

export async function setPeriodStatus(period: string, closed: boolean): Promise<ActionResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail("Periodo inválido");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("set_period_status", { p_period: period, p_closed: Boolean(closed) });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
