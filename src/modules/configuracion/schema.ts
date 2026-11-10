import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { required, text } from "@/lib/validation";

export const branches: EntityDef = {
  table: "branches",
  module: "configuracion",
  softDelete: true,
  schema: z.object({
    code: text(3).regex(/^\d{3}$/, "El código debe tener 3 dígitos (ej. 002)"),
    name: required("El nombre", 80),
    address: text(200).default(""),
    phone: text(30).default(""),
  }),
};
