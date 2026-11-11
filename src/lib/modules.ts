/**
 * Registro de módulos del ERP: fuente única de verdad para el menú, los
 * accesos rápidos y la matriz de permisos. Agregar un módulo nuevo es
 * añadir una entrada aquí, su carpeta en src/modules y su ruta en src/app.
 */

export type ModuleKey = "ventas" | "facturacion" | "caja" | "clientes" | "cuentas_cobrar" | "inventario" | "compras" | "proveedores" | "cuentas_pagar" | "finanzas" | "rrhh" | "reportes" | "configuracion";
export type Action = "view" | "create" | "edit" | "delete";
export type Permissions = Partial<Record<ModuleKey, Partial<Record<Action, boolean>>>>;

export const ACTIONS: { key: Action; label: string }[] = [
  { key: "view", label: "Ver" },
  { key: "create", label: "Crear" },
  { key: "edit", label: "Editar" },
  { key: "delete", label: "Eliminar" },
];

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  area: string;
  /** Qué habilita cada casilla en este módulo. Si falta, la acción no aplica. */
  actions: Partial<Record<Action, string>>;
};

export const MODULES: ModuleDef[] = [
  {
    key: "ventas",
    label: "Ventas",
    area: "Comercial",
    actions: {
      view: "Consultar los comprobantes de todos (cada quien siempre ve los suyos)",
      create: "Vender en el punto de venta y emitir cotizaciones",
      edit: "Aplicar descuentos mayores al 10 %",
      delete: "Anular ventas",
    },
  },
  {
    key: "facturacion",
    label: "Facturación",
    area: "Comercial",
    actions: {
      view: "Consultar los comprobantes electrónicos de todos (cada quien ve los de sus ventas)",
      create: "Emitir y reenviar comprobantes a SUNAT",
    },
  },
  {
    key: "caja",
    label: "Caja",
    area: "Comercial",
    actions: {
      view: "Ver los arqueos de todas las cajas",
      create: "Abrir y cerrar su propia caja, registrar ingresos y retiros",
      edit: "Operar y cerrar cajas de otros usuarios",
    },
  },
  {
    key: "clientes",
    label: "Clientes",
    area: "Comercial",
    actions: { view: "Ver el padrón", create: "Registrar clientes", edit: "Modificar datos", delete: "Desactivar clientes" },
  },
  {
    key: "cuentas_cobrar",
    label: "Cuentas por cobrar",
    area: "Comercial",
    actions: {
      view: "Ver las deudas de los clientes",
      create: "Registrar cobros a clientes",
      edit: "Conceder y modificar la línea de crédito de un cliente",
    },
  },
  {
    key: "inventario",
    label: "Inventario",
    area: "Almacén",
    actions: {
      view: "Ver catálogo, stock y kardex",
      create: "Registrar productos y categorías",
      edit: "Modificar productos, ajustar y transferir stock, recibir mercadería",
      delete: "Desactivar productos y categorías",
    },
  },
  {
    key: "compras",
    label: "Compras",
    area: "Almacén",
    actions: {
      view: "Ver solicitudes y órdenes de compra",
      create: "Crear solicitudes de pedido",
      edit: "Aprobar solicitudes, emitir órdenes y liberar facturas con diferencia",
      delete: "Anular órdenes",
    },
  },
  {
    key: "proveedores",
    label: "Proveedores",
    area: "Almacén",
    actions: { view: "Ver el padrón", create: "Registrar proveedores", edit: "Modificar datos", delete: "Desactivar proveedores" },
  },
  {
    key: "cuentas_pagar",
    label: "Cuentas por pagar",
    area: "Contabilidad",
    actions: {
      view: "Ver facturas de proveedores y saldos",
      create: "Registrar facturas de proveedor",
      edit: "Registrar pagos a proveedores",
      delete: "Anular facturas de proveedor",
    },
  },
  {
    key: "finanzas",
    label: "Finanzas",
    area: "Contabilidad",
    actions: { view: "Ver estado de resultados y gastos", create: "Registrar gastos", edit: "Modificar gastos", delete: "Eliminar gastos" },
  },
  {
    key: "reportes",
    label: "Reportes",
    area: "Contabilidad",
    actions: { view: "Ver y exportar reportes de ventas" },
  },
  {
    key: "rrhh",
    label: "Personal",
    area: "RRHH",
    actions: { view: "Ver colaboradores y sueldos", create: "Registrar colaboradores", edit: "Modificar datos y estado" },
  },
  {
    key: "configuracion",
    label: "Configuración",
    area: "Sistema",
    actions: { view: "Entrar a configuración", edit: "Cambiar empresa, sucursales, usuarios y roles" },
  },
];

export type NavItem = {
  href: string;
  label: string;
  desc: string;
  icon: string;
  /** Código de transacción (equivalente SAP): se escribe en el buscador para ir directo */
  code: string;
  group: string;
  /** null = disponible para todos los usuarios activos */
  module: ModuleKey | null;
  /** "access" = basta ver o crear; o una acción concreta */
  needs: Action | "access";
};

export const NAV: NavItem[] = [
  { href: "/", label: "Panel", desc: "Resumen del negocio", icon: "dashboard", code: "HOME", group: "General", module: null, needs: "access" },
  { href: "/pos", label: "Punto de venta", desc: "Cobrar y emitir comprobantes", icon: "pos", code: "VA01", group: "Ventas", module: "ventas", needs: "create" },
  { href: "/ventas", label: "Ventas", desc: "Historial de comprobantes", icon: "sales", code: "VA05", group: "Ventas", module: "ventas", needs: "access" },
  { href: "/cotizaciones", label: "Cotizaciones", desc: "Ofertas con precio congelado", icon: "quotes", code: "VA25", group: "Ventas", module: "ventas", needs: "access" },
  { href: "/facturacion", label: "Facturación", desc: "Comprobantes electrónicos", icon: "billing", code: "VF05", group: "Ventas", module: "facturacion", needs: "view" },
  { href: "/caja", label: "Caja", desc: "Apertura, arqueo y cierre", icon: "cash", code: "FBCJ", group: "Ventas", module: "caja", needs: "access" },
  { href: "/clientes", label: "Clientes", desc: "Padrón de clientes", icon: "customers", code: "XD03", group: "Ventas", module: "clientes", needs: "view" },
  { href: "/inventario", label: "Inventario", desc: "Productos, stock y kardex", icon: "inventory", code: "MMBE", group: "Logística", module: "inventario", needs: "view" },
  { href: "/compras", label: "Compras", desc: "Órdenes y recepción", icon: "purchases", code: "ME2N", group: "Logística", module: "compras", needs: "view" },
  { href: "/proveedores", label: "Proveedores", desc: "Padrón de proveedores", icon: "suppliers", code: "XK03", group: "Logística", module: "proveedores", needs: "view" },
  { href: "/cuentas-por-cobrar", label: "Cuentas por cobrar", desc: "Ventas al crédito y cobranza", icon: "receivables", code: "FBL5N", group: "Gestión", module: "cuentas_cobrar", needs: "view" },
  { href: "/cuentas-por-pagar", label: "Cuentas por pagar", desc: "Facturas y pagos a proveedores", icon: "payables", code: "FBL1N", group: "Gestión", module: "cuentas_pagar", needs: "view" },
  { href: "/finanzas", label: "Finanzas", desc: "Resultados y gastos", icon: "finance", code: "F.01", group: "Gestión", module: "finanzas", needs: "view" },
  { href: "/rrhh", label: "Personal", desc: "Colaboradores y planilla", icon: "hr", code: "PA20", group: "Gestión", module: "rrhh", needs: "view" },
  { href: "/reportes", label: "Reportes", desc: "Análisis y exportación", icon: "reports", code: "MCTA", group: "Gestión", module: "reportes", needs: "view" },
  { href: "/configuracion", label: "Configuración", desc: "Empresa, usuarios y roles", icon: "settings", code: "SPRO", group: "Gestión", module: "configuracion", needs: "view" },
];

/** Pantallas internas con código propio (no aparecen en el menú, sí en el buscador). */
export const SHORTCUTS: NavItem[] = [
  { href: "/cotizaciones/nueva", label: "Nueva cotización", desc: "Oferta de venta a un cliente", icon: "quotes", code: "VA21", group: "Ventas", module: "ventas", needs: "create" },
  { href: "/inventario/movimientos", label: "Kardex", desc: "Movimientos de almacén", icon: "inventory", code: "MB51", group: "Logística", module: "inventario", needs: "view" },
  { href: "/compras/solicitudes", label: "Solicitudes de pedido", desc: "Pedidos internos por aprobar", icon: "purchases", code: "ME5A", group: "Logística", module: "compras", needs: "view" },
  { href: "/compras/solicitudes/nueva", label: "Nueva solicitud de pedido", desc: "Pedir reposición de mercadería", icon: "purchases", code: "ME51N", group: "Logística", module: "compras", needs: "create" },
  { href: "/compras/nueva", label: "Nueva orden de compra", desc: "Crear pedido a proveedor", icon: "purchases", code: "ME21N", group: "Logística", module: "compras", needs: "edit" },
  { href: "/configuracion/usuarios", label: "Usuarios", desc: "Cuentas y accesos", icon: "settings", code: "SU01", group: "Gestión", module: "configuracion", needs: "view" },
  { href: "/configuracion/roles", label: "Roles y permisos", desc: "Matriz de permisos por rol", icon: "settings", code: "PFCG", group: "Gestión", module: "configuracion", needs: "view" },
  { href: "/configuracion/auditoria", label: "Auditoría", desc: "Registro de cambios", icon: "settings", code: "SM20", group: "Gestión", module: "configuracion", needs: "view" },
];

/** El rol "admin" tiene acceso total por definición (igual que en la base de datos). */
export function hasPermission(role: string, permissions: Permissions, module: ModuleKey, action: Action | "access"): boolean {
  if (role === "admin") return true;
  const p = permissions[module];
  if (!p) return false;
  return action === "access" ? Boolean(p.view || p.create) : Boolean(p[action]);
}

const allowed = (role: string, permissions: Permissions) => (n: NavItem) => n.module === null || hasPermission(role, permissions, n.module, n.needs);

export function navFor(role: string, permissions: Permissions) {
  return NAV.filter(allowed(role, permissions));
}

/** Todo lo que el usuario puede abrir por código o nombre desde el buscador. */
export function destinationsFor(role: string, permissions: Permissions) {
  return [...NAV, ...SHORTCUTS].filter(allowed(role, permissions));
}
