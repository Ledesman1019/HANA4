"use server";

import { randomUUID } from "node:crypto";
import { fail, getContext, success } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const BUCKET = "product-images";
const MAX_BYTES = 900_000;
const TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

/** Firma del archivo: no se confía en el tipo que declara el navegador. */
function sniff(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Sube la foto de un producto (ya reducida en el navegador) al almacenamiento
 * público y devuelve su URL. El bucket se crea solo la primera vez.
 */
export async function uploadProductImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const { can } = await getContext();
  if (!can("inventario", "create") && !can("inventario", "edit")) return fail("Tu rol no tiene permiso para subir imágenes");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Selecciona una imagen");
  if (file.size > MAX_BYTES) return fail("La imagen es demasiado pesada");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) return fail("Formato no admitido. Usa JPG, PNG o WebP");

  const admin = createAdminClient();
  if (!admin) return fail("Falta la variable SUPABASE_SERVICE_ROLE_KEY en el servidor");

  const path = `${randomUUID()}.${TYPES[type]}`;
  const options = { contentType: type, cacheControl: "31536000", upsert: false };

  let { error } = await admin.storage.from(BUCKET).upload(path, bytes, options);
  if (error && /bucket not found/i.test(error.message)) {
    const created = await admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: Object.keys(TYPES) });
    if (created.error && !/already exists/i.test(created.error.message)) {
      console.error("[upload] bucket", created.error);
      return fail("No se pudo preparar el almacenamiento de imágenes");
    }
    ({ error } = await admin.storage.from(BUCKET).upload(path, bytes, options));
  }
  if (error) {
    console.error("[upload]", error);
    return fail("No se pudo subir la imagen");
  }

  return success({ url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
}
