import type { z } from "zod";
import type { ModuleKey } from "../modules";
import type { ActionResult } from "../types";

/**
 * Definición de un maestro (clientes, productos…). Cada módulo declara las
 * suyas en su `schema.ts` y las pasa al motor CRUD (`engine.ts`).
 */
export type EntityDef = {
  table: string;
  /** Módulo dueño: de él salen los permisos crear/editar/eliminar */
  module: ModuleKey;
  /** true = se desactiva (conserva historial); false = se puede borrar */
  softDelete: boolean;
  /** Guarda quién creó el registro (columna created_by) */
  stampCreator?: boolean;
  schema: z.ZodType<Record<string, unknown>>;
};

/** Acciones de servidor que un módulo entrega a la tabla genérica (ResourceManager). */
export type CrudActions = {
  save: (id: string | null, values: Record<string, unknown>) => Promise<ActionResult>;
  setActive?: (id: string, active: boolean) => Promise<ActionResult>;
  remove?: (id: string) => Promise<ActionResult>;
};
