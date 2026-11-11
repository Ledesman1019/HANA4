"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { amount, firstIssue, isoDate, uuid } from "@/lib/validation";

/* Facturas de proveedor y pagos. Las reglas (coincidencia con la orden,
 * bloqueo, saldos, separación de funciones) viven en las funciones SQL. */

const invoiceSchema = z.object({
  purchase_id: uuid,
  number: z.string().trim().min(3, "Indica el número de la factura del proveedor").max(30),
  issue_date: isoDate,
  due_date: isoDate,
  total: amount.gt(0, "El importe debe ser mayor a cero"),
  note: z.string().trim().max(300),
});

/** Verificación de factura: se compara con la orden recibida; si difiere, queda bloqueada. */
export async function registerSupplierInvoice(input: z.input<typeof invoiceSchema>): Promise<ActionResult<{ blocked: boolean }>> {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc("register_supplier_invoice", {
    p_purchase: v.purchase_id,
    p_number: v.number,
    p_issue_date: v.issue_date,
    p_due_date: v.due_date,
    p_total: v.total,
    p_note: v.note,
  });
  if (error) return fail(friendlyError(error));
  const { data: row } = await supabase.from("supplier_invoices").select("status").eq("id", data as string).maybeSingle();
  revalidatePath("/", "layout");
  return success({ blocked: row?.status === "bloqueada" });
}

export async function releaseSupplierInvoice(invoiceId: string, note: string): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return fail("Factura inválida");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("release_supplier_invoice", { p_invoice: invoiceId, p_note: String(note ?? "").trim().slice(0, 300) });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}

const paymentSchema = z.object({
  invoice_id: uuid,
  amount: amount.gt(0, "El importe debe ser mayor a cero"),
  method: z.enum(["transferencia", "efectivo", "cheque", "tarjeta", "yape", "plin"]),
  paid_at: isoDate,
  reference: z.string().trim().max(60),
});

export async function paySupplierInvoice(input: z.input<typeof paymentSchema>): Promise<ActionResult<{ balance: number }>> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc("pay_supplier_invoice", {
    p_invoice: v.invoice_id,
    p_amount: v.amount,
    p_method: v.method,
    p_paid_at: v.paid_at,
    p_reference: v.reference,
  });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ balance: Number(data) });
}

export async function voidSupplierInvoice(invoiceId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return fail("Factura inválida");
  const text = String(reason ?? "").trim();
  if (text.length < 5) return fail("Describe el motivo de la anulación (mínimo 5 caracteres)");
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("void_supplier_invoice", { p_invoice: invoiceId, p_reason: text.slice(0, 300) });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
