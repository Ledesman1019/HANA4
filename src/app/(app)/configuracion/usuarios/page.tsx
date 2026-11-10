import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import type { Profile, RoleRow } from "@/lib/types";
import { UsersView } from "@/modules/configuracion/components/users-view";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const { supabase, userId, profile, branches } = await requireAccess("configuracion", "view");
  const [users, roles] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("roles").select("id, name, description, is_system").order("is_system", { ascending: false }).order("name"),
  ]);

  return (
    <UsersView
      rows={(users.data ?? []) as Profile[]}
      roles={(roles.data ?? []) as RoleRow[]}
      currentUserId={userId}
      isAdmin={profile.role === "admin"}
      branches={branches.map((b) => ({ value: b.id, label: b.name }))}
    />
  );
}
