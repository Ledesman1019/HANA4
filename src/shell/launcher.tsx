"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-provider";
import { BrandMark } from "@/components/brand";
import { launcherHref, menuFor, type Tile } from "./menu";
import { openWindow } from "./taskbar";

const tileBase =
  "desk-tile group relative flex cursor-pointer flex-col rounded-[3px] border-[1.5px] border-white/75 bg-white/[0.07] text-white shadow-[0_1px_0_rgb(255_255_255/0.15)_inset] transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/[0.16] hover:shadow-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Pantalla principal del ERP: módulos SAP → áreas → funciones, en mosaicos grandes. */
export function Launcher({ moduleKey, areaKey }: { moduleKey?: string; areaKey?: string }) {
  const { profile, permissions } = useApp();
  const menu = useMemo(() => menuFor(profile.role, permissions), [profile.role, permissions]);
  const sapModule = menu.find((m) => m.key === moduleKey);
  const area = sapModule?.areas.find((a) => a.key === areaKey) ?? sapModule?.areas[0];

  return (
    <div className="desk-bg relative flex min-h-[calc(100dvh-3.5rem)] flex-col overflow-hidden">
      <div className="relative z-10 flex-1 px-4 pb-28 pt-5 sm:px-8 sm:pt-8">
        {sapModule && area ? (
          <>
            <Link
              href={launcherHref()}
              className="mb-6 inline-flex h-10 items-center gap-2 rounded-[3px] border-[1.5px] border-white/75 bg-white/10 pl-3 pr-4 text-sm font-semibold text-white transition-colors hover:bg-white/20"
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
              Atrás
            </Link>
            <div className="mx-auto flex max-w-[1480px] flex-wrap justify-center gap-2.5">
              {area.tiles.map((tile) => (
                <FunctionTile key={tile.href} tile={tile} caption={area.label} />
              ))}
            </div>
          </>
        ) : (
          <div className="mx-auto mt-2 flex max-w-[1480px] flex-wrap justify-center gap-3 sm:mt-10">
            {menu.map((m) => (
              <Link key={m.key} href={launcherHref(m.key)} className={cn(tileBase, "h-40 w-full p-4 sm:w-[300px]")}>
                <div className="flex items-start justify-between gap-3">
                  <m.icon className="h-10 w-10 shrink-0" strokeWidth={1.75} />
                  <span className="text-[2rem] font-black leading-none tracking-tight">{m.code}</span>
                </div>
                <p className="mt-auto text-[17px] font-bold leading-tight">{m.name}</p>
                <p className="mt-1 text-xs text-white/75">{m.desc}</p>
                <span className="absolute bottom-1.5 right-2.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">SAP</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Marca de agua, como en los ERP de escritorio */}
      <div aria-hidden className="pointer-events-none absolute bottom-5 right-6 flex items-center gap-3 opacity-95 sm:bottom-8 sm:right-10">
        <BrandMark className="h-12 w-12 rounded-2xl p-1 sm:h-16 sm:w-16" />
        <div className="leading-none text-white">
          <p className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            hana<span className="text-sky-300">4</span>
          </p>
          <p className="mt-1 text-xs font-semibold tracking-wide text-white/80 sm:text-sm">erp empresarial</p>
        </div>
      </div>
    </div>
  );
}

function FunctionTile({ tile, caption }: { tile: Tile; caption: string }) {
  const className = cn(tileBase, "h-[120px] w-[calc(50%-5px)] p-3 text-left sm:w-[228px]");
  const body = (
    <>
      <div className="flex items-start gap-3">
        <tile.icon className="h-9 w-9 shrink-0" strokeWidth={1.75} />
        <span className="mt-1.5 text-[15px] font-bold leading-tight [text-wrap:balance]">{tile.label}</span>
      </div>
      <span className="mt-auto text-[11px] text-white/80">{caption}</span>
    </>
  );
  if (tile.action) {
    return (
      <button type="button" className={className} onClick={() => openWindow(tile.action === "about" ? "about" : "preferences")}>
        {body}
      </button>
    );
  }
  return (
    <Link href={tile.href} className={className}>
      {body}
    </Link>
  );
}
