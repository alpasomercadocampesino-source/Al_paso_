# Arquitectura Replicable — Marca Blanca

**Producto base:** Fruver Engine Suite (instancia original: Al Paso — Mercado Campesino)
**Fecha:** 10 de septiembre de 2026
**Modelo:** una instancia y una base de datos por cliente (single-tenant)

---

## 0. Diagnóstico: qué tan replicable es hoy

Antes de las recetas, la medición real sobre el código.

| Capa | Estado | Trabajo para un cliente nuevo |
|---|---|---|
| **Colores y tipografía** | ✅ **Ya resuelto** | `src/index.css` redefine las 5 escalas completas en un bloque `@theme` de 94 líneas. Las 505 clases `emerald-*` del código toman su color de ahí. Cambiar la identidad visual entera = editar un archivo. |
| **Núcleo funcional** | ✅ Reutilizable tal cual | Sesiones, roles, alcance por sucursal, motor de sincronización, respaldos. No se toca. |
| **Textos de marca** | ⚠️ Disperso | 66 apariciones: 27 «Al Paso», 7 «Mercado Campesino», 1 «SURTIFRUVER», 4 «Fruver», 22 llaves `alpaso_*` en el navegador, 5 referencias al logo. Extracción mecánica. |
| **Región y moneda** | ⚠️ Disperso | 29 apariciones de `COP`, `es-CO`, `America/Bogota`. |
| **Datos iniciales** | 🔴 **Bloqueante** | `server/db.ts` trae sembrados 288 productos, 14 proveedores con celular, 8 usuarios **con contraseña en texto plano** y 9 empleados **con cédula y celular reales**. |
| **Vocabulario del rubro** | ⛔ No configurable, y está bien | 237 «merma», 170 «canastilla», 138 «bulto», 65 «plaza». Esto define el vertical. |

### 0.1 El bloqueante, explícito

`server/db.ts` contiene datos personales de empleados de Al Paso: nombres
completos, **cédulas** y celulares. Entregar este repositorio a otro cliente —
o a un desarrollador externo — es entregar esa información. En Colombia eso
cae bajo la Ley 1581 de 2012 (Habeas Data).

**Antes de vender la primera copia, hay que sacar los datos sembrados del
código fuente.** La receta está en la sección 2.4.

### 0.2 Qué se puede vender y qué no

El producto **no** es un ERP genérico. Es un sistema para **cadenas de fruver y
minimercados con varios puntos, un comprador de plaza y cierre de caja diario**.
Ese es el vertical, y ahí la replicación es real.

Venderlo a una ferretería o una farmacia no es configurar: es reescribir. Las
canastillas, los bultos, las mermas por peso y la compra en plaza son el
producto, no la decoración.

### 0.3 Una regla que decide todo lo demás

> **Un solo repositorio. Configuración por cliente. Nunca forks.**

`AdminDashboard.tsx` tiene 11.073 líneas. Si cada cliente tiene su copia del
código, cada corrección de error hay que aplicarla a mano en cada copia, y a
los tres clientes el negocio se vuelve ingobernable. Una rama por cliente con
solo su archivo de configuración; el código es uno.

---

## 1. Core / Núcleo — no se modifica entre clientes

### 1.1 Identidad y acceso

- Inicio de sesión con contraseña cifrada (bcrypt, 10 rondas), migración automática desde texto plano.
- Sesión firmada con HMAC-SHA256, 30 días, comparación de tiempo constante.
- Freno a la fuerza bruta: 8 intentos por usuario y dirección, ventana de 15 minutos.
- **Cuatro roles fijos:** `Admin`, `AdminSucursal`, `Comprador`, `Sucursal`.
- Verificación de rol en cada operación que mueve dinero, precios o nómina.

> Los roles **no** son configurables. Son el modelo del negocio: quien vende,
> quien compra en plaza, quien administra y quien administra un solo punto.
> Un cliente que necesite un rol distinto necesita desarrollo, no configuración.

### 1.2 Alcance por sucursal

- `puedeVerSucursal()` y `filtrarPorSucursal()` en el servidor, nunca solo en pantalla.
- Aislamiento bidireccional: una sucursal con administrador propio desaparece también de los totales del administrador general.
- El comprador es la excepción explícita: ve todas.
- La lista de sucursales **siempre** viene del servidor, ya filtrada por rol.

### 1.3 Motor de datos

- PostgreSQL como fuente de la verdad; copia completa en memoria en el servidor.
- Escritura **fila por fila** (`INSERT … ON CONFLICT (client_id) DO UPDATE`). Nunca reemplazo de tabla.
- Nada se borra por omisión; los borrados son explícitos.
- Cuatro reintentos con espera creciente y reversión en memoria si fallan.
- 17 tablas fijas.

### 1.4 Operación

- Respaldo automático diario, 30 versiones, descargable.
- Chequeo de salud que compara memoria contra base de datos.
- Bitácora de sincronización.
- Chequeo de compilación que impide volver a escribir sucursales fijas en el código.

### 1.5 Flujo de negocio

Este es el corazón funcional y es lo que se está vendiendo:

1. La sucursal **pide** sobre el catálogo.
2. El comprador ve la **matriz consolidada** por proveedor y compra en plaza.
3. La sucursal **cierra caja**: efectivo contado más gastos de caja menor.
4. El efectivo queda **pendiente de recoger** en la tienda.
5. El comprador **recauda**, total o parcialmente.
6. El dinero entra a la **Caja Central** y de ahí salen los pagos de plaza y la nómina.

Ningún cliente del vertical cambia este flujo. Es el producto.

---

## 2. Capa de personalización

### 2.1 Lo que ya funciona: `src/index.css`

El bloque `@theme` de Tailwind v4 redefine las escalas de color como variables
CSS. Todo el código usa esos nombres, así que redefinirlos re-pinta la
aplicación completa.

**Cinco escalas, cinco papeles:**

| Escala | Papel | Cuántas veces se usa |
|---|---|---|
| `slate` | Neutro: fondos, texto, bordes | 2.470 |
| `emerald` | Acento de marca: acciones, éxito | 505 |
| `rose` | Error y alerta | 206 |
| `indigo` | Acento secundario | 199 |
| `amber` | Advertencia | 172 |

Para un cliente nuevo solo se sustituyen los valores. Ejemplo con acento azul:

```css
@theme {
  --font-sans: "Outfit", ui-sans-serif, system-ui, sans-serif;

  /* Acento del cliente — sustituir las 13 paradas */
  --color-emerald-50:  #eff6ff;
  --color-emerald-100: #dbeafe;
  --color-emerald-150: #cfe2fe;
  --color-emerald-200: #bfdbfe;
  --color-emerald-300: #93c5fd;
  --color-emerald-400: #60a5fa;
  --color-emerald-500: #3b82f6;
  --color-emerald-550: #2f76ef;
  --color-emerald-600: #2563eb;
  --color-emerald-700: #1d4ed8;
  --color-emerald-800: #1e40af;
  --color-emerald-900: #1e3a8a;
  --color-emerald-950: #172554;
}
```

**Importante:** el nombre `emerald` se queda aunque el color sea azul. Es el
nombre del *papel*, no del color. Renombrarlo obligaría a tocar 505 clases.

**Las paradas intermedias** (`150`, `450`, `550`, `650`, `750`, `850`) hay que
definirlas: el código las usa y Tailwind no las trae de fábrica. Si faltan, esos
elementos no pintan nada.

### 2.2 Lo que falta crear: `config/cliente.ts`

Este archivo **todavía no existe**. Es el trabajo principal de la capa de
personalización, y recoge las 95 apariciones dispersas de marca y región.

```ts
// config/cliente.ts — lo único que cambia entre clientes, junto con index.css

export const CLIENTE = {
  /** Identificador corto, sin espacios. Prefija las llaves del navegador. */
  id: "alpaso",

  marca: {
    nombre: "Al Paso",
    razonSocial: "Al Paso — Mercado Campesino",
    encabezadoOrden: "SURTIFRUVER / MERCADO CAMPESINO",
    logo: "/marca/logo.png",
    lemaOrden: "DESGLOSE OFICIAL DE PEDIDO POR SUCURSALES - LISTO PARA REPARTO",
    piePagina: "Generado automáticamente por Fruver Engine Suite",
  },

  regional: {
    locale: "es-CO",
    moneda: "COP",
    simbolo: "$",
    decimales: 0,
    zonaHoraria: "America/Bogota",
  },

  /** Qué pantallas ve este cliente. Apagar una la quita del menú. */
  modulos: {
    canastillas: true,
    nomina: true,
    mermas: true,
    preciosNuevos: true,
    correoPedidos: true,
    adminPorSucursal: true,
  },

  operacion: {
    baseCajaPorDefecto: 150_000,
    montoAlertaPorDefecto: 500_000,
    factorBultoPorDefecto: 56,        // kilos por bulto
    factorCanastillaPorDefecto: 22,   // kilos por canastilla
    diasDeSesion: 30,
    respaldosAConservar: 30,
  },
} as const;
```

**Cómo se consume.** Tres sustituciones mecánicas sobre el código actual:

```ts
// Antes
<img src="/logo_al_paso.png" alt="Al Paso" />
localStorage.getItem("alpaso_token")
new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })

// Después
<img src={CLIENTE.marca.logo} alt={CLIENTE.marca.nombre} />
localStorage.getItem(`${CLIENTE.id}_token`)
new Date().toLocaleDateString("en-CA", { timeZone: CLIENTE.regional.zonaHoraria })
```

### 2.3 Archivos por cliente

```
config/
  cliente.ts             ← identidad, región, módulos, parámetros
public/marca/
  logo.png               ← logo del cliente
src/
  index.css              ← las cinco escalas de color y las tipografías
seeds/
  <id-cliente>.json      ← catálogo, proveedores y usuarios iniciales
.env                     ← credenciales de su base de datos (nunca al repositorio)
```

Cinco archivos. Todo lo demás es el núcleo compartido.

### 2.4 Sacar los datos del cliente del código fuente

**Esto hay que hacerlo antes de vender la primera copia.** Hoy `server/db.ts`
trae los datos de Al Paso escritos en el código.

1. Exportar lo sembrado a `seeds/alpaso.json`, con la forma:
   ```json
   {
     "usuarios":    [{ "Usuario": "…", "Rol": "Admin" }],
     "sucursales":  ["…"],
     "productos":   [{ "Codigo": "…", "Producto": "…", "Medida": "…" }],
     "proveedores": [{ "Proveedor": "…", "Celular": "…" }]
   }
   ```
2. **Borrar de `server/db.ts`** `USER_SEED`, `PRODUCT_SEED_RAW`, `PROVIDER_SEED` y `RATES_SEED`.
3. Cargar desde `seeds/${CLIENTE.id}.json` en el primer arranque, solo si la tabla está vacía.
4. **Nunca sembrar contraseñas.** El primer arranque genera una contraseña temporal por usuario, la escribe una sola vez en el registro del servidor y obliga a cambiarla al entrar.
5. **Nunca sembrar empleados.** Las cédulas se cargan desde el panel de nómina del propio cliente.

### 2.5 Lo que no se debe hacer configurable

| Tentación | Por qué no |
|---|---|
| Roles configurables | Todo el filtrado por sucursal cuelga de los cuatro roles. Volverlos datos multiplica los caminos a probar. |
| Esquema de base de datos por cliente | Rompe la migración compartida. Cualquier corrección tendría que escribirse N veces. |
| Fórmulas de caja configurables | La conciliación es el corazón contable. Un cliente que la necesite distinta necesita desarrollo. |
| Vocabulario del rubro | Renombrar «canastilla» toca 170 sitios y no convierte el producto en otra cosa. |

---

## 3. Guía de despliegue rápido

**Tiempo real.** El primero, con la capa de configuración ya construida:
2 a 3 horas. Los siguientes: **45 a 90 minutos**. La mayor parte es cargar el
catálogo del cliente, no técnica.

### Paso 1 — Base de datos (10 min)

1. En Supabase, crear un proyecto nuevo. Región más cercana al cliente.
2. Guardar la contraseña de la base **en un gestor de contraseñas**, no en un chat.
3. Copiar las credenciales del **Session Pooler** (no la conexión directa):
   `aws-0-<region>.pooler.supabase.com`, puerto `5432`, usuario `postgres.<ref>`.

### Paso 2 — Rama del cliente (5 min)

```bash
git checkout -b cliente/<id-cliente>
```

Solo cambian los cinco archivos de la sección 2.3. **Nunca** se toca el núcleo
en una rama de cliente: si hace falta, va a `main` y se propaga a todas.

### Paso 3 — Identidad visual (20 min)

1. `public/marca/logo.png` — PNG con fondo transparente, alto mínimo 170 px.
2. `src/index.css` — sustituir las 13 paradas de `emerald` y, si el cliente
   tiene un neutro propio, las 17 de `slate`.
3. `config/cliente.ts` — nombre, razón social, región y módulos.

### Paso 4 — Datos iniciales (20–40 min)

`seeds/<id-cliente>.json` con sus sucursales, su catálogo y sus proveedores.
El catálogo suele venir en Excel: convertir a JSON con el formato de 2.4.

### Paso 5 — Servicio (15 min)

```bash
railway init
railway link
```

Variables de entorno:

```bash
AUTH_SECRET=<openssl rand -hex 32>    # 64 caracteres, único por cliente
SQL_HOST=aws-0-<region>.pooler.supabase.com
SQL_USER=postgres.<ref-del-proyecto>
SQL_PASSWORD=<contraseña de la base>
SQL_DB_NAME=postgres
SMTP_USER=<correo del cliente>        # solo si correoPedidos está activo
```

> `AUTH_SECRET` **debe ser distinta en cada cliente**. Compartirla haría que la
> sesión de un cliente sirviera en el sistema de otro.

```bash
railway up
```

El primer arranque crea las 17 tablas y siembra desde el archivo del cliente.

### Paso 6 — Verificación (10 min)

No se entrega sin estas seis comprobaciones:

1. `GET /api/health` responde `OK` y lista las 17 tablas.
2. Entra el administrador y ve su marca, no la de Al Paso.
3. Las sucursales del cliente salen en la Planilla de Compras.
4. Una sucursal registra un cierre de prueba y aparece en el panel del comprador.
5. Una sesión de sucursal **no** puede cambiar un precio (debe dar 403).
6. Se genera un respaldo manual y se descarga.

Después, borrar el cierre de prueba y **reiniciar el servicio** — si no, la
copia en memoria vuelve a escribirlo.

### Paso 7 — Entrega (15 min)

1. Cambiar todas las contraseñas temporales delante del cliente.
2. Entregar el manual técnico con su nombre.
3. Registrar en la bitácora interna: cliente, referencia de Supabase, servicio de Railway, fecha.

### Lista de verificación

```
[ ] Proyecto de Supabase creado, credenciales en el gestor
[ ] Rama cliente/<id> creada desde main
[ ] logo.png en public/marca/
[ ] index.css con las escalas del cliente
[ ] config/cliente.ts completo
[ ] seeds/<id>.json con sucursales, catálogo y proveedores
[ ] AUTH_SECRET único generado
[ ] Variables cargadas en Railway
[ ] Primer despliegue correcto
[ ] Las seis verificaciones del paso 6
[ ] Contraseñas cambiadas con el cliente presente
[ ] Manual entregado
[ ] Anotado en la bitácora interna
```

---

## 4. Prompt generador

Para usar con cualquier IA cuando llegue un cliente nuevo. Devuelve los
fragmentos exactos listos para pegar.

````
Actúa como el ingeniero de despliegue de un producto SaaS de marca blanca
llamado Fruver Engine Suite: un sistema de gestión para cadenas de fruver y
minimercados con varios puntos de venta, un comprador de plaza y cierre de
caja diario.

Está construido con React 18, Vite, Tailwind v4 (configuración por CSS con
@theme), Express en TypeScript y PostgreSQL.

Voy a darte los datos de un cliente nuevo. Devuélveme EXACTAMENTE tres
bloques de código, sin explicaciones intermedias, listos para pegar.

═══ DATOS DEL CLIENTE ═══
Nombre comercial: [NOMBRE]
Razón social:     [RAZÓN SOCIAL]
Identificador:    [ID en minúsculas, sin espacios ni tildes]
Color de acento:  [HEX]
Color neutro:     [HEX o "cálido" / "frío"]
Color de error:   [HEX, o "derivar del acento"]
País y moneda:    [ej. Colombia, COP]
Módulos activos:  [canastillas, nómina, mermas, precios nuevos, correo, admin por sucursal]
Sucursales:       [lista de nombres]
═════════════════════════

BLOQUE 1 — src/index.css

Genera el bloque @theme completo con las escalas de color.

Reglas estrictas:
- Conserva los NOMBRES de Tailwind (emerald, slate, rose, amber, indigo).
  Son nombres de papel, no de color: "emerald" es el acento aunque sea azul.
  Renombrarlos rompería 505 clases del código.
- emerald = acento del cliente. slate = neutro. rose = error.
  amber = advertencia. indigo = acento secundario.
- Cada escala necesita estas 13 paradas, en orden:
  50, 100, 150, 200, 300, 400, 500, 550, 600, 700, 800, 900, 950.
  Las intermedias (150, 450, 550, 650, 750, 850) NO son opcionales:
  el código las usa y Tailwind no las trae. Si faltan, no pinta nada.
- La escala debe ser perceptualmente pareja: el 500 es el color dado,
  el 50 casi blanco con su matiz, el 950 casi negro con su matiz.
- El texto sobre el 600 debe ser blanco legible (contraste mínimo 4.5:1).
- Incluye --font-sans y --font-mono.

BLOQUE 2 — config/cliente.ts

Genera el objeto CLIENTE con esta forma exacta:

export const CLIENTE = {
  id, 
  marca:     { nombre, razonSocial, encabezadoOrden, logo, lemaOrden, piePagina },
  regional:  { locale, moneda, simbolo, decimales, zonaHoraria },
  modulos:   { canastillas, nomina, mermas, preciosNuevos, correoPedidos, adminPorSucursal },
  operacion: { baseCajaPorDefecto, montoAlertaPorDefecto, factorBultoPorDefecto,
               factorCanastillaPorDefecto, diasDeSesion, respaldosAConservar },
} as const;

- `logo` siempre "/marca/logo.png".
- `encabezadoOrden` y `lemaOrden` en MAYÚSCULAS: van impresos en la orden
  de compra que se manda por WhatsApp.
- Deriva locale y zona horaria del país. Colombia: es-CO / America/Bogota,
  0 decimales. Ajusta los decimales a la moneda (COP 0, USD y EUR 2).
- Deja los valores de `operacion` por defecto salvo que te den otros.

BLOQUE 3 — seeds/[ID].json y variables de entorno

- El archivo de semilla con las sucursales dadas, y arreglos vacíos
  para productos y proveedores.
- Un usuario Admin, uno Comprador y uno por sucursal.
- NUNCA incluyas contraseñas en el archivo de semilla.
- El bloque de variables de entorno con marcadores, y el comando
  para generar AUTH_SECRET.

Al final, y solo al final, lista en tres líneas qué me falta por hacer a mano.
````

### Cómo usarlo

1. Rellenar el bloque de datos del cliente.
2. Pegar los tres bloques en los archivos correspondientes.
3. Seguir desde el paso 4 de la guía de despliegue.

**Verificar siempre a mano:** que el texto blanco se lea sobre el tono 600 del
acento, y que las seis paradas intermedias estén presentes en las cinco escalas.
Es lo que una IA suele omitir, y el síntoma es que algunos elementos quedan sin
pintar.

---

## 5. Antes de vender la primera copia

1. **Sacar los datos de Al Paso del código fuente** (sección 2.4). Bloqueante: hoy el repositorio lleva cédulas y celulares de personas reales.
2. **Crear `config/cliente.ts`** y sustituir las 95 apariciones de marca y región.
3. **Cargar la semilla desde archivo**, no desde el código.
4. **Contraseñas temporales generadas**, nunca sembradas.
5. Probar la replicación completa con un cliente ficticio, de principio a fin, cronometrando.

Hasta que los puntos 1 a 4 estén hechos, cada copia vendida es una copia de los
datos del primer cliente.
