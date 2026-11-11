"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navFor } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { useApp } from "./app-provider";
import { BrandMark } from "./brand";
import { NAV_ICONS } from "./nav-icons";
import { MobileClose, Topbar } from "./topbar";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { profile, permissions, settings } = useApp();
  const items = navFor(profile.role, permissions);
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="flex h-full flex-col border-r border-menu-border bg-menu text-menu-text">
      <div className="flex h-16 shrink-0 items-center gap-3 px-5">
        <BrandMark className="h-10 w-10" />
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold leading-tight tracking-tight text-white">
            HANA<span className="text-brand-500">4</span> <span className="text-[11px] font-semibold text-menu-muted">ERP</span>
          </p>
          <p className="truncate text-[11px] leading-tight text-menu-muted">{settings.name}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2" aria-label="Principal">
        {groups.map((group) => (
          <div key={group} className="mb-4">
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-menu-muted">{group}</p>
            <ul className="space-y-0.5">
              {items
                .filter((i) => i.group === group)
                .map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors",
                          active ? "bg-menu-active text-white" : "hover:bg-menu-active/60 hover:text-white",
                        )}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-500" />}
                        <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand-500" : "text-menu-muted group-hover:text-menu-text")} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <p className="shrink-0 border-t border-menu-border px-5 py-3 text-[10px] text-menu-muted">ERP HANA4 · v1.0</p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:pl-60 print:pl-0">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-2xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <MobileClose onClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <Topbar onOpenMenu={() => setMobileOpen(true)} />
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
