import "server-only";
import { customers } from "@/modules/clientes/schema";
import { costCenters } from "@/modules/contabilidad/schema";
import { branches } from "@/modules/configuracion/schema";
import { expenses } from "@/modules/finanzas/schema";
import { categories, products } from "@/modules/inventario/schema";
import { suppliers } from "@/modules/proveedores/schema";
import { employees } from "@/modules/rrhh/schema";
import type { EntityDef } from "./types";

/**
 * Maestros que el motor CRUD puede escribir. Es una lista cerrada: el
 * cliente solo envía la clave y el servidor decide tabla, validación y permiso.
 */
export const ENTITIES = { categories, products, customers, suppliers, expenses, employees, branches, costCenters } satisfies Record<string, EntityDef>;

export type EntityKey = keyof typeof ENTITIES;

export function resolveEntity(key: string): EntityDef | null {
  return Object.hasOwn(ENTITIES, key) ? ENTITIES[key as EntityKey] : null;
}
