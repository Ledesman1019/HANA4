"use server";

import { crudSave, crudSetActive } from "@/lib/crud/engine";
import { suppliers } from "./schema";

export async function saveSupplier(id: string | null, values: Record<string, unknown>) {
  return crudSave(suppliers, id, values);
}

export async function setSupplierActive(id: string, active: boolean) {
  return crudSetActive(suppliers, id, active);
}
