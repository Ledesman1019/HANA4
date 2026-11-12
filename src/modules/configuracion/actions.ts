"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { DENIED, fail, friendlyError, getContext, success } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { createAdminClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { crudSave, crudSetActive } from "@/lib/crud/engine";
import { firstIssue } from "@/lib/validation";
import { branches } from "./schema";

export async function saveBranch(id: string | null, values: Record<string, unknown>): Promise<ActionResult> {
  return crudSave(branches, id, values);
}

/** Debe quedar al menos una sucursal activa. */
export async function setBranchActive(id: string, active: boolean): Promise<ActionResult> {
  if (!active) {
    const { supabase } = await getContext();
    const { count } = await supabase.from("branches").select("id", { count: "exact", head: true }).eq("active", true);
    if ((count ?? 0) <= 1) return fail("Debe quedar al menos una sucursal activa");
  }
  return crudSetActive(branches, id, active);
}

const roleId = z.string().regex(/^[a-z0-9_]{2,40}$/, "Rol inválido");

/* ---------- Empresa ---------- */
const settingsSchema = z.object({
  name: z.string().trim().min(2, "Ingresa el nombre de la empresa").max(120),
  tax_id: z.union([z.literal(""), z.string().trim().regex(/^\d{11}$/, "El RUC debe tener 11 dígitos")]),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  email: z.union([z.literal(""), z.email("Correo inválido")]),
  currency_symbol: z.string().trim().min(1, "Ingresa el símbolo de moneda").max(5),
  tax_name: z.string().trim().min(1, "Ingresa el nombre del impuesto").max(10),
  tax_rate: z.coerce.number<number>().min(0, "Tasa inválida").max(50, "Tasa inválida"),
  receipt_footer: z.string().trim().max(200),
});

export async function updateSettings(values: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, can } = await getContext();
  if (!can("configuracion", "edit")) return fail(DENIED);
  const parsed = settingsSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const { error } = await supabase.from("company_settings").update(parsed.data).eq("id", 1);
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}

/* ---------- Usuarios ---------- */
const newUserSchema = z.object({
  full_name: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
  email: z.email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
  role: roleId,
  branch_id: z.uuid("Selecciona una sucursal"),
});

/** Alta de usuario por un administrador (no existe auto-registro). */
export async function createUser(values: Record<string, unknown>): Promise<ActionResult> {
  const ctx = await getContext();
  const { supabase, profile, branches, can } = ctx;
  if (!can("configuracion", "edit")) return fail(DENIED);

  const parsed = newUserSchema.safeParse({ ...values, email: String(values.email ?? "").trim().toLowerCase() });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const u = parsed.data;
  if (!branches.some((b) => b.id === u.branch_id)) return fail("Sucursal inválida");
  if (u.role === "admin" && !profile.is_super) return fail("Solo un Super Administrador puede crear administradores");

  const { data: roleRow } = await supabase.from("roles").select("id, name").eq("id", u.role).maybeSingle();
  if (!roleRow) return fail("El rol seleccionado no existe");

  const admin = createAdminClient();
  if (!admin) return fail("Falta la variable SUPABASE_SERVICE_ROLE_KEY en el servidor");

  const { data: created, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  if (error || !created.user) {
    if (error?.code === "email_exists" || error?.status === 422) return fail("Ya existe un usuario con ese correo");
    console.error("[createUser]", error);
    return fail("No se pudo crear el usuario");
  }

  // El trigger crea el perfil sin acceso (Supabase aún no ha guardado los
  // metadatos al insertar). El rol, la sucursal y el acceso se asignan aquí,
  // de forma explícita; si falla, no se deja una cuenta a medias.
  const { data: assigned, error: profileError } = await admin
    .from("profiles")
    .update({ full_name: u.full_name, role: u.role, branch_id: u.branch_id, active: true })
    .eq("id", created.user.id)
    .select("id");
  if (profileError || !assigned?.length) {
    console.error("[createUser] perfil", profileError);
    await admin.auth.admin.deleteUser(created.user.id);
    return fail("No se pudo asignar el rol al usuario. Inténtalo de nuevo");
  }
  await logAudit(ctx, "usuario.creacion", "usuario", created.user.id, `Creó la cuenta de ${u.full_name} (${u.email}) con el rol ${roleRow.name}`);
  revalidatePath("/", "layout");
  return success(undefined);
}

const updateUserSchema = z.object({
  id: z.uuid(),
  full_name: z.string().trim().min(3, "Ingresa el nombre completo").max(120),
  role: roleId,
  branch_id: z.uuid("Selecciona una sucursal"),
  active: z.boolean(),
  /** Solo lo puede cambiar un Super Administrador */
  is_super: z.boolean().optional(),
});

export async function updateUser(values: z.input<typeof updateUserSchema>): Promise<ActionResult> {
  const { supabase, profile, userId, can } = await getContext();
  if (!can("configuracion", "edit")) return fail(DENIED);

  const parsed = updateUserSchema.safeParse(values);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, is_super, ...rest } = parsed.data;

  // Nadie cambia su propio rol ni se desactiva a sí mismo.
  if (id === userId && (rest.role !== profile.role || !rest.active || (is_super !== undefined && is_super !== profile.is_super))) {
    return fail("No puedes cambiar tu propio rol, nivel ni desactivar tu cuenta. Pídeselo a otro Super Administrador");
  }

  // El nivel Super solo viaja si quien edita es Super Administrador y el rol es Administrador.
  const changes = profile.is_super && is_super !== undefined ? { ...rest, is_super: is_super && rest.role === "admin" } : rest;

  // La base de datos vuelve a exigirlo: solo un Super Administrador toca administradores,
  // y nunca puede quedar el sistema sin uno. Cada cambio queda en la auditoría.
  const { data, error } = await supabase.from("profiles").update(changes).eq("id", id).select("id");
  if (error) return fail(friendlyError(error));
  if (!data?.length) return fail("No tienes permiso para modificar a este usuario");
  revalidatePath("/", "layout");
  return success(undefined);
}

/** Restablece la contraseña de un usuario (por ejemplo, si la olvidó). Queda en la auditoría. */
export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx.can("configuracion", "edit")) return fail(DENIED);
  if (!z.uuid().safeParse(id).success) return fail("Usuario inválido");
  if (typeof password !== "string" || password.length < 8 || password.length > 72) return fail("La contraseña debe tener al menos 8 caracteres");
  if (id === ctx.userId) return fail("Para tu propia cuenta usa «Cambiar contraseña» en el menú de usuario");

  const { data: target } = await ctx.supabase.from("profiles").select("full_name, role").eq("id", id).maybeSingle();
  if (!target) return fail("Usuario no encontrado");
  if (target.role === "admin" && !ctx.profile.is_super) return fail("Solo un Super Administrador puede restablecer la contraseña de un administrador");

  const admin = createAdminClient();
  if (!admin) return fail("Falta la variable SUPABASE_SERVICE_ROLE_KEY en el servidor");
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    console.error("[resetUserPassword]", error);
    return fail("No se pudo restablecer la contraseña");
  }
  await logAudit(ctx, "usuario.contrasena", "usuario", id, `Restableció la contraseña de ${target.full_name}`);
  return success(undefined);
}

/* ---------- Roles y permisos ---------- */
const flags = z.object({ view: z.boolean(), create: z.boolean(), edit: z.boolean(), delete: z.boolean() }).partial();
const roleSchema = z.object({
  id: roleId.nullable(),
  name: z.string().trim().min(3, "El nombre del rol debe tener al menos 3 caracteres").max(60),
  description: z.string().trim().max(200),
  permissions: z.record(z.string(), flags),
});

export async function saveRole(input: z.input<typeof roleSchema>): Promise<ActionResult<{ id: string }>> {
  const { supabase, can } = await getContext();
  if (!can("configuracion", "edit")) return fail(DENIED);

  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = parsed.data;

  // Solo pasan módulos y acciones que existen en el registro.
  const permissions: Record<string, Record<string, boolean>> = {};
  for (const m of MODULES) {
    const given = r.permissions[m.key] ?? {};
    permissions[m.key] = Object.fromEntries(Object.keys(m.actions).map((a) => [a, Boolean(given[a as keyof typeof given])]));
  }

  const { data, error } = await supabase.rpc("save_role", { p_id: r.id, p_name: r.name, p_description: r.description, p_permissions: permissions });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success({ id: data as string });
}

export async function deleteRole(id: string): Promise<ActionResult> {
  const { supabase, can } = await getContext();
  if (!can("configuracion", "edit")) return fail(DENIED);
  if (!roleId.safeParse(id).success) return fail("Rol inválido");

  const { error } = await supabase.rpc("delete_role", { p_id: id });
  if (error) return fail(friendlyError(error));
  revalidatePath("/", "layout");
  return success(undefined);
}
