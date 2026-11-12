"use client";

import { saveCostCenter, setCostCenterActive } from "@/modules/contabilidad/actions";
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

export function CostCentersView({ rows, startNew }: { rows: CostCenter[]; startNew?: boolean }) {
  return (
    <ResourceManager
      actions={{ save: saveCostCenter, setActive: setCostCenterActive }}
      module="contabilidad"
      startNew={startNew}
      singular="centro de costo"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(c) => c.id}
      searchText={(c) => `${c.code} ${c.name}`}
      isActive={(c) => c.active}
      exportable={{
        title: "Centros de costo",
        filename: "centros-de-costo",
        columns: [
          { header: "Código", value: (c) => c.code },
          { header: "Centro de costo", value: (c) => c.name },
          { header: "Estado", value: (c) => (c.active ? "Activo" : "Inactivo") },
        ],
      }}
    />
  );
}
