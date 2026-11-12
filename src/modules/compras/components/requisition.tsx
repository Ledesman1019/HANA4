"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, PackagePlus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, Input, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { formatQty } from "@/lib/utils";
import { createRequisition, decideRequisition } from "@/modules/compras/actions";
import { baseQuantity, initialPack, PackPicker, type PackLine } from "./pack";

export type RequisitionProduct = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  min_stock: number;
  pack_unit?: string | null;
  pack_size?: number | null;
};

type Line = PackLine & { product_id: string };

/** Solicitud de pedido: qué se necesita y por qué. Los precios los negocia Compras. */
export function RequisitionForm({ products, costCenters }: { products: RequisitionProduct[]; costCenters: { value: string; label: string }[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [costCenter, setCostCenter] = useState("");
  const [justification, setJustification] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const chosen = new Set(lines.map((l) => l.product_id));
  // Sugerido: reponer hasta el doble del mínimo, en la presentación de compra del producto
  const newLine = (p: RequisitionProduct): Line => {
    const pack = initialPack(p);
    const units = Math.max(Math.ceil(Number(p.min_stock) * 2 - Number(p.quantity)), 1);
    const size = pack.pack_unit ? Number(pack.pack_size) || 1 : 1;
    return { product_id: p.product_id, quantity: String(Math.max(1, Math.ceil(units / size))), ...pack };
  };
  const patch = (id: string, change: Partial<Line>) => setLines((prev) => prev.map((x) => (x.product_id === id ? { ...x, ...change } : x)));
  const lowStock = products.filter((p) => Number(p.quantity) <= Number(p.min_stock) && !chosen.has(p.product_id));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8);
  }, [products, query]);

  const add = (p: RequisitionProduct) => {
    if (chosen.has(p.product_id)) return;
    setLines((prev) => [...prev, newLine(p)]);
    setQuery("");
  };

  function submit() {
    setError(null);
    if (lines.length === 0) return setError("Agrega al menos un producto");
    startTransition(async () => {
      const res = await createRequisition({
        justification,
        cost_center_id: costCenter || null,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: baseQuantity(l), pack_unit: l.pack_unit, pack_size: l.pack_unit ? Number(l.pack_size) : 1 })),
      });
      if (!res.ok) return setError(res.error);
      toast.success("Solicitud enviada a aprobación");
      setLines([]);
      setJustification("");
      router.push(`/compras/solicitudes/${res.data.id}`);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader title="Productos solicitados" description="Indica cantidades. El proveedor y el costo los define Compras al emitir la orden." />
        <div className="relative border-b border-slate-100 p-3">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                add(matches[0]);
              }
            }}
            placeholder="Buscar producto por nombre o SKU…"
            aria-label="Buscar producto"
            className="pl-9"
          />
          {matches.length > 0 && (
            <ul className="absolute inset-x-3 top-full z-10 -mt-1 overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-pop">
              {matches.map((p) => (
                <li key={p.product_id}>
                  <button
                    type="button"
                    disabled={chosen.has(p.product_id)}
                    onClick={() => add(p)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{p.name}</span>
                      <span className="tabular text-xs text-slate-500">{p.sku}</span>
                    </span>
                    <span className="tabular shrink-0 text-xs text-slate-500">
                      stock {formatQty(p.quantity)} / mín. {formatQty(p.min_stock)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState icon={<PackagePlus className="h-5 w-5" />} title="Solicitud vacía" description="Busca productos arriba o agrega los sugeridos por stock bajo." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th className="text-right">Stock actual</Th>
                <Th className="text-right">Mínimo</Th>
                <Th>Presentación</Th>
                <Th className="w-28 text-right">Cantidad</Th>
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
                      <p className="tabular text-xs text-slate-500">{p?.sku}</p>
                    </Td>
                    <Td className="tabular text-right">
                      {formatQty(p?.quantity)} <span className="text-xs text-slate-500">{p?.unit}</span>
                    </Td>
                    <Td className="tabular text-right">{formatQty(p?.min_stock)}</Td>
                    <Td>
                      <PackPicker line={l} product={p} label={p?.name ?? ""} onChange={(change) => patch(l.product_id, change)} />
                    </Td>
                    <Td>
                      <Input
                        type="number"
                        min={0.001}
                        step="0.001"
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => patch(l.product_id, { quantity: e.target.value })}
                        aria-label={`Cantidad de ${p?.name}`}
                        className="tabular text-right"
                      />
                    </Td>
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
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-slate-500">Productos en o bajo su stock mínimo</p>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, ...lowStock.map(newLine)])}
                className="cursor-pointer text-xs font-semibold text-link hover:underline"
              >
                Agregar todos ({lowStock.length})
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {lowStock.slice(0, 12).map((p) => (
                <button
                  key={p.product_id}
                  type="button"
                  onClick={() => add(p)}
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
        <Field label="Justificación *" hint="Por qué se necesita: stock bajo, campaña, pedido de un cliente…">
          <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={300} rows={4} required />
        </Field>
        <Field label="Centro de costo" hint="Área que solicita la compra." className="mt-4">
          <Select value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
            <option value="">— Sin asignar —</option>
            {costCenters.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
          La solicitud pasa a <strong className="font-semibold text-slate-800">aprobación</strong>. Otra persona con permiso de Compras la revisa y, si procede, emite la orden al proveedor.
        </p>
        <div className="mt-4 space-y-3">
          <FormError message={error} />
          <Button size="lg" className="w-full" loading={pending} onClick={submit}>
            Enviar a aprobación
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Aprobar o rechazar una solicitud pendiente. */
export function RequisitionDecision({ requisitionId, number }: { requisitionId: string; number: string }) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const approve = mode === "approve";

  return (
    <>
      <Button variant="secondary" onClick={() => setMode("reject")}>
        <X className="h-4 w-4 text-red-600" />
        Rechazar
      </Button>
      <Button variant="success" onClick={() => setMode("approve")}>
        <Check className="h-4 w-4" />
        Aprobar
      </Button>
      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        title={approve ? `Aprobar la solicitud ${number}` : `Rechazar la solicitud ${number}`}
        description={approve ? "Quedará lista para emitir la orden de compra al proveedor." : "El solicitante verá el motivo del rechazo."}
        size="sm"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await decideRequisition(requisitionId, approve, note);
              if (!res.ok) return setError(res.error);
              toast.success(approve ? "Solicitud aprobada" : "Solicitud rechazada");
              setMode(null);
              setNote("");
            });
          }}
        >
          <Field label={approve ? "Nota (opcional)" : "Motivo del rechazo *"}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required={!approve} minLength={approve ? undefined : 5} autoFocus />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMode(null)}>
              Volver
            </Button>
            <Button type="submit" variant={approve ? "success" : "danger"} loading={pending}>
              {approve ? "Aprobar solicitud" : "Rechazar solicitud"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
