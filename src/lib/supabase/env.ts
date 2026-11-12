export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Acepta tanto la clave "publishable" nueva como la "anon" clásica.
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const hasSupabaseEnv = Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Nombre de la base de datos tal como se muestra en el login y en «Acerca de» (servidor\\HANA4). */
export function databaseLabel() {
  try {
    return `${new URL(SUPABASE_URL).host.split(".")[0]}\\HANA4`;
  } catch {
    return "HANA4";
  }
}
