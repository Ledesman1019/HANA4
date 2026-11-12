"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BRANCH_COOKIE, canSwitchBranch, getContext } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export type FormState = { error?: string } | undefined;

const credentials = z.object({
  email: z.email("Correo inválido"),
  password: z.string().min(1, "Ingresa tu contraseña"),
});

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error:
        error.code === "invalid_credentials"
          ? "Correo o contraseña incorrectos"
          : "No se pudo iniciar sesión. Inténtalo de nuevo",
    };
  }
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const setupSchema = z.object({
  company: z.string().trim().min(2, "Ingresa el nombre de la empresa").max(120),
  full_name: z.string().trim().min(3, "Ingresa tu nombre completo").max(120),
  email: z.email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
});

/** Crea el primer usuario (administrador). Solo funciona si no existe ninguno. */
export async function createFirstAdmin(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!hasSupabaseEnv) return { error: "Faltan las variables de entorno de Supabase" };

  const parsed = setupSchema.safeParse({
    company: formData.get("company"),
    full_name: formData.get("full_name"),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { company, full_name, email, password } = parsed.data;

  const supabase = await createClient();
  const { data: needsSetup, error: rpcError } = await supabase.rpc("needs_setup");
  if (rpcError) return { error: "La base de datos aún no está preparada. Ejecuta la migración SQL" };
  if (!needsSetup) return { error: "El sistema ya fue configurado. Inicia sesión" };

  const admin = createAdminClient();
  if (!admin) return { error: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en el servidor" };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    console.error("[setup]", createError);
    return { error: "No se pudo crear el usuario. Verifica el correo y la contraseña" };
  }

  // El trigger ya lo hizo administrador por ser el primero; aquí se fija el nombre.
  await admin.from("profiles").update({ full_name }).eq("id", created.user.id);
  await admin.from("company_settings").update({ name: company }).eq("id", 1);

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect("/login");
  redirect("/");
}

export async function changePassword(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, profile } = await getContext();
  if (typeof next !== "string" || next.length < 8 || next.length > 72) return { ok: false, error: "La nueva contraseña debe tener al menos 8 caracteres" };

  // Se confirma la contraseña actual para que una sesión abierta no baste para cambiarla.
  const check = await supabase.auth.signInWithPassword({ email: profile.email, password: String(current ?? "") });
  if (check.error) return { ok: false, error: "La contraseña actual no es correcta" };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.code === "same_password" ? "La nueva contraseña debe ser distinta a la actual" : "No se pudo cambiar la contraseña" };
  return { ok: true };
}

export async function setBranch(branchId: string) {
  const { profile, permissions, branches } = await getContext();
  if (!canSwitchBranch(profile.role, permissions)) return;
  if (!branches.some((b) => b.id === branchId)) return;
  (await cookies()).set(BRANCH_COOKIE, branchId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
