# ERP HANA4

Sistema de gestión para empresas de venta minorista. Unifica **ventas, caja, inventario, compras, finanzas y personal** en una sola aplicación, con roles configurables y permisos por módulo.

## Módulos

| Área | Qué hace |
|---|---|
| **Panel** | Ventas del día y de la semana, ticket promedio, utilidad, stock por reponer, últimas ventas. |
| **Punto de venta** | Catálogo con fotos, búsqueda, lector de código de barras (USB o cámara), descuentos, boleta/factura/ticket, efectivo/tarjeta/Yape/Plin, vuelto, comprobante imprimible. |
| **Ventas** | Historial con filtros, detalle del comprobante, anulación con devolución de stock. Ventas al contado o al crédito. |
| **Cotizaciones** | Ofertas al cliente con precio congelado y vigencia; se convierten en venta con un clic. |
| **Cuentas por cobrar** | Ventas al crédito, línea de crédito por cliente, cobros parciales, antigüedad de la deuda. |
| **Facturación** | Comprobantes electrónicos en **modo demo**: boleta, factura y nota de crédito con validación, constancia, XML, QR e importe en letras. |
| **Caja** | Apertura, ingresos y retiros, arqueo y cierre con diferencia, historial de cierres. |
| **Clientes** | Padrón con DNI/RUC validado. |
| **Inventario** | Catálogo con fotos, stock por sucursal, alertas de mínimo, ajustes por conteo, transferencias entre sucursales, kardex. |
| **Compras** | Ciclo completo de aprovisionamiento: solicitud de pedido, aprobación, orden de compra, recepción con costo promedio ponderado. |
| **Cuentas por pagar** | Facturas de proveedor verificadas contra la orden, bloqueo por diferencias, pagos totales o parciales, vencimientos. |
| **Proveedores** | Padrón de proveedores. |
| **Finanzas** | Estado de resultados mensual y registro de gastos por categoría. |
| **Lotes y vencimientos** | Productos perecibles con lote y fecha de vencimiento; la venta sale por FEFO y nunca toma mercadería vencida. |
| **Centros de costo** | Resultado por sucursal (centro de beneficio) y gasto por área (administración, ventas, logística o los que crees). |
| **Contabilidad** | Plan de cuentas (PCGE), asientos automáticos de cada operación, libro diario, libro mayor, balance de comprobación, estado de resultados, situación financiera, asientos manuales y cierre de periodos. |
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
- **Super Administrador** (el dueño o TI): es el único que puede nombrar, modificar o retirar administradores. Un administrador normal opera todo, pero no puede tocar a otro administrador ni concederse ese nivel. Nunca puede quedar el sistema sin un Super Administrador activo.
- **Mínimo privilegio:** los roles base traen solo lo necesario (un vendedor no ve costos, sueldos ni finanzas) y nadie puede modificar los permisos de su propio rol ni cambiarse de rol.
- **Auditoría** (Configuración → Auditoría): queda registrado quién y cuándo concedió o quitó cada permiso, cambió un rol, creó o desactivó un usuario, restableció una contraseña, anuló una venta, ajustó stock, cerró caja con diferencia o cambió un sueldo. El registro lo escribe la base de datos y **nadie puede editarlo ni borrarlo**.
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

### Áreas conectadas

Una venta en el punto de venta, en una sola transacción:

1. descuenta el **inventario** y escribe el kardex,
2. suma a la **caja** del vendedor,
3. genera el **comprobante electrónico** (facturación),
4. genera la **comisión** del vendedor en **Personal**,
5. alimenta **finanzas** y **reportes**.

Si la venta se anula, todo se revierte: vuelve el stock, se emite la nota de crédito, se anula la comisión y queda en la auditoría.

### Ciclo de compras (modelo SAP MM)

```
Solicitud de pedido → Aprobación → Orden de compra → Recepción → Factura del proveedor → Pago
      ME51N             ME54N          ME21N           MIGO            MIRO              F110
```

Cada paso lo hace un rol distinto (separación de funciones):

| Paso | Quién | Permiso |
|---|---|---|
| Solicitar mercadería | Cualquier área | Compras · Crear |
| Aprobar y emitir la orden | Compras | Compras · Editar |
| Recibir la mercadería | Almacén | Inventario · Editar |
| Registrar la factura | Contabilidad | Cuentas por pagar · Crear |
| Pagar | Tesorería | Cuentas por pagar · Editar |

Controles: nadie aprueba su propia solicitud; una factura cuyo importe difiere de la orden más del 1 % queda **bloqueada para pago** hasta que Compras la libere; no se factura lo que no se recibió ni se paga más que el saldo. Cada orden muestra su **flujo de documentos** con el paso en que se encuentra.

### Ciclo comercial (modelo SAP SD)

```
Cotización → Venta (contado o crédito) → Comprobante → Cobro
  VA21            VA01                     VF01         F-28
```

- **Cotización:** congela los precios del día durante su vigencia (1 a 90 días). Al convertirla en venta se respetan esos precios aunque la lista haya cambiado.
- **Crédito:** solo a clientes con línea asignada. Antes de vender se verifica que la venta no supere el disponible y que el cliente no tenga deuda vencida. Solo quien tiene Cuentas por cobrar · Editar asigna o cambia una línea, y queda en la auditoría.
- **Cobro:** total o parcial. En efectivo entra a la caja abierta de quien cobra, así el arqueo cuadra. Una venta al crédito con cobros no se puede anular.

### Contabilidad (modelo SAP FI)

Cada operación genera su asiento en el mismo instante en que se registra, dentro de la misma transacción: si el asiento no cuadra, la operación no se guarda.

| Operación | Asiento |
|---|---|
| Venta al contado | Caja o bancos / Ventas + IGV; y Costo de ventas / Mercaderías |
| Venta al crédito | Cuentas por cobrar / Ventas + IGV; y su costo |
| Cobro a cliente | Caja o bancos / Cuentas por cobrar |
| Recepción de compra | Mercaderías / Mercadería recibida por facturar |
| Factura de proveedor | Recibido por facturar + IGV (crédito fiscal) / Cuentas por pagar; la diferencia con la orden va a resultados |
| Pago a proveedor | Cuentas por pagar / Caja o bancos |
| Gasto | Cuenta de gasto según categoría / Caja o bancos |
| Comisión | Comisiones / Remuneraciones por pagar |
| Merma o sobrante de inventario, diferencia de caja | Contra otros gastos u otros ingresos de gestión |

Una anulación genera el **extorno** (asiento inverso); nada se borra. Al cerrar un mes, nadie puede registrar operaciones con fecha de ese mes. La migración contabiliza también el historial existente.

No se contabilizan solos los ingresos y retiros manuales de caja ni las transferencias entre sucursales: el contador los registra con un asiento manual si corresponde.

### Lotes y vencimientos

Se activan por producto (Inventario → editar → «Controla lote y fecha de vencimiento»). Desde entonces:

- Al recibir una compra se pide el **lote y el vencimiento**; no se recibe mercadería ya vencida.
- La venta toma primero lo que **vence antes (FEFO)** y **nunca vende un lote vencido**: si solo queda stock vencido, la venta se bloquea con el motivo.
- Las anulaciones devuelven al mismo lote; las transferencias llevan el lote y su vencimiento a la otra sucursal; los ajustes a la baja retiran primero lo vencido.
- Pantalla **Lotes y vencimientos** (`MB5M`) y avisos en la campana por lotes vencidos o que vencen en 30 días.

### Centros de costo

Cada línea de gasto del libro diario lleva su centro de costo: los gastos lo eligen (o lo toman de su categoría), las comisiones y el costo de ventas van a Ventas, las mermas a Logística. La pantalla **Centros de costo** (`KSB1`) muestra el resultado de cada sucursal y el gasto de cada área.

### Códigos de transacción

Cada pantalla tiene un código al estilo SAP que se escribe en el buscador (`Ctrl K`) para ir directo: `VA01` vender, `VA05` ventas, `VF05` facturación, `MMBE` stock, `MB51` kardex, `ME51N` nueva solicitud, `ME5A` solicitudes, `ME21N` nueva orden, `ME2N` órdenes, `FBL1N` cuentas por pagar, `VA21` nueva cotización, `VA25` cotizaciones, `FBL5N` cuentas por cobrar, `FB03` libro diario, `FAGLL03` libro mayor, `F.08` balances, `FS00` plan de cuentas, `FB50` asiento manual, `OB52` periodos, `MB5M` lotes y vencimientos, `KSB1` centros de costo, `FBCJ` caja, `PA20` personal, `SU01` usuarios, `PFCG` roles, `SM20` auditoría.

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
   4. [`supabase/migrations/0004_superadmin_auditoria_comisiones.sql`](supabase/migrations/0004_superadmin_auditoria_comisiones.sql)
   5. [`supabase/migrations/0005_ciclo_compras_cuentas_por_pagar.sql`](supabase/migrations/0005_ciclo_compras_cuentas_por_pagar.sql)
   6. [`supabase/migrations/0006_cotizaciones_credito_cuentas_por_cobrar.sql`](supabase/migrations/0006_cotizaciones_credito_cuentas_por_cobrar.sql)
   7. [`supabase/migrations/0007_contabilidad.sql`](supabase/migrations/0007_contabilidad.sql)
   8. [`supabase/migrations/0008_lotes_centros_costo.sql`](supabase/migrations/0008_lotes_centros_costo.sql)
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
