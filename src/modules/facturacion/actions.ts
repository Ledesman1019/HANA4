"use server";

import { revalidatePath } from "next/cache";
import { DENIED, fail, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { uuid } from "@/lib/validation";
import { emitForSale, sendDocument } from "./api";

/** Emite el comprobante electrónico de una venta que aún no lo tiene. */
export async function emitSaleDocument(saleId: string): Promise<ActionResult<{ accepted: boolean; message: string }>> {
  if (!uuid.safeParse(saleId).success) return fail("Venta inválida");
  const ctx = await getContext();
  const result = await emitForSale(ctx, saleId);
  if (!result) return fail("Falta activar la facturación: ejecuta la migración 0003 en Supabase");
  revalidatePath("/", "layout");
  return success({ accepted: result.ok, message: result.message });
}

/** Reenvía un comprobante pendiente o rechazado (por ejemplo, tras corregir el RUC). */
export async function resendDocument(documentId: string): Promise<ActionResult<{ accepted: boolean; message: string }>> {
  if (!uuid.safeParse(documentId).success) return fail("Comprobante inválido");
  const ctx = await getContext();
  if (!ctx.can("facturacion", "create")) return fail(DENIED);
  const result = await sendDocument(ctx, documentId);
  revalidatePath("/", "layout");
  return success({ accepted: result.ok, message: result.message });
}
