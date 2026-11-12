import "server-only";
import { revalidatePath } from "next/cache";
import { DENIED, fail, friendlyError, getContext, success } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";
import { firstIssue, uuid } from "@/lib/validation";
import type { EntityDef } from "./types";

/* ------------------------------------------------------------------
 * Motor CRUD genérico de maestros. No conoce a ningún módulo: cada
 * módulo declara su entidad (`schema.ts`) y expone sus propias acciones
 * de servidor que llaman a estas funciones con su definición.
 * Verifica el permiso del rol; RLS en la base vuelve a verificarlo.
 * ------------------------------------------------------------------ */

const writeAction = (def: EntityDef, isNew: boolean) => (def.module === "configuracion" ? "edit" : isNew ? "create" : "edit");

export async function crudSave(def: EntityDef, id: string | null, values: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, userId, can } = await getContext();
  if (!can(def.module, writeAction(def, id === null))) return fail(DENIED);
  if (id !== null && !uuid.safeParse(id).success) return fail("Identificador inválido");

  const parsed = def.schema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const row: Record<string, unknown> = { ...parsed.data };
  if (def.stampCreator && id === null) row.created_by = userId;

  const query = id ? supabase.from(def.table).update(row).eq("id", id).select("id") : supabase.from(def.table).insert(row).select("id");
  const { data, error } = await query;
  if (error) return fail(friendlyError(error));
  if (!data || data.length === 0) return fail("No se encontró el registro o no tienes permiso");

  revalidatePath("/", "layout");
  return success(undefined);
}

/** Activa/desactiva: los maestros con historial nunca se borran. */
export async function crudSetActive(def: EntityDef, id: string, active: boolean): Promise<ActionResult> {
  if (!def.softDelete) return fail("Operación no disponible");
  const { supabase, can } = await getContext();
  if (!can(def.module, def.module === "configuracion" ? "edit" : "delete")) return fail(DENIED);
  if (!uuid.safeParse(id).success) return fail("Identificador inválido");

  const { data, error } = await supabase.from(def.table).update({ active }).eq("id", id).select("id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("No se encontró el registro o no tienes permiso");

  revalidatePath("/", "layout");
  return success(undefined);
}

/** Borrado definitivo: solo para entidades sin historial (softDelete: false). */
export async function crudDelete(def: EntityDef, id: string): Promise<ActionResult> {
  if (def.softDelete) return fail("Operación no disponible");
  const { supabase, can } = await getContext();
  if (!can(def.module, "delete")) return fail(DENIED);
  if (!uuid.safeParse(id).success) return fail("Identificador inválido");

  const { data, error } = await supabase.from(def.table).delete().eq("id", id).select("id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("No se encontró el registro");

  revalidatePath("/", "layout");
  return success(undefined);
}
