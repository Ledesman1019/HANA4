"use client";

import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import type { Branch } from "@/lib/types";

const columns: Column<Branch>[] = [
  { header: "Código", cell: (b) => <span className="tabular font-mono">{b.code}</span> },
  { header: "Sucursal", cell: (b) => <span className="font-medium text-slate-900">{b.name}</span> },
  { header: "Dirección", cell: (b) => b.address || "—" },
  { header: "Teléfono", cell: (b) => b.phone || "—" },
  { header: "Estado", cell: (b) => <Badge tone={b.active ? "green" : "neutral"}>{b.active ? "Activa" : "Inactiva"}</Badge> },
];

const fields: FieldDef[] = [
  { name: "code", label: "Código (3 dígitos)", required: true, maxLength: 3, placeholder: "002", hint: "Forma la serie de los comprobantes: B002-…" },
  { name: "name", label: "Nombre", required: true, maxLength: 80 },
  { name: "address", label: "Dirección", wide: true, maxLength: 200 },
  { name: "phone", label: "Teléfono", type: "tel", maxLength: 30 },
];

export function BranchesView({ rows }: { rows: Branch[] }) {
  return (
    <ResourceManager
      entity="branches"
      module="configuracion"
      singular="sucursal"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(b) => b.id}
      searchText={(b) => `${b.code} ${b.name} ${b.address}`}
      isActive={(b) => b.active}
    />
  );
}
