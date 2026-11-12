import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { param } from "@/components/filters";
import { PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { fetchAll } from "@/lib/supabase/paginate";
import { CreditLines, type CreditLine } from "@/modules/cuentas-cobrar/components/credit-lines";

export const metadata: Metadata = { title: "Líneas de crédito" };

/** Control de crédito: a quién se le vende al crédito, hasta cuánto y a cuántos días. */
export default async function CreditLinesPage({ searchParams }: PageProps<"/cuentas-por-cobrar/lineas">) {
  const { supabase, can } = await requireAccess("cuentas_cobrar", "view");
  // Control de crédito: quien lo asigna o quien supervisa finanzas (el cajero solo cobra)
  if (!can("cuentas_cobrar", "edit") && !can("finanzas", "view")) redirect("/");
  const q = param((await searchParams).q).slice(0, 60);
  const [customers, statusRes] = await Promise.all([
    fetchAll<Omit<CreditLine, "debt" | "overdue">>((a, b) =>
      supabase.from("customers").select("id, name, doc_type, doc_number, credit_limit, credit_days").eq("active", true).order("name").order("id").range(a, b),
    ),
    supabase.rpc("customer_credit_status"),
  ]);
  const status = new Map(((statusRes.data ?? []) as { customer_id: string; debt: number; overdue: boolean }[]).map((s) => [s.customer_id, s]));
  const rows: CreditLine[] = customers.map((c) => ({
    ...c,
    credit_limit: Number(c.credit_limit),
    credit_days: Number(c.credit_days),
    debt: Number(status.get(c.id)?.debt ?? 0),
    overdue: Boolean(status.get(c.id)?.overdue),
  }));

  return (
    <>
      <PageHeader title="Líneas de crédito" description="Asigna a cada cliente cuánto puede deber y a cuántos días paga. Cada cambio queda en la auditoría." />
      <CreditLines key={q} rows={rows} canEdit={can("cuentas_cobrar", "edit")} initialQuery={q} />
    </>
  );
}
