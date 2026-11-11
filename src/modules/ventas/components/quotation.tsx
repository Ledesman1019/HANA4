"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, FileText, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { Button, Card, CardHeader, EmptyState, Field, FormError, Input, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { playSound } from "@/lib/sound";
import { formatQty, round2 } from "@/lib/utils";
import { cancelQuotation, createQuotation, createSale } from "@/modules/ventas/actions";

export type QuoteProduct = { product_id: string; sku: string; name: string; unit: string; price: number; quantity: number };
export type QuoteCustomer = { id: string; name: string; doc_type: string; doc_number: string };

/** Nueva cotización: el precio de hoy queda congelado durante su vigencia. */
export function QuotationForm({ products, customers }: { products: QuoteProduct[]; customers: QuoteCustomer[] }) {
  const { money, settings, can } = useApp();
  const router = useRouter();
  const [lines, setLines] = useState<{ product_id: string; quantity: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [validDays, setValidDays] = useState("7");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
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

  const gross = round2(lines.reduce((sum, l) => sum + round2(Number(byId.get(l.product_id)?.price ?? 0) * (Number(l.quantity) || 0)), 0));
  const discountValue = Math.min(Math.max(Number(discount) || 0, 0), gross);
  const total = round2(gross - discountValue);
  const base = round2(total / (1 + Number(settings.tax_rate) / 100));
  const discountBlocked = !can("ventas", "edit") && discountValue > round2(gross * 0.1);

  const add = (p: QuoteProduct) => {
    if (chosen.has(p.product_id)) return;
    setLines((prev) => [...prev, { product_id: p.product_id, quantity: "1" }]);
    setQuery("");
  };

  function submit() {
    setError(null);
    if (lines.length === 0) return setError("Agrega al menos un producto");
    startTransition(async () => {
      const res = await createQuotation({
        customer_id: customerId || null,
        valid_days: Number(validDays),
        discount: discountValue,
        note,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
      });
      if (!res.ok) return setError(res.error);
      toast.success("Cotización emitida");
      router.push(`/cotizaciones/${res.data.id}`);
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Productos cotizados" description="Precios de lista vigentes (con impuesto). Quedan fijos durante la vigencia." />
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
                      <span className="tabular text-xs text-slate-500">
                        {p.sku} · stock {formatQty(p.quantity)}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-medium text-slate-900">{money(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="Cotización vacía" description="Busca productos arriba para agregarlos." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th className="w-28 text-right">Cantidad</Th>
                <Th className="text-right">P. unit.</Th>
                <Th className="text-right">Importe</Th>
                <Th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = byId.get(l.product_id);
                const short = p && Number(l.quantity) > Number(p.quantity);
                return (
                  <tr key={l.product_id}>
                    <Td>
                      <p className="font-medium text-slate-900">{p?.name}</p>
                      <p className={`tabular text-xs ${short ? "font-medium text-amber-700" : "text-slate-500"}`}>
                        {p?.sku} · stock {formatQty(p?.quantity)}
                        {short && " (insuficiente hoy)"}
                      </p>
                    </Td>
                    <Td>
                      <Input
                        type="number"
                        min={0.001}
                        step="0.001"
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => setLines((prev) => prev.map((x) => (x.product_id === l.product_id ? { ...x, quantity: e.target.value } : x)))}
                        aria-label={`Cantidad de ${p?.name}`}
                        className="tabular text-right"
                      />
                    </Td>
                    <Td className="tabular text-right">{money(p?.price)}</Td>
                    <Td className="tabular text-right font-medium text-slate-900">{money(round2(Number(p?.price ?? 0) * (Number(l.quantity) || 0)))}</Td>
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
      </Card>

      <Card className="self-start p-5 lg:sticky lg:top-20">
        <div className="space-y-4">
          <Field label="Cliente">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Sin cliente (genérica)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.doc_number}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vigencia (días)">
              <Input type="number" min={1} max={90} step={1} value={validDays} onChange={(e) => setValidDays(e.target.value)} className="tabular" />
            </Field>
            <Field label="Descuento">
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" className="tabular" />
            </Field>
          </div>
          <Field label="Condiciones / notas">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Entrega, forma de pago, etc." />
          </Field>
        </div>
        <dl className="tabular mt-5 space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(gross)}</dd>
          </div>
          {discountValue > 0 && (
            <div className="flex justify-between">
              <dt>Descuento</dt>
              <dd>− {money(discountValue)}</dd>
            </div>
          )}
          <div className="flex justify-between text-xs text-slate-500">
            <dt>Incluye {settings.tax_name}</dt>
            <dd>{money(total - base)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{money(total)}</dd>
          </div>
        </dl>
        {discountBlocked && <p className="mt-2 text-xs text-red-600">Tu rol puede ofrecer hasta 10 % de descuento.</p>}
        <div className="mt-4 space-y-3">
          <FormError message={error} />
          <Button size="lg" className="w-full" loading={pending} disabled={discountBlocked} onClick={submit}>
            Emitir cotización
          </Button>
        </div>
      </Card>
    </div>
  );
}

const METHODS = [
  ["efectivo", "Efectivo"],
  ["tarjeta", "Tarjeta"],
  ["yape", "Yape"],
  ["plin", "Plin"],
  ["transferencia", "Transferencia"],
  ["credito", "Crédito"],
];

/** Convertir la cotización en venta: mismos productos, precios y descuento. */
export function ConvertQuotationButton({ quotationId, total, hasRuc, hasCustomer }: { quotationId: string; total: number; hasRuc: boolean; hasCustomer: boolean }) {
  const { money } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("efectivo");
  const [docType, setDocType] = useState(hasRuc ? "factura" : "boleta");
  const [received, setReceived] = useState(total.toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="success" onClick={() => setOpen(true)}>
        <ShoppingCart className="h-4 w-4" />
        Convertir en venta
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Convertir en venta" description={`Se vende con los precios cotizados: ${money(total)}. Descuenta stock y requiere tu caja abierta.`} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await createSale({
                customer_id: null,
                doc_type: docType as "boleta",
                payment_method: method as "efectivo",
                amount_received: method === "efectivo" ? Number(received) : 0,
                discount: 0,
                items: [],
                quotation_id: quotationId,
              });
              if (!res.ok) {
                playSound("error");
                return setError(res.error);
              }
              playSound("success");
              toast.success("Venta registrada");
              router.push(`/ventas/${res.data.id}`);
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Comprobante">
              <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="boleta">Boleta</option>
                {hasRuc && <option value="factura">Factura</option>}
                <option value="ticket">Ticket interno</option>
              </Select>
            </Field>
            <Field label="Medio de pago">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.filter(([v]) => v !== "credito" || hasCustomer).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {method === "efectivo" && (
            <Field label="Monto recibido">
              <Input type="number" min={total} step="0.01" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} className="tabular" />
            </Field>
          )}
          {method === "credito" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Vence según el plazo del cliente. Se verifica su línea de crédito y que no tenga deuda vencida.</p>}
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="success" loading={pending}>
              Registrar venta
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

export function CancelQuotationButton({ quotationId }: { quotationId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Ban className="h-4 w-4 text-red-600" />
        Anular
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Anular cotización" size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await cancelQuotation(quotationId, reason);
              if (!res.ok) return setError(res.error);
              toast.success("Cotización anulada");
              setOpen(false);
            });
          }}
        >
          <Field label="Motivo">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={200} autoFocus />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Anular
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
