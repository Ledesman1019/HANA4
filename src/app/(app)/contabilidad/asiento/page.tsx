import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import { todayIn } from "@/lib/utils";
import { ManualEntryForm } from "@/modules/contabilidad/components/entry-tools";
import type { Account } from "@/modules/contabilidad/shared";

export const metadata: Metadata = { title: "Asiento manual" };

export default async function ManualEntryPage() {
  const { supabase, settings, branches } = await requireAccess("contabilidad", "create");
  const { data } = await supabase.from("accounts").select("code, name, type, active").eq("active", true).order("code");

  return (
    <ManualEntryForm accounts={(data ?? []) as Account[]} branches={branches.map((b) => ({ value: b.id, label: b.name }))} today={todayIn(settings.timezone)} />
  );
}
