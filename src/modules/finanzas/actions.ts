"use server";

import { crudDelete, crudSave } from "@/lib/crud/engine";
import { expenses } from "./schema";

export async function saveExpense(id: string | null, values: Record<string, unknown>) {
  return crudSave(expenses, id, values);
}

/** Borrar un gasto genera su extorno contable; el registro de auditoría queda. */
export async function deleteExpense(id: string) {
  return crudDelete(expenses, id);
}
