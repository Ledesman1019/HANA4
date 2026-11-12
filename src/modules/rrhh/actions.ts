"use server";

import { crudSave } from "@/lib/crud/engine";
import { employees } from "./schema";

export async function saveEmployee(id: string | null, values: Record<string, unknown>) {
  return crudSave(employees, id, values);
}
