export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Acepta tanto la clave "publishable" nueva como la "anon" clásica.
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const hasSupabaseEnv = Boolean(SUPABASE_URL && SUPABASE_KEY);

/**
 * Nombre de la central que se muestra en el login y en «Acerca de».
 * Nunca se muestra el servidor ni el nombre técnico de la base de datos.
 */
export const CENTRAL_NAME = process.env.NEXT_PUBLIC_CENTRAL_NAME?.trim() || "HANA4 Central";
