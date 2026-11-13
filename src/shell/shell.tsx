"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { backHref, launcherHref, locate, menuFor } from "./menu";
import { Taskbar } from "./taskbar";

/**
 * Marco al estilo de los ERP de escritorio: sin encabezado superior.
 * Abajo, la barra con el perfil, las áreas y los avisos; arriba de cada pantalla, solo «Atrás».
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, permissions } = useApp();
  const menu = useMemo(() => menuFor(profile.role, permissions), [profile.role, permissions]);
  const onLauncher = pathname === "/";

  return (
    <div className="flex min-h-dvh flex-col">
      {onLauncher ? (
        <div className="flex-1">{children}</div>
      ) : (
        <main className="flex-1 bg-app">
          <BackBar pathname={pathname} menu={menu} />
          <div className="mx-auto w-full max-w-[1400px] px-4 pb-8 pt-3 sm:px-6 lg:px-8">{children}</div>
        </main>
      )}
      <Taskbar menu={menu} />
    </div>
  );
}

/**
 * «Atrás» lleva al nivel anterior del menú: de un detalle (ej. /ventas/123) a su listado,
 * y de una pantalla del menú a los mosaicos de su área.
 */
function BackBar({ pathname, menu }: { pathname: string; menu: ReturnType<typeof menuFor> }) {
  const place = locate(menu, pathname);
  const href = backHref(menu, pathname, place);

  return (
    <div className="no-print mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 pt-4 sm:px-6 lg:px-8">
      <Link
        href={href}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-surface pl-2.5 pr-3.5 text-sm font-semibold text-slate-700 shadow-xs transition-colors hover:border-brand-500 hover:text-link"
      >
        <ArrowLeft className="h-4 w-4" />
        Atrás
      </Link>
      {place && (
        <p className="flex min-w-0 items-center gap-1 truncate text-xs font-medium text-slate-500">
          <Link href={launcherHref(place.module.key)} className="font-mono font-bold text-link hover:underline">
            {place.module.code}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          <Link href={launcherHref(place.module.key, place.area.key)} className="truncate hover:underline">
            {place.area.label}
          </Link>
        </p>
      )}
    </div>
  );
}
