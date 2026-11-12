import { ScreenHeader } from "@/components/screen-header";

const SCREENS = {
  "/configuracion": { title: "Datos de la empresa", description: "Razón social, impuesto, moneda y pie de los comprobantes." },
  "/configuracion/sucursales": { title: "Sucursales", description: "Tiendas y almacenes de la empresa." },
  "/configuracion/usuarios": { title: "Usuarios", description: "Cuentas de acceso, su rol y su sucursal." },
  "/configuracion/roles": { title: "Roles y permisos", description: "Qué puede ver y hacer cada rol en cada módulo." },
  "/configuracion/auditoria": { title: "Auditoría", description: "Registro inmutable de cambios y operaciones sensibles." },
};

export default function SettingsLayout({ children }: LayoutProps<"/configuracion">) {
  return (
    <>
      <ScreenHeader screens={SCREENS} />
      {children}
    </>
  );
}
