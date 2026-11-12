import { ScreenHeader } from "@/components/screen-header";

const SCREENS = {
  "/inventario": { title: "Listado de productos", description: "Catálogo con existencias, costo y precio en la sucursal activa." },
  "/inventario/fisico": { title: "Inventario físico", description: "Registra el conteo real de cada producto; las diferencias se ajustan y quedan en el kardex." },
  "/inventario/movimientos": {
    title: "Kardex",
    description: "Todos los movimientos de almacén con su saldo.",
    variants: {
      param: "tipo",
      values: {
        transferencia_salida: { title: "Transferencias (histórico)", description: "Mercadería enviada a otras sucursales." },
        transferencia_entrada: { title: "Transferencias recibidas (histórico)", description: "Mercadería recibida de otras sucursales." },
        ajuste: { title: "Ajustes de inventario (histórico)", description: "Correcciones por conteo físico, mermas y diferencias." },
        compra: { title: "Recibos de mercadería (histórico)", description: "Ingresos al almacén por órdenes de compra recibidas." },
        venta: { title: "Salidas por venta (histórico)", description: "Mercadería que salió por ventas." },
        devolucion: { title: "Devoluciones (histórico)", description: "Reingresos por anulación de ventas." },
      },
    },
  },
  "/inventario/lotes": { title: "Lotes y vencimientos", description: "Lotes con stock y su fecha de vencimiento; la venta sale primero lo que vence antes (FEFO)." },
  "/inventario/categorias": { title: "Categorías", description: "Clasificación de los productos." },
  "/inventario/ubicaciones": { title: "Ubicaciones de almacén", description: "Pasillos, estantes y zonas de cada sucursal. RLS Tools las usa para contar y ubicar productos." },
  "/inventario/conteos": { title: "Inventarios desde RLS Tools", description: "Inventarios físicos contados con el celular, con sus faltantes, sobrantes y diferencia valorizada." },
};

export default function InventoryLayout({ children }: LayoutProps<"/inventario">) {
  return (
    <>
      <ScreenHeader screens={SCREENS} />
      {children}
    </>
  );
}
