"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DENIED, fail, friendlyError, getContext, success } from "@/lib/auth";
import { crudSave } from "@/lib/crud/engine";
import type { ActionResult } from "@/lib/types";
import { firstIssue, isoDate, uuid } from "@/lib/validation";
import { employees } from "./schema";

export async function saveEmployee(id: string | null, values: Record<string, unknown>) {
  return crudSave(employees, id, values);
}

const paySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periodo inválido"),
  employees: z.array(uuid).min(1, "Selecciona al menos un colaborador").max(500),
  method: z.enum(["efectivo", "transferencia"], "Elige el medio de pago"),
  date: isoDate,
  note: z.string().trim().max(200),
});

/** Paga sueldo + comisiones del mes. Genera el asiento contable y queda en la auditoría. */
export async function payPayroll(input: z.input<typeof paySchema>): Promise<ActionResult<{ count: number }>> {
  const { supabase, can } = await getContext();
  if (!can("rrhh", "create")) return fail(DENIED);
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const p = parsed.data;
  const { data, error } = await supabase.rpc("pay_payroll", { p_period: p.period, p_employees: p.employees, p_method: p.method, p_date: p.date, p_note: p.note });
  if (error) return fail(friendlyError(error));
  revalidatePath("/rrhh", "layout");
  return success({ count: Number(data) });
}

/** Anula un pago: extorna su asiento y libera las comisiones para volver a pagarlas. */
export async function voidPayrollPayment(id: string, reason: string): Promise<ActionResult> {
  const { supabase, can } = await getContext();
  if (!can("rrhh", "delete")) return fail(DENIED);
  const parsed = z.object({ id: uuid, reason: z.string().trim().min(5, "Indica el motivo de la anulación").max(200) }).safeParse({ id, reason });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { error } = await supabase.rpc("void_payroll_payment", { p_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return fail(friendlyError(error));
  revalidatePath("/rrhh", "layout");
  return success(undefined);
}
