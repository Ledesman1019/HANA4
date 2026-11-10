"use server";

import { revalidatePath } from "next/cache";
import { DENIED, fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { firstIssue, uuid } from "@/lib/validation";
import { resolveEntity, type EntityKey } from "./registry";

/* ------------------------------------------------------------------
 * Motor CRUD genérico de maestros. Cada módulo declara su entidad en
 * `modules/<módulo>/schema.ts`; aquí se validan los datos y el permiso
 * (crear / editar / eliminar) del rol. RLS en la base de datos aplica
 * las mismas reglas como segunda barrera.
 * ------------------------------------------------------------------ */

export async function saveEntity(entity: EntityKey, id: string | null, values: Record<string, unknown>): Promise<ActionResult> {
  const def = resolveEntity(entity);
  if (!def) return fail("Entidad desconocida");

  const { supabase, userId, can } = await getContext();
  const action = def.module === "configuracion" ? "edit" : id ? "edit" : "create";
  if (!can(def.module, action)) return fail(DENIED);
  if (id !== null && !uuid.safeParse(id).success) return fail("Identificador inválido");

  const parsed = def.schema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const row: Record<string, unknown> = { ...parsed.data };
  if (entity === "expenses" && id === null) row.created_by = userId;

  const query = id ? supabase.from(def.table).update(row).eq("id", id).select("id") : supabase.from(def.table).insert(row).select("id");
  const { data, error } = await query;
  if (error) return fail(friendlyError(error));
  if (!data || data.length === 0) return fail("No se encontró el registro o no tienes permiso");

  revalidatePath("/", "layout");
  return success(undefined);
}

/** Activa/desactiva un maestro: nunca se borra historial con ventas asociadas. */
export async function setEntityActive(entity: EntityKey, id: string, active: boolean): Promise<ActionResult> {
  const def = resolveEntity(entity);
  if (!def || !def.softDelete) return fail("Operación no disponible");

  const { supabase, can } = await getContext();
  if (!can(def.module, def.module === "configuracion" ? "edit" : "delete")) return fail(DENIED);
  if (!uuid.safeParse(id).success) return fail("Identificador inválido");

  if (entity === "branches" && !active) {
    const { count } = await supabase.from("branches").select("id", { count: "exact", head: true }).eq("active", true);
    if ((count ?? 0) <= 1) return fail("Debe quedar al menos una sucursal activa");
  }

  const { data, error } = await supabase.from(def.table).update({ active }).eq("id", id).select("id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("No se encontró el registro o no tienes permiso");

  revalidatePath("/", "layout");
  return success(undefined);
}

export async function deleteEntity(entity: EntityKey, id: string): Promise<ActionResult> {
  const def = resolveEntity(entity);
  if (!def || def.softDelete || entity !== "expenses") return fail("Operación no disponible");

  const { supabase, can } = await getContext();
  if (!can(def.module, "delete")) return fail(DENIED);
  if (!uuid.safeParse(id).success) return fail("Identificador inválido");

  const { data, error } = await supabase.from(def.table).delete().eq("id", id).select("id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("No se encontró el registro");

  revalidatePath("/", "layout");
  return success(undefined);
}
