import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { money, optionalEmail, required, text } from "@/lib/validation";

export const customers: EntityDef = {
  table: "customers",
  module: "clientes",
  softDelete: true,
  schema: z
    .object({
      doc_type: z.enum(["DNI", "RUC", "CE", "PASAPORTE"]),
      doc_number: required("El número de documento", 20),
      name: required("El nombre", 160),
      email: optionalEmail,
      phone: text(30).default(""),
      address: text(200).default(""),
      // Solo viajan si el formulario los muestra (permiso de crédito); la base vuelve a verificarlo
      credit_limit: money("La línea de crédito").optional(),
      credit_days: z.coerce.number<number>("Plazo inválido").int("Plazo inválido").min(0, "Plazo inválido").max(365, "El plazo máximo es 365 días").optional(),
    })
    .refine((c) => c.doc_type !== "DNI" || /^\d{8}$/.test(c.doc_number), { message: "El DNI debe tener 8 dígitos" })
    .refine((c) => c.doc_type !== "RUC" || /^(10|15|17|20)\d{9}$/.test(c.doc_number), { message: "El RUC debe tener 11 dígitos válidos" }),
};
