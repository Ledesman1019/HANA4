import { cn } from "@/lib/utils";

/**
 * Símbolo de la marca sobre una ficha blanca: el logo usa azul marino,
 * así que la ficha garantiza que se lea también sobre fondos oscuros.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG pequeño y ya optimizado; evita pasar por el optimizador */}
      <img src="/brand/mark.png" alt="" width={256} height={256} className="h-full w-full object-contain" />
    </span>
  );
}

/** Logo completo (para fondos claros). */
export function BrandLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- PNG ya optimizado
    <img src="/brand/logo.png" alt="HANA4 · ERP Empresarial" width={720} height={287} className={cn("h-auto", className)} />
  );
}
