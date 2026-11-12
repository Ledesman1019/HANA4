"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, Bell, Check, Info, KeyRound, LogOut, MonitorCog, PackageX, Search, Truck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/modules/auth/actions";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/app-provider";
import { AboutDialog, PasswordDialog, PreferencesDialog } from "./dialogs";
import { launcherHref, locate, type SapModule } from "./menu";
import { SearchPalette } from "./search-palette";
import type { AlertItem } from "./types";

type Popup = "user" | "alerts" | null;
type Window = "preferences" | "about" | "password" | "search" | null;

/** Evento para abrir ventanas de la barra desde otros componentes (ej. el mosaico «Preferencias»). */
export const OPEN_WINDOW_EVENT = "hana4:open-window";
export const openWindow = (name: Exclude<Window, null>) => window.dispatchEvent(new CustomEvent(OPEN_WINDOW_EVENT, { detail: name }));

const ALERT_ICONS = { red: PackageX, amber: AlertTriangle, blue: Truck };
const ALERT_TONES = { red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600", blue: "bg-brand-50 text-link" };

const tabClass = (active: boolean) =>
  cn(
    "flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors",
    active ? "bg-white/90 text-taskbar shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white",
  );
const popup = "pop-in absolute bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-pop";

/** Reloj de la barra: solo en el cliente (en el servidor no hay hora local del usuario). */
function useClock(timeZone: string) {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, 15_000);
      return () => clearInterval(timer);
    },
    () => new Intl.DateTimeFormat("es-PE", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date()),
    () => "",
  );
}

export function Taskbar({ menu }: { menu: SapModule[] }) {
  const { profile, roleName, branch, settings } = useApp();
  const pathname = usePathname();
  const params = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<{ branch: string; keys: Set<string> } | null>(null);
  const [open, setOpen] = useState<Popup>(null);
  const [win, setWin] = useState<Window>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const time = useClock(settings.timezone);

  // Contexto actual: módulo y área del lanzador, o de la pantalla abierta.
  const located = pathname === "/" ? null : locate(menu, pathname);
  const current = pathname === "/" ? menu.find((m) => m.key === params.get("m")) : located?.module;
  const currentArea = pathname === "/" ? (current?.areas.find((a) => a.key === params.get("a")) ?? current?.areas[0]) : located?.area;

  // Cerrar con clic fuera o Esc; Ctrl/⌘+K abre el buscador; ventanas pedidas desde otros componentes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setWin("search");
      }
    };
    const onWindow = (e: Event) => setWin((e as CustomEvent<Window>).detail);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_WINDOW_EVENT, onWindow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_WINDOW_EVENT, onWindow);
    };
  }, []);

  // Avisos: al entrar, al cambiar de pantalla o sucursal, y cada minuto.
  // Si aparece uno nuevo, suena la campana y se muestra en pantalla.
  useEffect(() => {
    const controller = new AbortController();
    if (seenRef.current && seenRef.current.branch !== branch.id) seenRef.current = null;
    const load = () =>
      fetch("/api/alerts", { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: AlertItem[] }) => {
          const items = d.items ?? [];
          setAlerts(items);
          const keys = items.map((a) => `${a.id}:${a.title}`);
          const seen = seenRef.current;
          if (seen) {
            const fresh = items.filter((_, i) => !seen.keys.has(keys[i]));
            if (fresh.length > 0) {
              playSound("notify");
              fresh.forEach((a) => toast(a.title, { description: a.detail }));
            }
          }
          seenRef.current = { branch: branch.id, keys: new Set(keys) };
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pathname, branch.id]);

  const names = profile.full_name.toUpperCase().split(/\s+/).filter(Boolean);
  const firstLine = names.slice(0, Math.ceil(names.length / 2)).join(" ");
  const secondLine = names.slice(Math.ceil(names.length / 2)).join(" ");

  return (
    <footer className="no-print sticky bottom-0 z-30 bg-taskbar text-white shadow-[0_-2px_10px_rgb(0_0_0/0.25)]">
      <div ref={rootRef} className="flex h-14 items-center gap-2 px-2 sm:px-3">
        {/* Perfil */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => (o === "user" ? null : "user"))}
            aria-expanded={open === "user"}
            aria-label="Menú del usuario"
            className="flex h-12 cursor-pointer items-center gap-2.5 rounded-md px-2 text-left hover:bg-white/10"
          >
            <UserRound className="h-7 w-7 shrink-0 text-white/90" />
            <span className="hidden min-w-0 text-[10px] font-semibold uppercase leading-[1.25] tracking-wide text-white/90 md:block">
              <span className="block max-w-44 truncate">{firstLine}</span>
              {secondLine && <span className="block max-w-44 truncate">{secondLine}</span>}
              <span className="block max-w-44 truncate text-white/60">{roleName}</span>
            </span>
          </button>
          {open === "user" && (
            <div className={cn(popup, "left-0 w-64")}>
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="truncate text-sm font-semibold text-slate-900">{profile.full_name}</p>
                <p className="truncate text-xs text-slate-500">{profile.email}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {roleName} · {branch.name}
                </p>
              </div>
              <div className="p-1.5">
                <MenuButton
                  icon={MonitorCog}
                  label="Preferencias de estación"
                  onClick={() => {
                    setOpen(null);
                    setWin("preferences");
                  }}
                />
                <MenuButton
                  icon={KeyRound}
                  label="Cambiar clave"
                  onClick={() => {
                    setOpen(null);
                    setWin("password");
                  }}
                />
                <form action={logout}>
                  <button type="submit" className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                    <LogOut className="h-4 w-4" />
                    Cerrar sesión (Logout)
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Pestañas: módulos en el inicio, áreas dentro de un módulo */}
        <nav aria-label="Áreas" className="flex min-w-0 flex-1 items-center justify-start gap-1 overflow-x-auto px-1 [scrollbar-width:none] sm:justify-center">
          {current
            ? current.areas.map((a) => (
                <Link key={a.key} href={launcherHref(current.key, a.key)} className={tabClass(a.key === currentArea?.key)} aria-current={a.key === currentArea?.key ? "page" : undefined}>
                  <a.icon className="h-[18px] w-[18px]" />
                  {a.label}
                </Link>
              ))
            : menu.map((m) => (
                <Link key={m.key} href={launcherHref(m.key)} className={tabClass(false)} title={m.name}>
                  <m.icon className="h-[18px] w-[18px]" />
                  <span>
                    <span className="font-bold">{m.code}</span>
                    <span className="hidden lg:inline"> · {m.name}</span>
                  </span>
                </Link>
              ))}
          <button type="button" onClick={() => setWin("about")} className={tabClass(false)}>
            <Info className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">Acerca de…</span>
          </button>
        </nav>

        {/* Buscador, avisos, sucursal y hora */}
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setWin("search")} title="Buscar (Ctrl K)" aria-label="Buscar" className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-white/85 hover:bg-white/10">
            <Search className="h-[18px] w-[18px]" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => (o === "alerts" ? null : "alerts"))}
              aria-expanded={open === "alerts"}
              aria-label={`Avisos (${alerts.length})`}
              title="Avisos"
              className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-white/85 hover:bg-white/10"
            >
              <Bell className="h-[18px] w-[18px]" />
              {alerts.length > 0 && (
                <span className="tabular absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">{alerts.length}</span>
              )}
            </button>
            {open === "alerts" && (
              <div className={cn(popup, "right-0 w-80")}>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                  <p className="text-sm font-semibold text-slate-900">Mensajes de tienda</p>
                  <Link href="/mensajes" onClick={() => setOpen(null)} className="text-xs font-semibold text-link hover:underline">
                    Ver todos
                  </Link>
                </div>
                {alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Check className="mx-auto h-6 w-6 text-emerald-500" />
                    <p className="mt-2 text-sm text-slate-500">Todo en orden. No hay avisos pendientes.</p>
                  </div>
                ) : (
                  <ul className="max-h-[60dvh] overflow-y-auto p-1.5">
                    {alerts.map((a) => {
                      const Icon = ALERT_ICONS[a.tone];
                      return (
                        <li key={a.id}>
                          <Link href={a.href} onClick={() => setOpen(null)} className="flex items-start gap-3 rounded-md px-2.5 py-2.5 hover:bg-slate-100">
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", ALERT_TONES[a.tone])}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-slate-900">{a.title}</span>
                              <span className="block text-xs text-slate-500">{a.detail}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setWin("preferences")}
            title="Sucursal y preferencias"
            className="hidden h-12 cursor-pointer flex-col items-end justify-center rounded-md px-2 text-right text-[10px] font-semibold uppercase leading-[1.3] tracking-wide text-white/85 hover:bg-white/10 sm:flex"
          >
            <span className="max-w-44 truncate">{branch.name}</span>
            <span className="tabular text-white/60">
              {branch.code}
              {time && ` · ${time}`}
            </span>
          </button>
        </div>
      </div>

      <SearchPalette open={win === "search"} onClose={() => setWin(null)} />
      <PreferencesDialog open={win === "preferences"} onClose={() => setWin(null)} onPassword={() => setWin("password")} />
      <PasswordDialog open={win === "password"} onClose={() => setWin(null)} />
      <AboutDialog open={win === "about"} onClose={() => setWin(null)} menu={menu} />
    </footer>
  );
}

function MenuButton({ icon: Icon, label, onClick }: { icon: typeof Info; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">
      <Icon className="h-4 w-4 text-slate-400" />
      {label}
    </button>
  );
}
