import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

// Fondo estable por producto cuando aún no tiene foto
const TINTS = ["bg-brand-50 text-link", "bg-emerald-50 text-emerald-600", "bg-amber-50 text-amber-600", "bg-slate-100 text-slate-400"];

export function ProductThumb({ src, name, className }: { src?: string | null; name: string; className?: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- miniatura ya reducida (≤640 px, WebP) servida desde el CDN del almacenamiento
      <img src={src} alt="" loading="lazy" decoding="async" className={cn("shrink-0 bg-slate-100 object-cover", className)} />
    );
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return (
    <div aria-hidden className={cn("flex shrink-0 items-center justify-center", TINTS[Math.abs(hash) % TINTS.length], className)}>
      <Package className="h-[42%] w-[42%]" strokeWidth={1.5} />
    </div>
  );
}
