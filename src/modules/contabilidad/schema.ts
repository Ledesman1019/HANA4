import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { required, text } from "@/lib/validation";

export const costCenters: EntityDef = {
  table: "cost_centers",
  module: "contabilidad",
  softDelete: true,
  schema: z.object({
    code: text(10)
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,10}$/, "El código debe tener de 2 a 10 letras o números (ej. ADM)"),
    name: required("El nombre", 80),
  }),
};
