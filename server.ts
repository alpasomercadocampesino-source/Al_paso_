import express from "express";
import cors from "cors";
import path from "path";
import bcrypt from "bcryptjs";
import { createServer as createViteServer } from "vite";
import { initDb, saveDb as originalSaveDb, recordSyncLog, Order, DailyClosure, WalletTransaction, Shrinkage, PackagingMovement, EmployeeSchedule, EmployeeLoan, PayrollRecord, PriceHistory, Product, Provider } from "./server/db.ts";
import { sendOrderSummaryEmail } from "./server/mailer.ts";
import { GoogleGenAI, Type } from "@google/genai";
import { importCsvToDb } from "./server/import_csv.ts";
import { queueFirestoreSync, saveRecordToFirestoreDirect, saveBatchToFirestoreDirect, deleteRecordFromFirestoreDirect, pullFromFirestore, clearFirestoreOperationalCollections, purgePastMonthsOrdersAndClosures } from "./server/firebase.ts";
import { sqlSyncRouter } from "./server/sql_sync_routes.ts";

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("La variable de entorno GEMINI_API_KEY es requerida para el procesamiento por voz. Por favor configúrela en el panel de Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

const app = express();
const PORT = 3000;
 
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/api/sql-sync", sqlSyncRouter);

// Colombia date utilities (UTC-5, no DST)
function getColombiaDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function getColombiaYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

// Initialize file-based database & sync with Cloud Firestore
const db = initDb();

// Hydrate server DB from Cloud Firestore at startup and sync back
pullFromFirestore(db).then(() => {
  console.log("[Firestore] Base de datos servidor sincronizada con Cloud Firestore.");
  queueFirestoreSync(db);
}).catch((err) => {
  console.error("[Firestore] Error al hidratar datos desde Cloud Firestore:", err);
  queueFirestoreSync(db);
});

function saveDb(dbData: typeof db) {
  originalSaveDb(dbData);
  queueFirestoreSync(dbData);
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

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
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
    if (!isBcryptHash((user.Contraseña || "").toString().trim())) {
      user.Contraseña = bcrypt.hashSync(inputPassword, 10);
      saveDb(db);
    }
    return res.json({
      Usuario: user.Usuario || user.usuario || user.username || user.Username,
      Rol: user.Rol || user.rol || user.role || user.Role,
    });
  } else {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

// User Management for Admin
app.get("/api/users", (req, res) => {
  res.json(db.users);
});

// Branch Configs for cash collection
app.get("/api/admin/branch-configs", (req, res) => {
  if (!db.branchConfigs) {
    db.branchConfigs = {
      Tibasosa: { baseCaja: 150000, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 },
      Nobsa: { baseCaja: 100000, recolectorPredeterminado: "Cris", montoAlerta: 400000 },
      Fira: { baseCaja: 120000, recolectorPredeterminado: "Hamilton", montoAlerta: 450000 },
      Aquitania: { baseCaja: 200000, recolectorPredeterminado: "Cris", montoAlerta: 600000 },
      Hansel: { baseCaja: 150000, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 },
    };
    saveDb(db);
  }
  res.json(db.branchConfigs);
});

app.post("/api/admin/branch-configs", (req, res) => {
  const { branch, baseCaja, recolectorPredeterminado, montoAlerta } = req.body;
  if (!branch) {
    return res.status(400).json({ error: "Sucursal requerida" });
  }

  if (!db.branchConfigs) {
    db.branchConfigs = {};
  }

  db.branchConfigs[branch] = {
    baseCaja: Number(baseCaja) || 0,
    recolectorPredeterminado: String(recolectorPredeterminado || "Cualquiera"),
    montoAlerta: Number(montoAlerta) || 0,
  };

  saveDb(db);
  res.json({ success: true, config: db.branchConfigs[branch] });
});

app.post("/api/users/update-password", (req, res) => {
  const { Usuario, Contraseña } = req.body;
  if (!Usuario || !Contraseña) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  }

  const userIndex = db.users.findIndex(
    (u) => u.Usuario.toLowerCase().trim() === Usuario.toLowerCase().trim()
  );

  if (userIndex !== -1) {
    db.users[userIndex].Contraseña = bcrypt.hashSync(Contraseña.trim(), 10);
    saveDb(db);
    return res.json({ success: true, message: `Contraseña de ${Usuario} actualizada.` });
  }

  return res.status(404).json({ error: "Usuario no encontrado" });
});

// Products
app.get("/api/products", (req, res) => {
  res.json(db.products);
});

app.post("/api/products", async (req, res) => {
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
  saveDb(db);
  await saveRecordToFirestoreDirect("products", newProduct);
  res.status(210).json(newProduct);
});

app.put("/api/products/:code", async (req, res) => {
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

  saveDb(db);
  await saveRecordToFirestoreDirect("products", db.products[index]);
  res.json(db.products[index]);
});

// Providers
app.get("/api/providers", (req, res) => {
  res.json(db.providers);
});

app.post("/api/providers", async (req, res) => {
  const { Proveedor, Celular } = req.body;
  if (!Proveedor) {
    return res.status(400).json({ error: "Nombre de proveedor requerido" });
  }

  if (db.providers.some((p) => p.Proveedor.toLowerCase().trim() === Proveedor.toLowerCase().trim())) {
    return res.status(400).json({ error: "El proveedor ya existe" });
  }

  const newProvider: Provider = { Proveedor: Proveedor.trim(), Celular: Celular ? String(Celular).trim() : "" };
  db.providers.push(newProvider);
  saveDb(db);
  await saveBatchToFirestoreDirect([
    { collectionKey: "providers", record: newProvider }
  ]);
  res.status(210).json(newProvider);
});

app.put("/api/providers/:name", async (req, res) => {
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

  saveDb(db);
  await saveBatchToFirestoreDirect([
    { collectionKey: "providers", record: db.providers[idx] }
  ]);

  res.json({ success: true, provider: db.providers[idx] });
});

app.delete("/api/providers/:name", async (req, res) => {
  const name = decodeURIComponent(req.params.name).trim();
  const idx = db.providers.findIndex(
    (p) => p.Proveedor.toLowerCase().trim() === name.toLowerCase()
  );

  if (idx === -1) {
    return res.status(404).json({ error: "Proveedor no encontrado" });
  }

  const deleted = db.providers.splice(idx, 1)[0];
  saveDb(db);
  res.json({ success: true, deleted });
});

// Price History
app.get("/api/price-history", (req, res) => {
  res.json(db.priceHistory);
});

// Orders (Pedidos)
app.get("/api/orders", (req, res) => {
  const { sucursal, fecha } = req.query;
  let filtered = db.orders;

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

  const orderDate = fecha || getColombiaDate();
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const oid = `PED-${sucursal.toUpperCase()}-${timestamp}`;

  const createdOrders: Order[] = [];

  for (const item of items) {
    const { Codigo, Cantidad, Notas } = item;
    const prod = db.products.find((p) => p.Codigo === Codigo);
    if (!prod) continue;

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

    const newOrder: Order = {
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
    };

    db.orders.push(newOrder);
    createdOrders.push(newOrder);
  }

  saveDb(db);
  if (createdOrders.length > 0) {
    await saveBatchToFirestoreDirect(createdOrders.map((o) => ({ collectionKey: "orders", record: o })));
    sendOrderSummaryEmail(oid, sucursal, orderDate, createdOrders).catch(err => {
      console.error("Failed to automatically send order summary email:", err);
    });
  }

  res.status(210).json({ ID_Pedido: oid, orders: createdOrders });
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

  saveDb(db);
  await saveRecordToFirestoreDirect("orders", db.orders[index]);
  res.json(db.orders[index]);
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

  saveDb(db);
  if (updatedRecords.length > 0) {
    await saveBatchToFirestoreDirect(updatedRecords.map((o) => ({ collectionKey: "orders", record: o })));
  }
  res.json({ success: true });
});

app.post("/api/admin/matrix-save", (req, res) => {
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
      const branches = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];
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

  saveDb(db);
  res.json({ success: true });
});

// Closures (Cierre Diario)
app.get("/api/closures", (req, res) => {
  try {
    const { sucursal } = req.query;
    if (!Array.isArray(db.closures)) {
      db.closures = [];
    }
    let filtered = db.closures;
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

    const closureDate = Fecha || getColombiaDate();
    const collector = Persona_Recogio && String(Persona_Recogio).trim() ? String(Persona_Recogio).trim() : "Hamilton";

    const newClosure: DailyClosure = {
      Fecha: closureDate,
      Sucursal: String(Sucursal).trim(),
      Ventas_Totales: parseFloat(Ventas_Totales) || 0,
      Gastos_Extra: parseFloat(Gastos_Extra) || 0,
      Descripcion_Gastos: Descripcion_Gastos || "",
      Persona_Recogio: collector,
      Recaudado_Fisico: false,
      Foto_Factura: Foto_Factura || undefined,
    };

    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    const existingIdx = db.closures.findIndex(
      (c) => c && c.Fecha === closureDate && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim()
    );

    let closureToSave: DailyClosure;
    if (existingIdx !== -1) {
      db.closures[existingIdx] = {
        ...db.closures[existingIdx],
        ...newClosure,
        Recaudado_Fisico: db.closures[existingIdx].Recaudado_Fisico
      };
      closureToSave = db.closures[existingIdx];
    } else {
      db.closures.push(newClosure);
      closureToSave = newClosure;
    }

    // Add or update an entry in the branch wallet transaction too
    const neto = closureToSave.Ventas_Totales - closureToSave.Gastos_Extra;
    const txIdx = db.walletTransactions.findIndex(
      (t) => t && t.Fecha === closureDate && String(t.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Ingreso" && String(t.Descripcion || "").includes("Cierre")
    );

    let txToSave: WalletTransaction;
    if (txIdx !== -1) {
      db.walletTransactions[txIdx].Valor = neto;
      db.walletTransactions[txIdx].Responsable = collector;
      txToSave = db.walletTransactions[txIdx];
    } else {
      const newTx: WalletTransaction = {
        Fecha: closureDate,
        Sucursal: String(Sucursal).trim(),
        Tipo_Movimiento: "Ingreso",
        Valor: neto,
        Descripcion: `Cierre de Caja - Efectivo neto registrado`,
        Responsable: collector,
        Estado: "Pendiente",
      };
      db.walletTransactions.push(newTx);
      txToSave = newTx;
    }

    saveDb(db);
    await saveBatchToFirestoreDirect([
      { collectionKey: "closures", record: closureToSave },
      { collectionKey: "walletTransactions", record: txToSave }
    ]);

    res.status(200).json(closureToSave);
  } catch (err: any) {
    console.error("Error al registrar cierre:", err);
    res.status(500).json({ error: "Error al guardar el cierre: " + (err?.message || String(err)) });
  }
});

app.put("/api/closures", async (req, res) => {
  try {
    const { Fecha, Sucursal, Ventas_Totales, Gastos_Extra, Descripcion_Gastos, Persona_Recogio } = req.body;
    if (!Fecha || !Sucursal) {
      return res.status(400).json({ error: "Fecha y sucursal requeridas" });
    }

    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    const index = db.closures.findIndex(
      (c) => c && c.Fecha === Fecha && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim()
    );
    if (index === -1) {
      return res.status(404).json({ error: "Cierre no encontrado" });
    }

    db.closures[index].Ventas_Totales = parseFloat(Ventas_Totales) || 0;
    db.closures[index].Gastos_Extra = parseFloat(Gastos_Extra) || 0;
    db.closures[index].Descripcion_Gastos = Descripcion_Gastos || "";
    if (Persona_Recogio) {
      db.closures[index].Persona_Recogio = Persona_Recogio;
    }

    const updatedClosure = db.closures[index];

    // Update corresponding wallet transaction
    const neto = updatedClosure.Ventas_Totales - updatedClosure.Gastos_Extra;
    const txIdx = db.walletTransactions.findIndex(
      (t) => t && t.Fecha === Fecha && String(t.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Ingreso"
    );
    let updatedTx: WalletTransaction | null = null;
    if (txIdx !== -1) {
      db.walletTransactions[txIdx].Valor = neto;
      if (Persona_Recogio) {
        db.walletTransactions[txIdx].Responsable = Persona_Recogio;
      }
      updatedTx = db.walletTransactions[txIdx];
    }

    saveDb(db);

    const batchItems: { collectionKey: string; record: any }[] = [
      { collectionKey: "closures", record: updatedClosure }
    ];
    if (updatedTx) {
      batchItems.push({ collectionKey: "walletTransactions", record: updatedTx });
    }

    await saveBatchToFirestoreDirect(batchItems);

    res.json(updatedClosure);
  } catch (err: any) {
    console.error("Error al actualizar cierre:", err);
    res.status(500).json({ error: "Error al actualizar el cierre: " + (err?.message || String(err)) });
  }
});

app.put("/api/closures/reconcile", async (req, res) => {
  try {
    const { Fecha, Sucursal, Recaudado_Fisico } = req.body;
    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    const index = db.closures.findIndex((c) => c && c.Fecha === Fecha && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim());
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
    const batchItems: { collectionKey: string; record: any }[] = [
      { collectionKey: "closures", record: updatedClosure }
    ];

    // Reconcile corresponding wallet transaction for this branch
    const txIdx = db.walletTransactions.findIndex(
      (t) => t && t.Fecha === Fecha && String(t.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Ingreso"
    );
    if (txIdx !== -1) {
      db.walletTransactions[txIdx].Estado = isConfirmed ? "Reconciliado" : "Pendiente";
      batchItems.push({ collectionKey: "walletTransactions", record: db.walletTransactions[txIdx] });
    }

    // Record entry in Central / Nequi when confirmed
    if (isConfirmed && netVal > 0) {
      const today = getColombiaDate();
      const centralTxIdx = db.walletTransactions.findIndex(
        (t) => t && t.Fecha === Fecha && String(t.Sucursal || "") === "Central / Nequi" && String(t.Descripcion || "").includes(Sucursal)
      );
      if (centralTxIdx === -1) {
        const centralTx: WalletTransaction = {
          Fecha: today,
          Sucursal: "Central / Nequi",
          Tipo_Movimiento: "Ingreso",
          Valor: netVal,
          Descripcion: `Recolección Física Autorizada - ${Sucursal} (${Fecha})`,
          Responsable: "Admin / Comprador",
          Estado: "Reconciliado"
        };
        db.walletTransactions.push(centralTx);
        batchItems.push({ collectionKey: "walletTransactions", record: centralTx });
      }
    }

    saveDb(db);

    await saveBatchToFirestoreDirect(batchItems);

    res.json(updatedClosure);
  } catch (err: any) {
    console.error("Error al reconciliar cierre:", err);
    res.status(500).json({ error: "Error al reconciliar cierre: " + (err?.message || String(err)) });
  }
});

app.post("/api/closures/bulk-reconcile", async (req, res) => {
  try {
    const { Sucursal, Monto_Recogido } = req.body;
    if (!Sucursal) {
      return res.status(400).json({ error: "Sucursal es requerida para reconciliación en bloque" });
    }
    if (!Array.isArray(db.closures)) db.closures = [];
    if (!Array.isArray(db.walletTransactions)) db.walletTransactions = [];

    const uncollectedClosures = db.closures.filter(
      (c) => c && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && !c.Recaudado_Fisico
    );

    const batchItems: { collectionKey: string; record: any }[] = [];

    // Reconcile and subtract pending "Gasto" wallet transactions for this branch
    let totalPendingExpenses = 0;
    db.walletTransactions.forEach((t) => {
      if (t && String(t.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Gasto" && t.Estado === "Pendiente") {
        totalPendingExpenses += t.Valor;
        t.Estado = "Reconciliado";
        batchItems.push({ collectionKey: "walletTransactions", record: t });
      }
    });

    // Reconcile all corresponding wallet "Ingreso" transactions (from closures)
    db.walletTransactions.forEach((t) => {
      if (t && String(t.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && t.Tipo_Movimiento === "Ingreso" && t.Estado !== "Reconciliado") {
        t.Estado = "Reconciliado";
        batchItems.push({ collectionKey: "walletTransactions", record: t });
      }
    });

    let totalClosuresAmount = uncollectedClosures.reduce((acc, c) => acc + (c.Ventas_Totales - c.Gastos_Extra), 0);
    
    let isPartial = false;
    let customCollected = 0;
    if (Monto_Recogido !== undefined && Monto_Recogido !== null && Monto_Recogido !== "") {
      customCollected = Number(Monto_Recogido);
      isPartial = true;
    } else {
      customCollected = Math.max(0, totalClosuresAmount - totalPendingExpenses);
    }

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
          remainingToAllocate -= remainingForThisClosure;
        } else {
          c.Monto_Recaudado = currentRecaudado + remainingToAllocate;
          remainingToAllocate = 0;
        }
        batchItems.push({ collectionKey: "closures", record: c });
      });
    } else {
      db.closures.forEach((c) => {
        if (c && String(c.Sucursal || "").toLowerCase().trim() === String(Sucursal || "").toLowerCase().trim() && !c.Recaudado_Fisico) {
          c.Recaudado_Fisico = true;
          c.Monto_Recaudado = c.Ventas_Totales - c.Gastos_Extra;
          batchItems.push({ collectionKey: "closures", record: c });
        }
      });
    }

    // Add a transaction representing this cash pickup to the Central Bank Ledger / general Nequi
    const today = getColombiaDate();
    const newTx: WalletTransaction = {
      Fecha: today,
      Sucursal: "Central / Nequi",
      Tipo_Movimiento: "Ingreso",
      Valor: customCollected,
      Descripcion: isPartial 
        ? `Recolección Física Parcial Autorizada - ${Sucursal}` 
        : `Recolección Física Autorizada - ${Sucursal}`,
      Responsable: "Admin (Cris)",
      Estado: "Reconciliado"
    };
    db.walletTransactions.push(newTx);
    batchItems.push({ collectionKey: "walletTransactions", record: newTx });

    saveDb(db);

    await saveBatchToFirestoreDirect(batchItems);

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

app.post("/api/payroll/schedules/bulk", (req, res) => {
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

  saveDb(db);
  res.json({ success: true, count: schedules.length });
});

// Get all wallet transactions for admin
app.get("/api/wallet-transactions", (req, res) => {
  res.json(db.walletTransactions);
});

// Wallet balance and history per Branch
app.get("/api/wallet/:branch", (req, res) => {
  const { branch } = req.params;
  const isCentral = branch.toLowerCase().includes("central") || branch.toLowerCase().includes("nequi");

  let balance = 0;
  if (isCentral) {
    const reconciledClosuresSum = (db.closures || [])
      .filter((c) => c && c.Recaudado_Fisico)
      .reduce((acc, c) => acc + ((c.Ventas_Totales || 0) - (c.Gastos_Extra || 0)), 0);
    const paidPayrollSum = (db.payroll || []).reduce((acc, p) => acc + (p?.Total_Neto || 0), 0);

    const centralTxs = (db.walletTransactions || []).filter((t) => {
      const s = (t?.Sucursal || "").toLowerCase().trim();
      return s.includes("central") || s.includes("nequi");
    });

    const manualCentralIngresos = centralTxs
      .filter(
        (t) =>
          t.Tipo_Movimiento === "Ingreso" &&
          !t.Descripcion?.includes("Recolección Física") &&
          !t.Descripcion?.includes("Recaudo Cierre")
      )
      .reduce((acc, t) => acc + (t.Valor || 0), 0);

    const centralGastos = centralTxs
      .filter((t) => t.Tipo_Movimiento === "Gasto")
      .reduce((acc, t) => acc + (t.Valor || 0), 0);

    balance = (reconciledClosuresSum + manualCentralIngresos) - (paidPayrollSum + centralGastos);
  } else {
    const targetBranch = branch.toLowerCase().trim();
    const uncollectedClosuresSum = (db.closures || [])
      .filter(
        (c) =>
          c &&
          !c.Recaudado_Fisico &&
          (c.Sucursal || "").toLowerCase().trim() === targetBranch
      )
      .reduce((acc, c) => acc + ((c.Ventas_Totales || 0) - (c.Gastos_Extra || 0)), 0);

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

  const txDate = Fecha || getColombiaDate();

  const newTx: WalletTransaction = {
    Fecha: txDate,
    Sucursal: branch,
    Tipo_Movimiento: "Gasto",
    Valor: parseFloat(Valor_Gasto),
    Descripcion: Descripcion_Gasto,
    Responsable: Responsable || "System",
    Estado: "Pendiente",
    Foto_Factura: Foto_Factura || undefined,
  };

  db.walletTransactions.push(newTx);

  const newExpense = {
    Fecha: txDate,
    Sucursal: branch,
    Valor_Gasto: parseFloat(Valor_Gasto),
    Descripcion_Gasto: Descripcion_Gasto,
    Responsable: Responsable || "System",
    Reconciliado_Fisico: false,
  };

  db.nequiExpenses.push(newExpense);

  saveDb(db);

  await saveBatchToFirestoreDirect([
    { collectionKey: "walletTransactions", record: newTx },
    { collectionKey: "nequiExpenses", record: newExpense }
  ]);

  res.status(210).json(newTx);
});

app.post("/api/wallet/:branch/transaction", async (req, res) => {
  const { branch } = req.params;
  const { Fecha, Tipo_Movimiento, Valor, Descripcion, Responsable } = req.body;

  if (!Valor || !Descripcion || !Tipo_Movimiento) {
    return res.status(400).json({ error: "Valor, descripción y tipo de movimiento requeridos" });
  }

  const txDate = Fecha || getColombiaDate();

  const newTx: WalletTransaction = {
    Fecha: txDate,
    Sucursal: branch,
    Tipo_Movimiento: Tipo_Movimiento as "Ingreso" | "Gasto",
    Valor: parseFloat(Valor),
    Descripcion: Descripcion,
    Responsable: Responsable || "System",
    Estado: "Reconciliado",
  };

  db.walletTransactions.push(newTx);
  saveDb(db);

  await saveRecordToFirestoreDirect("walletTransactions", newTx);

  res.status(210).json(newTx);
});

// Mermas (Shrinkage)
app.get("/api/shrinkages", (req, res) => {
  const { sucursal } = req.query;
  let filtered = db.shrinkages;
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
  saveDb(db);
  await saveRecordToFirestoreDirect("shrinkages", newShrinkage);
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
  saveDb(db);
  await saveRecordToFirestoreDirect("packagingMovements", newMovement);
  res.status(210).json(newMovement);
});

// Payroll schedules, loans and generating payroll
app.get("/api/payroll/data", (req, res) => {
  res.json({
    schedules: db.schedules,
    loans: db.loans,
    rates: db.rates,
    payroll: db.payroll,
  });
});

app.post("/api/payroll/rates", async (req, res) => {
  const { Empleado, Valor_Dia, Valor_Hora, Auxilio_Transporte, Celular, Cedula } = req.body;
  if (!Empleado) {
    return res.status(400).json({ error: "El nombre del empleado es requerido" });
  }
  const exists = db.rates.some(r => r.Empleado.toLowerCase() === Empleado.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: "Ya existe un empleado con ese nombre" });
  }
  const newRate = {
    Empleado,
    Valor_Dia: Math.round(parseFloat(Valor_Dia) || 60000),
    Valor_Hora: Math.round(parseFloat(Valor_Hora) || 9000),
    Auxilio_Transporte: Math.round(parseFloat(Auxilio_Transporte) || 8303),
    Celular: Celular || "",
    Cedula: Cedula || ""
  };
  db.rates.push(newRate);
  saveDb(db);
  await saveRecordToFirestoreDirect("rates", newRate);
  res.status(210).json(newRate);
});

app.put("/api/payroll/rates/:name", async (req, res) => {
  const oldName = decodeURIComponent(req.params.name).trim();
  const { Empleado, Valor_Dia, Valor_Hora, Auxilio_Transporte, Celular, Cedula } = req.body;
  const index = db.rates.findIndex(r => r.Empleado.toLowerCase().trim() === oldName.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: "Empleado no encontrado" });
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
    Valor_Dia: Valor_Dia !== undefined ? Math.round(parseFloat(Valor_Dia)) : db.rates[index].Valor_Dia,
    Valor_Hora: Valor_Hora !== undefined ? Math.round(parseFloat(Valor_Hora)) : db.rates[index].Valor_Hora,
    Auxilio_Transporte: Auxilio_Transporte !== undefined ? Math.round(parseFloat(Auxilio_Transporte)) : (db.rates[index].Auxilio_Transporte !== undefined ? db.rates[index].Auxilio_Transporte : 8303),
    Celular: Celular !== undefined ? Celular : db.rates[index].Celular,
    Cedula: Cedula !== undefined ? Cedula : db.rates[index].Cedula
  };

  saveDb(db);
  await saveRecordToFirestoreDirect("rates", db.rates[index]);
  res.json(db.rates[index]);
});

app.delete("/api/payroll/rates/:name", async (req, res) => {
  const name = decodeURIComponent(req.params.name).trim();
  const index = db.rates.findIndex(r => r.Empleado.toLowerCase().trim() === name.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: "Empleado no encontrado" });
  }
  const deleted = db.rates.splice(index, 1)[0];
  saveDb(db);
  await deleteRecordFromFirestoreDirect("rates", deleted);
  res.json({ success: true });
});

app.post("/api/payroll/schedule", async (req, res) => {
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
  saveDb(db);
  await saveRecordToFirestoreDirect("schedules", newSched);
  res.status(210).json(newSched);
});

app.post("/api/payroll/schedule/save", async (req, res) => {
  const { Fecha, Empleado, Sucursal, Horas_Trabajadas } = req.body;
  if (!Empleado || !Sucursal || Horas_Trabajadas === undefined || !Fecha) {
    return res.status(400).json({ error: "Fecha, Empleado, Sucursal y Horas son requeridos" });
  }

  const deletedScheds = db.schedules.filter(
    (s) => s.Fecha === Fecha && s.Empleado.toLowerCase() === Empleado.toLowerCase()
  );

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
  saveDb(db);

  for (const ds of deletedScheds) {
    await deleteRecordFromFirestoreDirect("schedules", ds);
  }
  await saveRecordToFirestoreDirect("schedules", newSched);

  res.json({ success: true, schedule: newSched });
});

app.post("/api/payroll/schedule/delete", async (req, res) => {
  const { Fecha, Empleado } = req.body;
  if (!Fecha || !Empleado) {
    return res.status(400).json({ error: "Fecha y Empleado son requeridos" });
  }

  const deletedScheds = db.schedules.filter(
    (s) => s.Fecha === Fecha && s.Empleado.toLowerCase() === Empleado.toLowerCase()
  );

  db.schedules = db.schedules.filter(
    (s) => !(s.Fecha === Fecha && s.Empleado.toLowerCase() === Empleado.toLowerCase())
  );

  saveDb(db);

  for (const ds of deletedScheds) {
    await deleteRecordFromFirestoreDirect("schedules", ds);
  }

  res.json({ success: true });
});

app.post("/api/payroll/loan", async (req, res) => {
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
  saveDb(db);
  await saveRecordToFirestoreDirect("loans", newLoan);
  res.status(210).json(newLoan);
});

app.post("/api/payroll/generate", async (req, res) => {
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
      await saveRecordToFirestoreDirect("loans", loan);
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
  saveDb(db);
  await saveRecordToFirestoreDirect("payroll", newPayroll);
  res.status(210).json(newPayroll);
});

app.post("/api/payroll/pay", async (req, res) => {
  const { Trabajador, Fecha } = req.body;
  const idx = db.payroll.findIndex((p) => p.Trabajador === Trabajador && p.Fecha === Fecha);
  if (idx !== -1) {
    db.payroll[idx].Estado_Pago = "Pagado";
    saveDb(db);
    await saveRecordToFirestoreDirect("payroll", db.payroll[idx]);
    return res.json(db.payroll[idx]);
  }
  res.status(404).json({ error: "Registro de nómina no encontrado" });
});




app.delete("/api/products/:code", async (req, res) => {
  const { code } = req.params;
  const index = db.products.findIndex((p) => p.Codigo === code);
  if (index === -1) {
    return res.status(404).json({ error: "Producto no encontrado en el catálogo." });
  }
  const deleted = db.products.splice(index, 1)[0];
  saveDb(db);
  await deleteRecordFromFirestoreDirect("products", deleted);
  res.json({ success: true, deleted });
});

app.post("/api/admin/import-csv-orders", (req, res) => {
  const { csvText, fecha } = req.body;
  if (!csvText || typeof csvText !== "string" || !csvText.trim()) {
    return res.status(400).json({ error: "No se proporcionó el texto de los pedidos." });
  }

  const orderDate = fecha || getColombiaDate();
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  // Group orders under unique ID_Pedido per sucursal
  const sucursales = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];
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

    const branchQtys: { [sucursal: string]: string } = {
      Tibasosa: parts[1] ? parts[1].trim() : "0",
      Nobsa: parts[2] ? parts[2].trim() : "0",
      Fira: parts[3] ? parts[3].trim() : "0",
      Aquitania: parts[4] ? parts[4].trim() : "0",
      Hansel: parts[5] ? parts[5].trim() : "0",
    };

    const supplierName = parts[6] ? parts[6].trim() : "Sin Proveedor";
    const purchaseCost = parseFloat(parts[7] ? parts[7].trim().replace(/\s/g, "").replace(",", ".") : "0") || 0;

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
      errorMsg += ` Se detectaron ${malformedCount} filas mal estructuradas. Asegúrese de usar el formato correcto con el delimitador '${delimiter}' y de incluir las 8 columnas requeridas: (PRODUCTO; TIBASOSA; NOBSA; FIRA; AQUITANIA; Hansel; PROVEEDOR; PRECIO COMPRA).`;
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

  saveDb(db);
  res.json({ success: true, count: importedCount, date: orderDate });
});

app.post("/api/admin/clear-operational-data", async (req, res) => {
  try {
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

    saveDb(db);

    await clearFirestoreOperationalCollections();

    recordSyncLog(
      db,
      "Firebase",
      "Limpieza General de Datos Operativos",
      "success",
      "Base de datos totalmente limpiada para entrega: pedidos, cierres, gastos, mermas, horarios, préstamos y nóminas eliminados.",
      0,
      0
    );
    saveDb(db);

    res.json({
      success: true,
      message: "Base de datos operativa vaciada con éxito. Los pedidos, cierres, mermas, nómina, gastos y horarios fueron eliminados para la entrega del sistema."
    });
  } catch (err: any) {
    console.error("Error al limpiar la base de datos:", err);
    res.status(500).json({ error: err.message || "Error al limpiar la base de datos operativa." });
  }
});

app.post("/api/admin/clear-past-months-history", async (req, res) => {
  try {
    const result = await purgePastMonthsOrdersAndClosures(db);
    saveDb(db);
    recordSyncLog(
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


app.post("/api/test/run", (req, res) => {
  try {
    // Reset/Clear relevant tables for a clean test state
    db.orders = [];
    db.closures = [];
    db.walletTransactions = [];
    db.priceHistory = [];

    const branches = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];
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

    saveDb(db);

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
// SYNC LOGS & FIREBASE ENDPOINTS
// ─────────────────────────────────────────────
app.get("/api/sync-logs", (req, res) => {
  res.json(db.syncLogs || []);
});

app.post("/api/sync-logs/clear", (req, res) => {
  db.syncLogs = [];
  saveDb(db);
  res.json({ success: true, message: "Historial de logs de sincronización limpiado correctamente." });
});

app.post("/api/firebase/sync", async (req, res) => {
  const startTime = Date.now();
  try {
    const { pullFromFirestore, syncAllLocalCollectionsToFirestore } = await import("./server/firebase.ts");
    console.log("[API Firebase Sync] Sincronización forzada solicitada...");
    
    // Forzar guardado con setDoc ({ merge: true }) de todas las colecciones locales
    const syncedCount = await syncAllLocalCollectionsToFirestore(db);
    
    // Descargar/actualizar datos sincronizados desde Cloud Firestore
    await pullFromFirestore(db);
    saveDb(db);
    
    const durationMs = Date.now() - startTime;
    const count = (db.orders?.length || 0) + (db.closures?.length || 0) + (db.products?.length || 0);
    recordSyncLog(
      db, 
      "Firebase", 
      "Sincronización Manual / ForceSync", 
      "success", 
      `Sincronización forzada completada con éxito (${syncedCount} escrituras forzadas en Firestore).`, 
      count, 
      durationMs
    );
    saveDb(db);
    res.json({
      success: true,
      synced: syncedCount,
      message: "Base de datos sincronizada exitosamente con Firebase Firestore.",
      counts: {
        products: db.products?.length || 0,
        orders: db.orders?.length || 0,
        closures: db.closures?.length || 0,
        users: db.users?.length || 0
      },
      logs: db.syncLogs
    });
  } catch (err: any) {
    console.error("[API Firebase Sync] Error:", err);
    recordSyncLog(
      db, 
      "Firebase", 
      "Sincronización Manual", 
      "error", 
      `Error en sincronización forzada con Firestore: ${err.message || err}`, 
      0, 
      Date.now() - startTime
    );
    saveDb(db);
    res.status(500).json({ error: err.message || "Error al sincronizar con Firebase" });
  }
});

// ─────────────────────────────────────────────
// VITE OR STATIC MIDDLEWARE SETUP
// ─────────────────────────────────────────────
app.get("/logo_al_paso.png", (req, res) => {
  res.sendFile(path.join(process.cwd(), "logo_al_paso.png"));
});

async function startServer() {
  console.log("[Startup] Iniciando servidor Al Paso en modo local autónomo...");

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
}

startServer();
