import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db as sqlDb } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";

export const sqlSyncRouter = Router();

// --- Server-Sent Events (SSE) Manager para Sincronización en Vivo (SQL -> Front) ---
type SSEClient = {
  id: string;
  res: Response;
};

const sseClients: Map<string, SSEClient> = new Map();

export function broadcastSQLEvent(entity: string, action: "create" | "update" | "delete", data: any, sourceClientId?: string) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    entity,
    action,
    data,
    sourceClientId
  });

  sseClients.forEach((client) => {
    // Si el evento provino de este mismo cliente en vivo, se puede omitir o enviar con bandera
    client.res.write(`event: sql-change\ndata: ${payload}\n\n`);
  });
}

// Endpoint SSE para escuchar cambios en vivo
sqlSyncRouter.get("/events", (req: Request, res: Response) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Enviar mensaje inicial de conexión establecida
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, message: "Conectado al canal de eventos SQL en vivo" })}\n\n`);

  sseClients.set(clientId, { id: clientId, res });

  req.on("close", () => {
    sseClients.delete(clientId);
  });
});

// Helper para verificar conexión a SQL
async function isSqlAvailable(): Promise<boolean> {
  return Boolean(process.env.SQL_HOST && process.env.SQL_DB_NAME && process.env.SQL_USER);
}

// --- 1. ENDPOINTS DE PRODUCTOS / CATÁLOGO ---
sqlSyncRouter.get("/products", async (req: Request, res: Response) => {
  try {
    if (!(await isSqlAvailable())) {
      return res.status(503).json({ error: "PostgreSQL no configurado en entorno." });
    }
    const result = await sqlDb.select().from(schema.products);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Error consultando productos" });
  }
});

sqlSyncRouter.post("/products", async (req: Request, res: Response) => {
  try {
    const { clientId, ...productData } = req.body;
    const inserted = await sqlDb.insert(schema.products).values(productData).returning();
    const created = inserted[0];
    broadcastSQLEvent("products", "create", created, clientId);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Error al crear producto en SQL" });
  }
});

sqlSyncRouter.put("/products/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { clientId, ...productData } = req.body;
    const updated = await sqlDb.update(schema.products)
      .set(productData)
      .where(eq(schema.products.id, id))
      .returning();
    if (updated.length > 0) {
      broadcastSQLEvent("products", "update", updated[0], clientId);
      res.json(updated[0]);
    } else {
      res.status(404).json({ error: "Producto no encontrado" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Error al actualizar producto en SQL" });
  }
});

sqlSyncRouter.delete("/products/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const clientId = req.headers["x-client-id"] as string;
    const deleted = await sqlDb.delete(schema.products)
      .where(eq(schema.products.id, id))
      .returning();
    if (deleted.length > 0) {
      broadcastSQLEvent("products", "delete", { id }, clientId);
      res.json({ success: true, deleted: deleted[0] });
    } else {
      res.status(404).json({ error: "Producto no encontrado" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Error al eliminar producto en SQL" });
  }
});

// --- 2. ENDPOINTS DE PROVEEDORES ---
sqlSyncRouter.get("/providers", async (req: Request, res: Response) => {
  try {
    if (!(await isSqlAvailable())) {
      return res.status(503).json({ error: "PostgreSQL no configurado" });
    }
    const result = await sqlDb.select().from(schema.providers);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

sqlSyncRouter.post("/providers", async (req: Request, res: Response) => {
  try {
    const { clientId, ...providerData } = req.body;
    const inserted = await sqlDb.insert(schema.providers).values(providerData).returning();
    broadcastSQLEvent("providers", "create", inserted[0], clientId);
    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 3. ENDPOINTS DE PEDIDOS / ÓRDENES ---
sqlSyncRouter.get("/orders", async (req: Request, res: Response) => {
  try {
    if (!(await isSqlAvailable())) {
      return res.status(503).json({ error: "PostgreSQL no configurado" });
    }
    const result = await sqlDb.select().from(schema.orders);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

sqlSyncRouter.post("/orders", async (req: Request, res: Response) => {
  try {
    const { clientId, ...orderData } = req.body;
    const inserted = await sqlDb.insert(schema.orders).values(orderData).returning();
    broadcastSQLEvent("orders", "create", inserted[0], clientId);
    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

sqlSyncRouter.put("/orders/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { clientId, ...orderData } = req.body;
    const updated = await sqlDb.update(schema.orders)
      .set(orderData)
      .where(eq(schema.orders.id, id))
      .returning();
    if (updated.length > 0) {
      broadcastSQLEvent("orders", "update", updated[0], clientId);
      res.json(updated[0]);
    } else {
      res.status(404).json({ error: "Pedido no encontrado" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 4. ENDPOINTS DE CIERRES DE CAJA ---
/**
 * RESTRICCIÓN DE NEGOCIO CRÍTICA:
 * Las operaciones de sincronización de cierres de caja en las sucursales NO deben crear ni guardar
 * historiales de entregas de dinero bajo ninguna circunstancia.
 * Aquí guardamos únicamente el registro de cierre en la tabla 'closures' sin generar entradas secundarias.
 */
sqlSyncRouter.get("/closures", async (req: Request, res: Response) => {
  try {
    if (!(await isSqlAvailable())) {
      return res.status(503).json({ error: "PostgreSQL no configurado" });
    }
    const result = await sqlDb.select().from(schema.closures);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

sqlSyncRouter.post("/closures", async (req: Request, res: Response) => {
  try {
    const { clientId, ...closureData } = req.body;

    // Aislamiento estricto: Sanitizar campos para asegurar que NO se genere historial de entregas
    const sanitizedClosure = {
      fecha: closureData.fecha || closureData.Fecha || new Date().toISOString().split("T")[0],
      sucursal: closureData.sucursal || closureData.Sucursal || "Plaza",
      ventasTotales: parseFloat(closureData.ventasTotales || closureData.Ventas_Totales || 0),
      gastosExtra: parseFloat(closureData.gastosExtra || closureData.Gastos_Extra || 0),
      descripcionGastos: closureData.descripcionGastos || closureData.Descripcion_Gastos || "",
      personaRecogio: closureData.personaRecogio || closureData.Persona_Recogio || "",
      recaudadoFisico: Boolean(closureData.recaudadoFisico || closureData.Recaudado_Fisico || false),
      fotoFactura: closureData.fotoFactura || closureData.Foto_Factura || "",
      montoRecaudado: parseFloat(closureData.montoRecaudado || closureData.Monto_Recaudado || 0),
    };

    const inserted = await sqlDb.insert(schema.closures).values(sanitizedClosure).returning();
    
    // Difundir evento SSE para actualizar la UI en tiempo real sin alterar registros de entrega
    broadcastSQLEvent("closures", "create", inserted[0], clientId);
    
    res.status(201).json({
      success: true,
      data: inserted[0],
      note: "Cierre registrado exitosamente. Cumpliendo regla de negocio: no se generó historial de entrega de dinero."
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 5. ENDPOINTS DE NÓMINA ---
sqlSyncRouter.get("/payroll", async (req: Request, res: Response) => {
  try {
    if (!(await isSqlAvailable())) {
      return res.status(503).json({ error: "PostgreSQL no configurado" });
    }
    const result = await sqlDb.select().from(schema.payrollRecords);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

sqlSyncRouter.post("/payroll", async (req: Request, res: Response) => {
  try {
    const { clientId, ...payrollData } = req.body;
    const inserted = await sqlDb.insert(schema.payrollRecords).values(payrollData).returning();
    broadcastSQLEvent("payroll", "create", inserted[0], clientId);
    res.status(201).json(inserted[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 6. ENDPOINT DE RESILIENCIA Y PROCESAMIENTO EN LOTE (BATCH RETRY QUEUE) ---
sqlSyncRouter.post("/batch", async (req: Request, res: Response) => {
  try {
    const { items, clientId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "El cuerpo de la petición debe contener una lista 'items'" });
    }

    const processedResults = [];

    for (const item of items) {
      const { entity, action, data, id } = item;
      try {
        let result = null;

        if (entity === "products") {
          if (action === "create") {
            result = await sqlDb.insert(schema.products).values(data).returning();
          } else if (action === "update" && id) {
            result = await sqlDb.update(schema.products).set(data).where(eq(schema.products.id, id)).returning();
          } else if (action === "delete" && id) {
            result = await sqlDb.delete(schema.products).where(eq(schema.products.id, id)).returning();
          }
        } else if (entity === "orders") {
          if (action === "create") {
            result = await sqlDb.insert(schema.orders).values(data).returning();
          } else if (action === "update" && id) {
            result = await sqlDb.update(schema.orders).set(data).where(eq(schema.orders.id, id)).returning();
          }
        } else if (entity === "closures") {
          // Mantener la restricción de negocio en operaciones por lote
          if (action === "create") {
            const cleanClosure = {
              fecha: data.fecha || new Date().toISOString().split("T")[0],
              sucursal: data.sucursal || "Plaza",
              ventasTotales: parseFloat(data.ventasTotales || 0),
              gastosExtra: parseFloat(data.gastosExtra || 0),
              descripcionGastos: data.descripcionGastos || "",
              personaRecogio: data.personaRecogio || "",
              recaudadoFisico: Boolean(data.recaudadoFisico),
              fotoFactura: data.fotoFactura || "",
              montoRecaudado: parseFloat(data.montoRecaudado || 0),
            };
            result = await sqlDb.insert(schema.closures).values(cleanClosure).returning();
          }
        } else if (entity === "providers") {
          if (action === "create") {
            result = await sqlDb.insert(schema.providers).values(data).returning();
          }
        } else if (entity === "payroll") {
          if (action === "create") {
            result = await sqlDb.insert(schema.payrollRecords).values(data).returning();
          }
        }

        if (result && result.length > 0) {
          broadcastSQLEvent(entity, action, result[0], clientId);
        }

        processedResults.push({ id: item.id || item.tempId, status: "success" });
      } catch (err: any) {
        console.error(`Error procesando elemento en lote para entidad ${entity}:`, err);
        processedResults.push({ id: item.id || item.tempId, status: "error", error: err.message });
      }
    }

    res.json({
      success: true,
      processedCount: processedResults.filter((r) => r.status === "success").length,
      results: processedResults
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
