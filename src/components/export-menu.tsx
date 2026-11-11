"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Printer, Table2 } from "lucide-react";
import { toast } from "sonner";
import { exportCsv, exportExcel, exportPdf, printDoc, type ExportColumn, type ExportDoc, type ExportRow } from "@/lib/export";
import { cn } from "@/lib/utils";
import { useApp } from "./app-provider";
import { buttonClass } from "./ui";

type Format = "excel" | "pdf" | "csv" | "print";

const OPTIONS: { format: Format; label: string; hint: string; icon: typeof Download; tone: string }[] = [
  { format: "excel", label: "Excel", hint: "Hoja .xlsx con formato", icon: FileSpreadsheet, tone: "text-emerald-600" },
  { format: "pdf", label: "PDF", hint: "Documento listo para enviar", icon: FileText, tone: "text-red-600" },
  { format: "csv", label: "CSV", hint: "Datos para otros sistemas", icon: Table2, tone: "text-slate-500" },
  { format: "print", label: "Imprimir", hint: "Con encabezado de la empresa", icon: Printer, tone: "text-link" },
];

type Props = {
  title: string;
  /** Filtros o periodo, para el encabezado del documento */
  subtitle?: string;
  /** Nombre de archivo sin extensión */
  filename: string;
  columns: ExportColumn[];
  /** Filas ya cargadas… */
  rows?: ExportRow[];
  /** …o una URL que devuelve `{ rows }` con el listado completo (sin paginar) */
  source?: string;
  label?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
};

/** Menú «Exportar»: Excel, PDF, CSV o impresión del mismo listado. */
export function ExportMenu({ title, subtitle, filename, columns, rows, source, label = "Exportar", size = "md", align = "right" }: Props) {
  const { settings, profile } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(format: Format) {
    setBusy(format);
    try {
      let data = rows ?? [];
      if (source) {
        const res = await fetch(source);
        if (!res.ok) throw new Error("No se pudieron obtener los datos");
        data = ((await res.json()) as { rows: ExportRow[] }).rows ?? [];
      }
      if (data.length === 0) {
        toast.info("No hay datos para exportar con los filtros actuales");
        return;
      }
      const doc: ExportDoc = {
        title,
        subtitle,
        filename,
        columns,
        rows: data,
        company: { name: settings.name, taxId: settings.tax_id, symbol: settings.currency_symbol },
        author: profile.full_name,
      };
      if (format === "excel") await exportExcel(doc);
      else if (format === "pdf") await exportPdf(doc);
      else if (format === "csv") exportCsv(doc);
      else printDoc(doc);
      if (format !== "print") toast.success(`${data.length} ${data.length === 1 ? "registro exportado" : "registros exportados"}`);
      setOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo generar el archivo. Inténtalo de nuevo");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" className={buttonClass("secondary", size)} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className={cn("pop-in absolute top-full z-40 mt-1.5 w-60 rounded-xl border border-slate-200 bg-surface p-1.5 shadow-pop", align === "right" ? "right-0" : "left-0 origin-top-left")}>
          {OPTIONS.map((o) => (
            <button
              key={o.format}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => run(o.format)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            >
              {busy === o.format ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : <o.icon className={cn("h-4 w-4 shrink-0", o.tone)} />}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
