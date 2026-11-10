import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/tabs";

export default function SettingsLayout({ children }: LayoutProps<"/configuracion">) {
  return (
    <>
      <PageHeader title="Configuración" description="Datos de la empresa, sucursales, usuarios y permisos de cada rol." />
      <Tabs
        items={[
          { href: "/configuracion", label: "Empresa" },
          { href: "/configuracion/sucursales", label: "Sucursales" },
          { href: "/configuracion/usuarios", label: "Usuarios" },
          { href: "/configuracion/roles", label: "Roles y permisos" },
        ]}
      />
      {children}
    </>
  );
}
