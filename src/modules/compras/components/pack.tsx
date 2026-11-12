"use client";

import { Input, Select } from "@/components/ui";
import { formatQty } from "@/lib/utils";

/** Presentaciones de compra habituales. "" = la unidad base del producto. */
export const PACK_UNITS = ["CAJA", "PAQUETE", "DOCENA", "BOLSA", "FARDO", "SACO", "DISPLAY", "BALDE"] as const;

export type PackLine = { quantity: string; pack_unit: string; pack_size: string };
export type PackProduct = { unit: string; pack_unit?: string | null; pack_size?: number | null };

/** Unidades por empaque sugeridas al elegir una presentación. */
export function defaultPackSize(product: PackProduct | undefined, unit: string) {
  if (!unit) return "1";
  if (product?.pack_unit === unit && Number(product.pack_size) > 1) return String(Number(product.pack_size));
  if (unit === "DOCENA") return "12";
  return "";
}

/** Presentación inicial: la de compra del producto si la tiene; si no, la unidad base. */
export function initialPack(product: PackProduct | undefined): Pick<PackLine, "pack_unit" | "pack_size"> {
  const unit = product?.pack_unit && Number(product.pack_size) > 1 ? product.pack_unit : "";
  return { pack_unit: unit, pack_size: defaultPackSize(product, unit) };
}

/** Cantidad en unidades base (la que mueve el stock). */
export function baseQuantity(line: PackLine) {
  const size = line.pack_unit ? Number(line.pack_size) : 1;
  return Number(line.quantity) * (Number.isFinite(size) && size >= 1 ? size : 0);
}

/** Selector de presentación + unidades por empaque, con la conversión a unidades base. */
export function PackPicker({ line, product, onChange, label }: { line: PackLine; product: PackProduct | undefined; onChange: (patch: Partial<PackLine>) => void; label: string }) {
  const base = baseQuantity(line);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Select
          value={line.pack_unit}
          onChange={(e) => onChange({ pack_unit: e.target.value, pack_size: defaultPackSize(product, e.target.value) })}
          aria-label={`Presentación de ${label}`}
          className="h-9 w-32 text-xs"
        >
          <option value="">{product?.unit || "UND"} (unidad)</option>
          {PACK_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
        {line.pack_unit && (
          <label className="flex items-center gap-1 text-xs text-slate-500">
            ×
            <Input
              type="number"
              min={1}
              step="any"
              inputMode="decimal"
              value={line.pack_size}
              onChange={(e) => onChange({ pack_size: e.target.value })}
              aria-label={`Unidades por ${line.pack_unit.toLowerCase()} de ${label}`}
              className="tabular h-9 w-20 text-right"
            />
          </label>
        )}
      </div>
      {line.pack_unit && base > 0 && (
        <span className="tabular text-[11px] text-slate-500">
          = {formatQty(base)} {product?.unit || "UND"}
        </span>
      )}
    </div>
  );
}
