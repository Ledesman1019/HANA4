import type { Metadata } from "next";
import { Banknote, Palmtree, UserCheck, Users } from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { Employee } from "@/lib/types";
import { formatMoney, todayIn } from "@/lib/utils";
import { EmployeesView } from "@/modules/rrhh/components/employees-view";

export const metadata: Metadata = { title: "Personal" };

export default async function HrPage() {
  const { supabase, settings, branches } = await requireAccess("rrhh", "view");
  const { data } = await supabase.from("employees").select("*").order("full_name").limit(2000);
  const employees = (data ?? []) as Employee[];

  const onPayroll = employees.filter((e) => e.status !== "cesado");
  const payroll = onPayroll.reduce((sum, e) => sum + Number(e.salary), 0);

  return (
    <>
      <PageHeader title="Personal" description="Colaboradores, cargos y planilla mensual." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Colaboradores en planilla" value={String(onPayroll.length)} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Activos hoy" value={String(employees.filter((e) => e.status === "activo").length)} icon={<UserCheck className="h-4 w-4" />} tone="green" />
        <StatCard
          label="De vacaciones o licencia"
          value={String(employees.filter((e) => e.status === "vacaciones" || e.status === "licencia").length)}
          icon={<Palmtree className="h-4 w-4" />}
          tone="amber"
        />
        <StatCard label="Planilla mensual" value={formatMoney(payroll, settings.currency_symbol)} icon={<Banknote className="h-4 w-4" />} tone="slate" hint="Suma de sueldos brutos" />
      </div>
      <EmployeesView rows={employees} branches={branches.map((b) => ({ value: b.id, label: b.name }))} today={todayIn(settings.timezone)} />
    </>
  );
}
