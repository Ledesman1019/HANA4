import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/tabs";

export default function SettingsLayout({ children }: LayoutProps<"/configuracion">) {
  return (
    <>
      <PageHeader title="Configuración" description="Empresa, sucursales, usuarios, permisos de cada rol y registro de auditoría." />
      <Tabs
        items={[
          { href: "/configuracion", label: "Empresa" },
          { href: "/configuracion/sucursales", label: "Sucursales" },
          { href: "/configuracion/usuarios", label: "Usuarios" },
          { href: "/configuracion/roles", label: "Roles y permisos" },
          { href: "/configuracion/auditoria", label: "Auditoría" },
        ]}
      />
      {children}
    </>
  );
}
