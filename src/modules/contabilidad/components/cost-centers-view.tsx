"use client";

import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";

export type CostCenter = { id: string; code: string; name: string; active: boolean };

const columns: Column<CostCenter>[] = [
  { header: "Código", cell: (c) => <span className="font-mono font-medium text-slate-900">{c.code}</span> },
  { header: "Centro de costo", cell: (c) => c.name },
  { header: "Estado", cell: (c) => <Badge tone={c.active ? "green" : "neutral"}>{c.active ? "Activo" : "Inactivo"}</Badge> },
];

const fields: FieldDef[] = [
  { name: "code", label: "Código", required: true, maxLength: 10, placeholder: "ADM" },
  { name: "name", label: "Nombre", required: true, maxLength: 80, placeholder: "Administración" },
];

export function CostCentersView({ rows }: { rows: CostCenter[] }) {
  return (
    <ResourceManager
      entity="costCenters"
      module="contabilidad"
      singular="centro de costo"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(c) => c.id}
      searchText={(c) => `${c.code} ${c.name}`}
      isActive={(c) => c.active}
    />
  );
}
