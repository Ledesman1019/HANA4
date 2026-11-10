import type { Metadata } from "next";
import { logout } from "@/modules/auth/actions";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui";

export const metadata: Metadata = { title: "Cuenta sin acceso" };

export default function InactivePage() {
  return (
    <AuthCard
      title="Tu cuenta no tiene acceso"
      description="Tu usuario está desactivado o aún no tiene una sucursal asignada. Comunícate con el administrador del sistema."
    >
      <form action={logout}>
        <Button type="submit" variant="secondary" className="w-full">
          Cerrar sesión
        </Button>
      </form>
    </AuthCard>
  );
}
