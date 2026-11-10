import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { isoDate, money, nullableUuid, optionalEmail, required, text } from "@/lib/validation";

export const employees: EntityDef = {
  table: "employees",
  module: "rrhh",
  softDelete: false,
  schema: z.object({
    branch_id: nullableUuid,
    doc_number: required("El documento", 20),
    full_name: required("El nombre", 160),
    position: required("El cargo", 80),
    email: optionalEmail,
    phone: text(30).default(""),
    salary: money("El sueldo"),
    hire_date: isoDate,
    status: z.enum(["activo", "vacaciones", "licencia", "cesado"]),
  }),
};
