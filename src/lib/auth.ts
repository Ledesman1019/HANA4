import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hasPermission, type Action, type ModuleKey, type Permissions } from "./modules";
import { createClient } from "./supabase/server";
import { hasSupabaseEnv } from "./supabase/env";
import type { ActionResult, Branch, Profile, Settings } from "./types";

export const BRANCH_COOKIE = "erp_branch";

/** Versión del esquema (última migración) que necesita esta versión de la aplicación. */
export const REQUIRED_SCHEMA = 8;

type Loaded =
  | {
      status: "ok";
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      profile: Profile;
      roleName: string;
      permissions: Permissions;
      settings: Settings;
      branches: Branch[];
      branch: Branch;
      /** ¿El rol del usuario permite esta acción en el módulo? */
      can: (module: ModuleKey, action: Action | "access") => boolean;
    }
  | { status: "setup" | "anonymous" | "inactive" };

/**
 * Resuelve usuario, perfil, permisos, empresa y sucursal activa una sola vez
 * por petición (React cache) y en un solo viaje a la base de datos.
 * No redirige: sirve tanto a páginas como a rutas de API.
 */
export const loadContext = cache(async (): Promise<Loaded> => {
  // Todo lo que depende de la sesión se resuelve en tiempo de petición.
  await connection();
  if (!hasSupabaseEnv) return { status: "setup" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { status: "anonymous" };

  const { data, error } = await supabase.rpc("app_context");
  // La función no existe: falta ejecutar una migración.
  if (error || !data) return { status: "setup" };

  const ctx = data as { schema?: number; profile: Profile | null; role_name: string | null; settings: Settings | null; branches: Branch[] | null; permissions: Permissions | null };
  const { profile, settings } = ctx;
  const branches = ctx.branches ?? [];
  // La base está en una versión anterior a la que necesita esta aplicación: hay que actualizarla
  if ((ctx.schema ?? 0) < REQUIRED_SCHEMA) return { status: "setup" };
  if (!profile || !profile.active || !settings) return { status: "inactive" };

  const permissions = ctx.permissions ?? {};
  const can = (module: ModuleKey, action: Action | "access") => hasPermission(profile.role, permissions, module, action);

  // Solo quien supervisa (admin o con acceso a configuración/reportes) cambia de sucursal.
  let branchId = profile.branch_id;
  if (canSwitchBranch(profile.role, permissions)) {
    const chosen = (await cookies()).get(BRANCH_COOKIE)?.value;
    if (chosen && branches.some((b) => b.id === chosen)) branchId = chosen;
  }
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  if (!branch) return { status: "inactive" };

  return { status: "ok", supabase, userId, profile, roleName: ctx.role_name ?? profile.role, permissions, settings, branches, branch, can };
});

export function canSwitchBranch(role: string, permissions: Permissions) {
  return hasPermission(role, permissions, "reportes", "view") || hasPermission(role, permissions, "configuracion", "view");
}

/** Para páginas y acciones: redirige si no hay sesión válida. */
export async function getContext(): Promise<AppContext> {
  const ctx = await loadContext();
  if (ctx.status !== "ok") {
    return redirect(ctx.status === "setup" ? "/setup" : ctx.status === "anonymous" ? "/login" : "/inactivo");
  }
  return ctx;
}

export type AppContext = Extract<Loaded, { status: "ok" }>;

/** Para páginas: redirige al panel si el rol no tiene el permiso. */
export async function requireAccess(module: ModuleKey, action: Action | "access" = "access") {
  const ctx = await getContext();
  if (!ctx.can(module, action)) redirect("/");
  return ctx;
}

/** Traduce errores de Postgres/Supabase a mensajes para el usuario. */
export function friendlyError(error: { message?: string; code?: string; details?: string } | null | undefined) {
  if (!error) return "Ocurrió un error inesperado";
  switch (error.code) {
    case "23505":
      return "Ya existe un registro con esos datos (código, nombre o documento duplicado)";
    case "23503":
      return "No se puede completar: el registro está relacionado con otros datos";
    case "23514":
      return "Alguno de los valores no es válido";
    case "42501":
      return "Tu rol no tiene permiso para realizar esta acción";
    case "PGRST116":
      return "Registro no encontrado";
  }
  if (error.message?.includes("row-level security")) return "Tu rol no tiene permiso para realizar esta acción";
  // Los mensajes de nuestras funciones SQL (raise exception) ya están en español.
  if (error.code === "P0001" && error.message) return error.message;
  console.error("[db]", error);
  return "No se pudo completar la operación. Inténtalo de nuevo";
}

export const DENIED = "Tu rol no tiene permiso para realizar esta acción";
export const fail = (error: string): ActionResult<never> => ({ ok: false, error });
export const success = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
