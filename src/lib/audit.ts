import "server-only";
import type { AppContext } from "./auth";
import { createAdminClient } from "./supabase/server";

/**
 * Registra en la auditoría un hecho que ejecuta el servidor con la clave de
 * servicio (alta de usuarios, restablecer contraseñas…). Los cambios hechos
 * con la sesión del usuario los registra la propia base de datos con triggers.
 */
export async function logAudit(ctx: AppContext, action: string, entity: string, entityId: string | null, summary: string, details: Record<string, unknown> = {}) {
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.from("audit_log").insert({
    actor_id: ctx.userId,
    actor_name: ctx.profile.full_name,
    action,
    entity,
    entity_id: entityId,
    summary,
    details,
  });
  if (error) console.error("[audit]", error);
}
