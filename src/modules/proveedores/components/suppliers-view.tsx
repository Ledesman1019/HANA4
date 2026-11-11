"use client";

import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import type { Supplier } from "@/lib/types";

const columns: Column<Supplier>[] = [
  {
    header: "Proveedor",
    cell: (s) => (
      <div>
        <p className="font-medium text-slate-900">{s.name}</p>
        <p className="tabular text-xs text-slate-500">RUC {s.tax_id}</p>
      </div>
    ),
  },
  { header: "Contacto", cell: (s) => s.contact_name || "—" },
  { header: "Teléfono", cell: (s) => s.phone || "—" },
  { header: "Correo", cell: (s) => s.email || "—" },
  { header: "Estado", cell: (s) => <Badge tone={s.active ? "green" : "neutral"}>{s.active ? "Activo" : "Inactivo"}</Badge> },
];

const fields: FieldDef[] = [
  { name: "tax_id", label: "RUC", required: true, maxLength: 11, placeholder: "20XXXXXXXXX" },
  { name: "name", label: "Razón social", required: true, maxLength: 160 },
  { name: "contact_name", label: "Persona de contacto", maxLength: 120 },
  { name: "phone", label: "Teléfono", type: "tel", maxLength: 30 },
  { name: "email", label: "Correo", type: "email" },
  { name: "address", label: "Dirección", maxLength: 200 },
];

export function SuppliersView({ rows }: { rows: Supplier[] }) {
  return (
    <ResourceManager
      entity="suppliers"
      module="proveedores"
      singular="proveedor"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(s) => s.id}
      searchText={(s) => `${s.name} ${s.tax_id} ${s.contact_name}`}
      searchPlaceholder="Buscar por razón social o RUC…"
      isActive={(s) => s.active}
      exportable={{
        title: "Proveedores",
        filename: "proveedores",
        columns: [
          { header: "RUC", value: (s) => s.tax_id },
          { header: "Razón social", value: (s) => s.name },
          { header: "Contacto", value: (s) => s.contact_name },
          { header: "Teléfono", value: (s) => s.phone },
          { header: "Correo", value: (s) => s.email },
          { header: "Dirección", value: (s) => s.address },
          { header: "Estado", value: (s) => (s.active ? "Activo" : "Inactivo") },
        ],
      }}
    />
  );
}
