import { Tabs } from "@/components/tabs";

/** Pestañas del ciclo de aprovisionamiento. */
export function PurchasingTabs() {
  return (
    <Tabs
      items={[
        { href: "/compras/solicitudes", label: "1 · Solicitudes de pedido" },
        { href: "/compras", label: "2 · Órdenes de compra" },
        { href: "/cuentas-por-pagar", label: "3 · Facturas y pagos" },
      ]}
    />
  );
}
