"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function Tabs({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Secciones">
      {items.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-brand-600 text-link" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
