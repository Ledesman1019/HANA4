import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/tabs";

export default function AccountingLayout({ children }: LayoutProps<"/contabilidad">) {
  return (
    <>
      <PageHeader title="Contabilidad" description="Cada venta, cobro, compra, pago y gasto genera su asiento automáticamente. Plan contable general empresarial (PCGE)." />
      <Tabs
        items={[
          { href: "/contabilidad", label: "Libro diario" },
          { href: "/contabilidad/mayor", label: "Libro mayor" },
          { href: "/contabilidad/balances", label: "Balances" },
          { href: "/contabilidad/centros", label: "Centros de costo" },
          { href: "/contabilidad/plan", label: "Plan de cuentas" },
          { href: "/contabilidad/periodos", label: "Periodos" },
        ]}
      />
      {children}
    </>
  );
}
