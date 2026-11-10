import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFmt = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | string | null | undefined, symbol = "S/") {
  const n = Number(value ?? 0);
  const abs = numberFmt.format(Math.abs(n));
  return `${n < 0 ? "-" : ""}${symbol} ${abs}`;
}

export function formatQty(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 }).format(n);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("es-PE", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDateTime(iso: string | null | undefined, timeZone = "America/Lima") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Formatea una fecha tipo "YYYY-MM-DD" sin desfase de zona horaria. */
export function formatDate(day: string | null | undefined) {
  if (!day) return "—";
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Fecha actual (YYYY-MM-DD) en la zona horaria de la empresa. */
export function todayIn(timeZone: string, offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Instante UTC (ISO) en que empieza el día `day` en la zona horaria dada. */
export function zonedDayStart(day: string, timeZone: string) {
  const utc = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(utc.getTime() - (local - utc.getTime())).toISOString();
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    // Evita que Excel interprete texto como fórmula (inyección CSV)
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
