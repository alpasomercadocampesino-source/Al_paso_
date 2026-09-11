# Al Paso — Auditoría de Entrega y Manual Técnico

**Sistema:** Fruver Engine Suite / Al Paso — Mercado Campesino
**Alcance:** aplicación web completa (servidor, base de datos y las tres consolas)
**Fecha de la auditoría:** 10 de septiembre de 2026
**Estado:** apto para entrega, con las salvedades de la sección 5

---

## 1. Resumen ejecutivo

La auditoría revisó el código del servidor, la capa de base de datos y las tres consolas, y ejecutó pruebas contra el sistema en producción.

**El hallazgo principal:** la aplicación exigía haber iniciado sesión para usar cualquier operación, pero **casi nunca comprobaba con qué rol**. En la práctica, la contraseña de una caja de sucursal — que conoce todo el personal de ese punto — daba acceso por la API a cambiar precios, mover dinero de la Caja Central, dar por recogido su propio efectivo, subir un sueldo y **cambiar la contraseña del administrador**. Se comprobó explotándolo contra producción, no por lectura de código.

Todo eso quedó corregido y verificado el mismo día. La sección 2 lo detalla.

**No se encontraron** inyección SQL, contraseñas en texto plano, secretos en el repositorio ni fallas en el aislamiento entre sucursales.

| Severidad | Encontrados | Corregidos | Pendientes |
|---|---|---|---|
| Crítico | 2 | 2 | 0 |
| Alto | 4 | 4 | 0 |
| Medio | 6 | 3 | 3 |
| Bajo | 5 | 1 | 4 |

---

## 2. Fase 1 — Auditoría de seguridad

### 2.1 Hallazgos corregidos

| Riesgo | Impacto | Solución |
|---|---|---|
| **CRÍTICO — Cualquier sesión podía cambiar la contraseña de cualquier usuario.** `POST /api/users/update-password` no comprobaba el rol ni que el usuario fuera el propio. | Toma total del sistema. Un cajero cambia la contraseña de `Cris`, entra como administrador y accede a ventas, nómina, costos y proveedores de todo el negocio. El dueño queda fuera de su propia aplicación. | `requireRole("Admin")`. Verificado: sesión de sucursal → **403**. |
| **CRÍTICO — Cualquier sesión podía alterar precios.** `PUT /api/products/:code`, `POST /api/products` y `POST /api/admin/matrix-save` no comprobaban el rol. Verificado en producción: sesión de sucursal → HTTP 200. | Fraude directo. Se baja el precio de venta de un producto, se vende barato a un conocido y se vuelve a subir. Queda en la bitácora, pero a nombre de quien la caja quiera poner. | Roles `Admin`, `AdminSucursal` y `Comprador`. Las cajas quedan fuera. Verificado: sucursal → **403**, admin y comprador → **200**. |
| **ALTO — Una sucursal podía mover el monedero de otra y el de la Caja Central.** `POST /api/wallet/:branch/expense` y `/transaction` tomaban la sucursal de la dirección web sin comprobarla. | Se inventa un "Ingreso" a la Caja Central para tapar un faltante, o se carga un gasto al monedero de otra sucursal para bajarle el efectivo pendiente. Descuadra la conciliación de todo el negocio. | `puedeVerSucursal()` sobre la sucursal de la dirección. Verificado: ingreso a Central desde una caja → **403**; gasto en otra sucursal → **403**; gasto en la propia → autorizado. |
| **ALTO — Una sucursal podía dar por recogido su propio efectivo.** `POST /api/closures/bulk-reconcile` y `PUT /api/closures/reconcile` no comprobaban rol ni sucursal. | Una caja con un faltante marca su efectivo como entregado y la deuda desaparece del panel del comprador. El dinero nunca llega y el sistema deja de reclamarlo. | Roles de gestión más `puedeVerSucursal()`. Verificado: sucursal recaudando su propia caja → **403**. |
| **ALTO — Nómina sin protección.** Tarifas, turnos, préstamos, liquidación y marcado de pago, todos sin comprobación de rol. | Un empleado se sube la tarifa por hora, se borra un préstamo o marca su quincena como pagada. | Roles `Admin` y `AdminSucursal`. Verificado: sucursal creando una tarifa → **403**. |
| **ALTO — Importación de pedidos sin protección.** `POST /api/admin/import-csv-orders` reparte columnas entre todas las sucursales. | Una caja inyecta pedidos a nombre de cualquier sucursal. | Roles `Admin` y `Comprador`. |
| **MEDIO — Inicio de sesión sin límite de intentos.** Las contraseñas siguen un patrón adivinable y la dirección es pública. | Un atacante prueba miles de combinaciones por minuto hasta entrar. | Freno tras 8 fallos por usuario y dirección IP, ventana de 15 minutos. Verificado: décimo intento → **429**. |
| **MEDIO — Importes sin validar en el monedero.** `parseFloat("abc")` devuelve `NaN` y se guardaba; los negativos se aceptaban. | Un valor `NaN` corrompe el saldo del monedero; un gasto negativo lo infla. | Se exige un número finito mayor a cero, y que el tipo sea `Ingreso` o `Gasto`. |
| **BAJO — `/api/health` detallaba el error de la base de datos.** El mensaje de Postgres puede nombrar el servidor y el usuario. | Le da a un atacante el punto exacto al que dirigirse. | El detalle solo se muestra a quien ya inició sesión. |

### 2.2 Hallazgos pendientes (recomendaciones)

| Riesgo | Impacto | Solución |
|---|---|---|
| **MEDIO — Las sesiones no se pueden revocar.** El token dura 30 días y cambiar la contraseña no lo invalida. | Si se despide a alguien o se filtra un teléfono, esa sesión sigue viva un mes aunque se cambie la contraseña. | Guardar un contador de versión por usuario, incluirlo en el token y rechazar los que no coincidan. Cambiar la contraseña sube el contador y cierra todas las sesiones de esa persona al instante. |
| **MEDIO — Fotos sin límite de tamaño.** El cuerpo admite 50 MB y las fotos se guardan en base64 sin comprimir. | Una foto de celular ocupa 5–10 MB. Unas pocas al día hinchan la base de datos y vuelven lento cada guardado. | Redimensionar en el navegador a 1280 px y calidad 0,7 antes de enviar, y rechazar en el servidor lo que supere 1 MB. |
| **MEDIO — Un administrador de sucursal puede editar el catálogo maestro.** Las pestañas del panel no se ocultan según el alcance, así que `sara_admin_2026` ve *Catálogo Maestro*, *Añadir/Quitar Productos* y *Contraseñas*. | Un precio maestro afecta a todas las sucursales, incluidas las que ella no debería ver. Contradice el aislamiento pedido. | Decisión del dueño. Si el aislamiento debe ser total, ocultar esas tres pestañas cuando hay sucursal asignada y quitar `AdminSucursal` de los permisos de producto. *No se cambió porque restringe funciones que se pidieron explícitamente.* |
| **BAJO — CORS abierto.** `app.use(cors())` acepta peticiones de cualquier sitio web. | Con un token robado, cualquier página podría leer la API. El riesgo real es bajo porque el token va en cabecera, no en cookie. | Restringir a la dirección propia del negocio. |
| **BAJO — El token se guarda en `localStorage`.** | Un fallo de tipo XSS permitiría robarlo. No se encontró ningún punto de inyección: React escapa el contenido y no hay `dangerouslySetInnerHTML` en pantalla. | Riesgo teórico hoy. Se mitiga con el contador de versión de la primera fila. |
| **BAJO — Descarga de respaldo por `?token=`.** Único caso en que el token viaja en la dirección web. | Puede quedar en el historial del navegador. | Aceptable: es solo lectura, de un solo archivo y exige rol `Admin`. Si se quiere cerrar, usar un enlace de un solo uso con vencimiento corto. |

### 2.3 Revisado y correcto

| Área | Resultado |
|---|---|
| **Inyección SQL** | **No hay.** Todas las consultas usan plantillas `sql` de Drizzle con parámetros ligados; los nombres de tabla y columna pasan por `sql.identifier` y provienen de constantes internas, nunca del usuario. |
| **Almacenamiento de contraseñas** | bcrypt con 10 rondas. Las contraseñas antiguas en texto plano se migran a hash en el primer inicio de sesión correcto. `GET /api/users` nunca devuelve el hash, ni al administrador. |
| **Firma de sesión** | HMAC-SHA256 con comparación de tiempo constante. `AUTH_SECRET` está configurado en producción (64 caracteres). Si faltara, se genera uno aleatorio en memoria: las sesiones se cierran en cada reinicio, pero **nunca** queda abierto. |
| **Secretos en el repositorio** | `.env` está en `.gitignore` y no aparece en el historial de Git. |
| **Aislamiento entre sucursales** | Correcto, y hecho en el servidor, no en pantalla. Cierres, pedidos, mermas, monederos y configuración se filtran con `puedeVerSucursal()`. Una sucursal con administrador propio desaparece también de los totales del administrador general. El comprador es la única excepción, a propósito. |
| **Exposición de variables** | Ninguna variable de entorno se devuelve al navegador. |

---

## 3. Fase 2 — Pruebas de usuario y casos límite

| Riesgo | Impacto | Solución |
|---|---|---|
| **Reintento tras caída de red duplica el cierre.** El servidor crea un cierre nuevo en cada envío, con identificador basado en la hora. Si la respuesta se pierde en el camino, la sucursal reintenta y quedan dos. | Ventas contadas dos veces. En un negocio con internet inestable es el error más probable de todos. | Generar una clave de idempotencia en el navegador y enviarla; el servidor devuelve el cierre ya creado en vez de crear otro. **Pendiente.** |
| **Doble clic en los botones de envío.** | Registros duplicados. | **Ya cubierto:** los tres botones de envío de la consola de sucursal llevan `disabled={loading}` y cambian a "Guardando…". |
| **Cierre de caja en $0.** Solo se exige el nombre de quien recoge; el dinero contado puede quedar vacío. | Un cierre en cero se suma al histórico y descuadra el efectivo pendiente de esa sucursal. | Exigir dinero contado mayor a cero y pedir confirmación del monto antes de guardar. **Pendiente.** |
| **Decimales mal interpretados.** Los campos de dinero aplican `.replace(/\D/g,"")`, que borra la coma: escribir `1500,50` guarda `150050`. | Un cierre cien veces mayor al real. Poco probable en pesos colombianos, donde no se usan centavos, pero posible. | Separar miles y decimales antes de limpiar, o bloquear la coma en el campo. **Pendiente.** |
| **Valores negativos.** El servidor aceptaba números negativos en gastos y mermas. | Un gasto negativo infla el efectivo de la sucursal. | **Corregido** en el monedero. Pendiente aplicar el mismo criterio a mermas y a los gastos del cierre. |
| **Campos obligatorios vacíos.** | Registros inservibles. | **Ya cubierto:** pedido vacío, merma sin producto o cantidad, cierre sin responsable y gasto sin descripción se rechazan con un mensaje en pantalla. |
| **Código de producto inexistente en un pedido.** La sucursal puede tener el catálogo desactualizado en el navegador. | Antes el renglón se descartaba en silencio y la sucursal veía "pedido enviado con éxito". | **Ya corregido:** el servidor devuelve `rejectedItems` con el motivo, y responde error si no se registró ningún renglón. |
| **Pérdida de conexión durante el día.** | Se pierde el trabajo de la jornada. | **Ya cubierto:** el borrador del cierre se guarda en el navegador con la fecha y la sucursal como llave, y sobrevive a un corte de luz o al cierre del navegador. Los pedidos se encolan solo cuando la red falla de verdad; un rechazo del servidor (4xx) se retira de la cola con aviso, en vez de reintentarse para siempre. |
| **Fecha libre.** Se puede registrar con fecha futura o de meses atrás. | Un cierre con fecha equivocada desaparece del mes en curso. | Limitar el selector a un rango razonable (por ejemplo, de ayer a hoy para las sucursales). **Pendiente.** |
| **Sesión vencida a media captura.** | Se pierde lo escrito. | **Ya cubierto:** un 401 dispara el evento de sesión vencida y lleva al inicio de sesión. El borrador local del cierre se conserva. |
| **Dos cajeros del mismo punto trabajando a la vez.** | Un guardado pisa al otro. | **Ya cubierto:** la escritura es fila por fila (`INSERT … ON CONFLICT DO UPDATE`), nunca un reemplazo completo de la tabla, así que dos procesos no se borran datos entre sí. |

---

## 4. Fase 3 — Manual técnico

### 4.1 Arquitectura

| Capa | Tecnología |
|---|---|
| Interfaz | React 18 + Vite + Tailwind. Una sola página, tres consolas según el rol. |
| Servidor | Node.js + Express en TypeScript (`server.ts`). |
| Base de datos | PostgreSQL en Supabase, a través de Drizzle ORM. |
| Alojamiento | Railway. Despliegue con `railway up`. |
| Correo | SMTP para el resumen de pedidos. |

El servidor mantiene una copia completa de los datos en memoria y la sincroniza contra Postgres en cada escritura. Postgres es la fuente de la verdad: al arrancar, el servidor lee de allí.

### 4.2 Roles y alcance

| Rol | Quién | Alcance |
|---|---|---|
| `Admin` | Cris, mache | Todo el negocio, **menos** las sucursales que tengan administrador propio. |
| `AdminSucursal` | sara_admin_2026 | Solo su sucursal asignada. La sucursal viaja firmada dentro del token, así que el navegador no puede cambiarla. |
| `Comprador` | Hamilton | Todas las sucursales. Es la excepción al aislamiento: compra en plaza para el negocio completo. |
| `Sucursal` | Una cuenta por punto de venta | Solo su propia tienda. |

**Regla de aislamiento:** cuando una sucursal tiene administrador propio, el aislamiento va en los dos sentidos — ese administrador no ve las demás, y los administradores generales dejan de ver esa. Aplica a cierres, pedidos, mermas, monederos, nómina y configuración.

### 4.3 Módulos por consola

#### Consola de Sucursal

| Pantalla | Qué hace |
|---|---|
| **Comercial / Hacer Pedido** | Captura el pedido del día escribiendo cantidades sobre el catálogo. Guarda borrador en el navegador. Un código inexistente se informa, no se descarta. |
| **Registrar Merma** | Registra pérdidas por producto. El valor se calcula con el precio de venta y los factores de bulto o canastilla. Muestra las mermas del día. |
| **Cierre de Caja** | Registra el efectivo contado y los gastos de caja menor, uno por uno. `Ventas_Totales = efectivo contado + gastos`. Genera recibo. Guarda borrador por si se va la luz. |
| **Monedero Bodega** | Gastos pagados desde el efectivo de la tienda antes de la recolección. Valida contra el saldo disponible. |
| **Planilla de Control** | Consulta de los pedidos enviados. |
| **Catálogo de Productos** | Consulta, con ordenamiento por producto, proveedor, código o pedido anterior. |

#### Consola de Comprador (plaza)

| Pantalla | Qué hace |
|---|---|
| **Planilla de Compras (Plaza)** | Matriz con una columna por sucursal activa. Consolida lo pedido, calcula el requerido total y el valor a pagar por proveedor. Genera imagen de orden de compra por proveedor para WhatsApp. |
| **Recaudación de Cierres** | Confirma la recolección física del efectivo de cada sucursal. Admite recaudo parcial. |
| **Control de Canastillas** | Entregas y devoluciones de canastillas y estivas por proveedor. |
| **Libro Diario (Caja)** | Movimientos de la Caja Central. |
| **Historial de Precios** | Consulta de los cambios de precio. |

#### Consola de Administración

| Pantalla | Qué hace |
|---|---|
| **Consola Master** | Indicadores generales y últimos movimientos. |
| **Efectivo & Monedero** | Conciliación de efectivo, con selector de mes. Detalle en 4.5. |
| **Nómina Inteligente** | Turnos, tarifas, préstamos y liquidación con prestaciones y aportes. |
| **Canastillas & Estivas** | Saldo de canastillas por proveedor. |
| **Recibos de Cierre** | Recibos de los cierres registrados. |
| **Catálogo Maestro** | Precios de costo y de venta, utilidad y proveedor. |
| **Factores y Pesos** | Kilos por bulto y por canastilla de cada producto. |
| **Añadir/Quitar Productos** | Alta y baja del catálogo. |
| **Cuentas Proveedores** | Cuentas pendientes por proveedor y por fecha. |
| **Reporte Compras** | Consolidado de compras. Muestra siempre el valor a pagar y se recalcula solo si el precio cambia después. |
| **Auditoría Precios** | Bitácora de cambios por producto, con gráfica de evolución. |
| **Precios Nuevos** | Recibo en imagen con los precios que cambiaron, para enviar a las sucursales. **No muestra el precio de compra ni el margen.** |
| **Mermas** | Totales del mes por producto. |
| **Contraseñas** | Cambio de contraseñas. No se pueden ver: bcrypt es de una sola vía. |
| **Logs Sincronización** | Registro de las escrituras a la base de datos. |

### 4.4 Restricciones y reglas de negocio

#### Cómo se escribe en la base de datos

- Cada fila se identifica con un `client_id` propio, generado por la aplicación.
- La escritura es **fila por fila**, con `INSERT … ON CONFLICT (client_id) DO UPDATE`. Nunca se reemplaza una tabla completa. Un proceso con datos viejos en memoria no puede borrar filas que otro ya insertó.
- **Nada se borra por omisión.** Un borrado real es siempre explícito.
- Si el guardado falla, se reintenta cuatro veces con esperas de 250, 500 y 1000 ms. Si aun así falla, se revierte lo agregado en memoria, para que un reintento de la sucursal no cree un registro duplicado.

#### Cierres de caja

- Cada envío crea un cierre nuevo. Una sucursal puede registrar varios el mismo día (uno por turno) sin sobrescribir el anterior.
- `Ventas_Totales = efectivo contado + gastos de caja menor`.
- Neto del cierre `= Ventas_Totales − Gastos_Extra`.
- Cada cierre genera su propio movimiento de monedero, en estado `Pendiente`.

#### Efectivo y Caja Central

- Efectivo en tienda `= Σ (neto del cierre − ya recogido)` de los cierres sin recoger, menos los gastos pendientes de esa sucursal.
- Caja General `= Σ ingresos de "Central / Nequi" − (nómina pagada + Σ gastos de "Central / Nequi")`. **Se lee del libro de movimientos**, no se vuelve a deducir de los cierres.
- Desmarcar un cierre recogido borra su entrada del libro central, para que el saldo y el libro no se separen.
- El efectivo en tienda es una cifra de **hoy**, no de un mes: lo que quedó sin recoger en agosto sigue en la caja.

#### Precios

- Solo se escribe en la bitácora cuando el precio realmente cambió.
- Los precios se cambian por tandas: guardar la matriz escribe una fila por cada producto editado, en el mismo instante.
- El recibo de precios nuevos compara contra la bitácora del día seleccionado, no contra el precio anterior guardado en el producto.

#### Sucursales

- La lista de sucursales **siempre** viene del servidor (`GET /api/admin/branch-configs`), ya filtrada por rol. No hay ninguna lista fija en el código. Un chequeo automático (`scripts/check-sucursales.mjs`) bloquea la compilación si alguien vuelve a escribir una.
- El color de cada sucursal se calcula de su nombre, así que una sucursal nueva recibe el suyo sin tocar código.

#### Sesiones

- Token firmado con HMAC-SHA256, válido 30 días.
- El rol y la sucursal viajan firmados dentro del token: el navegador no puede cambiarlos.

### 4.5 Conciliación de efectivo por mes

El selector de mes filtra **lo que es movimiento**: lo que entró, lo que salió, la nómina pagada, los gastos de caja menor y los cierres procesados.

**No** filtra lo que es saldo, a propósito:

- La **Caja General** arrastra los meses anteriores y muestra el saldo al cierre del mes elegido.
- El **efectivo en tiendas** es una cifra de hoy.
- El **panel de confirmación de recolección** se deja entero, para que nadie confirme una recogida viendo solo parte de lo pendiente.

### 4.6 Operación

| Tema | Detalle |
|---|---|
| **Respaldos** | Automáticos cada 24 horas, guardados en la tabla `backups`. Se conservan los 30 más recientes. Descargables en JSON desde el panel de administración. |
| **Tablas** | `users`, `products`, `providers`, `orders`, `closures`, `wallet_transactions`, `shrinkages`, `packaging_movements`, `employee_schedules`, `employee_loans`, `employee_rates`, `payroll_records`, `price_histories`, `nequi_expenses`, `sync_logs`, `branch_configs`, `backups`. |
| **Variables de entorno** | `AUTH_SECRET` (obligatoria), `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`, `SMTP_USER`. |
| **Chequeo de salud** | `GET /api/health` compara la memoria del servidor contra Postgres y responde 409 si no coinciden. |
| **Despliegue** | `railway up`. Tras cambiar datos directamente en la base, hay que reiniciar el servicio: si no, la copia en memoria vuelve a escribir lo borrado. |
| **Compilación** | `npm run build` ejecuta primero el chequeo de sucursales; si encuentra una lista fija, la compilación falla. |

---

## 5. Acciones recomendadas antes de entregar

1. **Rotar las contraseñas** de todas las cuentas. Las actuales se compartieron por chat durante el desarrollo y siguen un patrón adivinable.
2. **Avisar al personal** que debe volver a iniciar sesión una vez.
3. **Decidir sobre el catálogo maestro** para el administrador de sucursal (sección 2.2).
4. **Registrar las recolecciones pendientes.** Hay cierres sin marcar como recogidos; mientras no se registren, la Caja General muestra un saldo negativo que no refleja la realidad del negocio.
5. Programar las mejoras pendientes de las secciones 2.2 y 3, por orden: clave de idempotencia en los cierres, límite de tamaño en las fotos y revocación de sesiones.
