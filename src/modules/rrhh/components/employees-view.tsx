"use client";

import { useApp } from "@/components/app-provider";
import { saveEmployee } from "@/modules/rrhh/actions";
import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge, type BadgeTone } from "@/components/ui";
import type { Employee } from "@/modules/rrhh/types";
import { formatDate } from "@/lib/utils";

const STATUS: Record<Employee["status"], { label: string; tone: BadgeTone }> = {
  activo: { label: "Activo", tone: "green" },
  vacaciones: { label: "Vacaciones", tone: "amber" },
  licencia: { label: "Licencia", tone: "blue" },
  cesado: { label: "Cesado", tone: "neutral" },
};

type Option = { value: string; label: string };

export function EmployeesView({ rows, branches, users, today }: { rows: Employee[]; branches: Option[]; users: Option[]; today: string }) {
  const { money } = useApp();
  const branchName = (id: string | null) => branches.find((b) => b.value === id)?.label ?? "—";

  const columns: Column<Employee>[] = [
    {
      header: "Colaborador",
      cell: (e) => (
        <div>
          <p className="font-medium text-slate-900">{e.full_name}</p>
          <p className="tabular text-xs text-slate-500">Doc. {e.doc_number}</p>
        </div>
      ),
    },
    { header: "Cargo", cell: (e) => e.position },
    { header: "Sucursal", cell: (e) => branchName(e.branch_id) },
    { header: "Ingreso", cell: (e) => <span className="tabular">{formatDate(e.hire_date)}</span> },
    { header: "Sueldo", align: "right", cell: (e) => money(e.salary) },
    {
      header: "Comisión",
      align: "right",
      cell: (e) => (Number(e.commission_rate) > 0 ? <span title={e.profile_id ? undefined : "Sin usuario vinculado: no genera comisiones"}>{Number(e.commission_rate)}%{!e.profile_id && " ⚠"}</span> : <span className="text-slate-400">—</span>),
    },
    { header: "Estado", cell: (e) => <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge> },
  ];

  const fields: FieldDef[] = [
    { name: "full_name", label: "Nombre completo", required: true, wide: true, maxLength: 160 },
    { name: "doc_number", label: "Documento de identidad", required: true, maxLength: 20 },
    { name: "position", label: "Cargo", required: true, maxLength: 80 },
    { name: "branch_id", label: "Sucursal", type: "select", options: branches },
    { name: "status", label: "Estado", type: "select", required: true, defaultValue: "activo", options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })) },
    { name: "salary", label: "Sueldo mensual", type: "number", required: true, defaultValue: "0" },
    { name: "commission_rate", label: "Comisión por ventas (%)", type: "number", required: true, defaultValue: "0", hint: "Sobre la venta neta (sin impuesto) de cada comprobante." },
    { name: "profile_id", label: "Usuario del sistema", type: "select", options: users, hint: "Vincula al colaborador con su cuenta: sus ventas le generan comisión.", wide: true },
    { name: "hire_date", label: "Fecha de ingreso", type: "date", required: true, defaultValue: today },
    { name: "phone", label: "Teléfono", type: "tel", maxLength: 30 },
    { name: "email", label: "Correo", type: "email" },
  ];

  return (
    <ResourceManager
      actions={{ save: saveEmployee }}
      module="rrhh"
      singular="colaborador"
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(e) => e.id}
      searchText={(e) => `${e.full_name} ${e.doc_number} ${e.position}`}
      searchPlaceholder="Buscar por nombre, documento o cargo…"
      exportable={{
        title: "Personal",
        filename: "personal",
        columns: [
          { header: "Documento", value: (e) => e.doc_number },
          { header: "Colaborador", value: (e) => e.full_name },
          { header: "Cargo", value: (e) => e.position },
          { header: "Sucursal", value: (e) => branchName(e.branch_id) },
          { header: "Ingreso", type: "date", value: (e) => e.hire_date },
          { header: "Estado", value: (e) => STATUS[e.status].label },
          { header: "Teléfono", value: (e) => e.phone },
          { header: "Comisión %", type: "number", value: (e) => Number(e.commission_rate) },
          { header: "Sueldo", type: "money", total: true, value: (e) => (e.status === "cesado" ? null : Number(e.salary)) },
        ],
      }}
    />
  );
}
