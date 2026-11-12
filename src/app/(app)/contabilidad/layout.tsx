import { ScreenHeader } from "@/components/screen-header";

const SCREENS = {
  "/contabilidad": { title: "Libro diario", description: "Asientos de cada operación, generados automáticamente (PCGE)." },
  "/contabilidad/asiento": { title: "Nuevo asiento manual", description: "Registra un asiento que no proviene de otro módulo. Debe cuadrar." },
  "/contabilidad/mayor": { title: "Libro mayor", description: "Movimientos y saldo de una cuenta contable." },
  "/contabilidad/balances": { title: "Balances", description: "Balance de comprobación, estado de resultados y situación financiera." },
  "/contabilidad/centros": { title: "Centros de costo", description: "Áreas a las que se asignan los gastos (maestro)." },
  "/contabilidad/centros/reporte": { title: "Reporte por centro de costo", description: "Resultado por sucursal y gasto por área en un periodo." },
  "/contabilidad/plan": { title: "Plan de cuentas", description: "Cuentas del Plan Contable General Empresarial con su saldo a hoy." },
  "/contabilidad/periodos": { title: "Periodos contables", description: "Cierre y reapertura de meses." },
};

export default function AccountingLayout({ children }: LayoutProps<"/contabilidad">) {
  return (
    <>
      <ScreenHeader screens={SCREENS} />
      {children}
    </>
  );
}
