import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/modules/auth/components/login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <AuthCard title="Bienvenido" description="Ingresa con tu cuenta para continuar.">
      <LoginForm />
      <p className="mt-5 text-center text-xs text-slate-500">
        ¿No tienes cuenta? Pídele acceso al administrador del sistema.
      </p>
    </AuthCard>
  );
}
