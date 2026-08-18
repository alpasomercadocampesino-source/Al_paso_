/**
 * Cliente de Sincronización Bidireccional en Tiempo Real con PostgreSQL (Drizzle ORM)
 * Incluye:
 * 1. Escritura Directa (Front -> SQL)
 * 2. Transmisión en Vivo SSE (SQL -> Front)
 * 3. Cola de Reintentos Offline (Queue Resiliency)
 * 4. Cumplimiento de Regla de Negocio (Sin historial de entregas de dinero en cierres)
 */

export interface QueueItem {
  id: string; // ID único temporal
  entity: "products" | "providers" | "orders" | "closures" | "payroll";
  action: "create" | "update" | "delete";
  data: any;
  timestamp: number;
}

const QUEUE_STORAGE_KEY = "alpaso_sql_retry_queue_v1";

class SQLSyncClient {
  private clientId: string;
  private eventSource: EventSource | null = null;
  private queue: QueueItem[] = [];
  private isFlushingQueue = false;
  private listeners: Map<string, Set<(event: any) => void>> = new Map();

  constructor() {
    this.clientId = `client_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    this.loadQueueFromStorage();
    this.initOnlineListener();
  }

  public getClientId(): string {
    return this.clientId;
  }

  // --- 1. Sincronización en Vivo (SQL -> Front vía SSE) ---
  public connectLiveSync() {
    if (this.eventSource) return;

    try {
      this.eventSource = new EventSource("/api/sql-sync/events");

      this.eventSource.addEventListener("connected", (e: any) => {
        console.log("[SQL Live Sync] Conectado exitosamente al canal en vivo:", e.data);
      });

      this.eventSource.addEventListener("sql-change", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          // Opcional: ignorar cambios si provienen de este mismo cliente para evitar bucles
          if (payload.sourceClientId === this.clientId) {
            console.log("[SQL Live Sync] Cambio local propio confirmado por el servidor.");
          }
          this.notifyListeners(payload.entity, payload);
          this.notifyListeners("*", payload);
        } catch (err) {
          console.error("[SQL Live Sync] Error parseando evento SSE:", err);
        }
      });

      this.eventSource.onerror = (err) => {
        console.warn("[SQL Live Sync] Desconexión temporal del canal SSE. Reintentando...");
        this.eventSource?.close();
        this.eventSource = null;
        // Reintentar conexión tras 5 segundos
        setTimeout(() => this.connectLiveSync(), 5000);
      };
    } catch (err) {
      console.error("[SQL Live Sync] Error iniciando EventSource:", err);
    }
  }

  public subscribe(entity: string, callback: (event: any) => void) {
    if (!this.listeners.has(entity)) {
      this.listeners.set(entity, new Set());
    }
    this.listeners.get(entity)!.add(callback);

    return () => {
      this.listeners.get(entity)?.delete(callback);
    };
  }

  private notifyListeners(entity: string, data: any) {
    const callbacks = this.listeners.get(entity);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }

  // --- 2. Cola de Reintentos (Queue Resiliency) ---
  private loadQueueFromStorage() {
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (e) {
      this.queue = [];
    }
  }

  private saveQueueToStorage() {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error("Error al guardar cola offline en localStorage:", e);
    }
  }

  private initOnlineListener() {
    window.addEventListener("online", () => {
      console.log("[SQL Sync Client] Conexión a red restablecida. Procesando cola de reintentos...");
      this.flushQueue();
    });

    // Intentar vaciar la cola al instanciar si hay red
    if (navigator.onLine) {
      setTimeout(() => this.flushQueue(), 2000);
    }
  }

  public async flushQueue(): Promise<void> {
    if (this.isFlushingQueue || this.queue.length === 0 || !navigator.onLine) return;

    this.isFlushingQueue = true;
    console.log(`[Queue Resiliency] Procesando ${this.queue.length} operaciones pendientes...`);

    try {
      const res = await fetch("/api/sql-sync/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: this.queue,
          clientId: this.clientId
        })
      });

      if (res.ok) {
        const body = await res.json();
        if (body.success) {
          console.log(`[Queue Resiliency] ${body.processedCount} elementos procesados en SQL.`);
          // Limpiar cola procesada
          this.queue = [];
          this.saveQueueToStorage();
        }
      }
    } catch (err) {
      console.warn("[Queue Resiliency] Error al enviar lote a SQL. Se reintentará en el próximo ciclo:", err);
    } finally {
      this.isFlushingQueue = false;
    }
  }

  public getQueue(): QueueItem[] {
    return [...this.queue];
  }

  public enqueueOperation(entity: QueueItem["entity"], action: QueueItem["action"], data: any) {
    const item: QueueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      entity,
      action,
      data,
      timestamp: Date.now()
    };
    this.queue.push(item);
    this.saveQueueToStorage();
    console.warn(`[Queue Resiliency] Operación en '${entity}' guardada localmente en cola offline.`, item);
    return item;
  }

  // --- 3. Escritura Inmediata (Front -> SQL) ---

  // Productos
  public async saveProduct(productData: any): Promise<any> {
    const isUpdate = Boolean(productData.id);
    const endpoint = isUpdate ? `/api/sql-sync/products/${productData.id}` : "/api/sql-sync/products";
    const method = isUpdate ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...productData, clientId: this.clientId })
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      this.enqueueOperation("products", isUpdate ? "update" : "create", productData);
      return { _offline: true, ...productData };
    }
  }

  // Pedidos
  public async saveOrder(orderData: any): Promise<any> {
    const isUpdate = Boolean(orderData.id);
    const endpoint = isUpdate ? `/api/sql-sync/orders/${orderData.id}` : "/api/sql-sync/orders";
    const method = isUpdate ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...orderData, clientId: this.clientId })
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      this.enqueueOperation("orders", isUpdate ? "update" : "create", orderData);
      return { _offline: true, ...orderData };
    }
  }

  // Cierres de caja (RESTRICCIÓN DE NEGOCIO ENFORCED)
  public async saveClosure(closureData: any): Promise<any> {
    // RESTRICCIÓN DE NEGOCIO: No enviar ni crear datos de entrega de dinero
    const cleanClosure = {
      fecha: closureData.fecha || closureData.Fecha || new Date().toISOString().split("T")[0],
      sucursal: closureData.sucursal || closureData.Sucursal || "Plaza",
      ventasTotales: parseFloat(closureData.ventasTotales || closureData.Ventas_Totales || 0),
      gastosExtra: parseFloat(closureData.gastosExtra || closureData.Gastos_Extra || 0),
      descripcionGastos: closureData.descripcionGastos || closureData.Descripcion_Gastos || "",
      personaRecogio: closureData.personaRecogio || closureData.Persona_Recogio || "",
      recaudadoFisico: Boolean(closureData.recaudadoFisico || closureData.Recaudado_Fisico || false),
      fotoFactura: closureData.fotoFactura || closureData.Foto_Factura || "",
      montoRecaudado: parseFloat(closureData.montoRecaudado || closureData.Monto_Recaudado || 0)
    };

    try {
      const response = await fetch("/api/sql-sync/closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cleanClosure, clientId: this.clientId })
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      this.enqueueOperation("closures", "create", cleanClosure);
      return { _offline: true, ...cleanClosure };
    }
  }

  // Nómina
  public async savePayroll(payrollData: any): Promise<any> {
    try {
      const response = await fetch("/api/sql-sync/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payrollData, clientId: this.clientId })
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      this.enqueueOperation("payroll", "create", payrollData);
      return { _offline: true, ...payrollData };
    }
  }

  // Proveedores
  public async saveProvider(providerData: any): Promise<any> {
    try {
      const response = await fetch("/api/sql-sync/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...providerData, clientId: this.clientId })
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (err) {
      this.enqueueOperation("providers", "create", providerData);
      return { _offline: true, ...providerData };
    }
  }
}

export const sqlSyncClient = new SQLSyncClient();
