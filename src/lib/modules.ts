/**
 * Registro de módulos del ERP: fuente única de verdad para el menú, los
 * accesos rápidos y la matriz de permisos. Agregar un módulo nuevo es
 * añadir una entrada aquí, su carpeta en src/modules y su ruta en src/app.
 */

export type ModuleKey = "ventas" | "facturacion" | "caja" | "clientes" | "inventario" | "compras" | "proveedores" | "finanzas" | "rrhh" | "reportes" | "configuracion";
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
      create: "Vender en el punto de venta",
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
    key: "inventario",
    label: "Inventario",
    area: "Almacén",
    actions: {
      view: "Ver catálogo, stock y kardex",
      create: "Registrar productos y categorías",
      edit: "Modificar productos, ajustar y transferir stock",
      delete: "Desactivar productos y categorías",
    },
  },
  {
    key: "compras",
    label: "Compras",
    area: "Almacén",
    actions: { view: "Ver órdenes de compra", create: "Crear órdenes", edit: "Recibir mercadería (ingresa stock)", delete: "Anular órdenes" },
  },
  {
    key: "proveedores",
    label: "Proveedores",
    area: "Almacén",
    actions: { view: "Ver el padrón", create: "Registrar proveedores", edit: "Modificar datos", delete: "Desactivar proveedores" },
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
  group: string;
  /** null = disponible para todos los usuarios activos */
  module: ModuleKey | null;
  /** "access" = basta ver o crear; o una acción concreta */
  needs: Action | "access";
};

export const NAV: NavItem[] = [
  { href: "/", label: "Panel", desc: "Resumen del negocio", icon: "dashboard", group: "General", module: null, needs: "access" },
  { href: "/pos", label: "Punto de venta", desc: "Cobrar y emitir comprobantes", icon: "pos", group: "Ventas", module: "ventas", needs: "create" },
  { href: "/ventas", label: "Ventas", desc: "Historial de comprobantes", icon: "sales", group: "Ventas", module: "ventas", needs: "access" },
  { href: "/facturacion", label: "Facturación", desc: "Comprobantes electrónicos", icon: "billing", group: "Ventas", module: "facturacion", needs: "view" },
  { href: "/caja", label: "Caja", desc: "Apertura, arqueo y cierre", icon: "cash", group: "Ventas", module: "caja", needs: "access" },
  { href: "/clientes", label: "Clientes", desc: "Padrón de clientes", icon: "customers", group: "Ventas", module: "clientes", needs: "view" },
  { href: "/inventario", label: "Inventario", desc: "Productos, stock y kardex", icon: "inventory", group: "Logística", module: "inventario", needs: "view" },
  { href: "/compras", label: "Compras", desc: "Órdenes y recepción", icon: "purchases", group: "Logística", module: "compras", needs: "view" },
  { href: "/proveedores", label: "Proveedores", desc: "Padrón de proveedores", icon: "suppliers", group: "Logística", module: "proveedores", needs: "view" },
  { href: "/finanzas", label: "Finanzas", desc: "Resultados y gastos", icon: "finance", group: "Gestión", module: "finanzas", needs: "view" },
  { href: "/rrhh", label: "Personal", desc: "Colaboradores y planilla", icon: "hr", group: "Gestión", module: "rrhh", needs: "view" },
  { href: "/reportes", label: "Reportes", desc: "Análisis y exportación", icon: "reports", group: "Gestión", module: "reportes", needs: "view" },
  { href: "/configuracion", label: "Configuración", desc: "Empresa, usuarios y roles", icon: "settings", group: "Gestión", module: "configuracion", needs: "view" },
];

/** El rol "admin" tiene acceso total por definición (igual que en la base de datos). */
export function hasPermission(role: string, permissions: Permissions, module: ModuleKey, action: Action | "access"): boolean {
  if (role === "admin") return true;
  const p = permissions[module];
  if (!p) return false;
  return action === "access" ? Boolean(p.view || p.create) : Boolean(p[action]);
}

export function navFor(role: string, permissions: Permissions) {
  return NAV.filter((n) => n.module === null || hasPermission(role, permissions, n.module, n.needs));
}
