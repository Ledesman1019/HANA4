"use client";

import { useApp } from "@/components/app-provider";
import { saveCustomer, setCustomerActive } from "@/modules/clientes/actions";
import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import type { Customer } from "@/modules/clientes/types";

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
  const { can, money } = useApp();
  // La línea de crédito solo la ve y la fija quien administra el crédito
  const manageCredit = can("cuentas_cobrar", "edit");
  const creditColumn: Column<Customer> = {
    header: "Crédito",
    align: "right",
    cell: (c) => (Number(c.credit_limit) > 0 ? <span title={`Plazo: ${c.credit_days} días`}>{money(c.credit_limit)}</span> : <span className="text-slate-400">Contado</span>),
  };
  const creditFields: FieldDef[] = [
    { name: "credit_limit", label: "Línea de crédito", type: "number", defaultValue: "0", hint: "Deuda máxima permitida. 0 = solo vende al contado." },
    { name: "credit_days", label: "Plazo de pago (días)", type: "number", step: "1", defaultValue: "0", hint: "Días para pagar cada venta al crédito." },
  ];
  return (
    <ResourceManager
      actions={{ save: saveCustomer, setActive: setCustomerActive }}
      module="clientes"
      initialQuery={initialQuery}
      singular="cliente"
      rows={rows}
      columns={can("cuentas_cobrar", "view") || manageCredit ? [...columns.slice(0, 2), creditColumn, ...columns.slice(2)] : columns}
      fields={manageCredit ? [...fields, ...creditFields] : fields}
      getId={(c) => c.id}
      searchText={(c) => `${c.name} ${c.doc_number} ${c.email} ${c.phone}`}
      searchPlaceholder="Buscar por nombre o documento…"
      isActive={(c) => c.active}
      exportable={{
        title: "Clientes",
        filename: "clientes",
        columns: [
          { header: "Tipo doc.", value: (c) => c.doc_type },
          { header: "Documento", value: (c) => c.doc_number },
          { header: "Nombre o razón social", value: (c) => c.name },
          { header: "Teléfono", value: (c) => c.phone },
          { header: "Correo", value: (c) => c.email },
          { header: "Dirección", value: (c) => c.address },
          { header: "Estado", value: (c) => (c.active ? "Activo" : "Inactivo") },
        ],
      }}
    />
  );
}
