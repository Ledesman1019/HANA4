"use client";

import { useMemo, useState, useTransition } from "react";
import { ClipboardCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { ExportMenu } from "@/components/export-menu";
import { Badge, Button, Card, EmptyState, Field, FormError, Input, Select, Table, Td, Th } from "@/components/ui";
import { registerPhysicalCount } from "@/modules/inventario/actions";
import type { InventoryRow } from "@/modules/inventario/types";
import { formatQty } from "@/lib/utils";

/**
 * Hoja de conteo: se escribe lo que hay físicamente; solo las filas con diferencia
 * se registran como ajuste (con la misma referencia) al confirmar.
 */
export function PhysicalCount({ rows, categories, branchName }: { rows: InventoryRow[]; categories: { value: string; label: string }[]; branchName: string }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [only, setOnly] = useState<"todos" | "diferencias">("todos");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const diffOf = (r: InventoryRow) => {
    const raw = counts[r.product_id];
    if (raw === undefined || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n - Number(r.quantity) : null;
  };
  const changes = rows.filter((r) => {
    const d = diffOf(r);
    return d !== null && d !== 0;
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!category || r.category_id === category) &&
        (!q || `${r.name} ${r.sku} ${r.barcode ?? ""}`.toLowerCase().includes(q)) &&
        (only === "todos" || (diffOf(r) ?? 0) !== 0),
    );
    // diffOf depende de counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, category, only, counts]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await registerPhysicalCount({ note, items: changes.map((r) => ({ id: r.product_id, quantity: Number(counts[r.product_id]) })) });
      if (!res.ok) return setError(res.error);
      toast.success(`Inventario físico registrado: ${res.data.adjusted} ${res.data.adjusted === 1 ? "ajuste" : "ajustes"}`);
      setCounts({});
      setNote("");
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Producto, SKU o código de barras…" aria-label="Buscar" className="pl-9" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría" className="w-auto min-w-40">
          <option value="">Categoría: todas</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Mostrar" className="w-auto min-w-40">
          <option value="todos">Todos los productos</option>
          <option value="diferencias">Solo con diferencia</option>
        </Select>
        <div className="ml-auto">
          <ExportMenu
            title="Hoja de conteo físico"
            subtitle={branchName}
            filename="inventario-fisico"
            columns={[
              { key: "sku", header: "SKU" },
              { key: "producto", header: "Producto", width: 34 },
              { key: "sistema", header: "Stock en sistema", type: "number" },
              { key: "contado", header: "Contado", type: "number" },
              { key: "diferencia", header: "Diferencia", type: "number" },
            ]}
            rows={shown.map((r) => ({ sku: r.sku, producto: r.name, sistema: Number(r.quantity), contado: counts[r.product_id] ? Number(counts[r.product_id]) : null, diferencia: diffOf(r) }))}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="Sin productos en esta vista" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th>
              <Th className="text-right">En sistema</Th>
              <Th className="w-36 text-right">Contado</Th>
              <Th className="text-right">Diferencia</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const d = diffOf(r);
              return (
                <tr key={r.product_id}>
                  <Td>
                    <p className="font-medium text-slate-900">{r.name}</p>
                    <p className="tabular text-xs text-slate-500">
                      {r.sku}
                      {r.track_lots && " · con lotes"}
                    </p>
                  </Td>
                  <Td className="tabular text-right">
                    {formatQty(r.quantity)} <span className="text-xs text-slate-400">{r.unit}</span>
                  </Td>
                  <Td className="text-right">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={counts[r.product_id] ?? ""}
                      onChange={(e) => setCounts((c) => ({ ...c, [r.product_id]: e.target.value }))}
                      aria-label={`Cantidad contada de ${r.name}`}
                      className="h-9 text-right"
                    />
                  </Td>
                  <Td className="text-right">
                    {d === null ? (
                      <span className="text-slate-300">—</span>
                    ) : d === 0 ? (
                      <Badge tone="green">Cuadra</Badge>
                    ) : (
                      <Badge tone={d > 0 ? "amber" : "red"}>
                        {d > 0 ? "+" : ""}
                        {formatQty(d)}
                      </Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 p-4">
        <Field label="Referencia del conteo" className="min-w-64 flex-1">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={150} placeholder="Ej. Conteo mensual de noviembre" />
        </Field>
        <Button onClick={submit} loading={pending} disabled={changes.length === 0}>
          <ClipboardCheck className="h-4 w-4" />
          Registrar {changes.length} {changes.length === 1 ? "ajuste" : "ajustes"}
        </Button>
        <FormError message={error} />
      </div>
    </Card>
  );
}
