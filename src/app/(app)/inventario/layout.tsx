import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/tabs";

export default function InventoryLayout({ children }: LayoutProps<"/inventario">) {
  return (
    <>
      <PageHeader title="Inventario" description="Catálogo de productos, existencias por sucursal y kardex de movimientos." />
      <Tabs
        items={[
          { href: "/inventario", label: "Productos y stock" },
          { href: "/inventario/movimientos", label: "Kardex" },
          { href: "/inventario/lotes", label: "Lotes y vencimientos" },
          { href: "/inventario/categorias", label: "Categorías" },
        ]}
      />
      {children}
    </>
  );
}
