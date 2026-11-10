import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth";
import type { Permissions } from "@/lib/modules";
import type { RoleRow } from "@/lib/types";
import { RolesView, type RoleWithPermissions } from "@/modules/configuracion/components/roles-view";

export const metadata: Metadata = { title: "Roles y permisos" };

type PermissionRow = { role_id: string; module: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };

export default async function RolesPage() {
  const { supabase, profile, can } = await requireAccess("configuracion", "view");

  const [rolesRes, permsRes, usersRes] = await Promise.all([
    supabase.from("roles").select("id, name, description, is_system").order("is_system", { ascending: false }).order("created_at"),
    supabase.from("role_permissions").select("*"),
    supabase.from("profiles").select("role"),
  ]);

  const perms = (permsRes.data ?? []) as PermissionRow[];
  const users = (usersRes.data ?? []) as { role: string }[];

  const roles: RoleWithPermissions[] = ((rolesRes.data ?? []) as RoleRow[]).map((r) => ({
    ...r,
    users: users.filter((u) => u.role === r.id).length,
    permissions: Object.fromEntries(
      perms.filter((p) => p.role_id === r.id).map((p) => [p.module, { view: p.can_view, create: p.can_create, edit: p.can_edit, delete: p.can_delete }]),
    ) as Permissions,
  }));

  return <RolesView roles={roles} ownRole={profile.role} canEdit={can("configuracion", "edit")} />;
}
