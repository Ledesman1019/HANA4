"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatDate } from "@/lib/utils";
import { useApp } from "./app-provider";

// Variables CSS: el gráfico cambia con el tema sin volver a renderizar.
const SERIES = "var(--chart-series)";
const AXIS = "var(--chart-axis)";
const GRID = "var(--chart-grid)";

export type DayPoint = { day: string; total: number; tickets: number };

/** Serie única de ventas por día: un solo tono, rejilla discreta, tooltip al pasar. */
export function SalesTrendChart({ data, height = 280 }: { data: DayPoint[]; height?: number }) {
  const { money } = useApp();
  const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

  return (
    <div style={{ height }} role="img" aria-label="Ventas por día">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SERIES} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={28} />
          <YAxis tickFormatter={(v) => formatCompact(Number(v))} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as DayPoint;
              return (
                <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-lg">
                  <p className="font-medium text-slate-500">{formatDate(p.day)}</p>
                  <p className="tabular mt-0.5 text-sm font-semibold text-slate-900">{money(p.total)}</p>
                  <p className="text-slate-500">
                    {p.tickets} {p.tickets === 1 ? "venta" : "ventas"}
                  </p>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="total" stroke={SERIES} strokeWidth={2} fill="url(#salesFill)" activeDot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export type BarItem = { label: string; value: number; hint?: string };

/** Ranking horizontal con valor rotulado: magnitud en un solo tono. */
export function BarList({ items, emptyText = "Sin datos en el periodo" }: { items: BarItem[]; emptyText?: string }) {
  const { money } = useApp();
  const max = Math.max(...items.map((i) => i.value), 0);
  if (items.length === 0 || max <= 0) return <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>;

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-700" title={item.label}>
              {item.label}
            </span>
            <span className="tabular shrink-0 font-medium text-slate-900">
              {money(item.value)}
              {item.hint && <span className="ml-1.5 text-xs font-normal text-slate-500">{item.hint}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100">
            <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.max((item.value / max) * 100, 1)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
