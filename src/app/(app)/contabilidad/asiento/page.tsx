import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import { todayIn } from "@/lib/utils";
import { ManualEntryForm } from "@/modules/contabilidad/components/entry-tools";
import type { Account } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Asiento manual" };

export default async function ManualEntryPage() {
  const { supabase, settings, branches } = await requireAccess("contabilidad", "create");
  const [{ data }, centers] = await Promise.all([
    supabase.from("accounts").select("code, name, type, active").eq("active", true).order("code"),
    supabase.from("cost_centers").select("id, code, name").eq("active", true).order("code"),
  ]);

  return (
    <ManualEntryForm accounts={(data ?? []) as Account[]} branches={branches.map((b) => ({ value: b.id, label: b.name }))}
      costCenters={((centers.data ?? []) as { id: string; code: string; name: string }[]).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
      today={todayIn(settings.timezone)} />
  );
}
