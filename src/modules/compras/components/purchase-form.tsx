"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackagePlus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createPurchase } from "@/modules/compras/actions";
import { useApp } from "@/components/app-provider";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, Input, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { formatQty, round2 } from "@/lib/utils";
import { baseQuantity, initialPack, PackPicker, type PackLine } from "./pack";

export type PurchaseProduct = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  cost: number;
  quantity: number;
  min_stock: number;
  pack_unit?: string | null;
  pack_size?: number | null;
};
/** quantity y unit_cost van en la presentación elegida (ej. cajas y costo por caja) */
type Line = PackLine & { product_id: string; unit_cost: string };
type Option = { value: string; label: string };

const sizeOf = (l: Pick<PackLine, "pack_unit" | "pack_size">) => (l.pack_unit ? Number(l.pack_size) || 1 : 1);

export function PurchaseForm({
  suppliers,
  products,
  costCenters,
  requisition,
}: {
  suppliers: Option[];
  products: PurchaseProduct[];
  costCenters: Option[];
  /** Solicitud de pedido aprobada de la que nace la orden */
  requisition?: { id: string; number: string; cost_center_id: string | null; items: { product_id: string; quantity: number; pack_unit: string; pack_size: number }[] };
}) {
  const { money, settings } = useApp();
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [costCenter, setCostCenter] = useState(requisition?.cost_center_id ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    (requisition?.items ?? []).map((i) => {
      const size = i.pack_unit ? Number(i.pack_size) || 1 : 1;
      return {
        product_id: i.product_id,
        pack_unit: i.pack_unit,
        pack_size: String(size),
        quantity: String(round2(Number(i.quantity) / size)),
        unit_cost: (Number(products.find((p) => p.product_id === i.product_id)?.cost ?? 0) * size).toFixed(2),
      };
    }),
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const chosen = new Set(lines.map((l) => l.product_id));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8);
  }, [products, query]);

  const lowStock = products.filter((p) => Number(p.quantity) <= Number(p.min_stock) && !chosen.has(p.product_id));

  const addLine = (p: PurchaseProduct, units = 1) => {
    if (chosen.has(p.product_id)) return;
    const pack = initialPack(p);
    const size = sizeOf(pack);
    setLines((prev) => [...prev, { product_id: p.product_id, ...pack, quantity: String(Math.max(1, Math.ceil(units / size))), unit_cost: (Number(p.cost) * size).toFixed(2) }]);
    setQuery("");
  };

  const update = (id: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.product_id === id ? { ...l, ...patch } : l)));

  const subtotal = round2(lines.reduce((a, l) => a + round2((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)), 0));
  const tax = round2((subtotal * Number(settings.tax_rate)) / 100);

  function submit() {
    setError(null);
    if (!supplierId) return setError("Selecciona un proveedor");
    if (lines.length === 0) return setError("Agrega al menos un producto");
    startTransition(async () => {
      const res = await createPurchase({
        supplier_id: supplierId,
        expected_date: expectedDate,
        note,
        requisition_id: requisition?.id ?? null,
        cost_center_id: costCenter || null,
        // El stock y el costo promedio se llevan en unidades base
        items: lines.map((l) => ({
          product_id: l.product_id,
          quantity: baseQuantity(l),
          unit_cost: (Number(l.unit_cost) || 0) / sizeOf(l),
          pack_unit: l.pack_unit,
          pack_size: sizeOf(l),
        })),
      });
      if (!res.ok) return setError(res.error);
      toast.success("Orden de compra registrada");
      setLines([]);
      setSupplierId("");
      setNote("");
      setExpectedDate("");
      router.push(`/compras/${res.data.id}`);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader
          title="Productos de la orden"
          description={requisition ? `De la solicitud ${requisition.number}. Ajusta cantidades y costos (sin impuesto).` : "Los costos se ingresan sin impuesto."}
        />
        <div className="relative border-b border-slate-100 p-3">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                addLine(matches[0]);
              }
            }}
            placeholder="Buscar producto por nombre o SKU para agregarlo…"
            aria-label="Buscar producto"
            className="pl-9"
          />
          {matches.length > 0 && (
            <ul className="absolute inset-x-3 top-full z-10 -mt-1 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-lg">
              {matches.map((p) => (
                <li key={p.product_id}>
                  <button
                    type="button"
                    disabled={chosen.has(p.product_id)}
                    onClick={() => addLine(p)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{p.name}</span>
                      <span className="tabular text-xs text-slate-500">
                        {p.sku} · stock {formatQty(p.quantity)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{chosen.has(p.product_id) ? "Ya agregado" : money(p.cost)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState icon={<PackagePlus className="h-5 w-5" />} title="Orden vacía" description="Busca productos arriba o agrega los sugeridos por stock bajo." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Presentación</Th>
                <Th className="w-24 text-right">Cantidad</Th>
                <Th className="w-28 text-right">Costo por presentación</Th>
                <Th className="text-right">Importe</Th>
                <Th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = byId.get(l.product_id);
                return (
                  <tr key={l.product_id}>
                    <Td>
                      <p className="font-medium text-slate-900">{p?.name}</p>
                      <p className="tabular text-xs text-slate-500">
                        {p?.sku} · stock actual {formatQty(p?.quantity)} {p?.unit}
                      </p>
                    </Td>
                    <Td>
                      <PackPicker
                        line={l}
                        product={p}
                        label={p?.name ?? ""}
                        onChange={(change) => {
                          // Al cambiar de presentación, el costo se recalcula desde el costo por unidad
                          const next = { ...l, ...change };
                          update(l.product_id, { ...change, unit_cost: ((Number(l.unit_cost) / sizeOf(l)) * sizeOf(next)).toFixed(2) });
                        }}
                      />
                    </Td>
                    <Td>
                      <Input type="number" min={0.001} step="0.001" inputMode="decimal" value={l.quantity} onChange={(e) => update(l.product_id, { quantity: e.target.value })} aria-label={`Cantidad de ${p?.name}`} className="tabular text-right" />
                    </Td>
                    <Td>
                      <Input type="number" min={0} step="0.01" inputMode="decimal" value={l.unit_cost} onChange={(e) => update(l.product_id, { unit_cost: e.target.value })} aria-label={`Costo de ${p?.name}`} className="tabular text-right" />
                    </Td>
                    <Td className="tabular text-right font-medium text-slate-900">{money(round2((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)))}</Td>
                    <Td>
                      <Button variant="ghost" size="icon" aria-label={`Quitar ${p?.name}`} onClick={() => setLines((prev) => prev.filter((x) => x.product_id !== l.product_id))}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {lowStock.length > 0 && (
          <div className="border-t border-slate-100 p-4">
            <p className="mb-2 text-xs font-medium text-slate-500">Sugeridos por stock bajo</p>
            <div className="flex flex-wrap gap-2">
              {lowStock.slice(0, 10).map((p) => (
                <button
                  key={p.product_id}
                  type="button"
                  onClick={() => addLine(p, Math.max(Math.ceil(Number(p.min_stock) * 2 - Number(p.quantity)), 1))}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 py-1 pl-3 pr-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {p.name}
                  <Badge tone={Number(p.quantity) <= 0 ? "red" : "amber"}>{formatQty(p.quantity)}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="self-start p-5 lg:sticky lg:top-20">
        <div className="space-y-4">
          <Field label="Proveedor *">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {suppliers.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          {suppliers.length === 0 && (
            <p className="text-xs text-slate-500">
              No hay proveedores activos.{" "}
              <Link href="/proveedores" className="font-medium text-link hover:underline">
                Registra uno
              </Link>
              .
            </p>
          )}
          <Field label="Centro de costo" hint={requisition ? "Heredado de la solicitud; puedes cambiarlo." : "Área para la que se compra."}>
            <Select value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {costCenters.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entrega estimada">
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
          <Field label="Notas">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </Field>
        </div>

        <dl className="tabular mt-5 space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>
              {settings.tax_name} ({Number(settings.tax_rate)}%)
            </dt>
            <dd>{money(tax)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{money(subtotal + tax)}</dd>
          </div>
        </dl>

        <div className="mt-4 space-y-3">
          <FormError message={error} />
          <Button size="lg" className="w-full" loading={pending} onClick={submit}>
            Registrar orden
          </Button>
        </div>
      </Card>
    </div>
  );
}
