import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { optionalEmail, required, text } from "@/lib/validation";

export const suppliers: EntityDef = {
  table: "suppliers",
  module: "proveedores",
  softDelete: true,
  schema: z.object({
    tax_id: text(11).regex(/^(10|15|17|20)\d{9}$/, "El RUC debe tener 11 dígitos válidos"),
    name: required("La razón social", 160),
    contact_name: text(120).default(""),
    email: optionalEmail,
    phone: text(30).default(""),
    address: text(200).default(""),
    payment_terms: z.coerce.number<number>("Plazo inválido").int("El plazo es en días enteros").min(0, "El plazo no puede ser negativo").max(365, "El plazo máximo es 365 días").default(30),
  }),
};
