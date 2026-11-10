"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/uploads/actions";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

const MAX_SIDE = 640;

/** Reduce la foto en el navegador (máx. 640 px, WebP): sube en ~40 KB y carga al instante. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // Fondo blanco para PNG con transparencia
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
  const blob = (await toBlob("image/webp")) ?? (await toBlob("image/jpeg"));
  if (!blob) throw new Error("No se pudo procesar la imagen");
  return blob;
}

export function ImageField({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Selecciona un archivo de imagen");
    setBusy(true);
    try {
      const blob = await shrink(file);
      const form = new FormData();
      form.set("file", new File([blob], "producto", { type: blob.type }));
      const res = await uploadProductImage(form);
      if (res.ok) setUrl(res.data.url);
      else toast.error(res.error);
    } catch {
      toast.error("No se pudo procesar la imagen. Prueba con otra foto");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <input type="hidden" name={name} value={url} />
      <div className={cn("relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50", !url && "border-dashed")}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura ya optimizada en el navegador
          <img src={url} alt="Foto del producto" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-6 w-6 text-slate-300" />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" />
            {url ? "Cambiar foto" : "Subir foto"}
          </Button>
          {url && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setUrl("")}>
              <Trash2 className="h-3.5 w-3.5" />
              Quitar
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500">JPG, PNG o WebP. Desde el celular puedes tomar la foto directamente.</p>
      </div>
    </div>
  );
}
