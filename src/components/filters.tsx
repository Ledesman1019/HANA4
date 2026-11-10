import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass, Button } from "./ui";
import { cn } from "@/lib/utils";

/** Barra de filtros por URL (GET): los resultados se pueden compartir y recargar. */
export function FilterBar({ action, children }: { action: string; children: ReactNode }) {
  return (
    <Form action={action} className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
      {children}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        <Link href={action} className={buttonClass("ghost")}>
          Limpiar
        </Link>
      </div>
    </Form>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (target: number, disabled: boolean, label: string, icon: ReactNode) =>
    disabled ? (
      <span className={cn(buttonClass("secondary", "icon"), "pointer-events-none opacity-50")} aria-disabled="true">
        {icon}
      </span>
    ) : (
      <Link href={hrefFor(target)} className={buttonClass("secondary", "icon")} aria-label={label}>
        {icon}
      </Link>
    );

  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
      <span>
        {total} {total === 1 ? "registro" : "registros"}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {link(page - 1, page <= 1, "Página anterior", <ChevronLeft className="h-4 w-4" />)}
          <span className="tabular">
            {page} / {pages}
          </span>
          {link(page + 1, page >= pages, "Página siguiente", <ChevronRight className="h-4 w-4" />)}
        </div>
      )}
    </div>
  );
}

/** Normaliza un searchParam a string. */
export function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function buildQuery(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}
