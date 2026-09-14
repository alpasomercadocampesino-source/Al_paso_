import express from "express";
import cors from "cors";
import path from "path";
import bcrypt from "bcryptjs";
import { createServer as createViteServer } from "vite";
import { initDb, saveDb as originalSaveDb, recordSyncLog, purgePastMonthsOrdersAndClosures, defaultBranchConfigs, sucursalesOrdenadas, ordenDeSucursal, deleteRowByClientId, truncateTables, getTableCounts, createBackup, listBackups, getBackup, restoreBackup, reloadFromPostgres, startAutomaticBackups, DatabaseSchema, CollectionKey, Order, DailyClosure, WalletTransaction, Shrinkage, PackagingMovement, EmployeeSchedule, EmployeeLoan, PayrollRecord, PriceHistory, Product, Provider } from "./server/db.ts";
import { sendOrderSummaryEmail } from "./server/mailer.ts";
import { crearToken, requireAuth, requireRole, type Rol } from "./server/auth.ts";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
 
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ─────────────────────────────────────────────
// ALCANCE POR SUCURSAL
//
// Una sucursal puede tener su propio administrador (rol AdminSucursal). Cuando
// existe, esa sucursal queda aislada: su administrador solo ve lo suyo, y los
// administradores generales dejan de verla. El comprador es la excepción — sigue
// viendo todas, porque hace las compras de plaza para el negocio completo.
//
// El filtro vive en el servidor a propósito: ocultarlo solo en pantalla dejaría
// los datos accesibles llamando la API directamente.
// ─────────────────────────────────────────────

function norm(s: any): string {
  return String(s || "").toLowerCase().trim();
}

/** Sucursales que tienen administrador propio y por tanto quedan aisladas. */
function sucursalesConAdminPropio(): Set<string> {
  const set = new Set<string>();
  for (const u of db?.users || []) {
    if (u && u.Rol === "AdminSucursal" && u.Sucursal) set.add(norm(u.Sucursal));
  }
  return set;
}

/**
 * Ámbito de la consulta. "pedidos" es la excepción al aislamiento: la compra se
 * hace de una sola vez en la plaza para todo el negocio, así que el
 * administrador general necesita ver también lo que pide una sucursal con
 * administrador propio. El dinero de esa sucursal — cierres, monedero, nómina —
 * sigue siendo solo de ella.
 */
type Ambito = "pedidos" | undefined;

/** ¿Esta sesión puede ver los datos de esta sucursal, en este ámbito? */
function puedeVerSucursal(req: express.Request, sucursal: any, ambito?: Ambito): boolean {
  const sesion = req.auth;
  if (!sesion) return false;
  const suc = norm(sucursal);

  switch (sesion.r) {
    case "Comprador":
      return true; // compra para todas las sucursales
    case "Sucursal":
      return suc === norm(sesion.u);
    case "AdminSucursal":
      return suc === norm(sesion.s);
    case "Admin":
      if (ambito === "pedidos") return true;
      return !sucursalesConAdminPropio().has(suc);
    default:
      return false;
  }
}

/** Filtra una lista dejando solo los registros de sucursales visibles para la sesión. */
function filtrarPorSucursal<T>(req: express.Request, lista: T[], obtenerSucursal: (item: T) => any, ambito?: Ambito): T[] {
  if (!Array.isArray(lista)) return [];
  const sesion = req.auth;
  // Admin general sin sucursales aisladas y Comprador ven todo: se evita recorrer.
  if (sesion?.r === "Comprador") return lista;
  if (sesion?.r === "Admin" && (ambito === "pedidos" || sucursalesConAdminPropio().size === 0)) return lista;
  return lista.filter((item) => item && puedeVerSucursal(req, obtenerSucursal(item), ambito));
}

// Rutas públicas: iniciar sesión y el chequeo de salud (que no expone datos).
const RUTAS_PUBLICAS = new Set(["/api/auth/login", "/api/health"]);

// Toda la API exige sesión válida. Antes cualquiera que supiera la dirección web
// podía leer los usuarios o borrar los datos sin iniciar sesión.
app.use("/api", (req, res, next) => {
  const ruta = req.baseUrl + req.path;
  if (RUTAS_PUBLICAS.has(ruta) || req.method === "OPTIONS") return next();
  return requireAuth(req, res, next);
});

// Colombia date utilities (UTC-5, no DST)
function getColombiaDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function getColombiaYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function genRecordId(prefix: string, branch: string, date: string): string {
  const branchTag = String(branch || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "GEN";
  return `${prefix}-${branchTag}-${date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Supabase/PostgreSQL es la fuente de la verdad. Se asigna en startServer(),
// antes de que el servidor empiece a aceptar peticiones (ver abajo).
let db: DatabaseSchema;

async function saveDb(dbData: DatabaseSchema, only?: CollectionKey[]) {
  await originalSaveDb(dbData, only);
}

/**
 * Tope de peso para una foto guardada en la base.
 *
 * El navegador ya las reduce a ~900 px antes de enviarlas (src/utils/imagen.ts)
 * y quedan en unas decenas de KB. Este tope es la red por si algo se salta esa
 * compresión: sin él, una foto de celular sin tocar (3 a 10 MB) entra entera,
 * hincha la base y vuelve lento cada guardado.
 */
const FOTO_MAXIMA_KB = 400;

/** Devuelve un mensaje de error si la foto excede el tope, o null si está bien. */
function revisarFoto(foto: any): string | null {
  if (!foto || typeof foto !== "string") return null;
  const kb = Math.round(foto.length / 1024);
  if (kb <= FOTO_MAXIMA_KB) return null;
  return `La foto pesa ${kb} KB y el máximo es ${FOTO_MAXIMA_KB} KB. Vuelva a tomarla desde la aplicación para que se comprima sola.`;
}

/** Formatea un valor en pesos colombianos, para mensajes de error legibles. */
function cop(valor: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(valor || 0);
}

function parseQty(q: any): number {
  if (!q) return 0;
  const cleaned = String(q).trim().replace(",", ".").replace(/\s+/g, " ");
  if (cleaned === "" || cleaned === "-") return 0;
  
  const mixedMatch = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/) || cleaned.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    if (den !== 0) {
      return whole + (num / den);
    }
  }

  if (cleaned.includes("/")) {
    const parts = cleaned.split("/");
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (!isNaN(num) && !isNaN(den) && den !== 0) {
        return num / den;
      }
    }
  }
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// ─────────────────────────────────────────────
// API ENDPOINTS
// ─────────────────────────────────────────────

// Login Routing
const isBcryptHash = (value: string) => /^\$2[aby]\$/.test(value);

// Freno a la fuerza bruta. Las contraseñas del personal siguen un patrón
// adivinable, y sin freno se pueden probar miles por minuto contra la
// dirección pública. Se cuenta por usuario+IP y se olvida solo.
const MAX_INTENTOS = 8;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
const intentosFallidos = new Map<string, { n: number; hasta: number }>();

function claveIntento(req: express.Request, usuario: string): string {
  const reenviada = req.headers["x-forwarded-for"];
  const ip = String(Array.isArray(reenviada) ? reenviada[0] : reenviada || req.socket.remoteAddress || "").split(",")[0].trim();
  return `${ip}|${String(usuario || "").toLowerCase().trim()}`;
}

/** Minutos que faltan para poder reintentar, o 0 si no está frenado. */
function minutosDeFreno(clave: string): number {
  const e = intentosFallidos.get(clave);
  if (!e) return 0;
  if (Date.now() > e.hasta) { intentosFallidos.delete(clave); return 0; }
  return e.n >= MAX_INTENTOS ? Math.ceil((e.hasta - Date.now()) / 60000) : 0;
}

function anotarFallo(clave: string) {
  const e = intentosFallidos.get(clave);
  const vigente = e && Date.now() <= e.hasta ? e.n : 0;
  intentosFallidos.set(clave, { n: vigente + 1, hasta: Date.now() + VENTANA_INTENTOS_MS });
}


app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  }

  const clave = claveIntento(req, username);
  const minutosRestantes = minutosDeFreno(clave);
  if (minutosRestantes > 0) {
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto(s).`,
    });
  }

  const inputPassword = password.trim();
  const user = db.users.find(
    (u: any) => {
      if (!u) return false;
      const dbUser = (u.Usuario || u.usuario || u.username || u.Username || "").toString().toLowerCase().trim();
      if (dbUser !== username.toLowerCase().trim()) return false;

      const dbPass = (u.Contraseña || u.contraseña || u.Contrasena || u.contrasena || u.password || u.Password || "").toString().trim();
      if (isBcryptHash(dbPass)) {
        return bcrypt.compareSync(inputPassword, dbPass);
      }
      // Contraseña legacy en texto plano: se compara directo y se migra a hash si coincide.
      return dbPass === inputPassword;
    }
  );

  if (user) {
    intentosFallidos.delete(clave);
    if (!isBcryptHash((user.Contraseña || "").toString().trim())) {
      user.Contraseña = bcrypt.hashSync(inputPassword, 10);
      await saveDb(db, ["users"]);
    }
    const usuario = user.Usuario || (user as any).usuario || (user as any).username || (user as any).Username;
    const rol = (user.Rol || (user as any).rol || (user as any).role || (user as any).Role) as Rol;
    const sucursalAsignada = rol === "AdminSucursal" ? (user.Sucursal || "") : "";
    return res.json({
      Usuario: usuario,
      Rol: rol,
      Sucursal: sucursalAsignada || undefined,
      // El servidor valida este token en cada operación: ya no basta con
      // saberse la dirección web para entrar o borrar datos. La sucursal viaja
      // firmada dentro del token, así que el navegador no puede cambiarla.
      token: crearToken(usuario, rol, sucursalAsignada),
    });
  } else {
    anotarFallo(clave);
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

// User Management for Admin
app.get("/api/users", requireRole("Admin"), (req, res) => {
  // Nunca se devuelve el hash de la contraseña, ni siquiera al administrador.
  res.json(db.users.map((u) => ({ Usuario: u.Usuario, Rol: u.Rol, _id: (u as any)._id })));
});

// Branch Configs for cash collection
app.get("/api/admin/branch-configs", async (req, res) => {
  if (!db.branchConfigs) {
    // La configuración inicial vive en un solo lugar (server/db.ts); antes estaba
    // duplicada aquí y las dos copias podían quedar distintas.
    db.branchConfigs = defaultBranchConfigs();
    await saveDb(db, ["branchConfigs"]);
  }
  // Cada sesión solo recibe la configuración de las sucursales que puede ver.
  // Con ?ambito=pedidos el administrador general recibe también las sucursales
  // con administrador propio, para armar las columnas de la planilla de compras.
  const ambito: Ambito = req.query.ambito === "pedidos" ? "pedidos" : undefined;
  const visibles: { [branch: string]: any } = {};
  // Se recorre en el orden del negocio, no en el de creación: las claves del
  // objeto conservan ese orden y con eso se ordenan todas las tablas del cliente.
  for (const nombre of sucursalesOrdenadas(db.branchConfigs)) {
    if (puedeVerSucursal(req, nombre, ambito)) visibles[nombre] = db.branchConfigs[nombre];
  }
  res.json(visibles);
});

app.post("/api/admin/branch-configs", async (req, res) => {
  const { branch, baseCaja, recolectorPredeterminado, montoAlerta, orden } = req.body;
  if (!branch) {
    return res.status(400).json({ error: "Sucursal requerida" });
  }
  if (!puedeVerSucursal(req, branch)) {
    return res.status(403).json({ error: "No puedes modificar la configuración de esta sucursal." });
  }

  if (!db.branchConfigs) {
    db.branchConfigs = {};
  }

  // La posición decide dónde sale la sucursal en todas las tablas. Si no llega
  // una nueva, se conserva la que ya tenía: guardar el monto de alerta no debe
  // reordenar las columnas de media empresa sin querer.
  const anterior = db.branchConfigs[branch];
  const posicion = orden === undefined || orden === null || orden === ""
    ? ordenDeSucursal(branch, anterior?.orden)
    : Math.min(998, Math.max(1, Math.round(Number(orden)) || 999));

  db.branchConfigs[branch] = {
    baseCaja: Number(baseCaja) || 0,
    recolectorPredeterminado: String(recolectorPredeterminado || "Cualquiera"),
    montoAlerta: Number(montoAlerta) || 0,
    orden: posicion,
  };

  await saveDb(db, ["branchConfigs"]);
  res.json({ success: true, config: db.branchConfigs[branch] });
});

/**
 * Cambia el nombre de una sucursal en todo el sistema.
 *
 * El nombre es la llave que usa cada tabla para agrupar sus datos — cierres,
 * pedidos, monedero, nómina, la configuración misma. No hay una lista de
 * pantallas que "mostrar diferente": se renombra la sucursal una sola vez aquí
 * y cada tabla la hereda porque todas leen el nombre desde los mismos datos.
 *
 * Respalda antes de tocar nada.
 */
app.post("/api/admin/branches/rename", requireRole("Admin"), async (req, res) => {
  try {
    const desde = String(req.body?.desde || "").trim();
    const hasta = String(req.body?.hasta || "").trim();
    if (!desde || !hasta) {
      return res.status(400).json({ error: "Se requiere el nombre actual y el nuevo nombre." });
    }
    if (norm(desde) === norm(hasta)) {
      return res.status(400).json({ error: "El nombre nuevo es igual al actual." });
    }

    const clavesActuales = Object.keys(db.branchConfigs || {});
    const claveOrigen = clavesActuales.find((k) => norm(k) === norm(desde));
    if (!claveOrigen) {
      return res.status(404).json({ error: `No existe una sucursal llamada "${desde}".` });
    }
    if (clavesActuales.some((k) => norm(k) === norm(hasta))) {
      return res.status(400).json({ error: `Ya existe una sucursal llamada "${hasta}".` });
    }

    const respaldoId = await respaldarAntesDeBorrar(`renombrar sucursal ${desde} a ${hasta}`);

    // La configuración de la sucursal: se mueve a la llave nueva y se borra la
    // fila vieja (su client_id está derivado del nombre anterior).
    const configVieja = db.branchConfigs[claveOrigen];
    delete db.branchConfigs[claveOrigen];
    db.branchConfigs[hasta] = configVieja;
    await deleteRowByClientId("branch_configs", `brc_${norm(claveOrigen)}`);

    // Cada colección que guarda "Sucursal" como texto. Se compara sin distinguir
    // mayúsculas para no dejar registros viejos con la grafía anterior.
    let filasActualizadas = 0;
    const coleccionesConSucursal: Array<[any[], CollectionKey]> = [
      [db.users, "users"],
      [db.orders, "orders"],
      [db.closures, "closures"],
      [db.walletTransactions, "walletTransactions"],
      [db.shrinkages, "shrinkages"],
      [db.packagingMovements, "packagingMovements"],
      [db.schedules, "schedules"],
      [db.loans, "loans"],
      [db.payroll, "payroll"],
      [db.rates, "rates"],
    ];
    for (const [lista] of coleccionesConSucursal) {
      for (const fila of lista || []) {
        if (fila && norm(fila.Sucursal) === norm(desde)) {
          fila.Sucursal = hasta;
          filasActualizadas++;
        }
      }
    }

    await saveDb(db, ["branchConfigs", ...coleccionesConSucursal.map(([, k]) => k)]);

    res.json({ success: true, respaldoPrevio: respaldoId, filasActualizadas, de: claveOrigen, a: hasta });
  } catch (err: any) {
    console.error("Error al renombrar sucursal:", err);
    res.status(500).json({ error: "No se pudo renombrar la sucursal: " + (err?.message || String(err)) });
  }
});

app.post("/api/users/update-password", requireRole("Admin"), async (req, res) => {
  const { Usuario, Contraseña } = req.body;
  if (!Usuario || !Contraseña) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  }

  const userIndex = db.users.findIndex(
    (u) => u.Usuario.toLowerCase().trim() === Usuario.toLowerCase().trim()
  );

  if (userIndex !== -1) {
    db.users[userIndex].Contraseña = bcrypt.hashSync(Contraseña.trim(), 10);
    await saveDb(db, ["users"]);
    return res.json({ success: true, message: `Contraseña de ${Usuario} actualizada.` });
  }

  return res.status(404).json({ error: "Usuario no encontrado" });
});

// Products
app.get("/api/products", (req, res) => {
  res.json(db.products);
});

app.post("/api/products", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  const { Codigo, Producto, Medida, Proveedor, Celular, Costo_Proveedor, Utilidad, Factor_Bulto, Factor_Canastilla, Merma } = req.body;
  if (!Codigo || !Producto) {
    return res.status(400).json({ error: "Código y nombre de producto requeridos" });
  }

  if (db.products.some((p) => p.Codigo === Codigo)) {
    return res.status(400).json({ error: "El código de producto ya existe" });
  }

  const cost = parseFloat(Costo_Proveedor) || 0;
  const util = parseFloat(Utilidad) || 0.3;
  const venta = Math.round(cost * (1 + util));

  const newProduct: Product = {
    Codigo,
    Producto,
    Medida: Medida || "Kg",
    Merma: parseFloat(Merma) || 0,
    Utilidad: util,
    Proveedor: Proveedor || "Sin Proveedor",
    Celular: Celular || "",
    Costo_Proveedor: cost,
    Precio_Venta_Actual: venta,
    Precio_Anterior: cost,
    Venta_Anterior: venta,
    Factor_Bulto: parseFloat(Factor_Bulto) || 56,
    Factor_Canastilla: parseFloat(Factor_Canastilla) || 22,
  };

  if (Proveedor && Proveedor.trim() !== "" && Proveedor.toLowerCase().trim() !== "sin proveedor") {
    const provLower = Proveedor.toLowerCase().trim();
    const exists = db.providers.some((p) => p.Proveedor.toLowerCase().trim() === provLower);
    if (!exists) {
      db.providers.push({
        Proveedor: Proveedor.trim(),
        Celular: Celular || "",
      });
    }
  }

  db.products.push(newProduct);
  await saveDb(db, ["products", "providers"]);
  res.status(210).json(newProduct);
});

app.put("/api/products/:code", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  const { code } = req.params;
  const index = db.products.findIndex((p) => p.Codigo === code);
  if (index === -1) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }

  const current = db.products[index];
  const { Costo_Proveedor, Precio_Venta_Actual, Utilidad, Proveedor, Celular, Factor_Bulto, Factor_Canastilla, user } = req.body;

  const costNew = Costo_Proveedor !== undefined ? Math.round(parseFloat(Costo_Proveedor) * 100) / 100 : current.Costo_Proveedor;
  const ventaNew = Precio_Venta_Actual !== undefined ? Math.round(parseFloat(Precio_Venta_Actual)) : current.Precio_Venta_Actual;
  const utilNew = Utilidad !== undefined ? Math.round(parseFloat(Utilidad) * 1000) / 1000 : current.Utilidad;

  // Add to price history if prices changed
  if (current.Costo_Proveedor !== costNew || current.Precio_Venta_Actual !== ventaNew) {
    const historyEntry: PriceHistory = {
      Fecha_Hora: new Date().toISOString(),
      Codigo: current.Codigo,
      Producto: current.Producto,
      Costo_Anterior: current.Costo_Proveedor,
      Costo_Nuevo: costNew,
      Venta_Anterior: current.Precio_Venta_Actual,
      Venta_Nueva: ventaNew,
      Usuario: user || "System",
    };
    db.priceHistory.push(historyEntry);
  }

  db.products[index] = {
    ...current,
    Costo_Proveedor: costNew,
    Precio_Venta_Actual: ventaNew,
    Utilidad: utilNew,
    Proveedor: Proveedor !== undefined ? Proveedor : current.Proveedor,
    Celular: Celular !== undefined ? Celular : current.Celular,
    Precio_Anterior: current.Costo_Proveedor,
    Venta_Anterior: current.Precio_Venta_Actual,
    Factor_Bulto: Factor_Bulto !== undefined ? parseFloat(Factor_Bulto) : current.Factor_Bulto,
    Factor_Canastilla: Factor_Canastilla !== undefined ? parseFloat(Factor_Canastilla) : current.Factor_Canastilla,
  };

  await saveDb(db, ["products", "priceHistory"]);
  res.json(db.products[index]);
});

// Providers
app.get("/api/providers", (req, res) => {
  res.json(db.providers);
});

app.post("/api/providers", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  const { Proveedor, Celular } = req.body;
  if (!Proveedor) {
    return res.status(400).json({ error: "Nombre de proveedor requerido" });
  }

  if (db.providers.some((p) => p.Proveedor.toLowerCase().trim() === Proveedor.toLowerCase().trim())) {
    return res.status(400).json({ error: "El proveedor ya existe" });
  }

  const newProvider: Provider = { Proveedor: Proveedor.trim(), Celular: Celular ? String(Celular).trim() : "" };
  db.providers.push(newProvider);
  await saveDb(db, ["providers"]);
  res.status(210).json(newProvider);
});

app.put("/api/providers/:name", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  const oldName = decodeURIComponent(req.params.name).trim();
  const { Proveedor: newName, Celular } = req.body;

  const idx = db.providers.findIndex(
    (p) => p.Proveedor.toLowerCase().trim() === oldName.toLowerCase()
  );

  if (idx === -1) {
    return res.status(404).json({ error: "Proveedor no encontrado" });
  }

  const finalName = newName && newName.trim() ? newName.trim() : db.providers[idx].Proveedor;
  const finalCelular = Celular !== undefined ? String(Celular).trim() : db.providers[idx].Celular;

  db.providers[idx] = {
    Proveedor: finalName,
    Celular: finalCelular,
  };

  // Sync with products
  db.products.forEach((p) => {
    if (p.Proveedor && p.Proveedor.toLowerCase().trim() === oldName.toLowerCase()) {
      p.Proveedor = finalName;
      p.Celular = finalCelular;
    }
  });

  // Sync with orders
  db.orders.forEach((o) => {
    if (o.Proveedor && o.Proveedor.toLowerCase().trim() === oldName.toLowerCase()) {
      o.Proveedor = finalName;
      if (finalCelular) o.Celular = finalCelular;
    }
  });

  await saveDb(db, ["providers", "products", "orders"]);

  res.json({ success: true, provider: db.providers[idx] });
});

app.delete("/api/providers/:name", requireRole("Admin"), async (req, res) => {
  const name = decodeURIComponent(req.params.name).trim();
  const idx = db.providers.findIndex(
    (p) => p.Proveedor.toLowerCase().trim() === name.toLowerCase()
  );

  if (idx === -1) {
    return res.status(404).json({ error: "Proveedor no encontrado" });
  }

  const deleted = db.providers.splice(idx, 1)[0];
  await deleteRowByClientId("providers", (deleted as any)._id);
  res.json({ success: true, deleted });
});

// Price History
app.get("/api/price-history", (req, res) => {
  res.json(db.priceHistory);
});

// Orders (Pedidos)
app.get("/api/orders", (req, res) => {
  const { sucursal, fecha } = req.query;
  // Los pedidos se consolidan para todo el negocio: ver 'Ambito'.
  let filtered = filtrarPorSucursal(req, db.orders, (o) => o.Sucursal, "pedidos");

  if (sucursal) {
    filtered = filtered.filter(
      (o) => o.Sucursal.toLowerCase().trim() === (sucursal as string).toLowerCase().trim()
    );
  }
  if (fecha) {
    filtered = filtered.filter((o) => o.Fecha === (fecha as string));
  }

  res.json(filtered);
});

app.post("/api/orders", async (req, res) => {
  const { sucursal, items, fecha } = req.body;
  if (!sucursal || !items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Datos de pedido inválidos" });
  }
  if (!puedeVerSucursal(req, sucursal)) {
    return res.status(403).json({ error: "No puedes registrar pedidos de esta sucursal." });
  }

  const orderDate = fecha || getColombiaDate();
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const oid = `PED-${sucursal.toUpperCase()}-${timestamp}`;

  const createdOrders: Order[] = [];
  // Renglones que no se pudieron registrar (p. ej. la sucursal tenía un catálogo
  // en caché desantiguado y pidió un código que ya no existe). Antes se
  // descartaban en silencio y la sucursal veía "pedido enviado con éxito".
  const rejectedItems: { Codigo: string; Cantidad: any; motivo: string }[] = [];

  for (const item of items) {
    const { Codigo, Cantidad, Notas } = item;
    const prod = db.products.find((p) => p.Codigo === Codigo);
    if (!prod) {
      rejectedItems.push({ Codigo, Cantidad, motivo: "El código no existe en el catálogo actual" });
      continue;
    }

    // Estimate kilos
    let kilos = 0;
    const qtyNum = parseQty(Cantidad);
    const medLower = prod.Medida.toLowerCase();
    if (medLower.includes("bulto") || medLower === "kg") {
      kilos = qtyNum * prod.Factor_Bulto;
    } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
      kilos = qtyNum * prod.Factor_Canastilla;
    } else {
      kilos = qtyNum; // standard kilos
    }

    createdOrders.push({
      ID_Pedido: oid,
      Fecha: orderDate,
      Sucursal: sucursal,
      Codigo: prod.Codigo,
      Producto: prod.Producto,
      Medida: prod.Medida,
      Cantidad: String(Cantidad),
      Notas: Notas || "",
      Precio_Anterior: prod.Precio_Venta_Actual,
      Porcentaje_Ganancia: prod.Utilidad,
      Cantidad_Comprada: 0,
      Costo_Momento: prod.Costo_Proveedor,
      Precio_Venta_Momento: prod.Precio_Venta_Actual,
      Kilos: kilos,
      Estado: "Pendiente",
      Estado_Pago: "Pendiente",
      Proveedor: prod.Proveedor,
      Celular: prod.Celular,
    });
  }

  if (createdOrders.length === 0) {
    return res.status(400).json({
      error: "Ningún producto del pedido pudo registrarse. Actualiza el catálogo e inténtalo de nuevo.",
      rejectedItems,
    });
  }

  // Se agregan a memoria solo justo antes de guardar, y se revierten si el guardado
  // falla — así la memoria nunca queda con pedidos que Postgres no tiene.
  db.orders.push(...createdOrders);
  try {
    await saveDb(db, ["orders"]);
  } catch (err: any) {
    for (const o of createdOrders) {
      const i = db.orders.indexOf(o);
      if (i !== -1) db.orders.splice(i, 1);
    }
    console.error("Error al guardar el pedido:", err);
    return res.status(500).json({ error: "No se pudo guardar el pedido: " + (err?.message || String(err)) });
  }

  sendOrderSummaryEmail(oid, sucursal, orderDate, createdOrders).catch(err => {
    console.error("Failed to automatically send order summary email:", err);
  });

  res.status(200).json({ ID_Pedido: oid, orders: createdOrders, rejectedItems });
});

// Update specific order details
app.put("/api/orders/:id", async (req, res) => {
  const { id } = req.params;
  const index = db.orders.findIndex((o) => o.ID_Pedido === id || `${o.ID_Pedido}_${o.Codigo}` === id);
  if (index === -1) {
    return res.status(404).json({ error: "Pedido no encontrado" });
  }

  const current = db.orders[index];
  const { Cantidad_Comprada, Costo_Momento, Precio_Venta_Momento, Estado, Estado_Pago, Proveedor } = req.body;

  db.orders[index] = {
    ...current,
    Cantidad_Comprada: Cantidad_Comprada !== undefined ? parseQty(Cantidad_Comprada) : current.Cantidad_Comprada,
    Costo_Momento: Costo_Momento !== undefined ? Math.round(parseFloat(Costo_Momento) * 100) / 100 : current.Costo_Momento,
    Precio_Venta_Momento: Precio_Venta_Momento !== undefined ? Math.round(parseFloat(Precio_Venta_Momento)) : current.Precio_Venta_Momento,
    Estado: Estado || current.Estado,
    Estado_Pago: Estado_Pago || current.Estado_Pago,
    Proveedor: Proveedor || current.Proveedor,
  };

  await saveDb(db, ["orders"]);
  res.json(db.orders[index]);
});

/**
 * La sucursal confirma qué le llegó de plaza.
 *
 * Antes las casillas de la planilla de rectificación solo vivían en la pantalla:
 * al recargar se perdían y nadie más se enteraba de lo que se había verificado.
 * Ahora la confirmación queda guardada con el nombre de quien la hizo.
 *
 * Se manda la lista completa de renglones verificados, no solo los nuevos: así
 * desmarcar uno también queda registrado.
 */
app.post("/api/orders/verify-reception", async (req, res) => {
  const { Sucursal, Fecha, verificados } = req.body;
  if (!Sucursal || !Fecha || !Array.isArray(verificados)) {
    return res.status(400).json({ error: "Se requieren la sucursal, la fecha y la lista de renglones verificados." });
  }
  if (!puedeVerSucursal(req, Sucursal)) {
    return res.status(403).json({ error: "No puedes confirmar el despacho de esta sucursal." });
  }

  const marcados = new Set(verificados.map((v: any) => `${v?.ID_Pedido}||${v?.Codigo}`));
  const quien = req.auth?.u || "Sucursal";
  const cuando = new Date().toISOString();

  let confirmados = 0;
  let desmarcados = 0;
  for (const o of db.orders || []) {
    if (!o || o.Fecha !== Fecha || norm(o.Sucursal) !== norm(Sucursal)) continue;
    const estaMarcado = marcados.has(`${o.ID_Pedido}||${o.Codigo}`);
    if (estaMarcado) {
      if (!o.Recibido_Sucursal) confirmados++;
      o.Recibido_Sucursal = true;
      o.Recibido_Por = quien;
      o.Recibido_Fecha = cuando;
    } else if (o.Recibido_Sucursal) {
      o.Recibido_Sucursal = false;
      o.Recibido_Por = "";
      o.Recibido_Fecha = "";
      desmarcados++;
    }
  }

  await saveDb(db, ["orders"]);
  res.json({ success: true, confirmados, desmarcados, total: marcados.size, responsable: quien });
});

app.post("/api/orders/bulk-update", async (req, res) => {
  const { updates } = req.body; // Array of { ID_Pedido, Codigo, fields }
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: "Actualizaciones inválidas" });
  }

  const updatedRecords: Order[] = [];
  for (const update of updates) {
    const idx = db.orders.findIndex(
      (o) => o.ID_Pedido === update.ID_Pedido && o.Codigo === update.Codigo
    );
    if (idx !== -1) {
      db.orders[idx] = {
        ...db.orders[idx],
        ...update.fields,
      };
      updatedRecords.push(db.orders[idx]);
    }
  }

  await saveDb(db, ["orders"]);
  if (updatedRecords.length > 0) {
  }
  res.json({ success: true });
});

app.post("/api/admin/matrix-save", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  const { fecha, edits, user } = req.body;
  if (!fecha || !edits) {
    return res.status(400).json({ error: "Fecha y cambios (edits) requeridos" });
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  // Iterate over product edits
  for (const [code, fields] of Object.entries(edits)) {
    const editFields = fields as any;
    const prodIdx = db.products.findIndex((p) => p.Codigo === code);
    let prod = prodIdx !== -1 ? db.products[prodIdx] : null;

    if (prod) {
      // Determine the final code to use (if renamed)
      const codeToUse = (editFields.Nuevo_Codigo && editFields.Nuevo_Codigo.trim().toUpperCase() !== code)
        ? editFields.Nuevo_Codigo.trim().toUpperCase()
        : code;

      // Cascade code renaming to products, orders, and priceHistory if different
      if (codeToUse !== code) {
        const conflict = db.products.some((p) => p.Codigo === codeToUse);
        if (conflict) {
          return res.status(400).json({ error: `El código ${codeToUse} ya está en uso por otro producto.` });
        }
        
        // Update product object code
        prod.Codigo = codeToUse;

        // Cascade to existing orders
        db.orders.forEach((o) => {
          if (o.Codigo === code) {
            o.Codigo = codeToUse;
          }
        });

        // Cascade to price history
        db.priceHistory.forEach((h) => {
          if (h.Codigo === code) {
            h.Codigo = codeToUse;
          }
        });
      }

      const costNew = editFields.Costo_Momento !== undefined ? parseFloat(editFields.Costo_Momento) : prod.Costo_Proveedor;
      const ventaNew = editFields.Precio_Venta_Actual !== undefined ? parseFloat(editFields.Precio_Venta_Actual) : prod.Precio_Venta_Actual;
      const utilNew = editFields.Utilidad !== undefined ? parseFloat(editFields.Utilidad) : prod.Utilidad;
      const provNew = editFields.Proveedor !== undefined ? editFields.Proveedor : prod.Proveedor;
      const nameNew = editFields.Producto !== undefined ? editFields.Producto : prod.Producto;
      const meNew = editFields.ME !== undefined ? parseFloat(editFields.ME) : null;
      const mermaNew = editFields.Merma !== undefined ? parseFloat(editFields.Merma) : null;
      const factorBultoNew = editFields.Factor_Bulto !== undefined ? parseFloat(editFields.Factor_Bulto) : null;
      const factorCanastillaNew = editFields.Factor_Canastilla !== undefined ? parseFloat(editFields.Factor_Canastilla) : null;

      // Add to price history if changed
      if (prod.Costo_Proveedor !== costNew || prod.Precio_Venta_Actual !== ventaNew) {
        db.priceHistory.push({
          Fecha_Hora: new Date().toISOString(),
          Codigo: codeToUse,
          Producto: nameNew,
          Costo_Anterior: prod.Costo_Proveedor,
          Costo_Nuevo: costNew,
          Venta_Anterior: prod.Precio_Venta_Actual,
          Venta_Nueva: ventaNew,
          Usuario: user || "Admin",
        });
      }

      // Update the product record
      db.products[prodIdx] = {
        ...prod,
        Producto: nameNew,
        Costo_Proveedor: costNew,
        Precio_Venta_Actual: ventaNew,
        Utilidad: utilNew,
        Proveedor: provNew,
        Precio_Anterior: prod.Costo_Proveedor,
        Venta_Anterior: prod.Precio_Venta_Actual,
        Merma: mermaNew !== null ? mermaNew : prod.Merma,
        Medida: editFields.Medida !== undefined ? editFields.Medida : prod.Medida,
      };

      if (provNew && provNew.trim() !== "" && provNew.toLowerCase().trim() !== "sin proveedor") {
        const provLower = provNew.toLowerCase().trim();
        const exists = db.providers.some((p) => p.Proveedor.toLowerCase().trim() === provLower);
        if (!exists) {
          db.providers.push({
            Proveedor: provNew.trim(),
            Celular: "",
          });
        }
      }

      if (meNew !== null) {
        const medLower = prod.Medida.toLowerCase();
        if (medLower.includes("bulto")) {
          db.products[prodIdx].Factor_Bulto = meNew;
        } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
          db.products[prodIdx].Factor_Canastilla = meNew;
        } else {
          db.products[prodIdx].Factor_Bulto = meNew;
          db.products[prodIdx].Factor_Canastilla = meNew;
        }
      }

      if (factorBultoNew !== null) {
        db.products[prodIdx].Factor_Bulto = factorBultoNew;
      }
      if (factorCanastillaNew !== null) {
        db.products[prodIdx].Factor_Canastilla = factorCanastillaNew;
      }

      // Re-read updated product
      prod = db.products[prodIdx];

      // Now update branch orders
      const branches = sucursalesOrdenadas(db.branchConfigs);
      for (const sucursal of branches) {
        const fieldVal = editFields[sucursal]; // e.g. "2" or "" or undefined
        if (fieldVal === undefined) {
          // If sucursal quantity wasn't edited, we still might need to update Costo_Momento, Proveedor, Precio_Venta_Momento
          // for any existing orders of this product on this date!
          const existingOrders = db.orders.filter(
            (o) => o.Fecha === fecha && o.Codigo === codeToUse && o.Sucursal.trim().toLowerCase() === sucursal.toLowerCase()
          );
          for (const o of existingOrders) {
            const idx = db.orders.findIndex((xo) => xo.ID_Pedido === o.ID_Pedido && xo.Codigo === o.Codigo);
            if (idx !== -1) {
              db.orders[idx] = {
                ...db.orders[idx],
                Costo_Momento: editFields.Costo_Momento !== undefined ? parseFloat(editFields.Costo_Momento) : db.orders[idx].Costo_Momento,
                Precio_Venta_Momento: editFields.Precio_Venta_Actual !== undefined ? parseFloat(editFields.Precio_Venta_Actual) : db.orders[idx].Precio_Venta_Momento,
                Proveedor: editFields.Proveedor !== undefined ? editFields.Proveedor : db.orders[idx].Proveedor,
                Porcentaje_Ganancia: editFields.Utilidad !== undefined ? parseFloat(editFields.Utilidad) : db.orders[idx].Porcentaje_Ganancia,
                Producto: editFields.Producto !== undefined ? editFields.Producto : db.orders[idx].Producto,
                Medida: editFields.Medida !== undefined ? editFields.Medida : db.orders[idx].Medida,
              };
            }
          }
          continue;
        }

        // The branch quantity was edited!
        const qtyStr = String(fieldVal).trim();
        const qtyNum = parseQty(qtyStr);

        const existingOrder = db.orders.find(
          (o) => o.Fecha === fecha && o.Codigo === codeToUse && o.Sucursal.trim().toLowerCase() === sucursal.toLowerCase()
        );

        if (qtyNum <= 0 || qtyStr === "" || qtyStr === "0" || qtyStr === "-") {
          // If quantity is 0/empty, remove existing order if present
          if (existingOrder) {
            db.orders = db.orders.filter(
              (o) => !(o.Fecha === fecha && o.Codigo === codeToUse && o.Sucursal.trim().toLowerCase() === sucursal.toLowerCase())
            );
          }
        } else {
          // Quantity is > 0, we upsert order
          const cost = editFields.Costo_Momento !== undefined ? parseFloat(editFields.Costo_Momento) : (prod ? prod.Costo_Proveedor : 0);
          const venta = editFields.Precio_Venta_Actual !== undefined ? parseFloat(editFields.Precio_Venta_Actual) : (prod ? prod.Precio_Venta_Actual : 0);
          const util = editFields.Utilidad !== undefined ? parseFloat(editFields.Utilidad) : (prod ? prod.Utilidad : 0.3);
          const prov = editFields.Proveedor !== undefined ? editFields.Proveedor : (prod ? prod.Proveedor : "Sin Proveedor");
          const name = editFields.Producto !== undefined ? editFields.Producto : (prod ? prod.Producto : codeToUse);
          const med = editFields.Medida !== undefined ? editFields.Medida : (prod ? prod.Medida : "Kg");

          // Calculate kilos
          let kilos = 0;
          const factorBulto = prod ? prod.Factor_Bulto : 1;
          const factorCanastilla = prod ? prod.Factor_Canastilla : 1;
          const medLower = med.toLowerCase();
          if (medLower.includes("bulto") || medLower === "kg") {
            kilos = qtyNum * factorBulto;
          } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
            kilos = qtyNum * factorCanastilla;
          } else {
            kilos = qtyNum;
          }

          if (existingOrder) {
            const idx = db.orders.findIndex((o) => o.ID_Pedido === existingOrder.ID_Pedido && o.Codigo === existingOrder.Codigo);
            if (idx !== -1) {
              db.orders[idx] = {
                ...db.orders[idx],
                Cantidad: qtyStr,
                Costo_Momento: cost,
                Precio_Venta_Momento: venta,
                Proveedor: prov,
                Porcentaje_Ganancia: util,
                Kilos: kilos,
                Producto: name,
                Medida: med,
                Notas: editFields[sucursal + "_Obs"] !== undefined ? editFields[sucursal + "_Obs"] : (editFields.Observacion !== undefined ? editFields.Observacion : db.orders[idx].Notas),
              };
            }
          } else {
            // Create new order
            const oid = `PED-${sucursal.toUpperCase()}-${timestamp}`;
            const newOrder = {
              ID_Pedido: oid,
              Fecha: fecha,
              Sucursal: sucursal,
              Codigo: codeToUse,
              Producto: name,
              Medida: med,
              Cantidad: qtyStr,
              Notas: editFields[sucursal + "_Obs"] !== undefined ? editFields[sucursal + "_Obs"] : (editFields.Observacion || ""),
              Precio_Anterior: prod ? prod.Precio_Venta_Actual : 0,
              Porcentaje_Ganancia: util,
              Cantidad_Comprada: 0,
              Costo_Momento: cost,
              Precio_Venta_Momento: venta,
              Kilos: kilos,
              Estado: "Pendiente",
              Estado_Pago: "Pendiente",
              Proveedor: prov,
              Celular: prod ? prod.Celular : "",
            };
            db.orders.push(newOrder);
          }
        }
      }
    }
  }

  await saveDb(db, ["products", "orders", "priceHistory", "providers"]);
  res.json({ success: true });
});

// Closures (Cierre Diario)
app.get("/api/closures", (req, res) => {
  try {
    const { sucursal } = req.query;
    if (!Array.isArray(db.closures)) {
      db.closures = [];
    }
    let filtered = filtrarPorSucursal(req, db.closures, (c) => c && c.Sucursal);
    if (sucursal) {
      filtered = filtered.filter(
        (c) => c && String(c.Sucursal || "").toLowerCase().trim() === String(sucursal || "").toLowerCase().trim()
      );
    }
    res.json(filtered);
  } catch (err: any) {
    console.error("Error en GET /api/closures:", err);
    res.status(500).json({ error: "Error al obtener cierres" });
  }
});

app.post("/api/closures", async (req, res) => {
  try {
    const { Fecha, Sucursal, Ventas_Totales, Gastos_Extra, Descripcion_Gastos, Persona_Recogio, Foto_Factura } = req.body;
    if (!Sucursal) {
      return res.status(400).json({ error: "Datos de cierre incompletos: Sucursal es requerida" });
    }

    if (!puedeVerSucursal(req, Sucursal)) {
      return res.status(403).json({ error: "No puedes registrar cierres de esta sucursal." });
    }
    const fotoCierre = revisarFoto(Foto_Factura);
    if (fotoCierre) return res.status(400).json({ error: fotoCierre });

    // Un cierre sin plata no dice nada y ensucia el histórico: los cierres en $0
    // del 1 de septiembre salieron de guardar el formulario en blanco. Se rechaza
    // aquí además de en pantalla, para que tampoco entre por la cola sin conexión.
    if ((parseFloat(Ventas_Totales) || 0) <= 0) {
      return res.status(400).json({
        error: "El cierre no puede quedar en cero. Escriba el efectivo contado antes de guardarlo.",
      });
    }

    const closureDate = Fecha || getColombiaDate();
    const collector = Persona_Recogio && String(Persona_Recogio).trim() ? String(Persona_Recogio).trim() : "Hamilton";
    const branchTrim = String(Sucursal).trim();

    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    // Cada envío crea un cierre nuevo — una sucursal puede registrar varios cierres el mismo día
    // (por ejemplo uno por turno) en vez de sobrescribir el anterior.
    const idCierre = `CLS-${branchTrim.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${closureDate}-${Date.now()}`;
    const newClosure: DailyClosure = {
      ID_Cierre: idCierre,
      Fecha: closureDate,
      Sucursal: branchTrim,
      Ventas_Totales: parseFloat(Ventas_Totales) || 0,
      Gastos_Extra: parseFloat(Gastos_Extra) || 0,
      Descripcion_Gastos: Descripcion_Gastos || "",
      Persona_Recogio: collector,
      Recaudado_Fisico: false,
      Foto_Factura: Foto_Factura || undefined,
    };
    db.closures.push(newClosure);

    // Cada cierre genera su propia transacción de billetera (no se reutiliza ninguna existente)
    const neto = newClosure.Ventas_Totales - newClosure.Gastos_Extra;
    const newTx: WalletTransaction = {
      ID_Transaccion: genRecordId("TXN", branchTrim, closureDate),
      Fecha: closureDate,
      Sucursal: branchTrim,
      Tipo_Movimiento: "Ingreso",
      Valor: neto,
      Descripcion: `Cierre de Caja - Efectivo neto registrado (${idCierre})`,
      Responsable: collector,
      Estado: "Pendiente",
    };
    db.walletTransactions.push(newTx);

    try {
      await saveDb(db, ["closures", "walletTransactions"]);
    } catch (saveErr) {
      // Se revierte lo agregado en memoria: si no, un reintento de la sucursal
      // crearía un segundo cierre y el próximo guardado exitoso persistiría ambos.
      const ci = db.closures.indexOf(newClosure);
      if (ci !== -1) db.closures.splice(ci, 1);
      const ti = db.walletTransactions.indexOf(newTx);
      if (ti !== -1) db.walletTransactions.splice(ti, 1);
      throw saveErr;
    }

    res.status(200).json(newClosure);
  } catch (err: any) {
    console.error("Error al registrar cierre:", err);
    res.status(500).json({ error: "Error al guardar el cierre: " + (err?.message || String(err)) });
  }
});

app.put("/api/closures", async (req, res) => {
  try {
    const { ID_Cierre, Fecha, Sucursal, Ventas_Totales, Gastos_Extra, Descripcion_Gastos, Persona_Recogio } = req.body;
    if (!ID_Cierre && (!Fecha || !Sucursal)) {
      return res.status(400).json({ error: "ID_Cierre (o Fecha y sucursal) requeridos" });
    }

    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    // Se identifica por ID_Cierre (una sucursal puede tener varios cierres el mismo día).
    // Se mantiene el respaldo por Fecha+Sucursal solo por compatibilidad con cierres muy antiguos.
    const index = ID_Cierre
      ? db.closures.findIndex((c) => c && c.ID_Cierre === ID_Cierre)
      : db.closures.findIndex((c) => c && c.Fecha === Fecha && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim());
    if (index === -1) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }

    db.closures[index].Ventas_Totales = parseFloat(Ventas_Totales) || 0;
    db.closures[index].Gastos_Extra = parseFloat(Gastos_Extra) || 0;
    db.closures[index].Descripcion_Gastos = Descripcion_Gastos || "";
    if (Persona_Recogio) {
      db.closures[index].Persona_Recogio = Persona_Recogio;
    }

    // Si el cierre ya estaba marcado como recaudado, "recaudado" debe seguir
    // significando "no queda nada pendiente". Sin esto, editar un cierre ya
    // recogido (subir o bajar la venta declarada) dejaba Monto_Recaudado con
    // el valor viejo: el cierre se veía completo pero en realidad quedaba una
    // diferencia que ningún reporte volvía a pedir — así se descuadró Nobsa.
    if (db.closures[index].Recaudado_Fisico) {
      db.closures[index].Monto_Recaudado =
        db.closures[index].Ventas_Totales - db.closures[index].Gastos_Extra;
    }

    const updatedClosure = db.closures[index];

    // Update corresponding wallet transaction (vinculada por el mismo ID_Cierre en su descripción)
    const neto = updatedClosure.Ventas_Totales - updatedClosure.Gastos_Extra;
    const txIdx = db.walletTransactions.findIndex(
      (t) => t && t.Fecha === updatedClosure.Fecha && String(t.Sucursal || "").toLowerCase().trim() === String(updatedClosure.Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Ingreso" && String(t.Descripcion || "").includes(updatedClosure.ID_Cierre)
    );
    if (txIdx !== -1) {
      db.walletTransactions[txIdx].Valor = neto;
      if (Persona_Recogio) {
        db.walletTransactions[txIdx].Responsable = Persona_Recogio;
      }
    }

    await saveDb(db, ["closures", "walletTransactions"]);

    res.json(updatedClosure);
  } catch (err: any) {
    console.error("Error al actualizar cierre:", err);
    res.status(500).json({ error: "Error al actualizar el cierre: " + (err?.message || String(err)) });
  }
});

app.put("/api/closures/reconcile", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  try {
    const { ID_Cierre, Fecha, Sucursal, Recaudado_Fisico } = req.body;
    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    // Se identifica por ID_Cierre (una sucursal puede tener varios cierres el mismo día).
    // Se mantiene el respaldo por Fecha+Sucursal solo por compatibilidad con cierres muy antiguos.
    const index = ID_Cierre
      ? db.closures.findIndex((c) => c && c.ID_Cierre === ID_Cierre)
      : db.closures.findIndex((c) => c && c.Fecha === Fecha && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim());
    if (index === -1) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }

    const isConfirmed = !!Recaudado_Fisico;
    db.closures[index].Recaudado_Fisico = isConfirmed;
    const netVal = db.closures[index].Ventas_Totales - db.closures[index].Gastos_Extra;

    if (isConfirmed) {
      db.closures[index].Monto_Recaudado = netVal;
    } else {
      db.closures[index].Monto_Recaudado = 0;
    }

    const updatedClosure = db.closures[index];

    // Reconcile corresponding wallet transaction (vinculada por el mismo ID_Cierre en su descripción)
    const txIdx = db.walletTransactions.findIndex(
      (t) => t && t.Fecha === updatedClosure.Fecha && String(t.Sucursal || "").toLowerCase().trim() === String(updatedClosure.Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Ingreso" && String(t.Descripcion || "").includes(updatedClosure.ID_Cierre)
    );
    if (txIdx !== -1) {
      db.walletTransactions[txIdx].Estado = isConfirmed ? "Reconciliado" : "Pendiente";
    }

    // Al desmarcar se saca del libro tanto la entrada al monedero central como
    // la salida del monedero de la sucursal. El saldo se lee del libro, así que
    // si quedaran, la plata seguiría contada con el cierre otra vez pendiente.
    //
    // Solo los movimientos DE LA RECOLECCIÓN. El cierre deja además su propio
    // movimiento ("Cierre de Caja - Efectivo neto registrado"), que representa
    // la venta del día y no tiene nada que ver con haberla recogido: borrarlo
    // hacía desaparecer el cierre del historial de monederos aunque siguiera
    // apareciendo en los recibos.
    if (!isConfirmed) {
      const esDeRecoleccion = (d: string) =>
        d.includes("Recolección") || d.includes("Retiro de efectivo") || d.includes("Retiro parcial");
      const sobrante = db.walletTransactions.filter(
        (t) => t && String(t.Descripcion || "").includes(updatedClosure.ID_Cierre) &&
          esDeRecoleccion(String(t.Descripcion || "")) &&
          (String(t.Sucursal || "") === "Central / Nequi" || norm(t.Sucursal) === norm(updatedClosure.Sucursal))
      );
      for (const t of sobrante) {
        db.walletTransactions.splice(db.walletTransactions.indexOf(t), 1);
        await deleteRowByClientId("wallet_transactions", (t as any)._id);
      }
    }

    // Record entry in Central / Nequi when confirmed
    if (isConfirmed && netVal > 0) {
      const today = getColombiaDate();
      const quienRecoge = req.auth?.u || "Admin / Comprador";
      const centralTxIdx = db.walletTransactions.findIndex(
        (t) => t && String(t.Sucursal || "") === "Central / Nequi" && String(t.Descripcion || "").includes(updatedClosure.ID_Cierre)
      );
      if (centralTxIdx === -1) {
        const centralTx: WalletTransaction = {
          ID_Transaccion: genRecordId("TXN", "CENTRAL", today),
          Fecha: today,
          Sucursal: "Central / Nequi",
          Tipo_Movimiento: "Ingreso",
          Valor: netVal,
          Descripcion: `Recolección Física Autorizada - ${updatedClosure.Sucursal} (${updatedClosure.Fecha}) [${updatedClosure.ID_Cierre}]`,
          Responsable: quienRecoge,
          Estado: "Reconciliado"
        };
        db.walletTransactions.push(centralTx);

        // La salida queda también en el monedero de la sucursal. Antes el retiro
        // solo se veía en la caja central, así que desde la tienda el dinero
        // desaparecía del saldo sin ninguna línea que dijera quién lo sacó.
        // Va como "Reconciliado" a propósito: el pendiente ya se descuenta del
        // cierre, y contarlo aquí otra vez lo restaría dos veces.
        db.walletTransactions.push({
          ID_Transaccion: genRecordId("TXN", updatedClosure.Sucursal, today),
          Fecha: today,
          Sucursal: updatedClosure.Sucursal,
          Tipo_Movimiento: "Gasto",
          Valor: netVal,
          Descripcion: `Retiro de efectivo hacia Caja Central - recogió ${quienRecoge} (cierre del ${updatedClosure.Fecha}) [${updatedClosure.ID_Cierre}]`,
          Responsable: quienRecoge,
          Estado: "Reconciliado"
        });
      }
    }

    await saveDb(db, ["closures", "walletTransactions"]);

    res.json(updatedClosure);
  } catch (err: any) {
    console.error("Error al reconciliar cierre:", err);
    res.status(500).json({ error: "Error al reconciliar cierre: " + (err?.message || String(err)) });
  }
});

/**
 * Borra un cierre de caja y los movimientos de monedero que generó.
 *
 * Existe porque un cierre mal registrado no se podía corregir de ninguna forma:
 * quedaba en el histórico para siempre. De ahí salieron los cierres en $0 que
 * confundían la lista.
 *
 * Van juntos el cierre, su entrada de monedero ("Cierre de Caja - Efectivo neto
 * registrado") y, si ya se había recaudado, la entrada a la caja central y el
 * retiro de la sucursal. Borrar solo uno dejaría el libro descuadrado.
 *
 * Respalda antes de tocar nada: si el respaldo falla, no se borra.
 */
/**
 * Corrige a mano cuánto de un cierre está recaudado, sin mover plata.
 *
 * Las rutas normales de recaudo (individual y en bloque) siempre crean un
 * movimiento nuevo en el monedero, porque asumen que están registrando una
 * recolección que ocurre ahora. Eso está bien para el trabajo del día, pero es
 * el ayudante equivocado para corregir un dato histórico — usarlas para eso
 * duplica el dinero (se creó y se tuvo que revertir un caso así).
 *
 * Este endpoint es solo para eso: ajustar el número sin tocar el monedero.
 */
app.put("/api/closures/:id/monto-recaudado", requireRole("Admin"), async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id).trim();
    const idx = (db.closures || []).findIndex((c) => c && c.ID_Cierre === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }
    const cierre = db.closures[idx];
    if (!puedeVerSucursal(req, cierre.Sucursal)) {
      return res.status(403).json({ error: "No puedes corregir cierres de esta sucursal." });
    }

    const neto = (cierre.Ventas_Totales || 0) - (cierre.Gastos_Extra || 0);
    const monto = Math.max(0, Math.min(neto, Number(req.body?.montoRecaudado) || 0));

    await respaldarAntesDeBorrar(`corregir el monto recaudado del cierre ${id}`);
    cierre.Monto_Recaudado = monto;
    cierre.Recaudado_Fisico = monto >= neto;
    await saveDb(db, ["closures"]);

    res.json({ success: true, cierre });
  } catch (err: any) {
    console.error("Error al corregir monto recaudado:", err);
    res.status(500).json({ error: "No se pudo corregir el cierre: " + (err?.message || String(err)) });
  }
});

app.delete("/api/closures/:id", requireRole("Admin"), async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id).trim();
    const idx = (db.closures || []).findIndex((c) => c && c.ID_Cierre === id);
    if (idx === -1) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }

    const cierre = db.closures[idx];
    if (!puedeVerSucursal(req, cierre.Sucursal)) {
      return res.status(403).json({ error: "No puedes borrar cierres de esta sucursal." });
    }

    const respaldoId = await respaldarAntesDeBorrar(`borrar el cierre ${id}`);

    // Todo movimiento que lleve el identificador del cierre en su descripción.
    const ligados = (db.walletTransactions || []).filter(
      (t) => t && String(t.Descripcion || "").includes(id)
    );
    for (const t of ligados) {
      db.walletTransactions.splice(db.walletTransactions.indexOf(t), 1);
      await deleteRowByClientId("wallet_transactions", (t as any)._id);
    }

    db.closures.splice(idx, 1);
    await deleteRowByClientId("closures", (cierre as any)._id);
    await saveDb(db, ["closures", "walletTransactions"]);

    res.json({
      success: true,
      respaldoPrevio: respaldoId,
      borrado: {
        id: cierre.ID_Cierre,
        sucursal: cierre.Sucursal,
        fecha: cierre.Fecha,
        ventas: cierre.Ventas_Totales,
        gastos: cierre.Gastos_Extra,
      },
      movimientosBorrados: ligados.length,
    });
  } catch (err: any) {
    console.error("Error al borrar cierre:", err);
    res.status(500).json({ error: "No se pudo borrar el cierre: " + (err?.message || String(err)) });
  }
});

app.post("/api/closures/bulk-reconcile", requireRole("Admin", "AdminSucursal", "Comprador"), async (req, res) => {
  try {
    const { Sucursal, Monto_Recogido } = req.body;
    if (!Sucursal) {
      return res.status(400).json({ error: "Sucursal es requerida para reconciliación en bloque" });
    }
    if (!puedeVerSucursal(req, Sucursal)) {
      return res.status(403).json({ error: "No puedes recaudar el efectivo de esta sucursal." });
    }
    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    const uncollectedClosures = db.closures.filter(
      (c) => c && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && !c.Recaudado_Fisico
    );

    // Gastos de caja menor (Monedero Bodega) todavía pendientes de esta sucursal.
    let totalPendingExpenses = 0;
    const gastosAReconciliar: any[] = [];
    db.walletTransactions.forEach((t) => {
      if (t && String(t.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Gasto" && t.Estado === "Pendiente") {
        totalPendingExpenses += t.Valor;
        gastosAReconciliar.push(t);
      }
    });

    let totalClosuresAmount = uncollectedClosures.reduce((acc, c) => acc + (c.Ventas_Totales - c.Gastos_Extra), 0);
    const maxRecogible = Math.max(0, totalClosuresAmount - totalPendingExpenses);

    let isPartial = false;
    let customCollected = 0;
    if (Monto_Recogido !== undefined && Monto_Recogido !== null && Monto_Recogido !== "") {
      customCollected = Number(Monto_Recogido);
      isPartial = true;
      // Sin este tope, pedir recoger más de lo que la sucursal debe retiraba esa
      // plata de más del monedero (y la sumaba a la Caja Central) sin que
      // ningún cierre quedara marcado por ella: así se descuadró Nobsa, con
      // $5.021.000 retirados de más que ningún cierre reclamaba.
      if (customCollected > maxRecogible) {
        return res.status(400).json({
          error: `Esta sucursal solo tiene ${cop(maxRecogible)} pendientes de recoger. No se puede registrar un recaudo de ${cop(customCollected)}.`,
        });
      }
    } else {
      customCollected = maxRecogible;
    }

    // Los cierres que este recaudo deja completamente saldados, para reconciliar
    // solo SUS movimientos de monedero — no los de cierres que sigan pendientes.
    const idsCerradosEnEstaPasada = new Set<string>();

    // Reconcile closures
    if (isPartial) {
      const sortedPending = [...uncollectedClosures].sort((a, b) => (a.Fecha || "").localeCompare(b.Fecha || ""));
      let remainingToAllocate = customCollected;

      sortedPending.forEach((c) => {
        const netVal = c.Ventas_Totales - c.Gastos_Extra;
        const currentRecaudado = c.Monto_Recaudado || 0;
        const remainingForThisClosure = Math.max(0, netVal - currentRecaudado);

        if (remainingToAllocate <= 0) {
          return;
        }

        if (remainingToAllocate >= remainingForThisClosure) {
          c.Monto_Recaudado = netVal;
          c.Recaudado_Fisico = true;
          idsCerradosEnEstaPasada.add(c.ID_Cierre);
          remainingToAllocate -= remainingForThisClosure;
        } else {
          c.Monto_Recaudado = currentRecaudado + remainingToAllocate;
          remainingToAllocate = 0;
        }
      });
    } else {
      db.closures.forEach((c) => {
        if (c && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && !c.Recaudado_Fisico) {
          c.Recaudado_Fisico = true;
          c.Monto_Recaudado = c.Ventas_Totales - c.Gastos_Extra;
          idsCerradosEnEstaPasada.add(c.ID_Cierre);
        }
      });
    }

    // Ahora sí se marcan como reconciliados: los gastos de caja menor que se
    // acaban de cubrir, y solo el movimiento "Cierre de Caja" de los cierres
    // que quedaron completamente saldados en esta pasada.
    gastosAReconciliar.forEach((t) => { t.Estado = "Reconciliado"; });
    if (idsCerradosEnEstaPasada.size > 0) {
      db.walletTransactions.forEach((t) => {
        if (
          t && t.Tipo_Movimiento === "Ingreso" && t.Estado !== "Reconciliado" &&
          [...idsCerradosEnEstaPasada].some((id) => String(t.Descripcion || "").includes(id))
        ) {
          t.Estado = "Reconciliado";
        }
      });
    }

    // Add a transaction representing this cash pickup to the Central Bank Ledger / general Nequi
    const today = getColombiaDate();
    const quienRecoge = req.auth?.u || "Admin / Comprador";
    const newTx: WalletTransaction = {
      ID_Transaccion: genRecordId("TXN", "CENTRAL", today),
      Fecha: today,
      Sucursal: "Central / Nequi",
      Tipo_Movimiento: "Ingreso",
      Valor: customCollected,
      Descripcion: isPartial
        ? `Recolección Física Parcial Autorizada - ${Sucursal}`
        : `Recolección Física Autorizada - ${Sucursal}`,
      Responsable: quienRecoge,
      Estado: "Reconciliado"
    };
    db.walletTransactions.push(newTx);

    // La salida queda también en el monedero de la sucursal, con el nombre de
    // quien la recogió. Antes el retiro solo se veía en la caja central: desde
    // la tienda el dinero bajaba del saldo sin ninguna línea que lo explicara.
    // Va como "Reconciliado" porque el pendiente ya se descuenta del cierre.
    if (customCollected > 0) {
      db.walletTransactions.push({
        ID_Transaccion: genRecordId("TXN", String(Sucursal), today),
        Fecha: today,
        Sucursal: String(Sucursal).trim(),
        Tipo_Movimiento: "Gasto",
        Valor: customCollected,
        Descripcion: isPartial
          ? `Retiro parcial de efectivo hacia Caja Central - recogió ${quienRecoge}`
          : `Retiro de efectivo hacia Caja Central - recogió ${quienRecoge}`,
        Responsable: quienRecoge,
        Estado: "Reconciliado"
      });
    }

    await saveDb(db, ["closures", "walletTransactions"]);

    res.json({
      success: true,
      totalCollected: customCollected, 
      msg: isPartial
        ? `Se registró un recaudo parcial de ${customCollected} para la sucursal ${Sucursal}`
        : `Se reconcilió un total neto de ${customCollected} (descontando gastos directos de monedero por ${totalPendingExpenses}) para la sucursal ${Sucursal}`
    });
  } catch (err: any) {
    console.error("Error en bulk-reconcile:", err);
    res.status(500).json({ error: "Error al reconciliar en bloque: " + (err?.message || String(err)) });
  }
});

app.post("/api/payroll/schedules/bulk", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { schedules, clearEmployee, clearMonth } = req.body;
  if (!schedules || !Array.isArray(schedules)) {
    return res.status(400).json({ error: "Arreglo de horarios es requerido" });
  }

  if (clearEmployee && clearMonth) {
    db.schedules = db.schedules.filter(
      (s) => !(s.Empleado.toLowerCase() === clearEmployee.toLowerCase() && s.Fecha.startsWith(clearMonth))
    );
  } else if (req.body.clearDates && Array.isArray(req.body.clearDates)) {
    const datesSet = new Set(req.body.clearDates);
    if (clearEmployee && clearEmployee !== "ALL") {
      db.schedules = db.schedules.filter(
        (s) => !(s.Empleado.toLowerCase() === clearEmployee.toLowerCase() && datesSet.has(s.Fecha))
      );
    } else {
      db.schedules = db.schedules.filter(
        (s) => !datesSet.has(s.Fecha)
      );
    }
  }

  schedules.forEach((s) => {
    const newSched: EmployeeSchedule = {
      Fecha: s.Fecha || getColombiaDate(),
      Empleado: s.Empleado,
      Sucursal: s.Sucursal,
      Horas_Trabajadas: parseFloat(s.Horas_Trabajadas) || 0,
    };
    db.schedules.push(newSched);
  });

  await saveDb(db, ["schedules"]);
  res.json({ success: true, count: schedules.length });
});

// Get all wallet transactions for admin
app.get("/api/wallet-transactions", (req, res) => {
  res.json(filtrarPorSucursal(req, db.walletTransactions, (t) => t && t.Sucursal));
});

// Wallet balance and history per Branch
app.get("/api/wallet/:branch", (req, res) => {
  const { branch } = req.params;
  const isCentral = branch.toLowerCase().includes("central") || branch.toLowerCase().includes("nequi");

  // El monedero central consolida el dinero de todas las sucursales, así que solo
  // lo ve quien tiene alcance global. Un administrador de una sola sucursal
  // conocería por ahí los totales de las demás.
  if (isCentral && req.auth?.r !== "Admin" && req.auth?.r !== "Comprador") {
    return res.status(403).json({ error: "No tienes acceso al monedero central." });
  }
  if (!isCentral && !puedeVerSucursal(req, branch)) {
    return res.status(403).json({ error: "No tienes acceso a esta sucursal." });
  }

  let balance = 0;
  if (isCentral) {
    // El saldo sale del libro de "Central / Nequi": entra lo que entró y sale lo
    // que salió. Antes el ingreso se rearmaba a partir de los cierres marcados
    // como recogidos más los movimientos que no dijeran "Recolección Física", y
    // una recogida parcial no entraba por ninguna de las dos vías.
    const paidPayrollSum = filtrarPorSucursal(req, db.payroll || [], (p) => p && p.Sucursal)
      .reduce((acc, p) => acc + (p?.Total_Neto || 0), 0);

    const privadas = sucursalesConAdminPropio();
    const centralTxs = (db.walletTransactions || []).filter((t) => {
      const s = (t?.Sucursal || "").toLowerCase().trim();
      if (!s.includes("central") && !s.includes("nequi")) return false;
      // Una sucursal con administrador propio queda fuera de los totales del
      // administrador general, también cuando su plata pasa por la caja central.
      if (req.auth?.r === "Admin" && privadas.size > 0) {
        const d = (t?.Descripcion || "").toLowerCase();
        for (const p of privadas) if (d.includes(p.toLowerCase())) return false;
      }
      return true;
    });

    const centralIngresos = centralTxs
      .filter((t) => t.Tipo_Movimiento === "Ingreso")
      .reduce((acc, t) => acc + (t.Valor || 0), 0);

    const centralGastos = centralTxs
      .filter((t) => t.Tipo_Movimiento === "Gasto")
      .reduce((acc, t) => acc + (t.Valor || 0), 0);

    balance = centralIngresos - (paidPayrollSum + centralGastos);
  } else {
    const targetBranch = branch.toLowerCase().trim();
    // De cada cierre sin recoger queda el neto menos lo ya recogido a cuenta.
    const uncollectedClosuresSum = (db.closures || [])
      .filter(
        (c) =>
          c &&
          !c.Recaudado_Fisico &&
          (c.Sucursal || "").toLowerCase().trim() === targetBranch
      )
      .reduce(
        (acc, c) =>
          acc +
          Math.max(0, (c.Ventas_Totales || 0) - (c.Gastos_Extra || 0) - (c.Monto_Recaudado || 0)),
        0
      );

    const pendingExpensesSum = (db.walletTransactions || [])
      .filter(
        (t) =>
          t &&
          (t.Sucursal || "").toLowerCase().trim() === targetBranch &&
          t.Tipo_Movimiento === "Gasto" &&
          (t.Estado === "Pendiente" || !t.Estado)
      )
      .reduce((acc, t) => acc + (t.Valor || 0), 0);

    balance = Math.max(0, uncollectedClosuresSum - pendingExpensesSum);
  }

  const txs = (db.walletTransactions || []).filter((t) => {
    const s = (t?.Sucursal || "").toLowerCase().trim();
    return isCentral ? (s.includes("central") || s.includes("nequi")) : s === branch.toLowerCase().trim();
  });

  res.json({
    balance,
    transactions: txs.sort((a, b) => (b.Fecha || "").localeCompare(a.Fecha || "")),
  });
});

app.post("/api/wallet/:branch/expense", async (req, res) => {
  const { branch } = req.params;
  const { Valor_Gasto, Descripcion_Gasto, Responsable, Fecha, Foto_Factura } = req.body;

  if (!Valor_Gasto || !Descripcion_Gasto) {
    return res.status(400).json({ error: "Valor y descripción del gasto requeridos" });
  }
  if (!puedeVerSucursal(req, branch)) {
    return res.status(403).json({ error: "No puedes registrar movimientos de este monedero." });
  }
  const fotoGasto = revisarFoto(Foto_Factura);
  if (fotoGasto) return res.status(400).json({ error: fotoGasto });
  const valorGasto = Number(Valor_Gasto);
  if (!Number.isFinite(valorGasto) || valorGasto <= 0) {
    return res.status(400).json({ error: "El valor del gasto debe ser un número mayor a cero." });
  }

  const txDate = Fecha || getColombiaDate();

  const newTx: WalletTransaction = {
    ID_Transaccion: genRecordId("TXN", branch, txDate),
    Fecha: txDate,
    Sucursal: branch,
    Tipo_Movimiento: "Gasto",
    Valor: valorGasto,
    Descripcion: Descripcion_Gasto,
    Responsable: Responsable || "System",
    Estado: "Pendiente",
    Foto_Factura: Foto_Factura || undefined,
  };

  db.walletTransactions.push(newTx);

  const newExpense = {
    ID_Gasto: genRecordId("GST", branch, txDate),
    Fecha: txDate,
    Sucursal: branch,
    Valor_Gasto: valorGasto,
    Descripcion_Gasto: Descripcion_Gasto,
    Responsable: Responsable || "System",
    Reconciliado_Fisico: false,
  };

  db.nequiExpenses.push(newExpense);

  await saveDb(db, ["walletTransactions", "nequiExpenses"]);

  res.status(210).json(newTx);
});

app.post("/api/wallet/:branch/transaction", async (req, res) => {
  const { branch } = req.params;
  const { Fecha, Tipo_Movimiento, Valor, Descripcion, Responsable } = req.body;

  if (!Valor || !Descripcion || !Tipo_Movimiento) {
    return res.status(400).json({ error: "Valor, descripción y tipo de movimiento requeridos" });
  }
  if (!puedeVerSucursal(req, branch)) {
    return res.status(403).json({ error: "No puedes registrar movimientos de este monedero." });
  }
  if (Tipo_Movimiento !== "Ingreso" && Tipo_Movimiento !== "Gasto") {
    return res.status(400).json({ error: "El tipo de movimiento debe ser Ingreso o Gasto." });
  }
  const valorMovimiento = Number(Valor);
  if (!Number.isFinite(valorMovimiento) || valorMovimiento <= 0) {
    return res.status(400).json({ error: "El valor debe ser un número mayor a cero." });
  }

  const txDate = Fecha || getColombiaDate();

  const newTx: WalletTransaction = {
    ID_Transaccion: genRecordId("TXN", branch, txDate),
    Fecha: txDate,
    Sucursal: branch,
    Tipo_Movimiento: Tipo_Movimiento as "Ingreso" | "Gasto",
    Valor: valorMovimiento,
    Descripcion: Descripcion,
    Responsable: Responsable || "System",
    Estado: "Reconciliado",
  };

  db.walletTransactions.push(newTx);
  await saveDb(db, ["walletTransactions"]);


  res.status(210).json(newTx);
});

/**
 * Borra un movimiento del monedero.
 *
 * Existe porque un movimiento mal cargado no se podía corregir de ninguna
 * forma: quedaba en el libro para siempre y había que compensarlo con otro
 * movimiento inventado, que es de donde salieron los "ajustes para cuadrar".
 *
 * Si el movimiento era la entrada de una recolección, el cierre que la generó
 * vuelve a quedar pendiente en la tienda. Sin eso la plata desaparecería de los
 * dos lados: ni en la caja central ni en el efectivo del punto.
 */
app.delete("/api/wallet/transaction/:id", requireRole("Admin"), async (req, res) => {
  const id = decodeURIComponent(req.params.id).trim();
  const idx = (db.walletTransactions || []).findIndex((t) => t && t.ID_Transaccion === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Movimiento no encontrado" });
  }

  const tx = db.walletTransactions[idx];
  if (!puedeVerSucursal(req, tx.Sucursal)) {
    return res.status(403).json({ error: "No puedes borrar movimientos de este monedero." });
  }

  // El identificador del cierre viaja entre corchetes al final de la descripción.
  let cierreLiberado: string | null = null;
  const texto = String(tx.Descripcion || "");
  const abre = texto.lastIndexOf("[");
  const cierra = texto.lastIndexOf("]");
  if (abre !== -1 && cierra > abre) {
    const idCierre = texto.slice(abre + 1, cierra).trim();
    const cierre = (db.closures || []).find((c) => c && c.ID_Cierre === idCierre);
    if (cierre) {
      cierre.Recaudado_Fisico = false;
      cierre.Monto_Recaudado = 0;
      cierreLiberado = cierre.ID_Cierre;
    }
  }

  db.walletTransactions.splice(idx, 1);
  await deleteRowByClientId("wallet_transactions", (tx as any)._id);

  // Una recolección deja dos líneas: la entrada a la caja central y la salida
  // del monedero de la sucursal. Se borran juntas, o el libro de la tienda
  // seguiría mostrando un retiro que ya no existe.
  let parejaBorrada = 0;
  if (cierreLiberado) {
    const pareja = db.walletTransactions.filter(
      (t) => t && String(t.Descripcion || "").includes(cierreLiberado as string)
    );
    for (const t of pareja) {
      db.walletTransactions.splice(db.walletTransactions.indexOf(t), 1);
      await deleteRowByClientId("wallet_transactions", (t as any)._id);
      parejaBorrada++;
    }
  }

  await saveDb(db, cierreLiberado ? ["walletTransactions", "closures"] : ["walletTransactions"]);

  res.json({
    success: true,
    borrado: { id: tx.ID_Transaccion, valor: tx.Valor, tipo: tx.Tipo_Movimiento, descripcion: tx.Descripcion },
    cierreLiberado,
    movimientosLigadosBorrados: parejaBorrada,
  });
});

// Mermas (Shrinkage)
app.get("/api/shrinkages", (req, res) => {
  const { sucursal } = req.query;
  let filtered = filtrarPorSucursal(req, db.shrinkages, (s) => s && s.Sucursal);
  if (sucursal) {
    filtered = filtered.filter(
      (s) => s.Sucursal.toLowerCase().trim() === (sucursal as string).toLowerCase().trim()
    );
  }
  res.json(filtered.sort((a, b) => b.Fecha.localeCompare(a.Fecha)));
});

app.post("/api/shrinkages", async (req, res) => {
  const { Fecha, Sucursal, Codigo, Cantidad, Unidad, Motivo, Foto } = req.body;
  if (!Sucursal || !Codigo || !Cantidad) {
    return res.status(400).json({ error: "Datos de merma incompletos" });
  }
  if (!puedeVerSucursal(req, Sucursal)) {
    return res.status(403).json({ error: "No puedes registrar mermas de esta sucursal." });
  }
  const fotoMerma = revisarFoto(Foto);
  if (fotoMerma) return res.status(400).json({ error: fotoMerma });

  const prod = db.products.find((p) => p.Codigo === Codigo);
  if (!prod) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }

  const qty = parseQty(Cantidad) || 1;
  const unit = Unidad || "Kg";

  let loss = 0;
  let displayQty = String(Cantidad);

  if (unit === "Bultos") {
    const bultoWeight = prod.Factor_Bulto || 56;
    if (prod.Medida.toLowerCase().includes("bulto")) {
      loss = Math.round(qty * prod.Precio_Venta_Actual);
    } else {
      const totalKilos = qty * bultoWeight;
      loss = Math.round(totalKilos * prod.Precio_Venta_Actual);
    }
    displayQty = `${Cantidad} Bto(s)`;
  } else if (unit === "Canastillas") {
    const canWeight = prod.Factor_Canastilla || 22;
    if (prod.Medida.toLowerCase().includes("canastilla") || prod.Medida.toLowerCase().includes("guacal")) {
      loss = Math.round(qty * prod.Precio_Venta_Actual);
    } else {
      const totalKilos = qty * canWeight;
      loss = Math.round(totalKilos * prod.Precio_Venta_Actual);
    }
    displayQty = `${Cantidad} Can(s)`;
  } else {
    // Default Kg
    if (prod.Medida.toLowerCase().includes("bulto")) {
      const bultoWeight = prod.Factor_Bulto || 56;
      loss = Math.round((qty / bultoWeight) * prod.Precio_Venta_Actual);
    } else {
      loss = Math.round(qty * prod.Precio_Venta_Actual);
    }
    displayQty = `${Cantidad} Kg`;
  }

  const newShrinkage: Shrinkage = {
    Fecha: Fecha || getColombiaDate(),
    Sucursal,
    Codigo,
    Producto: prod.Producto,
    Cantidad: displayQty,
    Unidad: unit,
    Motivo: Motivo || "Merma general",
    Costo_Proveedor: prod.Costo_Proveedor,
    Perdida_Monetaria: loss,
    Foto,
  };

  db.shrinkages.push(newShrinkage);
  await saveDb(db, ["shrinkages"]);
  res.status(210).json(newShrinkage);
});

// Packaging Assets (Canastillas / Estibas)
app.get("/api/packaging", (req, res) => {
  res.json(db.packagingMovements.sort((a, b) => b.Fecha.localeCompare(a.Fecha)));
});

app.post("/api/packaging", async (req, res) => {
  const { Fecha, Proveedor, Tipo_Activo, Cantidad_Entregada, Cantidad_Devuelta, Notas } = req.body;
  if (!Proveedor || !Tipo_Activo) {
    return res.status(400).json({ error: "Proveedor y Tipo de Activo requeridos" });
  }

  const newMovement: PackagingMovement = {
    ID_Movimiento: `MOV-${Date.now()}`,
    Fecha: Fecha || getColombiaDate(),
    Proveedor,
    Tipo_Activo,
    Cantidad_Entregada: parseInt(Cantidad_Entregada) || 0,
    Cantidad_Devuelta: parseInt(Cantidad_Devuelta) || 0,
    Notas: Notas || "",
  };

  db.packagingMovements.push(newMovement);
  await saveDb(db, ["packagingMovements"]);
  res.status(210).json(newMovement);
});

// Payroll schedules, loans and generating payroll
app.get("/api/payroll/data", (req, res) => {
  // Horarios, préstamos y nómina son por sucursal. Las tarifas por empleado no
  // llevan sucursal, así que se derivan de los empleados visibles.
  const schedules = filtrarPorSucursal(req, db.schedules || [], (s) => s && s.Sucursal);
  const loans = filtrarPorSucursal(req, db.loans || [], (l) => l && l.Sucursal);
  const payroll = filtrarPorSucursal(req, db.payroll || [], (p) => p && p.Sucursal);

  let rates = db.rates || [];
  if (req.auth?.r === "AdminSucursal" || req.auth?.r === "Sucursal") {
    // Un empleado se ve si pertenece a la sucursal, o si ya tiene movimiento en
    // ella. Lo primero es lo que permite dar de alta a alguien y verlo de
    // inmediato: antes solo aparecía después de asignarle un turno, así que un
    // empleado recién creado quedaba invisible para su propio administrador.
    const empleadosVisibles = new Set<string>();
    for (const s of schedules) empleadosVisibles.add(norm(s.Empleado));
    for (const l of loans) empleadosVisibles.add(norm(l.Empleado));
    for (const p of payroll) empleadosVisibles.add(norm(p.Trabajador));
    rates = rates.filter(
      (r) => r && (puedeVerSucursal(req, r.Sucursal) || empleadosVisibles.has(norm(r.Empleado)))
    );
  } else if (req.auth?.r === "Admin") {
    // El aislamiento va en los dos sentidos: el personal propio de una sucursal
    // con administrador no aparece en la nómina del administrador general.
    // Los empleados sin sucursal asignada son del negocio y los sigue viendo.
    const privadas = sucursalesConAdminPropio();
    rates = rates.filter((r) => !r?.Sucursal || !privadas.has(norm(r.Sucursal)));
  }

  res.json({ schedules, loans, rates, payroll });
});

app.post("/api/payroll/rates", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { Empleado, Valor_Dia, Valor_Hora, Auxilio_Transporte, Celular, Cedula } = req.body;
  if (!Empleado) {
    return res.status(400).json({ error: "El nombre del empleado es requerido" });
  }
  const exists = db.rates.some(r => r.Empleado.toLowerCase() === Empleado.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: "Ya existe un empleado con ese nombre" });
  }
  // Un administrador de sucursal solo puede dar de alta personal suyo, y queda
  // asignado a su sucursal para que lo vea de inmediato sin asignarle turnos.
  const sucursalDelEmpleado =
    req.auth?.r === "AdminSucursal" ? req.auth.s : (req.body.Sucursal || undefined);

  if (sucursalDelEmpleado && !puedeVerSucursal(req, sucursalDelEmpleado)) {
    return res.status(403).json({ error: "No puedes crear personal en esta sucursal." });
  }

  const newRate = {
    Empleado,
    Sucursal: sucursalDelEmpleado,
    Valor_Dia: Math.round(parseFloat(Valor_Dia) || 60000),
    Valor_Hora: Math.round(parseFloat(Valor_Hora) || 9000),
    Auxilio_Transporte: Math.round(parseFloat(Auxilio_Transporte) || 8303),
    Celular: Celular || "",
    Cedula: Cedula || ""
  };
  db.rates.push(newRate);
  await saveDb(db, ["rates"]);
  res.status(200).json(newRate);
});

app.put("/api/payroll/rates/:name", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const oldName = decodeURIComponent(req.params.name).trim();
  const { Empleado, Valor_Dia, Valor_Hora, Auxilio_Transporte, Celular, Cedula } = req.body;
  const index = db.rates.findIndex(r => r.Empleado.toLowerCase().trim() === oldName.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }

  // Un administrador de sucursal solo edita personal suyo. Sin esto podía
  // cambiarle el sueldo a cualquiera con solo saberse el nombre.
  if (req.auth?.r === "AdminSucursal" && !puedeVerSucursal(req, db.rates[index].Sucursal)) {
    return res.status(403).json({ error: "Este empleado no pertenece a tu sucursal." });
  }

  // La sucursal se conserva. Antes se rearmaba el registro sin ella, así que
  // cualquier edición — cambiar un valor, un celular — dejaba al empleado sin
  // sucursal y volvía a aparecer en la nómina del administrador general.
  let sucursalDelEmpleado = db.rates[index].Sucursal;
  if (req.auth?.r === "Admin" && req.body.Sucursal !== undefined) {
    sucursalDelEmpleado = req.body.Sucursal || undefined;
  }

  const updatedName = (Empleado || oldName).trim();

  if (updatedName.toLowerCase() !== oldName.toLowerCase()) {
    const exists = db.rates.some(r => r.Empleado.toLowerCase().trim() === updatedName.toLowerCase() && r.Empleado.toLowerCase().trim() !== oldName.toLowerCase());
    if (exists) {
      return res.status(400).json({ error: "Ya existe otro empleado con el nombre nuevo" });
    }

    db.schedules.forEach(s => {
      if (s.Empleado.toLowerCase().trim() === oldName.toLowerCase()) s.Empleado = updatedName;
    });
    db.loans.forEach(l => {
      if (l.Empleado.toLowerCase().trim() === oldName.toLowerCase()) l.Empleado = updatedName;
    });
    db.payroll.forEach(p => {
      if (p.Trabajador.toLowerCase().trim() === oldName.toLowerCase()) p.Trabajador = updatedName;
    });
  }

  db.rates[index] = {
    Empleado: updatedName,
    Sucursal: sucursalDelEmpleado,
    Valor_Dia: Valor_Dia !== undefined ? Math.round(parseFloat(Valor_Dia)) : db.rates[index].Valor_Dia,
    Valor_Hora: Valor_Hora !== undefined ? Math.round(parseFloat(Valor_Hora)) : db.rates[index].Valor_Hora,
    Auxilio_Transporte: Auxilio_Transporte !== undefined ? Math.round(parseFloat(Auxilio_Transporte)) : (db.rates[index].Auxilio_Transporte !== undefined ? db.rates[index].Auxilio_Transporte : 8303),
    Celular: Celular !== undefined ? Celular : db.rates[index].Celular,
    Cedula: Cedula !== undefined ? Cedula : db.rates[index].Cedula
  };

  await saveDb(db, ["rates"]);
  res.json(db.rates[index]);
});

app.delete("/api/payroll/rates/:name", requireRole("Admin"), async (req, res) => {
  const name = decodeURIComponent(req.params.name).trim();
  const index = db.rates.findIndex(r => r.Empleado.toLowerCase().trim() === name.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }
  const deleted = db.rates.splice(index, 1)[0];
  await deleteRowByClientId("employee_rates", (deleted as any)._id);
  res.json({ success: true });
});

app.post("/api/payroll/schedule", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { Fecha, Empleado, Sucursal, Horas_Trabajadas } = req.body;
  if (!Empleado || !Sucursal || Horas_Trabajadas === undefined) {
    return res.status(400).json({ error: "Empleado, Sucursal y Horas son requeridas" });
  }

  const newSched: EmployeeSchedule = {
    Fecha: Fecha || getColombiaDate(),
    Empleado,
    Sucursal,
    Horas_Trabajadas: Math.round(parseFloat(Horas_Trabajadas) * 10) / 10,
  };

  db.schedules.push(newSched);
  await saveDb(db, ["schedules"]);
  res.status(210).json(newSched);
});

app.post("/api/payroll/schedule/save", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { Fecha, Empleado, Sucursal, Horas_Trabajadas } = req.body;
  if (!Empleado || !Sucursal || Horas_Trabajadas === undefined || !Fecha) {
    return res.status(400).json({ error: "Fecha, Empleado, Sucursal y Horas son requeridos" });
  }

  db.schedules = db.schedules.filter(
    (s) => !(s.Fecha === Fecha && s.Empleado.toLowerCase() === Empleado.toLowerCase())
  );

  const newSched: EmployeeSchedule = {
    Fecha,
    Empleado,
    Sucursal,
    Horas_Trabajadas: Math.round((parseFloat(Horas_Trabajadas) || 0) * 10) / 10,
  };

  db.schedules.push(newSched);
  await saveDb(db, ["schedules"]);

  res.json({ success: true, schedule: newSched });
});

app.post("/api/payroll/schedule/delete", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { Fecha, Empleado } = req.body;
  if (!Fecha || !Empleado) {
    return res.status(400).json({ error: "Fecha y Empleado son requeridos" });
  }

  db.schedules = db.schedules.filter(
    (s) => !(s.Fecha === Fecha && s.Empleado.toLowerCase() === Empleado.toLowerCase())
  );

  await saveDb(db, ["schedules"]);

  res.json({ success: true });
});

app.post("/api/payroll/loan", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { Fecha, Empleado, Sucursal, Monto, Motivo } = req.body;
  if (!Empleado || !Monto) {
    return res.status(400).json({ error: "Empleado y Monto son requeridos" });
  }

  const newLoan: EmployeeLoan = {
    Fecha: Fecha || getColombiaDate(),
    Empleado,
    Sucursal: Sucursal || "Plaza",
    Monto: Math.round(parseFloat(Monto)),
    Motivo: Motivo || "Préstamo",
    Estado: "Pendiente",
  };

  db.loans.push(newLoan);
  await saveDb(db, ["loans"]);
  res.status(210).json(newLoan);
});

app.post("/api/payroll/generate", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { 
    Empleado, 
    Fecha_Inicio, 
    Fecha_Fin, 
    Sucursal,
    Pago_Base,
    Pago_Horas,
    Prestamos_Descontados,
    Total_Neto,
    Dias_Trabajados,
    Horas_Trabajadas
  } = req.body;

  if (!Empleado || !Fecha_Inicio || !Fecha_Fin) {
    return res.status(400).json({ error: "Empleado y fechas requeridas" });
  }

  let finalPagoBase = Pago_Base !== undefined ? Math.round(parseFloat(Pago_Base)) : null;
  let finalPagoHoras = Pago_Horas !== undefined ? Math.round(parseFloat(Pago_Horas)) : null;
  let finalPrestamosDescontados = Prestamos_Descontados !== undefined ? Math.round(parseFloat(Prestamos_Descontados)) : null;
  let finalTotalNeto = Total_Neto !== undefined ? Math.round(parseFloat(Total_Neto)) : null;
  let finalDiasTrabajados = Dias_Trabajados !== undefined ? parseFloat(Dias_Trabajados) : null;
  let finalHorasTrabajadas = Horas_Trabajadas !== undefined ? Math.round(parseFloat(Horas_Trabajadas) * 10) / 10 : null;

  if (finalPagoBase === null) {
    const rate = db.rates.find((r) => r.Empleado.toLowerCase() === Empleado.toLowerCase()) || {
      Empleado,
      Valor_Dia: 60000,
      Valor_Hora: 9000,
    };

    const empSchedules = db.schedules.filter(
      (s) =>
        s.Empleado.toLowerCase() === Empleado.toLowerCase() &&
        s.Fecha >= Fecha_Inicio &&
        s.Fecha <= Fecha_Fin
    );

    finalHorasTrabajadas = Math.round(empSchedules.reduce((sum, s) => sum + (s.Horas_Trabajadas || 0), 0) * 10) / 10;
    finalDiasTrabajados = empSchedules.filter((s) => (s.Horas_Trabajadas || 0) >= 6).length;

    finalPagoBase = Math.round(finalDiasTrabajados * rate.Valor_Dia);
    const hourlyPay = Math.round((finalHorasTrabajadas - (finalDiasTrabajados * 8 > 0 ? finalDiasTrabajados * 8 : 0)) * rate.Valor_Hora);
    finalPagoHoras = hourlyPay > 0 ? hourlyPay : 0;

    const empLoans = db.loans.filter(
      (l) => l.Empleado.toLowerCase() === Empleado.toLowerCase() && l.Estado === "Pendiente"
    );
    finalPrestamosDescontados = Math.round(empLoans.reduce((sum, l) => sum + (l.Monto || 0), 0));

    finalTotalNeto = Math.max(0, Math.round(finalPagoBase + finalPagoHoras - finalPrestamosDescontados));
  }

  for (const loan of db.loans) {
    if (loan.Empleado.toLowerCase() === Empleado.toLowerCase() && loan.Estado === "Pendiente") {
      loan.Estado = "Descontado";
    }
  }

  const newPayroll: PayrollRecord = {
    Fecha: Fecha_Fin,
    Trabajador: Empleado,
    Sucursal: Sucursal || "Plaza",
    Dias_Trabajados: finalDiasTrabajados,
    Horas_Trabajadas: finalHorasTrabajadas,
    Pago_Base: finalPagoBase,
    Pago_Horas: finalPagoHoras,
    Prestamos_Descontados: finalPrestamosDescontados,
    Total_Neto: finalTotalNeto,
    Estado_Pago: "Pendiente",
  };

  db.payroll.push(newPayroll);
  await saveDb(db, ["payroll", "loans"]);
  res.status(210).json(newPayroll);
});

app.post("/api/payroll/pay", requireRole("Admin", "AdminSucursal"), async (req, res) => {
  const { Trabajador, Fecha } = req.body;
  const idx = db.payroll.findIndex((p) => p.Trabajador === Trabajador && p.Fecha === Fecha);
  if (idx !== -1) {
    db.payroll[idx].Estado_Pago = "Pagado";
    await saveDb(db, ["payroll"]);
    return res.json(db.payroll[idx]);
  }
  res.status(404).json({ error: "Registro de nómina no encontrado" });
});




app.delete("/api/products/:code", requireRole("Admin"), async (req, res) => {
  const { code } = req.params;
  const index = db.products.findIndex((p) => p.Codigo === code);
  if (index === -1) {
    return res.status(404).json({ error: "Producto no encontrado en el catálogo." });
  }
  const deleted = db.products.splice(index, 1)[0];
  await deleteRowByClientId("products", (deleted as any)._id);
  res.json({ success: true, deleted });
});

app.post("/api/admin/import-csv-orders", requireRole("Admin", "Comprador"), async (req, res) => {
  const { csvText, fecha } = req.body;
  if (!csvText || typeof csvText !== "string" || !csvText.trim()) {
    return res.status(400).json({ error: "No se proporcionó el texto de los pedidos." });
  }

  const orderDate = fecha || getColombiaDate();
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  // Group orders under unique ID_Pedido per sucursal
  // Las sucursales salen de la configuración: una sucursal nueva entra sola.
  const sucursales = sucursalesOrdenadas(db.branchConfigs);
  const oids: { [sucursal: string]: string } = {};
  for (const s of sucursales) {
    oids[s] = `PED-${s.toUpperCase()}-${timestamp}`;
  }

  const lines = csvText.split(/\r?\n/);
  
  // Dynamic delimiter detection
  let delimiter = ";";
  const firstLine = lines.find(l => l.trim() !== "");
  if (firstLine) {
    const semicScount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    if (commaCount > semicScount && commaCount >= 7) {
      delimiter = ",";
    }
  }

  console.log(`[CSV Import] Usando delimitador: "${delimiter}" para procesar ${lines.length} líneas.`);

  let importedCount = 0;
  let malformedCount = 0;
  const createdOrders: Order[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const parts = trimmedLine.split(delimiter);
    if (parts.length < 8) {
      if (!trimmedLine.toUpperCase().startsWith("PRODUCTO") && !trimmedLine.startsWith("---")) {
        malformedCount++;
      }
      continue;
    }

    const firstCol = parts[0].trim();
    if (firstCol.toUpperCase().startsWith("PRODUCTO") || firstCol.toUpperCase().startsWith("---")) {
      continue;
    }

    const productName = parts[0].trim();
    if (!productName || productName === "") continue;

    const branchQtys: { [sucursal: string]: string } = Object.fromEntries(
      sucursales.map((suc, i) => [suc, parts[i + 1] ? parts[i + 1].trim() : "0"])
    );
    // Proveedor y precio van después de las columnas de sucursal, así que su
    // posición depende de cuántas haya — antes estaban clavadas en 6 y 7.
    const colProveedor = 1 + sucursales.length;

    const supplierName = parts[colProveedor] ? parts[colProveedor].trim() : "Sin Proveedor";
    const purchaseCost = parseFloat(parts[colProveedor + 1] ? parts[colProveedor + 1].trim().replace(/\s/g, "").replace(",", ".") : "0") || 0;

    // Find product in DB or create a placeholder product
    let prod = db.products.find(p => p.Producto.toLowerCase().trim() === productName.toLowerCase().trim());
    
    if (!prod) {
      const codePrefix = productName.toUpperCase().slice(0, 2);
      const nextNum = db.products.filter(p => p.Codigo.startsWith(codePrefix)).length + 1;
      const newCode = `${codePrefix}${nextNum}`;
      
      prod = {
        Codigo: newCode,
        Producto: productName,
        Medida: "Kg",
        Merma: 0.05,
        Utilidad: 0.30,
        Proveedor: supplierName,
        Celular: "",
        Costo_Proveedor: purchaseCost || 1000,
        Precio_Venta_Actual: Math.round((purchaseCost || 1000) * 1.3),
        Precio_Anterior: purchaseCost || 1000,
        Venta_Anterior: Math.round((purchaseCost || 1000) * 1.3),
        Factor_Bulto: 56,
        Factor_Canastilla: 22,
      };
      
      db.products.push(prod);
    }

    // Now process for each sucursal
    for (const [suc, qtyStr] of Object.entries(branchQtys)) {
      const qtyNum = parseQty(qtyStr);
      if (qtyNum > 0) {
        let kilos = 0;
        const medLower = prod.Medida.toLowerCase();
        if (medLower.includes("bulto") || medLower === "kg") {
          kilos = qtyNum * prod.Factor_Bulto;
        } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
          kilos = qtyNum * prod.Factor_Canastilla;
        } else {
          kilos = qtyNum;
        }

        const newOrder: Order = {
          ID_Pedido: oids[suc],
          Fecha: orderDate,
          Sucursal: suc,
          Codigo: prod.Codigo,
          Producto: prod.Producto,
          Medida: prod.Medida,
          Cantidad: String(qtyStr),
          Notas: "Importado vía adjunto",
          Precio_Anterior: prod.Precio_Venta_Actual,
          Porcentaje_Ganancia: prod.Utilidad,
          Cantidad_Comprada: qtyNum,
          Costo_Momento: purchaseCost > 0 ? purchaseCost : prod.Costo_Proveedor,
          Precio_Venta_Momento: prod.Precio_Venta_Actual,
          Kilos: kilos,
          Estado: "Comprado",
          Estado_Pago: "Pendiente",
          Proveedor: supplierName || prod.Proveedor,
          Celular: prod.Celular,
        };

        db.orders.push(newOrder);
        createdOrders.push(newOrder);
        importedCount++;
      }
    }
  }

  if (importedCount === 0) {
    let errorMsg = "No se pudieron importar pedidos del archivo CSV.";
    if (malformedCount > 0) {
      // Las columnas se nombran desde la configuración: si se abre una sucursal
      // nueva, el mensaje de ayuda la incluye sin tocar código.
      const columnas = ["PRODUCTO", ...sucursales.map((x) => x.toUpperCase()), "PROVEEDOR", "PRECIO COMPRA"];
      errorMsg += ` Se detectaron ${malformedCount} filas mal estructuradas. Asegúrese de usar el formato correcto con el delimitador '${delimiter}' y de incluir las ${columnas.length} columnas requeridas: (${columnas.join("; ")}).`;
    } else {
      errorMsg += " El archivo parece estar vacío o no contiene cantidades mayores a cero.";
    }
    return res.status(400).json({ error: errorMsg });
  }

  createdOrders.forEach((o) => {
    if (o.Proveedor && o.Proveedor.trim() !== "" && o.Proveedor.toLowerCase().trim() !== "sin proveedor") {
      const provLower = o.Proveedor.toLowerCase().trim();
      const exists = db.providers.some(p => p.Proveedor.toLowerCase().trim() === provLower);
      if (!exists) {
        db.providers.push({
          Proveedor: o.Proveedor.trim(),
          Celular: o.Celular || "",
        });
      }
    }
  });

  await saveDb(db, ["orders", "providers"]);
  res.json({ success: true, count: importedCount, date: orderDate });
});

/**
 * Toma un respaldo antes de una operación que borra datos. Si el respaldo falla,
 * lanza — y quien llame NO debe borrar nada. Convierte cualquier borrado (un
 * error, un clic de más, una sesión de admin comprometida) en algo que se
 * recupera con una sola llamada a /restore.
 */
async function respaldarAntesDeBorrar(motivo: string): Promise<number> {
  const { id } = await createBackup(`auto antes de: ${motivo}`);
  return id;
}

app.post("/api/admin/clear-operational-data", requireRole("Admin"), async (req, res) => {
  try {
    // Red de seguridad: si esto falla, no se borra nada.
    const respaldoId = await respaldarAntesDeBorrar("limpiar datos operativos");

    db.orders = [];
    db.closures = [];
    db.walletTransactions = [];
    db.shrinkages = [];
    db.packagingMovements = [];
    db.schedules = [];
    db.loans = [];
    db.payroll = [];
    db.priceHistory = [];
    db.nequiExpenses = [];
    if (db.syncLogs) db.syncLogs = [];

    await truncateTables(["orders", "closures", "wallet_transactions", "shrinkages", "packaging_movements", "employee_schedules", "employee_loans", "payroll_records", "price_histories", "nequi_expenses", "sync_logs"]);

    recordSyncLog(
      db,
      "Sistema",
      "Limpieza General de Datos Operativos",
      "success",
      "Base de datos totalmente limpiada para entrega: pedidos, cierres, gastos, mermas, horarios, préstamos y nóminas eliminados.",
      0,
      0
    );
    await saveDb(db, ["syncLogs"]);

    res.json({
      success: true,
      respaldoPrevio: respaldoId,
      message: "Base de datos operativa vaciada con éxito. Los pedidos, cierres, mermas, nómina, gastos y horarios fueron eliminados para la entrega del sistema."
    });
  } catch (err: any) {
    console.error("Error al limpiar la base de datos:", err);
    res.status(500).json({ error: err.message || "Error al limpiar la base de datos operativa." });
  }
});

app.post("/api/admin/clear-past-months-history", requireRole("Admin"), async (req, res) => {
  try {
    await respaldarAntesDeBorrar("limpiar históricos de meses anteriores");
    const result = await purgePastMonthsOrdersAndClosures(db);
    await saveDb(db, ["orders", "closures"]);
    recordSyncLog(
      db,
      "Sistema",
      "Limpieza de Históricos",
      "success",
      `Limpieza de históricos completada: se eliminaron registros de meses anteriores en pedidos y cierres (${result.deletedOrdersCount} pedidos, ${result.deletedClosuresCount} cierres).`,
      result.deletedOrdersCount + result.deletedClosuresCount,
      0
    );
    res.json({
      success: true,
      message: "Limpieza de históricos antiguos de pedidos y cierres de caja realizada exitosamente.",
      deletedOrders: result.deletedOrdersCount,
      deletedClosures: result.deletedClosuresCount
    });
  } catch (err: any) {
    console.error("Error al limpiar históricos de meses anteriores:", err);
    res.status(500).json({ error: err.message || "Error al realizar la limpieza de históricos." });
  }
});


app.post("/api/test/run", requireRole("Admin"), async (req, res) => {
  try {
    // Esta prueba BORRA pedidos, cierres, monederos e historial de precios y los
    // reemplaza por datos de ejemplo. En una base con datos reales es una pérdida
    // total, así que exige una confirmación explícita y respalda antes de tocar
    // nada. Sin la confirmación no borra: solo avisa.
    if (req.body?.confirmar !== true) {
      return res.status(400).json({
        error: "Esta prueba BORRA todos los pedidos, cierres, monederos e historial de precios reales y los reemplaza por datos de ejemplo. Si es lo que quieres, vuelve a llamar con { \"confirmar\": true }.",
      });
    }
    const respaldoId = await respaldarAntesDeBorrar("prueba de siembra (borra datos operativos)");

    // Reset/Clear relevant tables for a clean test state
    db.orders = [];
    db.closures = [];
    db.walletTransactions = [];
    db.priceHistory = [];
    await truncateTables(["orders", "closures", "wallet_transactions", "price_histories"]);
    console.log(`[Test] Datos operativos reemplazados por prueba; respaldo previo #${respaldoId}.`);

    const branches = sucursalesOrdenadas(db.branchConfigs);
    const productsToUse = db.products.slice(0, 15);

    if (productsToUse.length === 0) {
      return res.status(400).json({ error: "No hay productos en el catálogo para realizar la prueba." });
    }

    const currentDate = getColombiaDate();
    const yesterdayDate = getColombiaYesterdayDate();

    // 1. Create exactly 15 orders for each branch
    for (const branch of branches) {
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const oid = `PED-${branch.toUpperCase()}-${timestamp}`;

      // We make sure we have exactly 15 products or repeat if we have less
      for (let i = 0; i < 15; i++) {
        const prod = productsToUse[i % productsToUse.length];
        
        // Select different quantities for variety
        const quantities = ["5", "10", "1/2", "3", "15", "2", "1.5", "8", "12", "4", "20", "1", "6", "2.5", "3.5"];
        const quantity = quantities[i % quantities.length];

        let kilos = 0;
        const qtyNum = parseQty(quantity);
        const medLower = prod.Medida.toLowerCase();
        if (medLower.includes("bulto") || medLower === "kg") {
          kilos = qtyNum * prod.Factor_Bulto;
        } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
          kilos = qtyNum * prod.Factor_Canastilla;
        } else {
          kilos = qtyNum;
        }

        const newOrder: Order = {
          ID_Pedido: oid,
          Fecha: currentDate,
          Sucursal: branch,
          Codigo: prod.Codigo,
          Producto: prod.Producto,
          Medida: prod.Medida,
          Cantidad: quantity,
          Notas: `Pedido de prueba ${i + 1}`,
          Precio_Anterior: prod.Precio_Venta_Actual,
          Porcentaje_Ganancia: prod.Utilidad,
          Cantidad_Comprada: 0,
          Costo_Momento: prod.Costo_Proveedor,
          Precio_Venta_Momento: prod.Precio_Venta_Actual,
          Kilos: kilos,
          Estado: "Pendiente",
          Estado_Pago: "Pendiente",
          Proveedor: prod.Proveedor,
          Celular: prod.Celular,
        };

        db.orders.push(newOrder);
      }

      // 2. Create exactly 2 daily closures for each branch
      // Closure 1 (Yesterday)
      const yesterdaySales = 1350000 + (Math.floor(Math.random() * 300) * 1000);
      const yesterdayExpenses = 35000 + (Math.floor(Math.random() * 20) * 1000);
      const yesterdayClosure: DailyClosure = {
        ID_Cierre: `CLS-${branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${yesterdayDate}-${Date.now()}`,
        Fecha: yesterdayDate,
        Sucursal: branch,
        Ventas_Totales: yesterdaySales,
        Gastos_Extra: yesterdayExpenses,
        Descripcion_Gastos: "Pago de bolsas biodegradables y bombillo",
        Persona_Recogio: "Comprador Juan",
        Recaudado_Fisico: false,
      };
      db.closures.push(yesterdayClosure);

      const yesterdayNeto = yesterdaySales - yesterdayExpenses;
      const yesterdayTx: WalletTransaction = {
        ID_Transaccion: genRecordId("TXN", branch, yesterdayDate),
        Fecha: yesterdayDate,
        Sucursal: branch,
        Tipo_Movimiento: "Ingreso",
        Valor: yesterdayNeto,
        Descripcion: `Cierre de Caja - Efectivo neto registrado (Ayer)`,
        Responsable: "Comprador Juan",
        Estado: "Pendiente",
      };
      db.walletTransactions.push(yesterdayTx);

      // Closure 2 (Today)
      const todaySales = 1580000 + (Math.floor(Math.random() * 400) * 1000);
      const todayExpenses = 20000 + (Math.floor(Math.random() * 15) * 1000);
      const todayClosure: DailyClosure = {
        ID_Cierre: `CLS-${branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${currentDate}-${Date.now()}`,
        Fecha: currentDate,
        Sucursal: branch,
        Ventas_Totales: todaySales,
        Gastos_Extra: todayExpenses,
        Descripcion_Gastos: "Material de aseo y cinta de embalaje",
        Persona_Recogio: "Comprador Juan",
        Recaudado_Fisico: false,
      };
      db.closures.push(todayClosure);

      const todayNeto = todaySales - todayExpenses;
      const todayTx: WalletTransaction = {
        ID_Transaccion: genRecordId("TXN", branch, currentDate),
        Fecha: currentDate,
        Sucursal: branch,
        Tipo_Movimiento: "Ingreso",
        Valor: todayNeto,
        Descripcion: `Cierre de Caja - Efectivo neto registrado (Hoy)`,
        Responsable: "Comprador Juan",
        Estado: "Pendiente",
      };
      db.walletTransactions.push(todayTx);
    }

    // 3. Change some prices as comprador (e.g. 3 products)
    const productsToChange = db.products.slice(0, 3);
    const changedPricesLog: any[] = [];

    for (const prod of productsToChange) {
      const costAnterior = prod.Costo_Proveedor;
      const costNuevo = Math.round((costAnterior * 1.15) / 50) * 50; // 15% increase, rounded to 50
      const ventaAnterior = prod.Precio_Venta_Actual;
      const ventaNueva = Math.round((costNuevo * (1 + prod.Utilidad)) / 100) * 100; // rounded to 100

      // Update product
      prod.Costo_Proveedor = costNuevo;
      prod.Precio_Anterior = ventaAnterior;
      prod.Precio_Venta_Actual = ventaNueva;

      const newHistory: PriceHistory = {
        Fecha_Hora: new Date().toISOString(),
        Codigo: prod.Codigo,
        Producto: prod.Producto,
        Costo_Anterior: costAnterior,
        Costo_Nuevo: costNuevo,
        Venta_Anterior: ventaAnterior,
        Venta_Nueva: ventaNueva,
        Usuario: "Comprador Juan"
      };

      db.priceHistory.push(newHistory);
      changedPricesLog.push({
        Codigo: prod.Codigo,
        Producto: prod.Producto,
        Costo_Anterior: costAnterior,
        Costo_Nuevo: costNuevo,
        Venta_Anterior: ventaAnterior,
        Venta_Nueva: ventaNueva,
      });
    }

    await saveDb(db);

    res.json({
      success: true,
      message: "Prueba simulada con éxito. Se crearon 15 pedidos por sucursal, 2 cierres de caja por sucursal y se actualizaron precios de 3 productos.",
      details: {
        ordersCreated: db.orders.length,
        closuresCreated: db.closures.length,
        walletTransactionsCreated: db.walletTransactions.length,
        changedPrices: changedPricesLog
      }
    });
  } catch (err: any) {
    console.error("Error running test simulation:", err);
    res.status(500).json({ error: err.message || "Error al ejecutar la simulación de prueba." });
  }
});



// ─────────────────────────────────────────────
// SYNC LOGS ENDPOINTS
// ─────────────────────────────────────────────
app.get("/api/sync-logs", (req, res) => {
  res.json(db.syncLogs || []);
});

app.post("/api/sync-logs/clear", requireRole("Admin"), async (req, res) => {
  db.syncLogs = [];
  await truncateTables(["sync_logs"]);
  res.json({ success: true, message: "Historial de logs de sincronización limpiado correctamente." });
});

// ── Respaldos ──────────────────────────────────────────────
app.get("/api/admin/backups", requireRole("Admin"), async (req, res) => {
  try {
    res.json(await listBackups());
  } catch (err: any) {
    res.status(500).json({ error: "No se pudieron listar los respaldos: " + (err?.message || String(err)) });
  }
});

// Crea un respaldo manual bajo demanda (además del automático diario).
app.post("/api/admin/backups", requireRole("Admin"), async (req, res) => {
  try {
    const { id, resumen } = await createBackup("manual");
    res.json({ success: true, id, resumen, message: "Respaldo creado correctamente." });
  } catch (err: any) {
    res.status(500).json({ error: "No se pudo crear el respaldo: " + (err?.message || String(err)) });
  }
});

/**
 * Repuebla tablas desde un respaldo, rellenando solo lo que falte (nunca pisa lo
 * que ya existe). Después recarga la copia en memoria del servidor desde
 * Postgres, para que no quede desincronizada de lo que se acaba de restaurar.
 *
 * Se limita a las tablas indicadas; si no se indican, a las operativas, que son
 * las que borra "limpiar datos operativos".
 */
app.post("/api/admin/backups/:id/restore", requireRole("Admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Todas las tablas que puede vaciar "limpiar datos operativos", más products.
    const permitidas = [
      "orders", "closures", "wallet_transactions", "products", "shrinkages",
      "packaging_movements", "employee_schedules", "employee_loans",
      "payroll_records", "price_histories", "nequi_expenses",
    ];
    const pedidas: string[] = Array.isArray(req.body?.tablas) && req.body.tablas.length > 0
      ? req.body.tablas.filter((t: string) => permitidas.includes(t))
      : ["orders", "closures", "wallet_transactions", "products"];

    const reinsertadas = await restoreBackup(id, pedidas);
    db = await reloadFromPostgres();

    res.json({ success: true, respaldo: id, reinsertadas });
  } catch (err: any) {
    console.error("Error al restaurar respaldo:", err);
    res.status(500).json({ error: "No se pudo restaurar el respaldo: " + (err?.message || String(err)) });
  }
});

// Descarga el respaldo como archivo JSON, para guardarlo fuera de la nube.
app.get("/api/admin/backups/:id/download", requireRole("Admin"), async (req, res) => {
  try {
    const backup = await getBackup(Number(req.params.id));
    if (!backup) return res.status(404).json({ error: "Respaldo no encontrado" });

    const fecha = new Date(backup.creado_en).toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="respaldo-alpaso-${fecha}-${backup.id}.json"`);
    res.send(JSON.stringify(backup.contenido, null, 2));
  } catch (err: any) {
    res.status(500).json({ error: "No se pudo descargar el respaldo: " + (err?.message || String(err)) });
  }
});

// Chequeo de salud: confirma que Postgres responde de verdad y que lo que hay en
// memoria coincide con lo persistido. Sirve para detectar un problema antes de que
// una sucursal pierda un pedido, en vez de enterarnos por el reclamo.
app.get("/api/health", async (req, res) => {
  try {
    const counts = await getTableCounts();
    const memoria = {
      products: db.products.length,
      orders: db.orders.length,
      closures: db.closures.length,
      walletTransactions: db.walletTransactions.length,
    };
    const desincronizado =
      counts.products !== memoria.products ||
      counts.orders !== memoria.orders ||
      counts.closures !== memoria.closures ||
      counts.wallet_transactions !== memoria.walletTransactions;

    res.status(desincronizado ? 409 : 200).json({
      estado: desincronizado ? "DESINCRONIZADO" : "OK",
      baseDeDatos: "conectada",
      postgres: counts,
      memoria,
      advertencia: desincronizado
        ? "La memoria del servidor y la base de datos no coinciden. Suele indicar que otro proceso escribió en la misma base; reinicia el servicio para recargar."
        : undefined,
    });
  } catch (err: any) {
    // El detalle puede nombrar el servidor y el usuario de la base de datos:
    // solo se muestra a quien ya inició sesión.
    console.error("[Health] Fallo al consultar la base:", err?.message || err);
    res.status(503).json({
      estado: "ERROR",
      baseDeDatos: "sin conexión",
      detalle: req.auth ? (err?.message || String(err)) : undefined,
    });
  }
});

// ─────────────────────────────────────────────
// VITE OR STATIC MIDDLEWARE SETUP
// ─────────────────────────────────────────────
app.get("/logo_al_paso.png", (req, res) => {
  res.sendFile(path.join(process.cwd(), "logo_al_paso.png"));
});

async function startServer() {
  console.log("[Startup] Iniciando servidor Al Paso...");

  // 1. Cargar la base de datos desde Supabase/PostgreSQL antes de aceptar peticiones
  db = await initDb();
  console.log(`[Startup] Base de datos lista: ${db.products.length} productos, ${db.orders.length} pedidos.`);

  // 3. Iniciar middlewares frontend
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 4. Iniciar servidor Express únicamente cuando la hidratación de datos esté lista
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Al Paso server running on http://localhost:${PORT}`);
  });

  // 5. Respaldos automáticos diarios (nunca bloquean ni tumban el arranque)
  startAutomaticBackups();
}

startServer();
