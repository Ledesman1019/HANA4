# ERP HANA4

Sistema de gestión para empresas de venta minorista. Unifica **ventas, caja, inventario, compras, finanzas y personal** en una sola aplicación, con roles configurables y permisos por módulo.

## Módulos

| Área | Qué hace |
|---|---|
| **Panel** | Ventas del día y de la semana, ticket promedio, utilidad, stock por reponer, últimas ventas. |
| **Punto de venta** | Catálogo con fotos, búsqueda, lector de código de barras (USB o cámara), descuentos, boleta/factura/ticket, efectivo/tarjeta/Yape/Plin, vuelto, comprobante imprimible. |
| **Ventas** | Historial con filtros, detalle del comprobante, anulación con devolución de stock. |
| **Facturación** | Comprobantes electrónicos en **modo demo**: boleta, factura y nota de crédito con validación, constancia, XML, QR e importe en letras. |
| **Caja** | Apertura, ingresos y retiros, arqueo y cierre con diferencia, historial de cierres. |
| **Clientes** | Padrón con DNI/RUC validado. |
| **Inventario** | Catálogo con fotos, stock por sucursal, alertas de mínimo, ajustes por conteo, transferencias entre sucursales, kardex. |
| **Compras** | Órdenes de compra, sugerencia por stock bajo, recepción con costo promedio ponderado. |
| **Proveedores** | Padrón de proveedores. |
| **Finanzas** | Estado de resultados mensual y registro de gastos por categoría. |
| **Personal** | Colaboradores, cargos, estado y planilla mensual. |
| **Reportes** | Ventas por día, categoría, medio de pago, vendedor y sucursal; top de productos; exportación CSV. |
| **Configuración** | Empresa, impuesto y moneda, sucursales, usuarios, **roles y matriz de permisos**. |

Además:

- **Exportación** de cada listado a Excel (.xlsx con formato y totales), PDF (con encabezado de la empresa y numeración de páginas), CSV e impresión.
- **Aplicación instalable (PWA)**: se instala en el celular o la PC desde el menú de usuario, con ícono propio y accesos directos. Sin conexión muestra un aviso en lugar de datos desactualizados.
- **Avisos con sonido**: stock agotado o bajo, compras por recibir, caja abierta de más y comprobantes sin aceptar. El sonido se silencia desde la campana.
- Búsqueda global (`Ctrl K`), modo claro/oscuro y diseño adaptable a celular.

## Facturación electrónica (modo demo)

Al cobrar una boleta o factura se genera su comprobante electrónico y se «envía»; al anular la venta se emite la nota de crédito. El flujo, los estados (pendiente, aceptado, rechazado), el XML con estructura UBL 2.1 y la representación impresa con QR son los reales.

**Lo que es simulado:** la respuesta de SUNAT. El proveedor demo aplica las validaciones más comunes (RUC del emisor, RUC del cliente en facturas, totales) y responde como una constancia, pero no envía nada fuera del sistema ni firma el XML. **Los documentos no tienen validez tributaria.**

**Para pasar a real:** implementar la interfaz `BillingProvider` de [`src/modules/facturacion/provider.ts`](src/modules/facturacion/provider.ts) contra un PSE/OSE (Nubefact, Efact u otro) y seleccionarlo con la variable `BILLING_PROVIDER`. Tablas, estados, pantallas y permisos no cambian. Hace falta además el certificado digital y el alta de la empresa como emisor electrónico.

## Roles y permisos

Los permisos se asignan al **rol**, no a la persona: si mañana entran 20 vendedores, se configura un rol una vez.

- **Configuración → Roles y permisos** muestra la matriz: por cada módulo, qué puede **Ver, Crear, Editar y Eliminar** cada rol. Se pueden crear roles propios (por ejemplo, «Supervisor de Ventas»).
- Roles base: Administrador, Gerente, Vendedor, Almacenero y Contador.
- Salvaguardas:
  - El Administrador siempre tiene acceso total y **nunca puede quedar el sistema sin un administrador activo**. La pantalla de usuarios avisa cuando solo hay uno.
  - Nadie puede modificar los permisos de su propio rol ni cambiarse de rol.
  - Solo un administrador puede crear o editar a otro administrador.
- Los permisos se aplican **en la base de datos** (Row Level Security y funciones SQL), no solo en la interfaz: ocultar un botón no es la protección, es la comodidad.

## Arquitectura: monolito modular

Una sola aplicación desplegable, dividida en módulos de negocio con fronteras claras.

```
src/
  app/                      Rutas (capa de composición: páginas delgadas)
    (app)/<módulo>/page.tsx   lee datos y arma la pantalla
    api/                      búsqueda global y avisos
  modules/                  Un directorio por módulo de negocio
    ventas/     actions.ts · components/
    facturacion/ actions.ts · service.ts · provider.ts · xml.ts · components/
    caja/       actions.ts · components/
    inventario/ actions.ts · schema.ts · components/
    compras/    actions.ts · components/
    clientes/ proveedores/ finanzas/ rrhh/   schema.ts · components/
    reportes/   components/
    configuracion/  actions.ts · schema.ts · components/
    auth/       actions.ts · components/
  lib/                      Núcleo compartido
    modules.ts                registro de módulos, menú y significado de cada permiso
    auth.ts                   sesión, contexto y verificación de permisos
    crud/                     motor CRUD genérico (cada módulo declara su schema.ts)
    validation.ts             validaciones reutilizables
  components/               Kit de interfaz compartido (tabla, modal, buscador, lector…)
supabase/migrations/        Esquema, funciones transaccionales y políticas
```

Reglas de dependencia: un módulo usa `lib/` y `components/`, nunca el interior de otro módulo. Para agregar un módulo: una entrada en `lib/modules.ts`, su carpeta en `modules/` y su ruta en `app/`.

### Transacciones

Las operaciones críticas son **funciones de PostgreSQL**, atómicas y con bloqueo de filas:

- **Venta**: descuenta stock, escribe kardex, suma a la caja y numera el comprobante. Si falta stock de un solo producto, no se guarda nada.
- **Recepción de compra**: ingresa stock y recalcula el costo promedio.
- **Anulación**: devuelve stock y sale de caja y reportes.
- **Guardar un rol**: reemplaza toda su matriz de permisos de una vez.

Los precios y totales se calculan en la base de datos; el navegador nunca los envía.

### Rendimiento

- Cada página resuelve sesión, perfil, permisos, empresa y sucursales en **una sola consulta**.
- El marco de la aplicación se sirve estático y los datos llegan por streaming; la navegación entre módulos no recarga el menú.
- El punto de venta filtra el catálogo en memoria: buscar y agregar productos no hace peticiones.
- Las fotos se reducen en el navegador (640 px, WebP, ~40 KB) antes de subirse.
- Para la menor latencia, crea el proyecto de Supabase y el de Vercel en la **misma región**.

## Tecnología

- **Next.js 16** (App Router, Server Components, Server Actions) + **TypeScript**
- **Supabase**: PostgreSQL, autenticación, almacenamiento y Row Level Security
- **Tailwind CSS 4**, Recharts, Zod, ZXing (lector de códigos)
- Despliegue en **Vercel**

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta en orden:
   1. [`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql)
   2. [`supabase/migrations/0002_roles_permisos_imagenes.sql`](supabase/migrations/0002_roles_permisos_imagenes.sql)
   3. [`supabase/migrations/0003_facturacion_demo.sql`](supabase/migrations/0003_facturacion_demo.sql)
3. En **Authentication → Sign In / Providers**, desactiva **Allow new users to sign up**. Las cuentas se crean desde el sistema.

### 2. Variables de entorno

Copia `.env.example` como `.env.local` y completa las tres claves (Supabase → Project Settings → API).

### 3. Ejecutar en local

```bash
npm install
npm run dev
```

Abre <http://localhost:3000>. La primera vez, el asistente (`/setup`) indica qué paso falta y luego pide crear la cuenta del administrador.

### 4. Datos de demostración (opcional)

Con el administrador ya creado, ejecuta [`supabase/seed.sql`](supabase/seed.sql). **No lo ejecutes sobre datos reales.**

### 5. Desplegar en Vercel

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa este repositorio.
2. En **Environment Variables** agrega las tres variables de `.env.local`.
3. Despliega. Cada `git push` a `main` publica una nueva versión.

## Alcance y límites

- La facturación electrónica está en **modo demo**: no envía nada a SUNAT y sus comprobantes no tienen validez tributaria (ver arriba cómo pasar a real).
- La PWA no trabaja sin conexión: vender requiere internet para validar stock y caja en el servidor.
- Los precios de venta incluyen impuesto; los costos de compra se registran sin impuesto.
- La planilla es un registro de sueldos: no calcula boletas de pago, AFP ni beneficios.
- El lector por cámara necesita HTTPS (Vercel lo da) y permiso de cámara en el navegador.
