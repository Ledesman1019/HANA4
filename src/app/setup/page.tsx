import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CheckCircle2, Circle } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { Skeleton } from "@/components/ui";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { SetupForm } from "@/modules/auth/components/setup-form";

export const metadata: Metadata = { title: "Instalación" };

/** Versión de esquema que necesita esta versión de la aplicación. */
const REQUIRED_SCHEMA = 2;

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title="Instalación">
          <Skeleton className="h-40" />
        </AuthCard>
      }
    >
      <Setup />
    </Suspense>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {!done && <div className="mt-1 space-y-1 text-sm text-slate-600">{children}</div>}
      </div>
    </li>
  );
}

const code = "rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800 break-all";

async function Setup() {
  // Siempre en tiempo de petición: el estado de instalación no se prerenderiza.
  await connection();
  let baseReady = false;
  let upToDate = false;
  let needsSetup = false;

  if (hasSupabaseEnv) {
    const supabase = await createClient();
    const [setup, version] = await Promise.all([supabase.rpc("needs_setup"), supabase.rpc("schema_version")]);
    baseReady = !setup.error;
    needsSetup = setup.data === true;
    upToDate = !version.error && Number(version.data) >= REQUIRED_SCHEMA;
    if (baseReady && upToDate && !needsSetup) redirect("/login");
  }

  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);

  if (hasSupabaseEnv && baseReady && upToDate && hasServiceKey) {
    return (
      <AuthCard title="Configura tu sistema" description="Crea la cuenta del administrador. Luego podrás invitar al resto del equipo.">
        <SetupForm />
      </AuthCard>
    );
  }

  return (
    <AuthCard wide title="Faltan pasos de instalación" description="Completa estos pasos y recarga la página.">
      <ol className="space-y-5">
        <Step done={hasSupabaseEnv} title="1. Conectar Supabase">
          <p>
            Define <span className={code}>NEXT_PUBLIC_SUPABASE_URL</span> y <span className={code}>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</span> en{" "}
            <span className={code}>.env.local</span> (o en Vercel → Settings → Environment Variables) y reinicia el servidor.
          </p>
        </Step>
        <Step done={hasServiceKey} title="2. Clave de servidor">
          <p>
            Define <span className={code}>SUPABASE_SERVICE_ROLE_KEY</span>. Se usa solo en el servidor para crear usuarios; nunca se expone al navegador.
          </p>
        </Step>
        <Step done={baseReady} title="3. Crear la base de datos">
          <p>
            En Supabase → SQL Editor, pega y ejecuta el contenido de <span className={code}>supabase/migrations/0001_schema.sql</span>.
          </p>
        </Step>
        <Step done={upToDate} title="4. Actualizar la base de datos">
          <p>
            En Supabase → SQL Editor, pega y ejecuta <span className={code}>supabase/migrations/0002_roles_permisos_imagenes.sql</span>. Agrega los roles con
            permisos, las fotos de producto y acelera la carga. No borra datos.
          </p>
        </Step>
      </ol>
    </AuthCard>
  );
}
