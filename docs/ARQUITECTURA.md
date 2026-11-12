# Arquitectura de ERP HANA4

ERP HANA4 es un **monolito modular**. Todo se despliega como una sola aplicación (Next.js en Vercel y una sola base Postgres en Supabase), pero el código está dividido en módulos de negocio con fronteras explícitas. Esas fronteras las verifica `npm run lint`.

## Capas

```
src/app        Rutas (páginas y endpoints). Son delgadas: cargan datos y componen vistas de los módulos.
src/shell      Marco de la aplicación: lanzador de mosaicos (menu.ts), barra inferior, búsqueda global y avisos.
src/modules/*  Módulos de negocio (uno por área del ERP).
src/components Kit de UI genérico: tablas, diálogos, formularios, exportación. No conoce módulos.
src/lib        Kernel compartido: sesión y permisos, registro de módulos, motor CRUD, validación, utilidades.
supabase/      Migraciones SQL: tablas, RLS, reglas de negocio transaccionales y asientos automáticos.
```

Las dependencias solo van hacia abajo: `app → shell → modules → components → lib`.

## Anatomía de un módulo

```
src/modules/<modulo>/
  actions.ts     Server Actions ("use server"): casos de uso que la UI invoca. Validan con Zod y verifican el permiso.
  schema.ts      Entidades editables (EntityDef: tabla, permiso, esquema Zod). Interno al módulo.
  types.ts       Tipos y catálogos de etiquetas del módulo. Público.
  api.ts         Servicios que otros módulos pueden llamar desde el servidor. Público.
  components/    Vistas del módulo. Internas: solo las usan las rutas de src/app.
```

### Reglas de frontera (eslint.config.mjs)

| Quién | No puede importar |
|---|---|
| `src/lib` | módulos, componentes, shell ni rutas |
| `src/components` | módulos, shell ni rutas |
| `src/shell` | rutas, ni componentes o esquemas de módulos |
| `src/modules/A` | `components/` o `schema` de otro módulo, el shell ni las rutas |

Un módulo usa otro solo a través de su superficie pública: `api.ts`, `types.ts` y `actions.ts`.

## Integración entre módulos

Casi toda la integración ocurre **en la base de datos**, dentro de una transacción. Las funciones `SECURITY DEFINER` y los triggers se encargan de ello. Ningún módulo escribe en las tablas de otro desde TypeScript.

| Evento | Efectos en la misma transacción |
|---|---|
| Venta (`create_sale`) | Descuenta stock (FEFO por lotes), registra en el kardex y en caja, crea la comisión del vendedor (RRHH), abre la cuenta por cobrar si es al crédito y genera el asiento contable |
| Recepción de compra | Ingresa stock y lotes y actualiza el costo. La factura del proveedor abre la cuenta por pagar y genera su asiento |
| Gasto | Asiento contable con centro de costo; borrarlo genera el extorno |
| Anulación | Revierte stock, caja, comisión y contabilidad (extorno) |

La única dependencia directa entre módulos en TypeScript es `ventas → facturacion/api` (la emisión del comprobante electrónico de demostración).

## Catálogo de módulos

| Módulo (carpeta) | Permiso | Rutas | Tablas que le pertenecen |
|---|---|---|---|
| ventas | `ventas` | `/pos`, `/ventas`, `/cotizaciones` | sales, sale_items, quotations, quotation_items, document_sequences |
| facturacion | `facturacion` | `/facturacion` | e_documents |
| caja | `caja` | `/caja` | cash_sessions, cash_movements |
| clientes | `clientes` | `/clientes` | customers |
| cuentas-cobrar | `cuentas_cobrar` | `/cuentas-por-cobrar` | customer_payments |
| inventario | `inventario` | `/inventario`, `/inventario/categorias`, `/inventario/movimientos`, `/inventario/lotes` | categories, products, stock, stock_movements, lots, lot_movements |
| compras | `compras` | `/compras`, `/compras/solicitudes` | purchases, purchase_items, purchase_requisitions, purchase_requisition_items |
| proveedores | `proveedores` | `/proveedores` | suppliers |
| cuentas-pagar | `cuentas_pagar` | `/cuentas-por-pagar` | supplier_invoices, supplier_payments |
| finanzas | `finanzas` | `/finanzas` | expenses |
| contabilidad | `contabilidad` | `/contabilidad/*` | accounts, accounting_periods, journal_sequences, journal_entries, journal_lines, cost_centers |
| reportes | `reportes` | `/reportes` | (solo lectura) |
| rrhh | `rrhh` | `/rrhh` | employees, commissions |
| configuracion | `configuracion` | `/configuracion/*` | company_settings, branches, profiles, roles, role_permissions, app_modules, audit_log |
| auth | (sesión) | `/login` | (Supabase Auth) |

El registro central está en `src/lib/modules.ts`. Ahí se definen las claves de permiso, las acciones, el menú y los códigos de transacción estilo SAP.

## Seguridad

- **Permisos:** se revisan dos veces. Las Server Actions llaman a `can(modulo, accion)`, y Postgres vuelve a exigir el permiso con RLS (`public.can()`).
- **Funciones internas:** las funciones de negocio que empiezan con `_` no se pueden ejecutar desde el cliente.
- **Auditoría:** `audit_log` es inmutable: los usuarios solo pueden leerla, y las funciones del sistema son las únicas que agregan registros.

## Cómo agregar un módulo

1. Escribe la migración `supabase/migrations/NNNN_*.sql` con las tablas, la RLS basada en `can('<clave>', ...)` y una fila en `app_modules`. Sube `schema_version`.
2. Agrega la clave en `src/lib/modules.ts` (`MODULES` y `NAV`) y sube `REQUIRED_SCHEMA` en `src/lib/auth.ts`.
3. Crea `src/modules/<modulo>/` con `actions.ts`, `types.ts` y `components/`. Las entidades CRUD simples se declaran en `schema.ts` y usan `crudSave`, `crudSetActive` y `crudDelete` de `@/lib/crud/engine`.
4. Agrega las rutas en `src/app/(app)/<ruta>/page.tsx`.

## Límites actuales

Las tablas viven todas en el esquema `public` de Postgres. La propiedad de cada tabla se define en el catálogo de arriba y no con un esquema SQL por módulo, porque la integración transaccional (venta → stock → contabilidad) usa claves foráneas entre módulos. Separar esquemas por módulo es un paso posible a futuro y no cambia el código de la aplicación.
