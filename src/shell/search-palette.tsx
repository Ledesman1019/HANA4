"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { destinationsFor } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-provider";
import { Dialog } from "@/components/dialog";
import type { SearchGroup } from "./types";

/**
 * Buscador global (Ctrl+K): pantallas por nombre o código de transacción (VA01, ME21N…)
 * y datos (productos, clientes, comprobantes…). RLS limita lo que cada rol ve.
 */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, permissions } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const destinations = useMemo(() => destinationsFor(profile.role, permissions), [profile.role, permissions]);

  // Espera corta y se aborta la petición anterior en cada tecla.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { groups: [] }))
        .then((d: { groups: SearchGroup[] }) => {
          setGroups(d.groups ?? []);
          setSearching(false);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setSearching(false);
        });
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function onQuery(value: string) {
    setQuery(value);
    setActive(0);
    const live = value.trim().length >= 2;
    setSearching(live);
    if (!live) setGroups([]);
  }

  function close() {
    setQuery("");
    setGroups([]);
    setSearching(false);
    onClose();
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  const q = query.trim().toLowerCase();
  // El código de transacción exacto va primero
  const moduleHits = q
    ? destinations
        .filter((m) => m.code.toLowerCase().startsWith(q) || m.label.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q))
        .sort((a, b) => Number(b.code.toLowerCase() === q) - Number(a.code.toLowerCase() === q))
        .slice(0, 5)
    : [];
  const all: SearchGroup[] = [
    ...(moduleHits.length ? [{ label: "Pantallas", items: moduleHits.map((m) => ({ title: m.label, subtitle: `${m.code} · ${m.desc}`, href: m.href })) }] : []),
    ...groups,
  ];
  const flat = all.flatMap((g) => g.items);
  const offsets = all.map((_, i) => all.slice(0, i).reduce((sum, g) => sum + g.items.length, 0));

  return (
    <Dialog open={open} onClose={close} title="Buscar en el sistema" size="lg">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          autoFocus
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && flat[active]) {
              e.preventDefault();
              go(flat[active].href);
            }
          }}
          placeholder="Producto, cliente, comprobante o código de transacción (VA01, MMBE…)"
          aria-label="Búsqueda global"
          autoComplete="off"
          className="h-11 w-full rounded-lg border border-slate-300 bg-surface pl-11 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 [&::-webkit-search-cancel-button]:hidden"
        />
        {searching && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      <div className="mt-3 max-h-[55dvh] min-h-24 overflow-y-auto">
        {!q ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">
            Escribe para buscar. Atajo: <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px]">Ctrl K</kbd>
          </p>
        ) : flat.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">{searching || q.length < 2 ? "Buscando…" : `Sin resultados para «${query.trim()}»`}</p>
        ) : (
          all.map((g, groupIndex) => (
            <div key={g.label}>
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
              {g.items.map((item, itemIndex) => {
                const index = offsets[groupIndex] + itemIndex;
                return (
                  <button
                    key={`${g.label}-${item.href}-${item.title}`}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(item.href)}
                    className={cn("flex w-full cursor-pointer flex-col rounded-lg px-2.5 py-2 text-left", index === active && "bg-slate-100")}
                  >
                    <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
                    <span className="tabular truncate text-xs text-slate-500">{item.subtitle}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
