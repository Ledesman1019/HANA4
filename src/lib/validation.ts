import { z } from "zod";

/** Piezas de validación compartidas por los esquemas de todos los módulos. */
export const uuid = z.uuid();
export const text = (max = 200) => z.string().trim().max(max);
export const required = (label: string, max = 200) => text(max).min(1, `${label} es obligatorio`);
export const optionalEmail = z.union([z.literal(""), z.email("Correo inválido")]);
export const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
export const nullableUuid = z.preprocess(emptyToNull, z.uuid().nullable());
export const nullableText = z.preprocess(emptyToNull, text(60).nullable());
export const money = (label: string) => z.coerce.number<number>(`${label} inválido`).min(0, `${label} no puede ser negativo`).max(99_999_999);
export const amount = z.coerce.number<number>().min(0).max(99_999_999);
export const quantity = z.coerce.number<number>().gt(0, "La cantidad debe ser mayor a cero").max(9_999_999);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const firstIssue = (e: z.ZodError) => e.issues[0].message;
