"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Bell, Building2, Check, ChevronDown, CircleHelp, KeyRound, LayoutGrid, Loader2, LogOut, Menu, PackageX, Search, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { changePassword, logout, setBranch } from "@/modules/auth/actions";
import type { AlertItem } from "@/app/api/alerts/route";
import type { SearchGroup } from "@/app/api/search/route";
import { navFor } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { useApp } from "./app-provider";
import { Dialog, DialogFooter } from "./dialog";
import { NAV_ICONS } from "./nav-icons";
import { ThemeToggle } from "./theme";
import { Button, Field, FormError, Input } from "./ui";

type MenuName = "search" | "alerts" | "help" | "apps" | "user" | null;

const iconButton =
  "relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500";
const popover = "pop-in absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-pop";

const ALERT_ICONS = { red: PackageX, amber: AlertTriangle, blue: Truck };
const ALERT_TONES = { red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600", blue: "bg-brand-50 text-link" };

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { profile, roleName, permissions, canSwitchBranch, branch, branches } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [menu, setMenu] = useState<MenuName>(null);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [switching, startSwitch] = useTransition();

  const modules = useMemo(() => navFor(profile.role, permissions), [profile.role, permissions]);
  const canSwitch = canSwitchBranch && branches.length > 1;
  const toggle = (name: Exclude<MenuName, null>) => setMenu((current) => (current === name ? null : name));

  // Cerrar al hacer clic fuera o con Esc; Ctrl/⌘+K enfoca el buscador.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Avisos: al entrar, al cambiar de módulo o sucursal, y cada 2 minutos.
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch("/api/alerts", { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: AlertItem[] }) => setAlerts(d.items ?? []))
        .catch(() => {});
    load();
    const timer = setInterval(load, 120_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pathname, branch.id]);

  // Búsqueda global con espera corta; se aborta la petición anterior en cada tecla.
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
    setMenu("search");
    const live = value.trim().length >= 2;
    setSearching(live);
    if (!live) setGroups([]);
  }

  const q = query.trim().toLowerCase();
  const moduleHits = q ? modules.filter((m) => m.label.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)).slice(0, 4) : [];
  const allGroups: SearchGroup[] = [
    ...(moduleHits.length ? [{ label: "Módulos", items: moduleHits.map((m) => ({ title: m.label, subtitle: m.desc, href: m.href })) }] : []),
    ...groups,
  ];
  const flat = allGroups.flatMap((g) => g.items);

  function go(href: string) {
    setMenu(null);
    setQuery("");
    setGroups([]);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    router.push(href);
  }

  const initials = profile.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  // Posición de cada grupo dentro de la lista plana (navegación con flechas)
  const offsets = allGroups.map((_, i) => allGroups.slice(0, i).reduce((sum, g) => sum + g.items.length, 0));

  return (
    <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-surface/85 backdrop-blur-md">
      <div ref={rootRef} className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <button type="button" aria-label="Abrir menú" onClick={onOpenMenu} className={cn(iconButton, "lg:hidden")}>
          <Menu className="h-5 w-5" />
        </button>

        {/* Buscador global */}
        <div className="relative min-w-0 flex-1 md:max-w-xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onFocus={() => q && setMenu("search")}
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
            placeholder="Buscar productos, clientes o comprobantes…"
            aria-label="Búsqueda global"
            autoComplete="off"
            className="h-11 w-full rounded-full border border-transparent bg-slate-100 pl-11 pr-16 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-500/15 [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:flex">
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : (
              <kbd className="rounded-md border border-slate-200 bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-400">Ctrl K</kbd>
            )}
          </span>

          {menu === "search" && q && (
            <div className="pop-in absolute inset-x-0 top-full z-50 mt-2 max-h-[70dvh] origin-top overflow-y-auto rounded-2xl border border-slate-200 bg-surface p-1.5 shadow-pop">
              {flat.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">{searching || q.length < 2 ? "Buscando…" : `Sin resultados para «${query.trim()}»`}</p>
              ) : (
                allGroups.map((g, groupIndex) => (
                  <div key={g.label}>
                    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
                    {g.items.map((item, itemIndex) => {
                      const index = offsets[groupIndex] + itemIndex;
                      return (
                        <button
                          key={`${g.label}-${item.href}-${item.title}`}
                          type="button"
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(item.href)}
                          className={cn("flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left", index === active && "bg-slate-100")}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">{item.title}</span>
                            <span className="tabular block truncate text-xs text-slate-500">{item.subtitle}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {/* Sucursal */}
          {canSwitch ? (
            <label className={cn("relative mr-1 hidden items-center md:flex", switching && "opacity-60")}>
              <Building2 className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
              <span className="sr-only">Sucursal activa</span>
              <select
                value={branch.id}
                disabled={switching}
                onChange={(e) => {
                  const id = e.target.value;
                  startSwitch(() => setBranch(id));
                }}
                className="h-9 max-w-44 cursor-pointer appearance-none truncate rounded-full border border-slate-200 bg-surface pl-9 pr-8 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-400" />
            </label>
          ) : (
            <span className="mr-2 hidden items-center gap-1.5 text-xs font-semibold text-slate-600 md:flex">
              <Building2 className="h-4 w-4 text-slate-400" />
              {branch.name}
            </span>
          )}

          {/* Avisos */}
          <div className="relative">
            <button type="button" className={iconButton} onClick={() => toggle("alerts")} aria-label={`Avisos (${alerts.length})`} aria-expanded={menu === "alerts"} title="Avisos">
              <Bell className="h-[18px] w-[18px]" />
              {alerts.length > 0 && (
                <span className="tabular absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
                  {alerts.length}
                </span>
              )}
            </button>
            {menu === "alerts" && (
              <div className={cn(popover, "w-80")}>
                <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Avisos</p>
                {alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Check className="mx-auto h-6 w-6 text-emerald-500" />
                    <p className="mt-2 text-sm text-slate-500">Todo en orden. No hay avisos pendientes.</p>
                  </div>
                ) : (
                  <ul className="p-1.5">
                    {alerts.map((a) => {
                      const Icon = ALERT_ICONS[a.tone];
                      return (
                        <li key={a.id}>
                          <Link href={a.href} onClick={() => setMenu(null)} className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 hover:bg-slate-100">
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

          <ThemeToggle className={iconButton} />

          {/* Ayuda */}
          <div className="relative hidden sm:block">
            <button type="button" className={iconButton} onClick={() => toggle("help")} aria-label="Ayuda" aria-expanded={menu === "help"} title="Ayuda">
              <CircleHelp className="h-[18px] w-[18px]" />
            </button>
            {menu === "help" && (
              <div className={cn(popover, "w-80 p-4")}>
                <p className="text-sm font-semibold text-slate-900">Atajos y consejos</p>
                <dl className="mt-3 space-y-2.5 text-xs text-slate-600">
                  {[
                    ["Ctrl K", "Buscar en todo el sistema"],
                    ["Enter", "En el punto de venta, agrega el producto escaneado o buscado"],
                    ["Esc", "Cierra ventanas y menús"],
                  ].map(([key, text]) => (
                    <div key={key} className="flex items-start gap-3">
                      <dt>
                        <kbd className="inline-block min-w-12 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-center font-sans text-[11px] font-semibold text-slate-700">{key}</kbd>
                      </dt>
                      <dd>{text}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                  Un lector de código de barras USB funciona sin configuración: enfoca el buscador del punto de venta y escanea. Desde el celular usa el botón de cámara.
                </p>
              </div>
            )}
          </div>

          {/* Accesos rápidos */}
          <div className="relative hidden sm:block">
            <button type="button" className={iconButton} onClick={() => toggle("apps")} aria-label="Accesos rápidos" aria-expanded={menu === "apps"} title="Accesos rápidos">
              <LayoutGrid className="h-[18px] w-[18px]" />
            </button>
            {menu === "apps" && (
              <div className={cn(popover, "w-[22rem] p-2")}>
                <ul className="grid grid-cols-3 gap-1">
                  {modules.map((m) => {
                    const Icon = NAV_ICONS[m.icon];
                    return (
                      <li key={m.href}>
                        <Link href={m.href} onClick={() => setMenu(null)} className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center hover:bg-slate-100">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-link">
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="text-[11px] font-semibold leading-tight text-slate-700">{m.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* Usuario */}
          <div className="relative ml-1 border-l border-slate-200 pl-2 sm:ml-2 sm:pl-4">
            <button
              type="button"
              onClick={() => toggle("user")}
              aria-expanded={menu === "user"}
              aria-label="Menú de usuario"
              className="flex cursor-pointer items-center gap-3 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-slate-100 sm:pl-3"
            >
              <span className="hidden min-w-0 text-right sm:block">
                <span className="block max-w-40 truncate text-sm font-bold leading-tight text-slate-900">{profile.full_name}</span>
                <span className="block text-xs leading-tight text-slate-500">{roleName}</span>
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {initials}
              </span>
              <ChevronDown className={cn("hidden h-4 w-4 text-slate-400 transition-transform sm:block", menu === "user" && "rotate-180")} />
            </button>
            {menu === "user" && (
              <div className={cn(popover, "w-64")}>
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{profile.full_name}</p>
                  <p className="truncate text-xs text-slate-500">{profile.email}</p>
                </div>
                {canSwitch && (
                  <div className="border-b border-slate-100 p-1.5 md:hidden">
                    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sucursal</p>
                    {branches.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          startSwitch(() => setBranch(b.id));
                        }}
                        className="flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                      >
                        {b.name}
                        {b.id === branch.id && <Check className="h-4 w-4 text-link" />}
                      </button>
                    ))}
                  </div>
                )}
                <div className="p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      setPasswordOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <KeyRound className="h-4 w-4 text-slate-400" />
                    Cambiar contraseña
                  </button>
                  <form action={logout}>
                    <button type="submit" className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                      <LogOut className="h-4 w-4" />
                      Cerrar sesión
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </header>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onClose={onClose} title="Cambiar contraseña" size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const next = String(form.get("next") ?? "");
          if (next !== String(form.get("repeat") ?? "")) return setError("Las contraseñas nuevas no coinciden");
          setError(null);
          startTransition(async () => {
            const res = await changePassword(String(form.get("current") ?? ""), next);
            if (!res.ok) return setError(res.error ?? "No se pudo cambiar la contraseña");
            toast.success("Contraseña actualizada");
            onClose();
          });
        }}
      >
        <Field label="Contraseña actual">
          <Input name="current" type="password" required autoComplete="current-password" autoFocus />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
          <Input name="next" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <Field label="Repite la nueva contraseña">
          <Input name="repeat" type="password" required minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending}>
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function MobileClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Cerrar menú" onClick={onClick} className="absolute right-2 top-4 rounded-lg p-1.5 text-menu-muted hover:bg-menu-active hover:text-white">
      <X className="h-4 w-4" />
    </button>
  );
}
