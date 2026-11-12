"use client";

import { saveLocation, setLocationActive } from "@/modules/inventario/actions";
import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import type { WarehouseLocation } from "@/modules/inventario/types";

type Option = { value: string; label: string };

/** Maestro de ubicaciones del almacén: RLS Tools las usa para contar por zona y ubicar productos. */
export function LocationsView({ rows, branches, branchId, products, startNew }: { rows: WarehouseLocation[]; branches: Option[]; branchId: string; products: Record<string, number>; startNew?: boolean }) {
  const branchName = (id: string) => branches.find((b) => b.value === id)?.label ?? "—";
  const zones = [...new Set(rows.map((r) => r.zone).filter(Boolean))].sort();

  const columns: Column<WarehouseLocation>[] = [
    { header: "Código", cell: (l) => <span className="font-mono font-semibold text-slate-900">{l.code}</span> },
    { header: "Zona", cell: (l) => l.zone || "—" },
    { header: "Descripción", cell: (l) => l.description || "—" },
    { header: "Sucursal", cell: (l) => branchName(l.branch_id) },
    { header: "Productos", align: "right", cell: (l) => products[l.id] ?? 0 },
    { header: "Estado", cell: (l) => <Badge tone={l.active ? "green" : "neutral"}>{l.active ? "Activa" : "Inactiva"}</Badge> },
  ];
  const fields: FieldDef[] = [
    { name: "code", label: "Código", required: true, maxLength: 20, placeholder: "A-01-03", hint: "Pasillo-estante-nivel. Imprime este código como etiqueta para escanearlo." },
    { name: "zone", label: "Zona", maxLength: 40, placeholder: "BEBIDAS", hint: "Los inventarios por zona cuentan solo las ubicaciones de esa zona." },
    { name: "branch_id", label: "Sucursal", type: "select", required: true, options: branches, defaultValue: branchId },
    { name: "description", label: "Descripción", maxLength: 120, wide: true },
  ];

  return (
    <ResourceManager
      actions={{ save: saveLocation, setActive: setLocationActive }}
      module="inventario"
      singular="ubicación"
      feminine
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(l) => l.id}
      searchText={(l) => `${l.code} ${l.zone} ${l.description}`}
      searchPlaceholder="Buscar por código, zona o descripción…"
      isActive={(l) => l.active}
      startNew={startNew}
      filter={zones.length ? { label: "Zona", options: zones.map((z) => ({ value: z, label: z, test: (l: WarehouseLocation) => l.zone === z })) } : undefined}
      exportable={{
        title: "Ubicaciones de almacén",
        filename: "ubicaciones",
        columns: [
          { header: "Código", value: (l) => l.code },
          { header: "Zona", value: (l) => l.zone },
          { header: "Descripción", value: (l) => l.description },
          { header: "Sucursal", value: (l) => branchName(l.branch_id) },
          { header: "Productos", type: "number", value: (l) => products[l.id] ?? 0 },
          { header: "Estado", value: (l) => (l.active ? "Activa" : "Inactiva") },
        ],
      }}
    />
  );
}
