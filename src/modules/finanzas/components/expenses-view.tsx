"use client";

import { useApp } from "@/components/app-provider";
import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import { EXPENSE_LABELS, PAYMENT_LABELS, type Expense } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type Option = { value: string; label: string };
const toOptions = (labels: Record<string, string>, keys?: string[]) => (keys ?? Object.keys(labels)).map((value) => ({ value, label: labels[value] }));

export function ExpensesView({ rows, branchId, branches, defaultDate }: { rows: Expense[]; branchId: string; branches: Option[]; defaultDate: string }) {
  const { money } = useApp();

  const columns: Column<Expense>[] = [
    { header: "Fecha", cell: (e) => <span className="tabular">{formatDate(e.expense_date)}</span> },
    { header: "Categoría", cell: (e) => <Badge>{EXPENSE_LABELS[e.category] ?? e.category}</Badge> },
    { header: "Descripción", cell: (e) => <span className="text-slate-900">{e.description}</span> },
    { header: "Pago", cell: (e) => PAYMENT_LABELS[e.payment_method] ?? e.payment_method },
    { header: "Monto", align: "right", cell: (e) => <span className="font-medium text-slate-900">{money(e.amount)}</span> },
  ];

  const fields: FieldDef[] = [
    { name: "description", label: "Descripción", required: true, wide: true, maxLength: 200 },
    { name: "category", label: "Categoría", type: "select", required: true, defaultValue: "servicios", options: toOptions(EXPENSE_LABELS) },
    { name: "amount", label: "Monto", type: "number", required: true },
    { name: "expense_date", label: "Fecha", type: "date", required: true, defaultValue: defaultDate },
    { name: "payment_method", label: "Medio de pago", type: "select", required: true, defaultValue: "efectivo", options: toOptions(PAYMENT_LABELS, ["efectivo", "tarjeta", "transferencia", "yape", "plin"]) },
    { name: "branch_id", label: "Sucursal", type: "select", required: true, defaultValue: branchId, options: branches },
  ];

  return (
    <ResourceManager
      entity="expenses"
      module="finanzas"
      singular="gasto"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(e) => e.id}
      searchText={(e) => `${e.description} ${EXPENSE_LABELS[e.category] ?? ""}`}
      searchPlaceholder="Buscar gasto…"
      hardDelete
      exportable={{
        title: "Gastos",
        filename: `gastos_${defaultDate.slice(0, 7)}`,
        columns: [
          { header: "Fecha", type: "date", value: (e) => e.expense_date },
          { header: "Categoría", value: (e) => EXPENSE_LABELS[e.category] ?? e.category },
          { header: "Descripción", value: (e) => e.description },
          { header: "Medio de pago", value: (e) => PAYMENT_LABELS[e.payment_method] ?? e.payment_method },
          { header: "Monto", type: "money", total: true, value: (e) => Number(e.amount) },
        ],
      }}
    />
  );
}
