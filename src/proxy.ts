import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/setup", "/inactivo"];

/**
 * Refresca la sesión de Supabase y hace la redirección optimista de
 * usuarios sin sesión. La autorización real vive en RLS y en el servidor.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSupabaseEnv) {
    return pathname === "/setup" ? NextResponse.next() : NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!signedIn && !isPublic) return redirectTo("/login");
  if (signedIn && pathname === "/login") return redirectTo("/");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
