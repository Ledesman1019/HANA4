"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, isoDate, uuid } from "@/lib/validation";

const paymentSchema = z.object({
  sale_id: uuid,
  amount: amount.gt(0, "El importe debe ser mayor a cero"),
  method: z.enum(["efectivo", "transferencia", "tarjeta", "yape", "plin", "cheque"]),
  paid_at: isoDate,
  reference: z.string().trim().max(60),
});

/** Cobro (total o parcial) de una venta al crédito. En efectivo entra a la caja abierta de quien cobra. */
export async function collectPayment(input: z.input<typeof paymentSchema>): Promise<ActionResult<{ balance: number }>> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc("collect_payment", {
    p_sale: v.sale_id,
    p_amount: v.amount,
    p_method: v.method,
    p_paid_at: v.paid_at,
    p_reference: v.reference,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ balance: Number(data) });
}

/** Asigna o cambia la línea de crédito de un cliente (control de crédito). Queda en la auditoría. */
export async function setCustomerCredit(customerId: string, limit: number, days: number): Promise<ActionResult> {
  const parsed = z
    .object({
      id: uuid,
      limit: z.coerce.number<number>("Línea inválida").min(0, "La línea no puede ser negativa").max(99_999_999),
      days: z.coerce.number<number>("Plazo inválido").int("El plazo es en días enteros").min(0).max(365, "El plazo máximo es 365 días"),
    })
    .safeParse({ id: customerId, limit, days });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { supabase, can } = await getContext();
  if (!can("cuentas_cobrar", "edit")) return fail("Tu rol no puede asignar líneas de crédito");
  const { error } = await supabase.rpc("set_customer_credit", { p_customer: parsed.data.id, p_limit: parsed.data.limit, p_days: parsed.data.days });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
