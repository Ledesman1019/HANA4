import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <AuthCard title="Página no encontrada" description="El enlace no existe o el registro ya no está disponible.">
      <Link href="/" className={`${buttonClass("primary")} w-full`}>
        Volver al panel
      </Link>
    </AuthCard>
  );
}
