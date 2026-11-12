import type { Metadata } from "next";
import { Banknote, Palmtree, UserX, Users } from "lucide-react";
import { param } from "@/components/filters";
import { PageHeader, StatCard } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import type { Employee } from "@/modules/rrhh/types";
import { formatMoney, todayIn } from "@/lib/utils";
import { EmployeesView } from "@/modules/rrhh/components/employees-view";

export const metadata: Metadata = { title: "Colaboradores" };

export default async function HrPage({ searchParams }: PageProps<"/rrhh">) {
  const { supabase, settings, branches } = await requireAccess("rrhh", "view");
  const sp = await searchParams;
  const tz = settings.timezone;
  const today = todayIn(tz);
  const money = (n: number) => formatMoney(n, settings.currency_symbol);

  const [employeesRes, usersRes, centersRes] = await Promise.all([
    supabase.from("employees").select("*").order("full_name").limit(1000),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
    supabase.from("cost_centers").select("id, code, name").eq("active", true).order("code"),
  ]);
  const employees = (employeesRes.data ?? []) as Employee[];
  const users = (usersRes.data ?? []) as { id: string; full_name: string; email: string }[];

  const onPayroll = employees.filter((e) => e.status !== "cesado");
  const payroll = onPayroll.reduce((sum, e) => sum + Number(e.salary), 0);

  return (
    <>
      <PageHeader title="Colaboradores" description="Ficha de cada colaborador: cargo, sueldo, comisión, centro de costo y usuario del sistema." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Colaboradores en planilla" value={String(onPayroll.length)} icon={<Users className="h-4 w-4" />} hint={`${employees.filter((e) => e.status === "activo").length} activos hoy`} />
        <StatCard
          label="De vacaciones o licencia"
          value={String(employees.filter((e) => e.status === "vacaciones" || e.status === "licencia").length)}
          icon={<Palmtree className="h-4 w-4" />}
          tone="amber"
        />
        <StatCard label="Planilla mensual" value={money(payroll)} icon={<Banknote className="h-4 w-4" />} tone="slate" hint="Suma de sueldos brutos" />
        <StatCard label="Cesados" value={String(employees.filter((e) => e.status === "cesado").length)} icon={<UserX className="h-4 w-4" />} tone="slate" />
      </div>

      <EmployeesView
        rows={employees}
        branches={branches.map((b) => ({ value: b.id, label: b.name }))}
        users={users.map((u) => ({ value: u.id, label: `${u.full_name} · ${u.email}` }))}
        costCenters={((centersRes.data ?? []) as { id: string; code: string; name: string }[]).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
        today={today}
        startNew={param(sp.nuevo) === "1"}
      />
    </>
  );
}
