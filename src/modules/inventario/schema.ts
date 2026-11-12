import { z } from "zod";
import type { EntityDef } from "@/lib/crud/types";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { emptyToNull, money, nullableText, nullableUuid, required, text } from "@/lib/validation";

export const categories: EntityDef = {
  table: "categories",
  module: "inventario",
  softDelete: true,
  schema: z.object({
    name: required("El nombre", 80),
    description: text(300).default(""),
  }),
};

export const products: EntityDef = {
  table: "products",
  module: "inventario",
  softDelete: true,
  schema: z.object({
    sku: required("El SKU", 40).toUpperCase(),
    barcode: nullableText,
    name: required("El nombre", 160),
    description: text(500).default(""),
    category_id: nullableUuid,
    unit: required("La unidad", 10).toUpperCase(),
    cost: money("El costo"),
    price: money("El precio"),
    min_stock: money("El stock mínimo"),
    track_lots: z.preprocess((v) => v === true || v === "true", z.boolean()),
    /** Presentación de compra (CAJA, PAQUETE…) y sus unidades; vacía = se compra por unidad */
    pack_unit: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z]{2,12})?$/, "Presentación inválida: solo letras (ej. CAJA)")
      .default(""),
    pack_size: z.coerce.number<number>("Unidades por presentación inválidas").min(1, "La presentación debe tener al menos 1 unidad").max(100_000).default(1),
    // Solo se aceptan imágenes de nuestro propio almacenamiento
    image_url: z.preprocess(
      emptyToNull,
      z
        .string()
        .max(500)
        .refine((u) => u.startsWith(`${SUPABASE_URL}/storage/v1/object/public/product-images/`), "Imagen inválida")
        .nullable(),
    ),
  }),
};
