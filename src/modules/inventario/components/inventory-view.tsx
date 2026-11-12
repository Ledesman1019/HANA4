"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { adjustStock, saveProduct, setProductActive, transferStock } from "@/modules/inventario/actions";
import { useApp } from "@/components/app-provider";
import { Dialog, DialogFooter } from "@/components/dialog";
import { ProductThumb } from "@/components/product-thumb";
import { ResourceManager, type Column, type ExportField, type FieldDef } from "@/components/resource-manager";
import { Badge, Button, Field, FormError, Input, Select } from "@/components/ui";
import type { InventoryRow } from "@/modules/inventario/types";
import { formatQty } from "@/lib/utils";

type Option = { value: string; label: string };
type Filter = "todos" | "bajo" | "inactivos";

export function InventoryView({
  rows,
  categories,
  otherBranches,
  showCosts,
  initialFilter,
  initialQuery,
  startNew,
}: {
  initialQuery: string;
  startNew?: boolean;
  rows: InventoryRow[];
  categories: Option[];
  otherBranches: Option[];
  showCosts: boolean;
  initialFilter: Filter;
}) {
  const { money, branch, can } = useApp();
  const canAdjust = can("inventario", "edit");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [action, setAction] = useState<{ kind: "adjust" | "transfer"; row: InventoryRow } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = rows.filter((r) => (filter === "bajo" ? r.active && r.low_stock : filter === "inactivos" ? !r.active : true));

  const columns: Column<InventoryRow>[] = [
    {
      header: "Producto",
      cell: (r) => (
        <div className="flex min-w-56 items-center gap-3">
          <ProductThumb src={r.image_url} name={r.name} className="h-10 w-10 rounded-lg" />
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{r.name}</p>
            <p className="tabular text-xs text-slate-500">
              {r.sku}
              {r.barcode && ` · ${r.barcode}`}
            </p>
          </div>
        </div>
      ),
    },
    { header: "Categoría", cell: (r) => r.category_name ?? <span className="text-slate-400">—</span> },
    ...(showCosts ? [{ header: "Costo", align: "right", cell: (r) => money(r.cost) } satisfies Column<InventoryRow>] : []),
    { header: "Precio", align: "right", cell: (r) => <span className="font-medium text-slate-900">{money(r.price)}</span> },
    {
      header: "Stock",
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          {r.active && Number(r.quantity) <= 0 ? <Badge tone="red">Agotado</Badge> : r.active && r.low_stock ? <Badge tone="amber">Bajo</Badge> : null}
          <span className="font-medium text-slate-900">{formatQty(r.quantity)}</span>
          <span className="text-xs text-slate-500">{r.unit}</span>
        </span>
      ),
    },
    ...(showCosts ? [{ header: "Valor", align: "right", cell: (r) => money(r.stock_value) } satisfies Column<InventoryRow>] : []),
  ];

  const fields: FieldDef[] = [
    { name: "image_url", label: "Foto del producto", type: "image" },
    { name: "name", label: "Nombre del producto", required: true, wide: true, maxLength: 160 },
    { name: "sku", label: "SKU (código interno)", required: true, maxLength: 40, placeholder: "ABA-001" },
    { name: "barcode", label: "Código de barras", maxLength: 60, hint: "Opcional. Permite vender con lector." },
    { name: "category_id", label: "Categoría", type: "select", options: categories },
    { name: "unit", label: "Unidad de medida", required: true, defaultValue: "UND", maxLength: 10 },
    { name: "cost", label: "Costo unitario (sin impuesto)", type: "number", required: true, defaultValue: "0" },
    { name: "price", label: "Precio de venta (con impuesto)", type: "number", required: true, defaultValue: "0" },
    { name: "min_stock", label: "Stock mínimo", type: "number", step: "0.001", required: true, defaultValue: "0", hint: "Se alerta al llegar a esta cantidad." },
    {
      name: "track_lots",
      label: "Lotes y vencimiento",
      type: "select",
      required: true,
      defaultValue: "false",
      options: [
        { value: "false", label: "No controla lotes" },
        { value: "true", label: "Controla lote y fecha de vencimiento (FEFO)" },
      ],
      hint: "Para perecibles: se pide el lote al recibir y se vende primero lo que vence antes.",
      wide: true,
    },
    {
      name: "pack_unit",
      label: "Presentación de compra",
      type: "select",
      options: [
        { value: "CAJA", label: "Caja" },
        { value: "PAQUETE", label: "Paquete" },
        { value: "DOCENA", label: "Docena" },
        { value: "BOLSA", label: "Bolsa" },
        { value: "FARDO", label: "Fardo" },
        { value: "SACO", label: "Saco" },
        { value: "DISPLAY", label: "Display" },
        { value: "BALDE", label: "Balde" },
      ],
      hint: "Cómo lo vende el proveedor. Vacío: se compra por unidad.",
    },
    { name: "pack_size", label: "Unidades por presentación", type: "number", step: "1", defaultValue: "1", hint: "Ej. 12 si una caja trae 12 unidades." },
    { name: "description", label: "Descripción", type: "textarea", maxLength: 500 },
  ];

  function close() {
    setAction(null);
    setError(null);
  }

  function submit(form: FormData) {
    if (!action) return;
    const { kind, row } = action;
    setError(null);
    startTransition(async () => {
      const res =
        kind === "adjust"
          ? await adjustStock(row.product_id, Number(form.get("quantity")), String(form.get("note") ?? ""))
          : await transferStock(row.product_id, String(form.get("to") ?? ""), Number(form.get("quantity")), String(form.get("note") ?? ""));
      if (!res.ok) return setError(res.error);
      toast.success(kind === "adjust" ? "Stock ajustado" : "Transferencia registrada");
      close();
    });
  }

  return (
    <>
      <ResourceManager
        actions={{ save: saveProduct, setActive: setProductActive }}
        module="inventario"
        startNew={startNew}
        singular="producto"
        rows={shown}
        columns={columns}
        fields={fields}
        getId={(r) => r.product_id}
        searchText={(r) => `${r.name} ${r.sku} ${r.barcode ?? ""} ${r.category_name ?? ""}`}
        searchPlaceholder="Buscar por nombre, SKU o código…"
        initialQuery={initialQuery}
        isActive={(r) => r.active}
        exportable={{
          title: `Inventario · ${branch.name}`,
          filename: "inventario",
          columns: [
            { header: "SKU", value: (r) => r.sku },
            { header: "Código de barras", value: (r) => r.barcode },
            { header: "Producto", value: (r) => r.name },
            { header: "Categoría", value: (r) => r.category_name },
            { header: "Unidad", value: (r) => r.unit },
            { header: "Stock", type: "number", value: (r) => Number(r.quantity) },
            { header: "Mínimo", type: "number", value: (r) => Number(r.min_stock) },
            ...(showCosts ? [{ header: "Costo", type: "money", value: (r) => Number(r.cost) } satisfies ExportField<InventoryRow>] : []),
            { header: "Precio", type: "money", value: (r) => Number(r.price) },
            ...(showCosts ? [{ header: "Valor", type: "money", total: true, value: (r) => Number(r.stock_value) } satisfies ExportField<InventoryRow>] : []),
            { header: "Estado", value: (r) => (!r.active ? "Inactivo" : Number(r.quantity) <= 0 ? "Agotado" : r.low_stock ? "Stock bajo" : "Normal") },
          ],
        }}
        toolbar={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filtrar productos" className="w-auto">
            <option value="todos">Todos</option>
            <option value="bajo">Stock bajo o agotado</option>
            <option value="inactivos">Inactivos</option>
          </Select>
        }
        rowActions={
          canAdjust
            ? (r) => (
                <>
                  <Button variant="ghost" size="icon" title="Ajustar stock" aria-label="Ajustar stock" onClick={() => setAction({ kind: "adjust", row: r })}>
                    <SlidersHorizontal className="h-4 w-4" />
                  </Button>
                  {otherBranches.length > 0 && (
                    <Button variant="ghost" size="icon" title="Transferir a otra sucursal" aria-label="Transferir a otra sucursal" onClick={() => setAction({ kind: "transfer", row: r })}>
                      <ArrowLeftRight className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )
            : undefined
        }
      />

      <Dialog
        open={action !== null}
        onClose={close}
        title={action?.kind === "transfer" ? "Transferir stock" : "Ajustar stock"}
        description={action ? `${action.row.name} · ${formatQty(action.row.quantity)} ${action.row.unit} en ${branch.name}` : undefined}
        size="sm"
      >
        {action && (
          <form
            key={`${action.kind}-${action.row.product_id}`}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit(new FormData(e.currentTarget));
            }}
          >
            {action.kind === "adjust" ? (
              <Field label="Cantidad real (conteo físico)" hint="El sistema registra la diferencia en el kardex.">
                <Input name="quantity" type="number" min={0} step="0.001" inputMode="decimal" required autoFocus defaultValue={Number(action.row.quantity)} className="tabular" />
              </Field>
            ) : (
              <>
                <Field label="Sucursal de destino">
                  <Select name="to" required>
                    {otherBranches.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cantidad a transferir">
                  <Input name="quantity" type="number" min={0.001} max={Number(action.row.quantity)} step="0.001" inputMode="decimal" required autoFocus className="tabular" />
                </Field>
              </>
            )}
            <Field label={action.kind === "adjust" ? "Motivo *" : "Nota (opcional)"}>
              <Input name="note" required={action.kind === "adjust"} minLength={action.kind === "adjust" ? 3 : undefined} maxLength={200} placeholder={action.kind === "adjust" ? "Conteo físico, merma, rotura…" : ""} />
            </Field>
            <FormError message={error} />
            <DialogFooter>
              <Button variant="secondary" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                {action.kind === "adjust" ? "Guardar ajuste" : "Transferir"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </Dialog>
    </>
  );
}
