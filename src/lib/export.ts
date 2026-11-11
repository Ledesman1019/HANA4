/**
 * Exportación de listados a Excel, PDF, CSV e impresión.
 * Corre en el navegador; las librerías pesadas se cargan solo al exportar.
 */
import type { Row } from "write-excel-file/browser";
import { formatDate, toCsv } from "./utils";

export type ExportColumn = {
  key: string;
  header: string;
  type?: "text" | "money" | "number" | "date";
  /** Ancho aproximado en caracteres (Excel) */
  width?: number;
  /** Suma la columna en una fila de totales */
  total?: boolean;
};

export type ExportRow = Record<string, string | number | null | undefined>;

export type ExportDoc = {
  title: string;
  subtitle?: string;
  /** Nombre de archivo sin extensión */
  filename: string;
  columns: ExportColumn[];
  rows: ExportRow[];
  company: { name: string; taxId: string; symbol: string };
  author: string;
};

const BRAND = "#2554eb";
const numberFmt = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 });

const isNumeric = (c: ExportColumn) => c.type === "money" || c.type === "number";
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function generatedAt() {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short" }).format(new Date());
}

function totals(doc: ExportDoc) {
  if (!doc.columns.some((c) => c.total)) return null;
  return doc.columns.map((c, i) => {
    if (c.total) return doc.rows.reduce((sum, r) => sum + (num(r[c.key]) ?? 0), 0);
    return i === 0 ? "Total" : null;
  });
}

/** Texto ya formateado de una celda (PDF, impresión). */
function display(c: ExportColumn, value: unknown): string {
  if (value == null || value === "") return "";
  if (c.type === "money") return numberFmt.format(Number(value));
  if (c.type === "number") return qtyFmt.format(Number(value));
  if (c.type === "date") return formatDate(String(value));
  return String(value);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const moneyHeader = (c: ExportColumn, symbol: string) => (c.type === "money" ? `${c.header} (${symbol})` : c.header);

/* ---------- Excel ---------- */
export async function exportExcel(doc: ExportDoc) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  type Cell = Row[number];

  const blank = (): Cell[] => doc.columns.map(() => null as unknown as Cell);
  const lead = (cell: Cell): Cell[] => [cell, ...blank().slice(1)];

  const header: Cell[] = doc.columns.map((c) => ({
    value: moneyHeader(c, doc.company.symbol),
    fontWeight: "bold",
    textColor: "#ffffff",
    backgroundColor: BRAND,
    align: isNumeric(c) ? "right" : "left",
  }));

  const body: Cell[][] = doc.rows.map((r) =>
    doc.columns.map((c): Cell => {
      const v = r[c.key];
      if (v == null || v === "") return null as unknown as Cell;
      if (c.type === "money") return { value: Number(v), type: Number, format: "#,##0.00", align: "right" };
      if (c.type === "number") return { value: Number(v), type: Number, format: "#,##0.###", align: "right" };
      if (c.type === "date") {
        const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
        return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: "dd/mm/yyyy" };
      }
      // El texto se escribe como texto: Excel no lo interpreta como fórmula
      return { value: String(v), type: String };
    }),
  );

  const sum = totals(doc);
  const foot: Cell[][] = sum
    ? [
        sum.map((v, i): Cell => {
          if (v == null) return null as unknown as Cell;
          if (typeof v === "string") return { value: v, fontWeight: "bold", backgroundColor: "#eef1f4" };
          return { value: v, type: Number, format: doc.columns[i].type === "money" ? "#,##0.00" : "#,##0.###", fontWeight: "bold", align: "right", backgroundColor: "#eef1f4" };
        }),
      ]
    : [];

  const data: Cell[][] = [
    lead({ value: doc.company.name, fontWeight: "bold", fontSize: 14 }),
    lead({ value: doc.title, fontWeight: "bold", fontSize: 12 }),
    lead({ value: [doc.subtitle, `Generado el ${generatedAt()} por ${doc.author}`].filter(Boolean).join(" · "), textColor: "#5f6778" }),
    blank(),
    header,
    ...body,
    ...foot,
  ];

  const widths = doc.columns.map((c) => {
    const longest = doc.rows.reduce((max, r) => Math.max(max, display(c, r[c.key]).length), moneyHeader(c, doc.company.symbol).length);
    return { width: c.width ?? Math.min(Math.max(longest + 2, 10), 48) };
  });

  const blob = await writeExcelFile(data, { columns: widths, sheet: doc.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), stickyRowsCount: 5 }).toBlob();
  download(blob, `${doc.filename}.xlsx`);
}

/* ---------- PDF ---------- */
/** Las fuentes estándar del PDF solo cubren Latin-1: se sustituyen los signos que no existen. */
const latin = (s: string) => s.replace(/[—–−]/g, "-").replace(/…/g, "...").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xff]/g, "");

export async function exportPdf(doc: ExportDoc) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const landscape = doc.columns.length > 6;
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 40;

  const drawHeader = () => {
    pdf.setFillColor(37, 84, 235);
    pdf.rect(0, 0, width, 6, "F");
    pdf.setFont("helvetica", "bold").setFontSize(13).setTextColor(19, 26, 43);
    pdf.text(latin(doc.company.name), margin, 34);
    pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(95, 103, 120);
    if (doc.company.taxId) pdf.text(`RUC ${doc.company.taxId}`, margin, 46);
    pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(19, 26, 43);
    pdf.text(latin(doc.title), width - margin, 34, { align: "right" });
    pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(95, 103, 120);
    if (doc.subtitle) pdf.text(latin(doc.subtitle), width - margin, 46, { align: "right" });
    pdf.setDrawColor(227, 231, 236).setLineWidth(0.7).line(margin, 56, width - margin, 56);
  };

  const sum = totals(doc);
  autoTable(pdf, {
    head: [doc.columns.map((c) => latin(moneyHeader(c, doc.company.symbol)))],
    body: doc.rows.map((r) => doc.columns.map((c) => latin(display(c, r[c.key])))),
    foot: sum ? [sum.map((v, i) => (v == null ? "" : typeof v === "string" ? v : display(doc.columns[i], v)))] : undefined,
    showFoot: "lastPage",
    startY: 68,
    margin: { top: 68, right: margin, bottom: 44, left: margin },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 5, right: 6, bottom: 5, left: 6 }, textColor: [54, 63, 83], lineColor: [227, 231, 236], lineWidth: { bottom: 0.5 }, overflow: "linebreak" },
    headStyles: { fillColor: [37, 84, 235], textColor: 255, fontStyle: "bold", lineWidth: 0 },
    footStyles: { fillColor: [238, 241, 244], textColor: [19, 26, 43], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 250, 252] },
    columnStyles: Object.fromEntries(doc.columns.map((c, i) => [i, { halign: isNumeric(c) ? "right" : "left" }])),
    didParseCell: (data) => {
      // Encabezados y totales numéricos también alineados a la derecha
      if (data.section !== "body" && isNumeric(doc.columns[data.column.index])) data.cell.styles.halign = "right";
    },
    didDrawPage: drawHeader,
  });

  const pages = pdf.getNumberOfPages();
  const stamp = latin(`Generado el ${generatedAt()} por ${doc.author}`);
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(133, 140, 154);
    pdf.text(stamp, margin, height - 22);
    pdf.text(`ERP HANA4  |  Pagina ${i} de ${pages}`, width - margin, height - 22, { align: "right" });
  }
  pdf.save(`${doc.filename}.pdf`);
}

/* ---------- CSV ---------- */
export function exportCsv(doc: ExportDoc) {
  const rows = doc.rows.map((r) =>
    Object.fromEntries(
      doc.columns.map((c) => {
        const v = r[c.key];
        const value = v == null ? "" : c.type === "money" ? Number(v).toFixed(2) : c.type === "date" ? formatDate(String(v)) : v;
        return [moneyHeader(c, doc.company.symbol), value];
      }),
    ),
  );
  // BOM para que Excel abra el CSV con tildes correctas
  download(new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" }), `${doc.filename}.csv`);
}

/* ---------- Impresión ---------- */
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function printDoc(doc: ExportDoc) {
  const sum = totals(doc);
  const align = (c: ExportColumn) => (isNumeric(c) ? ' class="n"' : "");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
    @page { size: A4 ${doc.columns.length > 6 ? "landscape" : "portrait"}; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #131a2b; }
    header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 8px; border-bottom: 2px solid ${BRAND}; margin-bottom: 10px; }
    h1 { margin: 0; font-size: 15px; } h2 { margin: 0; font-size: 12px; text-align: right; }
    .muted { color: #5f6778; font-size: 9px; } .right { text-align: right; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; } tfoot { display: table-row-group; }
    th { background: ${BRAND}; color: #fff; text-align: left; padding: 5px 6px; font-size: 9px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 4px 6px; border-bottom: 1px solid #e3e7ec; vertical-align: top; }
    tr { break-inside: avoid; } .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    tfoot td { font-weight: 700; background: #eef1f4; border-bottom: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    footer { margin-top: 10px; display: flex; justify-content: space-between; color: #858c9a; font-size: 8.5px; }
  </style></head><body>
    <header>
      <div><h1>${esc(doc.company.name)}</h1>${doc.company.taxId ? `<div class="muted">RUC ${esc(doc.company.taxId)}</div>` : ""}</div>
      <div class="right"><h2>${esc(doc.title)}</h2>${doc.subtitle ? `<div class="muted">${esc(doc.subtitle)}</div>` : ""}</div>
    </header>
    <table>
      <thead><tr>${doc.columns.map((c) => `<th${align(c)}>${esc(moneyHeader(c, doc.company.symbol))}</th>`).join("")}</tr></thead>
      <tbody>${doc.rows.map((r) => `<tr>${doc.columns.map((c) => `<td${align(c)}>${esc(display(c, r[c.key]))}</td>`).join("")}</tr>`).join("")}</tbody>
      ${sum ? `<tfoot><tr>${sum.map((v, i) => `<td${align(doc.columns[i])}>${v == null ? "" : typeof v === "string" ? v : esc(display(doc.columns[i], v))}</td>`).join("")}</tr></tfoot>` : ""}
    </table>
    <footer><span>Generado el ${esc(generatedAt())} por ${esc(doc.author)}</span><span>ERP HANA4 · ${doc.rows.length} registros</span></footer>
  </body></html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) return frame.remove();
  win.document.open();
  win.document.write(html);
  win.document.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup);
  // Da tiempo a que el documento se maquete antes de abrir el diálogo
  setTimeout(() => {
    win.focus();
    win.print();
    // Respaldo por si el navegador no emite "afterprint"
    setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  }, 150);
}
