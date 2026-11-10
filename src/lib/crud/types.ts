import type { z } from "zod";
import type { ModuleKey } from "../modules";

/**
 * Definición de un maestro (clientes, productos…). Cada módulo declara las
 * suyas en su `schema.ts`; el motor CRUD genérico las ejecuta.
 */
export type EntityDef = {
  table: string;
  /** Módulo dueño: de él salen los permisos crear/editar/eliminar */
  module: ModuleKey;
  /** true = se desactiva (conserva historial); false = se puede borrar */
  softDelete: boolean;
  schema: z.ZodType<Record<string, unknown>>;
};
