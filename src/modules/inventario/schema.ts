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
