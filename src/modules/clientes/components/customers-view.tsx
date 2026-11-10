"use client";

import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import type { Customer } from "@/lib/types";

const columns: Column<Customer>[] = [
  {
    header: "Cliente",
    cell: (c) => (
      <div>
        <p className="font-medium text-slate-900">{c.name}</p>
        {c.address && <p className="text-xs text-slate-500">{c.address}</p>}
      </div>
    ),
  },
  {
    header: "Documento",
    cell: (c) => (
      <span className="tabular whitespace-nowrap">
        <Badge tone={c.doc_type === "RUC" ? "blue" : "neutral"}>{c.doc_type}</Badge> <span className="ml-1">{c.doc_number}</span>
      </span>
    ),
  },
  { header: "Teléfono", cell: (c) => c.phone || "—" },
  { header: "Correo", cell: (c) => c.email || "—" },
  { header: "Estado", cell: (c) => <Badge tone={c.active ? "green" : "neutral"}>{c.active ? "Activo" : "Inactivo"}</Badge> },
];

const fields: FieldDef[] = [
  {
    name: "doc_type",
    label: "Tipo de documento",
    type: "select",
    required: true,
    defaultValue: "DNI",
    options: [
      { value: "DNI", label: "DNI" },
      { value: "RUC", label: "RUC" },
      { value: "CE", label: "Carné de extranjería" },
      { value: "PASAPORTE", label: "Pasaporte" },
    ],
  },
  { name: "doc_number", label: "Número de documento", required: true, maxLength: 20 },
  { name: "name", label: "Nombre o razón social", required: true, wide: true, maxLength: 160 },
  { name: "phone", label: "Teléfono", type: "tel", maxLength: 30 },
  { name: "email", label: "Correo", type: "email" },
  { name: "address", label: "Dirección", wide: true, maxLength: 200 },
];

export function CustomersView({ rows, initialQuery }: { rows: Customer[]; initialQuery?: string }) {
  return (
    <ResourceManager
      entity="customers"
      module="clientes"
      initialQuery={initialQuery}
      singular="cliente"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(c) => c.id}
      searchText={(c) => `${c.name} ${c.doc_number} ${c.email} ${c.phone}`}
      searchPlaceholder="Buscar por nombre o documento…"
      isActive={(c) => c.active}
    />
  );
}
