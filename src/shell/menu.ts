/**
 * Menú del lanzador al estilo de los ERP clásicos, ordenado como SAP:
 *   módulo SAP (MM, SD, FI…)  →  área (pestaña de la barra inferior)  →  mosaico (función).
 * Cada mosaico abre una pantalla existente; el permiso del rol decide si se ve.
 */
import {
  ArrowLeftRight,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  BookOpenText,
  Boxes,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  CreditCard,
  Factory,
  FilePlus2,
  FileText,
  FileX2,
  FolderArchive,
  HandCoins,
  History,
  IdCard,
  Landmark,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MessageSquareWarning,
  MonitorCog,
  NotebookPen,
  PackageCheck,
  PackagePlus,
  PackageSearch,
  PiggyBank,
  Receipt,
  ScanBarcode,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Tags,
  Target,
  Timer,
  Truck,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { hasPermission, type Action, type ModuleKey, type Permissions } from "@/lib/modules";

export type Tile = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Módulo de permisos que exige (null = cualquier usuario con sesión) */
  module: ModuleKey | null;
  needs: Action | "access";
  /** Permiso adicional (ej. vender exige además tener caja) */
  also?: [ModuleKey, Action | "access"];
  /** Abre una ventana en lugar de navegar */
  action?: "preferences" | "about";
};

export type Area = { key: string; label: string; icon: LucideIcon; tiles: Tile[] };

export type SapModule = {
  key: string;
  code: string;
  name: string;
  desc: string;
  icon: LucideIcon;
  areas: Area[];
};

const t = (label: string, href: string, icon: LucideIcon, module: ModuleKey | null, needs: Action | "access" = "view", also?: Tile["also"]): Tile => ({
  label,
  href,
  icon,
  module,
  needs,
  also,
});

export const SAP_MODULES: SapModule[] = [
  {
    key: "mm",
    code: "MM",
    name: "Gestión de Materiales",
    desc: "Inventario, almacén y compras",
    icon: Boxes,
    areas: [
      {
        key: "inventario",
        label: "Inventario",
        icon: Boxes,
        tiles: [
          t("Listado de Productos", "/inventario", PackageSearch, "inventario"),
          t("Nuevo Producto", "/inventario?nuevo=1", PackagePlus, "inventario", "create"),
          t("Inventario Físico", "/inventario/fisico", ScanBarcode, "inventario", "edit"),
          t("Transferencias (Histórico)", "/inventario/movimientos?tipo=transferencia_salida", ArrowLeftRight, "inventario"),
          t("Ajustes (Histórico)", "/inventario/movimientos?tipo=ajuste", ClipboardCheck, "inventario"),
          t("Kardex", "/inventario/movimientos", ScrollText, "inventario"),
          t("Lotes y Vencimientos", "/inventario/lotes", CalendarRange, "inventario"),
          t("Categorías", "/inventario/categorias", Tags, "inventario"),
          t("Ubicaciones de Almacén", "/inventario/ubicaciones", MapPin, "inventario"),
          t("Inventarios desde RLS Tools", "/inventario/conteos", Smartphone, "inventario"),
        ],
      },
      {
        key: "almacen",
        label: "Almacén",
        icon: Warehouse,
        tiles: [
          t("Recepción de Mercadería", "/compras?estado=ordenada", PackageCheck, "compras", "view", ["inventario", "edit"]),
          t("Recibos de Mercadería (Histórico)", "/inventario/movimientos?tipo=compra", History, "inventario", "view", ["compras", "view"]),
          t("Transferencias entre Tiendas", "/inventario/transferencias", Truck, "inventario"),
          t("Retornos a Proveedor", "/inventario/retornos", Undo2, "inventario"),
        ],
      },
      {
        key: "compras",
        label: "Compras",
        icon: ClipboardList,
        tiles: [
          t("Nuevo Proveedor", "/proveedores?nuevo=1", UserPlus, "proveedores", "create"),
          t("Listado de Proveedores", "/proveedores", Truck, "proveedores"),
          t("Nueva Solicitud de Pedido", "/compras/solicitudes/nueva", ClipboardPlus, "compras", "create"),
          t("Solicitudes de Pedido (Histórico)", "/compras/solicitudes", ListChecks, "compras", "view", ["proveedores", "view"]),
          t("Nueva Orden de Compra", "/compras/nueva", FilePlus2, "compras", "edit"),
          t("Órdenes de Compra (Histórico)", "/compras", FolderArchive, "compras", "view", ["proveedores", "view"]),
        ],
      },
    ],
  },
  {
    key: "sd",
    code: "SD",
    name: "Ventas y Distribución",
    desc: "Ventas, clientes y caja",
    icon: ShoppingCart,
    areas: [
      {
        key: "ventas",
        label: "Ventas",
        icon: ShoppingCart,
        tiles: [
          t("Nueva Venta", "/pos", ShoppingCart, "ventas", "create", ["caja", "create"]),
          t("Nueva Orden de Venta (Cotización)", "/cotizaciones/nueva", FilePlus2, "ventas", "create"),
          t("Órdenes de Venta (Histórico)", "/cotizaciones", FileText, "ventas", "access"),
          t("Ventas (Histórico)", "/ventas", FolderArchive, "ventas", "access"),
          t("Notas de Crédito (Anulaciones)", "/ventas?estado=anulada", FileX2, "ventas", "view"),
          t("Clientes", "/clientes", Users, "clientes"),
          t("Nuevo Cliente", "/clientes?nuevo=1", UserPlus, "clientes", "create"),
        ],
      },
      {
        key: "caja",
        label: "Caja",
        icon: Wallet,
        tiles: [
          t("Caja: Apertura y Cierre", "/caja", Wallet, "caja", "create"),
          t("Cobrar Órdenes de Venta", "/cotizaciones?estado=vigente", HandCoins, "caja", "create", ["ventas", "create"]),
          t("Cierres de Caja (Histórico)", "/caja/cierres", History, "caja", "access"),
          t("Cobrar Ventas al Crédito", "/cuentas-por-cobrar", PiggyBank, "cuentas_cobrar", "create", ["caja", "create"]),
        ],
      },
    ],
  },
  {
    key: "fi",
    code: "FI",
    name: "Finanzas",
    desc: "Contabilidad, gastos, cuentas por pagar y por cobrar",
    icon: Landmark,
    areas: [
      {
        key: "contabilidad",
        label: "Contabilidad",
        icon: BookOpenText,
        tiles: [
          t("Libro Diario", "/contabilidad", BookOpenText, "contabilidad"),
          t("Nuevo Asiento Manual", "/contabilidad/asiento", NotebookPen, "contabilidad", "create"),
          t("Libro Mayor", "/contabilidad/mayor", ScrollText, "contabilidad"),
          t("Balances", "/contabilidad/balances", Scale, "contabilidad"),
          t("Plan de Cuentas", "/contabilidad/plan", ListChecks, "contabilidad"),
          t("Periodos Contables", "/contabilidad/periodos", CalendarDays, "contabilidad"),
        ],
      },
      {
        key: "gastos",
        label: "Gastos",
        icon: BadgeDollarSign,
        tiles: [
          t("Gastos", "/finanzas", BadgeDollarSign, "finanzas"),
          t("Nuevo Gasto", "/finanzas?nuevo=1", FilePlus2, "finanzas", "create"),
          t("Estado de Resultados", "/finanzas/resultados", Landmark, "finanzas"),
        ],
      },
      {
        key: "pagar",
        label: "Cuentas por Pagar",
        icon: HandCoins,
        tiles: [
          t("Facturas de Proveedor", "/cuentas-por-pagar", HandCoins, "cuentas_pagar"),
          t("Pagos Vencidos", "/cuentas-por-pagar?estado=vencidas", Timer, "cuentas_pagar"),
        ],
      },
      {
        key: "cobrar",
        label: "Cuentas por Cobrar",
        icon: PiggyBank,
        tiles: [
          t("Cuentas por Cobrar", "/cuentas-por-cobrar", PiggyBank, "cuentas_cobrar", "view", ["finanzas", "view"]),
          t("Cobros Vencidos", "/cuentas-por-cobrar?estado=vencidas", Timer, "cuentas_cobrar", "view", ["finanzas", "view"]),
          t("Líneas de Crédito", "/cuentas-por-cobrar/lineas", CreditCard, "cuentas_cobrar", "edit"),
        ],
      },
      {
        key: "comprobantes",
        label: "Comprobantes",
        icon: Receipt,
        tiles: [t("Comprobantes Electrónicos", "/facturacion", Receipt, "facturacion")],
      },
    ],
  },
  {
    key: "co",
    code: "CO",
    name: "Controlling",
    desc: "Indicadores, reportes y centros de costo",
    icon: Target,
    areas: [
      {
        key: "control",
        label: "Control de Gestión",
        icon: Target,
        tiles: [
          t("Panel del Negocio", "/panel", LayoutDashboard, "reportes"),
          t("Reportes", "/reportes", BarChart3, "reportes"),
          t("Centros de Costo", "/contabilidad/centros", Target, "contabilidad"),
          t("Nuevo Centro de Costo", "/contabilidad/centros?nuevo=1", FilePlus2, "contabilidad", "create"),
          t("Reporte por Centro de Costo", "/contabilidad/centros/reporte", BarChart3, "contabilidad"),
        ],
      },
    ],
  },
  {
    key: "hcm",
    code: "HCM",
    name: "Recursos Humanos",
    desc: "Colaboradores, planilla y comisiones",
    icon: UsersRound,
    areas: [
      {
        key: "personal",
        label: "Personal",
        icon: UserRound,
        tiles: [
          t("Colaboradores", "/rrhh", UsersRound, "rrhh"),
          t("Nuevo Colaborador", "/rrhh?nuevo=1", UserPlus, "rrhh", "create"),
          t("Comisiones", "/rrhh/comisiones", HandCoins, "rrhh"),
          t("Pago de Planilla", "/rrhh/planilla", Banknote, "rrhh"),
        ],
      },
    ],
  },
  {
    key: "general",
    code: "BASIS",
    name: "General",
    desc: "Mis datos, preferencias, mensajes, calendario y configuración",
    icon: Settings,
    areas: [
      {
        key: "general",
        label: "General",
        icon: MonitorCog,
        tiles: [
          { ...t("Preferencias de Estación de Trabajo", "#preferencias", MonitorCog, null, "access"), action: "preferences" },
          t("Mensajes de Tienda", "/mensajes", MessageSquareWarning, null, "access"),
          t("Calendario", "/calendario", CalendarDays, null, "access"),
          t("Mis Datos", "/mis-datos", IdCard, null, "access"),
        ],
      },
      {
        key: "configuracion",
        label: "Configuración",
        icon: Settings,
        tiles: [
          t("Datos de la Empresa", "/configuracion", Factory, "configuracion"),
          t("Usuarios", "/configuracion/usuarios", Users, "configuracion"),
          t("Roles y Permisos", "/configuracion/roles", ShieldCheck, "configuracion"),
          t("Sucursales", "/configuracion/sucursales", Building2, "configuracion"),
          t("Auditoría", "/configuracion/auditoria", ScrollText, "configuracion"),
        ],
      },
    ],
  },
];

/** Módulos, áreas y mosaicos que el rol puede ver; se ocultan los que quedan vacíos. */
export function menuFor(role: string, permissions: Permissions): SapModule[] {
  const allowed = (tile: Tile) =>
    (tile.module === null || hasPermission(role, permissions, tile.module, tile.needs)) && (!tile.also || hasPermission(role, permissions, tile.also[0], tile.also[1]));
  return SAP_MODULES.map((m) => ({
    ...m,
    areas: m.areas.map((a) => ({ ...a, tiles: a.tiles.filter(allowed) })).filter((a) => a.tiles.length > 0),
  })).filter((m) => m.areas.length > 0);
}

export const launcherHref = (module?: string, area?: string) => (module ? `/?m=${module}${area ? `&a=${area}` : ""}` : "/");

/**
 * Ubica una pantalla dentro del menú (para el botón «Atrás» y la pestaña activa).
 * Gana el mosaico cuya ruta coincide más exactamente con la actual.
 */
export function locate(menu: SapModule[], pathname: string): { module: SapModule; area: Area } | null {
  let best: { module: SapModule; area: Area; score: number } | null = null;
  for (const sapModule of menu) {
    for (const area of sapModule.areas) {
      for (const tile of area.tiles) {
        const path = tile.href.split("?")[0];
        if (path.startsWith("#")) continue;
        const exact = pathname === path;
        const nested = path !== "/" && pathname.startsWith(`${path}/`);
        if (!exact && !nested) continue;
        const score = path.length + (exact ? 1000 : 0);
        if (!best || score > best.score) best = { module: sapModule, area, score };
      }
    }
  }
  return best && { module: best.module, area: best.area };
}

/**
 * Destino de «Atrás». Cada pantalla del menú es independiente: si la ruta es un
 * mosaico (ej. Kardex en /inventario/movimientos), vuelve a los mosaicos de su
 * área, aunque su ruta empiece como la de otro mosaico (Listado en /inventario).
 * Solo un detalle que no es mosaico (ej. /ventas/123) vuelve a su listado: el
 * mosaico con la ruta más larga que la contiene.
 */
export function backHref(menu: SapModule[], pathname: string, place: ReturnType<typeof locate>) {
  const paths = menu.flatMap((m) => m.areas.flatMap((a) => a.tiles.map((t) => t.href.split("?")[0]))).filter((p) => p.startsWith("/") && p !== "/");
  const isTile = paths.includes(pathname);
  const parent = isTile ? undefined : paths.filter((p) => pathname.startsWith(`${p}/`)).sort((x, y) => y.length - x.length)[0];
  if (parent) return parent;
  return place ? launcherHref(place.module.key, place.area.key) : launcherHref();
}
