import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { isoDate, money, required } from "@/lib/validation";

export const expenses: EntityDef = {
  table: "expenses",
  module: "finanzas",
  softDelete: false,
  schema: z.object({
    branch_id: z.uuid("Selecciona la sucursal"),
    category: z.enum(["alquiler", "servicios", "planilla", "marketing", "transporte", "mantenimiento", "impuestos", "otros"]),
    description: required("La descripción", 200),
    amount: money("El monto").gt(0, "El monto debe ser mayor a cero"),
    payment_method: z.enum(["efectivo", "tarjeta", "transferencia", "yape", "plin"]),
    expense_date: isoDate,
  }),
};
