"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Banknote, CalendarClock, CheckCircle2, CreditCard, Landmark, Minus, PackageSearch, Plus, ScanBarcode, Search, ShoppingCart, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createSale } from "@/modules/ventas/actions";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { ProductThumb } from "@/components/product-thumb";
import { ScannerDialog } from "@/components/scanner";
import { Button, buttonClass, Card, Field, FormError, Input, Select } from "@/components/ui";
import { playSound } from "@/lib/sound";
import { addDays, cn, formatQty, round2 } from "@/lib/utils";

export type PosProduct = {
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  price: number;
  quantity: number;
  category_name: string | null;
  image_url?: string | null;
};
export type PosCustomer = { id: string; name: string; doc_type: string; doc_number: string; credit_limit: number; credit_days: number; debt: number };

type DocType = "ticket" | "boleta" | "factura";
type Method = "efectivo" | "tarjeta" | "yape" | "plin" | "transferencia" | "credito";

const METHODS: { value: Method; label: string; icon: typeof Banknote }[] = [
  { value: "efectivo", label: "Efectivo", icon: Banknote },
  { value: "tarjeta", label: "Tarjeta", icon: CreditCard },
  { value: "yape", label: "Yape", icon: Smartphone },
  { value: "plin", label: "Plin", icon: Smartphone },
  { value: "transferencia", label: "Transf.", icon: Landmark },
  { value: "credito", label: "Crédito", icon: CalendarClock },
];

export function PosClient({ products, customers, today }: { products: PosProduct[]; customers: PosCustomer[]; today: string }) {
  const { money, settings, can } = useApp();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState("");
  const [docType, setDocType] = useState<DocType>("boleta");
  const [discount, setDiscount] = useState("");
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<Method>("efectivo");
  const [received, setReceived] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; total: number; change: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((p) => [p.product_id, p])), [products]);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category_name).filter((c): c is string => Boolean(c)))].sort(), [products]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (!category || p.category_name === category) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode === q))
      .slice(0, 60);
  }, [products, query, category]);

  const lines = Object.entries(cart)
    .map(([id, quantity]) => ({ product: byId.get(id), quantity }))
    .filter((l): l is { product: PosProduct; quantity: number } => Boolean(l.product));

  const gross = round2(lines.reduce((sum, l) => sum + round2(Number(l.product.price) * l.quantity), 0));
  const discountValue = Math.min(Math.max(Number(discount) || 0, 0), gross);
  const total = round2(gross - discountValue);
  const base = round2(total / (1 + Number(settings.tax_rate) / 100));
  const units = lines.reduce((sum, l) => sum + l.quantity, 0);
  const receivedValue = Number(received) || 0;
  const change = round2(receivedValue - total);
  const customer = customers.find((c) => c.id === customerId);
  // Crédito disponible del cliente elegido (el servidor lo vuelve a verificar al vender)
  const creditAvailable = customer ? Math.max(round2(Number(customer.credit_limit) - Number(customer.debt)), 0) : 0;
  const creditDue = dueDate || (customer ? addDays(today, Number(customer.credit_days)) : today);
  const maxCashierDiscount = round2(gross * 0.1);
  // Descuentos mayores al 10 % requieren el permiso "Editar" de Ventas (el servidor lo vuelve a verificar)
  const discountBlocked = !can("ventas", "edit") && discountValue > maxCashierDiscount;

  function setQty(product: PosProduct, quantity: number) {
    const available = Number(product.quantity);
    if (quantity > available) {
      toast.warning(`Solo hay ${formatQty(available)} ${product.unit} de «${product.name}»`);
      quantity = available;
    }
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[product.product_id];
      else next[product.product_id] = quantity;
      return next;
    });
  }

  const add = (product: PosProduct) => setQty(product, (cart[product.product_id] ?? 0) + 1);

  /** Enter en el buscador: un lector de código de barras agrega el producto directo. */
  function onSearchEnter() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => p.barcode === q || p.sku.toLowerCase() === q) ?? (visible.length === 1 ? visible[0] : undefined);
    if (!exact) return;
    if (Number(exact.quantity) <= 0) return void toast.error(`«${exact.name}» está agotado`);
    add(exact);
    setQuery("");
  }

  /** Código leído por la cámara: agrega el producto y devuelve el texto de confirmación. */
  function onScan(code: string) {
    const value = code.trim();
    const product = products.find((p) => p.barcode === value || p.sku.toLowerCase() === value.toLowerCase());
    if (!product) {
      toast.error(`El código ${value} no está registrado`);
      return `No registrado: ${value}`;
    }
    if (Number(product.quantity) <= 0) {
      toast.error(`«${product.name}» está agotado`);
      return `${product.name} · agotado`;
    }
    add(product);
    return `${product.name} agregado`;
  }

  function openPayment() {
    setError(null);
    setReceived("");
    setPaying(true);
  }

  function reset() {
    setCart({});
    setCustomerId("");
    setDiscount("");
    setDocType("boleta");
    setMethod("efectivo");
    setReceived("");
    setDueDate("");
    setError(null);
  }

  function confirm() {
    setError(null);
    if (docType === "factura" && customer?.doc_type !== "RUC") return setError("La factura requiere un cliente con RUC");
    if (method === "efectivo" && receivedValue < total) return setError("El monto recibido es menor al total");
    if (method === "credito" && !customer) return setError("Elige el cliente para vender al crédito");
    if (method === "credito" && total > creditAvailable) return setError(`El total supera el crédito disponible de ${customer?.name} (${money(creditAvailable)})`);

    startTransition(async () => {
      const res = await createSale({
        customer_id: customerId || null,
        doc_type: docType,
        payment_method: method,
        amount_received: method === "efectivo" ? receivedValue : method === "credito" ? 0 : total,
        due_date: method === "credito" ? creditDue : null,
        discount: discountValue,
        items: lines.map((l) => ({ product_id: l.product.product_id, quantity: l.quantity })),
      });
      if (!res.ok) {
        playSound("error");
        return setError(res.error);
      }
      playSound("success");
      setReceipt({ id: res.data.id, total, change: method === "efectivo" ? change : 0 });
      setPaying(false);
      reset();
    });
  }

  const quickAmounts = [...new Set([total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100])].filter((n) => n > 0).slice(0, 4);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* Catálogo */}
      <section aria-label="Catálogo">
        <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            ref={searchRef}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchEnter();
              }
            }}
            placeholder="Buscar por nombre, SKU o escanear código de barras…"
            aria-label="Buscar producto"
            className="h-11 pl-10 text-base"
          />
        </div>
          <Button variant="secondary" className="h-11 shrink-0 px-3.5" onClick={() => setScanning(true)} title="Escanear con la cámara" aria-label="Escanear con la cámara">
            <ScanBarcode className="h-5 w-5" />
            <span className="hidden sm:inline">Escanear</span>
          </Button>
        </div>

        {categories.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {["", ...categories].map((c) => (
              <button
                key={c || "all"}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  category === c ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-surface text-slate-600 hover:bg-slate-50",
                )}
              >
                {c || "Todos"}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <Card className="mt-4 flex flex-col items-center px-6 py-16 text-center">
            <PackageSearch className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-900">{products.length === 0 ? "No hay productos activos" : "Sin resultados"}</p>
            <p className="mt-1 text-sm text-slate-500">
              {products.length === 0 ? "Registra productos e ingresa stock desde Inventario." : "Prueba con otro nombre o código."}
            </p>
          </Card>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((p) => {
              const stock = Number(p.quantity);
              const inCart = cart[p.product_id] ?? 0;
              const out = stock <= 0;
              return (
                <li key={p.product_id}>
                  <button
                    type="button"
                    disabled={out}
                    onClick={() => add(p)}
                    className={cn(
                      "relative flex h-full w-full cursor-pointer flex-col rounded-xl border bg-surface p-3 text-left shadow-xs transition",
                      "hover:border-brand-500 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand-500",
                      "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:shadow-xs",
                      inCart > 0 ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200",
                    )}
                  >
                    {inCart > 0 && (
                      <span className="tabular absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                        {formatQty(inCart)}
                      </span>
                    )}
                    <ProductThumb src={p.image_url} name={p.name} className="mb-2.5 aspect-[4/3] w-full rounded-lg" />
                    <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{p.category_name ?? p.sku}</span>
                    <span className="mt-0.5 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-slate-900">{p.name}</span>
                    <span className="mt-2 flex items-end justify-between gap-2">
                      <span className="tabular text-base font-semibold text-slate-900">{money(p.price)}</span>
                      <span className={cn("tabular text-xs", out ? "font-medium text-red-600" : "text-slate-500")}>{out ? "Agotado" : `${formatQty(stock)} ${p.unit}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {visible.length === 60 && <p className="mt-3 text-center text-xs text-slate-500">Mostrando 60 productos. Usa el buscador para encontrar el resto.</p>}
      </section>

      {/* Carrito */}
      <aside aria-label="Venta en curso" className="lg:sticky lg:top-20 lg:self-start">
        <Card className="flex flex-col lg:max-h-[calc(100dvh-6.5rem)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShoppingCart className="h-4 w-4 text-slate-400" />
              Venta en curso
            </h2>
            {lines.length > 0 && (
              <button type="button" onClick={reset} className="cursor-pointer text-xs font-medium text-slate-500 hover:text-red-600">
                Vaciar
              </button>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-900">El carrito está vacío</p>
              <p className="mt-1 text-sm text-slate-500">Toca un producto o escanea su código para agregarlo.</p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {lines.map(({ product, quantity }) => (
                <li key={product.product_id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProductThumb src={product.image_url} name={product.name} className="h-9 w-9 rounded-lg" />
                      <p className="min-w-0 text-sm font-medium leading-5 text-slate-900">{product.name}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQty(product, 0)}
                      aria-label={`Quitar ${product.name}`}
                      className="cursor-pointer rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center rounded-lg border border-slate-200">
                      <button type="button" onClick={() => setQty(product, quantity - 1)} aria-label="Restar" className="cursor-pointer px-2 py-1.5 text-slate-600 hover:bg-slate-50">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={quantity}
                        onChange={(e) => setQty(product, Number(e.target.value) || 0)}
                        aria-label={`Cantidad de ${product.name}`}
                        className="tabular w-12 border-x border-slate-200 py-1 text-center text-sm focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button type="button" onClick={() => setQty(product, quantity + 1)} aria-label="Sumar" className="cursor-pointer px-2 py-1.5 text-slate-600 hover:bg-slate-50">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-sm font-semibold text-slate-900">{money(round2(Number(product.price) * quantity))}</p>
                      <p className="tabular text-xs text-slate-500">{money(product.price)} c/u</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3 border-t border-slate-200 bg-slate-50/60 p-4">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal ({formatQty(units)} u.)</dt>
                <dd className="tabular">{money(gross)}</dd>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <dt>
                  <label htmlFor="pos-discount">Descuento</label>
                </dt>
                <dd>
                  <Input
                    id="pos-discount"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0.00"
                    className="tabular h-7 w-24 text-right"
                  />
                </dd>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <dt>
                  Incluye {settings.tax_name} ({Number(settings.tax_rate)}%)
                </dt>
                <dd className="tabular">{money(total - base)}</dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                <dt className="text-sm font-semibold text-slate-900">Total</dt>
                <dd className="tabular text-2xl font-semibold tracking-tight text-slate-900">{money(total)}</dd>
              </div>
            </dl>
            {discountBlocked && <p className="text-xs text-red-600">Tu rol puede descontar hasta {money(maxCashierDiscount)} (10 %).</p>}
            <Button size="lg" variant="success" className="w-full" disabled={lines.length === 0 || total <= 0 || discountBlocked} onClick={openPayment}>
              Cobrar {lines.length > 0 && money(total)}
            </Button>
          </div>
        </Card>
      </aside>

      {/* Cobro */}
      <Dialog open={paying} onClose={() => setPaying(false)} title="Cobrar venta" size="md">
        <div className="space-y-4">
          <div className="rounded-xl bg-ink px-5 py-4 text-white">
            <p className="text-xs text-white/60">Total a cobrar</p>
            <p className="tabular text-3xl font-semibold tracking-tight">{money(total)}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Comprobante">
              <Select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
                <option value="boleta">Boleta</option>
                <option value="factura">Factura</option>
                <option value="ticket">Ticket interno</option>
              </Select>
            </Field>
            <Field label={docType === "factura" ? "Cliente (con RUC) *" : "Cliente"}>
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Cliente genérico</option>
                {customers
                  .filter((c) => docType !== "factura" || c.doc_type === "RUC")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.doc_number}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-slate-700">Medio de pago</legend>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={method === m.value}
                  onClick={() => setMethod(m.value)}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-xs font-medium transition-colors",
                    method === m.value ? "border-brand-600 bg-brand-50 text-link" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <m.icon className="h-4 w-4" />
                  {m.label}
                </button>
              ))}
            </div>
          </fieldset>

          {method === "efectivo" && (
            <div>
              <Field label="Monto recibido">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirm()}
                  className="tabular h-11 text-lg"
                />
              </Field>
              <div className="mt-2 flex flex-wrap gap-2">
                {quickAmounts.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReceived(n.toFixed(2))}
                    className="tabular cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {n === total ? "Exacto" : money(n)}
                  </button>
                ))}
              </div>
              <div className={cn("mt-3 flex items-baseline justify-between rounded-lg px-4 py-2.5", change >= 0 ? "bg-emerald-50" : "bg-slate-100")}>
                <span className="text-sm text-slate-600">Vuelto</span>
                <span className={cn("tabular text-xl font-semibold", change >= 0 ? "text-emerald-700" : "text-slate-400")}>{money(Math.max(change, 0))}</span>
              </div>
            </div>
          )}

          {method === "credito" && (
            <div className="rounded-xl border border-slate-200 p-4">
              {!customer ? (
                <p className="text-sm text-slate-600">Elige arriba el cliente. Solo se vende al crédito a clientes con línea asignada.</p>
              ) : Number(customer.credit_limit) <= 0 ? (
                <p className="text-sm text-red-600">{customer.name} no tiene línea de crédito. Cobra al contado o solicita que se la asignen.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <dl className="tabular space-y-1 text-sm text-slate-600">
                    <div className="flex justify-between">
                      <dt>Línea de crédito</dt>
                      <dd>{money(customer.credit_limit)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Deuda actual</dt>
                      <dd>{money(customer.debt)}</dd>
                    </div>
                    <div className={cn("flex justify-between border-t border-slate-200 pt-1 font-semibold", total > creditAvailable ? "text-red-600" : "text-emerald-700")}>
                      <dt>Disponible</dt>
                      <dd>{money(creditAvailable)}</dd>
                    </div>
                  </dl>
                  <Field label="Fecha de vencimiento" hint={`Plazo del cliente: ${customer.credit_days} días.`}>
                    <Input type="date" value={creditDue} min={today} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          )}

          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setPaying(false)}>
            Volver
          </Button>
          <Button variant="success" loading={pending} onClick={confirm}>
            Confirmar venta
          </Button>
        </DialogFooter>
      </Dialog>

      <ScannerDialog open={scanning} onClose={() => setScanning(false)} onDetect={onScan} title="Escanear productos" />

      {/* Venta registrada */}
      <Dialog
        open={receipt !== null}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
        title="Venta registrada"
        size="sm"
      >
        {receipt && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <p className="tabular mt-3 text-2xl font-semibold text-slate-900">{money(receipt.total)}</p>
            {receipt.change > 0 && (
              <p className="mt-1 text-sm text-slate-600">
                Vuelto: <span className="tabular font-semibold text-slate-900">{money(receipt.change)}</span>
              </p>
            )}
            <div className="mt-5 grid gap-2">
              <Link href={`/ventas/${receipt.id}`} className={buttonClass("secondary")} onClick={() => setReceipt(null)}>
                Ver e imprimir comprobante
              </Link>
              <Button
                onClick={() => {
                  setReceipt(null);
                  searchRef.current?.focus();
                }}
              >
                Nueva venta
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
