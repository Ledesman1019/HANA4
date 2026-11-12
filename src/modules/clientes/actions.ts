"use server";

import { crudSave, crudSetActive } from "@/lib/crud/engine";
import { customers } from "./schema";

export async function saveCustomer(id: string | null, values: Record<string, unknown>) {
  return crudSave(customers, id, values);
}

export async function setCustomerActive(id: string, active: boolean) {
  return crudSetActive(customers, id, active);
}
