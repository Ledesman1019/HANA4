"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { PageHeader } from "./ui";

export type Screen = {
  title: string;
  description: string;
  /** Variante según un parámetro de la URL (ej. kardex filtrado por tipo) */
  variants?: { param: string; values: Record<string, { title: string; description: string }> };
};

/**
 * Título de la pantalla actual dentro de una sección. Cada pantalla muestra solo lo suyo:
 * la navegación entre pantallas la hace el lanzador, no pestañas.
 */
export function ScreenHeader({ screens }: { screens: Record<string, Screen> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const screen = screens[pathname];
  if (!screen) return null;
  const variant = screen.variants && screen.variants.values[params.get(screen.variants.param) ?? ""];
  const { title, description } = variant ?? screen;
  return <PageHeader title={title} description={description} />;
}
