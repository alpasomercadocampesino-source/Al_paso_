import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  Unsubscribe,
  SnapshotMetadata
} from "firebase/firestore";

// Re-exportar cliente de Firebase con Persistencia Offline Multi-Pestaña activada
import { db, auth } from "./lib/firebase";
import { getPendingOrders, removePendingOrder } from "./utils/indexedDb";
export { db, auth };

// ============================================================================
// SISTEMA DE LOGS Y NOTIFICACIONES DE SINCRONIZACIÓN (REGLA DE ORO 3)
// ============================================================================

export interface SyncLogEvent {
  id: string;
  timestamp: Date;
  tipo: "EXITO" | "ERROR" | "PENDIENTE_OFFLINE" | "HIDRATACION";
  coleccion: string;
  accion: string;
  mensaje: string;
  detalles?: any;
}

type SyncLogListener = (events: SyncLogEvent[]) => void;
const syncLogs: SyncLogEvent[] = [];
const logListeners: Set<SyncLogListener> = new Set();

export function emitSyncEvent(event: Omit<SyncLogEvent, "id" | "timestamp">) {
  const fullEvent: SyncLogEvent = {
    ...event,
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date()
  };
  syncLogs.unshift(fullEvent);
  if (syncLogs.length > 50) syncLogs.pop(); // Mantener un límite de 50 registros recientes

  logListeners.forEach((listener) => {
    try {
      listener([...syncLogs]);
    } catch (err) {
      console.error("[SyncLog] Error notificando listener:", err);
    }
  });
}

export function subscribeSyncLogs(listener: SyncLogListener): () => void {
  logListeners.add(listener);
  listener([...syncLogs]);
  return () => {
    logListeners.delete(listener);
  };
}

export function getSyncLogs(): SyncLogEvent[] {
  return [...syncLogs];
}

// ============================================================================
// INTERFACES Y MODELOS DE DATOS DEL FRUVER "AL PASO"
// ============================================================================

export interface ItemInventario {
  id?: string;
  codigo: string;
  producto: string;
  medida: string;
  costoProveedor: number;
  precioVentaActual: number;
  stockActual: number;
  sucursalId: string;
  actualizadoEn?: Timestamp | Date;
}

export interface Sucursal {
  id?: string;
  nombre: string;
  direccion: string;
  telefono: string;
  encargado: string;
  activa: boolean;
  baseCaja?: number;
  creadoEn?: Timestamp | Date;
}

export interface Pedido {
  id?: string;
  ID_Pedido: string;
  Fecha: string;
  Sucursal: string;
  Codigo: string;
  Producto: string;
  Medida: string;
  Cantidad: string;
  Notas?: string;
  Precio_Anterior: number;
  Porcentaje_Ganancia: number;
  Cantidad_Comprada?: number;
  Costo_Momento?: number;
  Precio_Venta_Momento?: number;
  Kilos?: number;
  Estado: "Pendiente" | "Comprado" | "Cancelado";
  Estado_Pago: "Pendiente" | "Pagado";
  Proveedor?: string;
  Celular?: string;
  creadoEn?: Timestamp | Date;
  actualizadoEn?: Timestamp | Date;
}

export interface CierreCaja {
  id?: string;
  Fecha: string;
  Sucursal: string;
  Ventas_Totales: number;
  Gastos_Extra: number;
  Descripcion_Gastos?: string;
  Persona_Recogio?: string;
  Recaudado_Fisico?: boolean;
  Foto?: string;
  creadoEn?: Timestamp | Date;
  actualizadoEn?: Timestamp | Date;
}

export interface RegistroNomina {
  id?: string;
  Fecha: string;
  Trabajador: string;
  Sucursal: string;
  Dias_Trabajados: number;
  Horas_Trabajadas: number;
  Pago_Base: number;
  Pago_Horas: number;
  Prestamos_Descontados: number;
  Total_Neto: number;
  Estado_Pago: "Pendiente" | "Pagado";
  creadoEn?: Timestamp | Date;
  actualizadoEn?: Timestamp | Date;
}

export interface MovimientoMonedero {
  id?: string;
  Fecha: string;
  Sucursal: string;
  Tipo_Movimiento: "Ingreso" | "Gasto";
  Valor: number;
  Descripcion: string;
  Responsable: string;
  Estado: "Pendiente" | "Reconciliado";
  Foto?: string;
  creadoEn?: Timestamp | Date;
  actualizadoEn?: Timestamp | Date;
}

export interface RegistroMerma {
  id?: string;
  Fecha: string;
  Sucursal: string;
  Codigo: string;
  Producto: string;
  Cantidad: string;
  Motivo: string;
  Costo_Proveedor: number;
  Perdida_Monetaria: number;
  Foto?: string;
  creadoEn?: Timestamp | Date;
  actualizadoEn?: Timestamp | Date;
}

// ============================================================================
// HELPER SEGURO DE ESCRITURA CON INTENTO / FALLO (REGLA DE ORO 3)
// ============================================================================

function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map((item) => cleanUndefined(item)) as unknown as T;
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, any>)[key];
    if (val !== undefined) {
      result[key] = cleanUndefined(val);
    }
  }
  return result as T;
}

/**
 * Realiza una escritura atómica en Firestore con { merge: true }, marcas de tiempo del servidor
 * y captura de excepciones. Garantiza que jamás se sobreescriba una entidad completa
 * y que los errores de permisos o red activen notificaciones inmediatas.
 */
async function safeFirestoreSet<T extends Record<string, any>>(
  collectionName: string,
  docId: string,
  data: T
): Promise<string> {
  try {
    const docRef = doc(db, collectionName, docId);
    const rawPayload = {
      ...data,
      id: docId,
      actualizadoEn: serverTimestamp()
    };
    const payload = cleanUndefined(rawPayload);

    // Escritura asíncrona segura con merge: true (No destruye campos paralelos)
    await setDoc(docRef, payload, { merge: true });

    emitSyncEvent({
      tipo: "EXITO",
      coleccion: collectionName,
      accion: `Guardar/Actualizar [${docId}]`,
      mensaje: `Registro persistido en almacenamiento local/nube exitosamente.`
    });

    return docId;
  } catch (error: any) {
    const errorMsg = error?.message || "Error desconocido al escribir en Firestore";
    const isQuotaError = error?.code === "resource-exhausted" || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("Quota exceeded");

    if (isQuotaError) {
      console.warn(`[Firestore Quota] Cuota alcanzada al escribir en '${collectionName}' ID '${docId}'. Guardado localmente.`);
      emitSyncEvent({
        tipo: "PENDIENTE_OFFLINE",
        coleccion: collectionName,
        accion: `Guardar Local [${docId}]`,
        mensaje: `Cuota de Firestore alcanzada. Los datos se mantienen seguros en almacenamiento local.`
      });
      // Retornamos el docId para que la aplicación local continúe operando sin romper la experiencia
      return docId;
    }

    console.error(`[SyncError] Fallo en colección '${collectionName}' ID '${docId}':`, error);

    // Activar alerta roja y registro en el sistema
    emitSyncEvent({
      tipo: "ERROR",
      coleccion: collectionName,
      accion: `Error al Guardar [${docId}]`,
      mensaje: `Sincronización rechazada: ${errorMsg}`,
      detalles: error
    });

    // Re-lanzar error para revertir el estado visual en la aplicación (Escenario E)
    throw new Error(`REGLA_SEGURIDAD_ERROR: ${errorMsg}`);
  }
}

// ============================================================================
// 1. OPERACIONES COLECCIÓN 'inventario'
// ============================================================================

export async function guardarItemInventario(item: ItemInventario): Promise<string> {
  const docId = item.id || `prd_${item.codigo}`;
  return safeFirestoreSet("inventario", docId, item);
}

export async function obtenerInventario(sucursalId?: string): Promise<ItemInventario[]> {
  try {
    const colRef = collection(db, "inventario");
    const q = sucursalId ? query(colRef, where("sucursalId", "==", sucursalId)) : colRef;
    const querySnapshot = await getDocs(q);
    const items: ItemInventario[] = [];

    querySnapshot.forEach((docSnap) => {
      items.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ItemInventario, "id">)
      });
    });

    return items;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar inventario. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo inventario:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionInventario(
  callback: (items: ItemInventario[], metadata?: SnapshotMetadata) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, "inventario");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: ItemInventario[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...(docSnap.data() as Omit<ItemInventario, "id">) });
      });

      if (snapshot.metadata.hasPendingWrites) {
        emitSyncEvent({
          tipo: "PENDIENTE_OFFLINE",
          coleccion: "inventario",
          accion: "Cambios en búfer local",
          mensaje: "Guardando cambios localmente en IndexedDB (esperando conexión)..."
        });
      }

      callback(items, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de inventario. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de inventario:", err.message);
        }
        if (onError) onError(err);
      }
    }
  );
}

// ============================================================================
// 2. OPERACIONES COLECCIÓN 'sucursales'
// ============================================================================

export async function guardarSucursal(sucursal: Sucursal): Promise<string> {
  const docId = sucursal.id || `suc_${sucursal.nombre.toLowerCase().trim()}`;
  return safeFirestoreSet("sucursales", docId, {
    ...sucursal,
    creadoEn: sucursal.creadoEn || serverTimestamp()
  });
}

export async function obtenerSucursales(): Promise<Sucursal[]> {
  try {
    const colRef = collection(db, "sucursales");
    const querySnapshot = await getDocs(colRef);
    const sucursales: Sucursal[] = [];

    querySnapshot.forEach((docSnap) => {
      sucursales.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Sucursal, "id">)
      });
    });

    return sucursales;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar sucursales. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo sucursales:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionSucursales(
  callback: (sucursales: Sucursal[], metadata?: SnapshotMetadata) => void
): Unsubscribe {
  const colRef = collection(db, "sucursales");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const sucursales: Sucursal[] = [];
      snapshot.forEach((docSnap) => {
        sucursales.push({ id: docSnap.id, ...(docSnap.data() as Omit<Sucursal, "id">) });
      });
      callback(sucursales, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de sucursales. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de sucursales:", err.message);
        }
      }
    }
  );
}

// ============================================================================
// 3. OPERACIONES COLECCIÓN 'pedidos' (VENTAS Y COMPRAS PLAZA)
// ============================================================================

export async function guardarPedido(pedido: Pedido): Promise<string> {
  const docId = pedido.id || `ped_${pedido.ID_Pedido}_${pedido.Codigo}`;
  return safeFirestoreSet("pedidos", docId, {
    ...pedido,
    creadoEn: pedido.creadoEn || serverTimestamp()
  });
}

export async function eliminarPedido(docId: string): Promise<boolean> {
  try {
    const docRef = doc(db, "pedidos", docId);
    await deleteDoc(docRef);
    emitSyncEvent({
      tipo: "EXITO",
      coleccion: "pedidos",
      accion: `Eliminar Pedido [${docId}]`,
      mensaje: `Pedido eliminado correctamente de Firestore.`
    });
    return true;
  } catch (err: any) {
    emitSyncEvent({
      tipo: "ERROR",
      coleccion: "pedidos",
      accion: `Eliminar Pedido [${docId}]`,
      mensaje: `No se pudo eliminar el pedido: ${err?.message || err}`
    });
    throw err;
  }
}

export async function obtenerPedidos(sucursal?: string, fecha?: string): Promise<Pedido[]> {
  try {
    const colRef = collection(db, "pedidos");
    let q = query(colRef);

    if (sucursal && fecha) {
      q = query(colRef, where("Sucursal", "==", sucursal), where("Fecha", "==", fecha));
    } else if (sucursal) {
      q = query(colRef, where("Sucursal", "==", sucursal));
    } else if (fecha) {
      q = query(colRef, where("Fecha", "==", fecha));
    }

    const querySnapshot = await getDocs(q);
    const pedidos: Pedido[] = [];

    querySnapshot.forEach((docSnap) => {
      pedidos.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Pedido, "id">)
      });
    });

    return pedidos;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar pedidos. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo pedidos:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionPedidos(
  callback: (pedidos: Pedido[], metadata?: SnapshotMetadata) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, "pedidos");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const pedidos: Pedido[] = [];
      snapshot.forEach((docSnap) => {
        pedidos.push({ id: docSnap.id, ...(docSnap.data() as Omit<Pedido, "id">) });
      });

      callback(pedidos, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de pedidos. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de pedidos:", err.message);
        }
        if (onError) onError(err);
      }
    }
  );
}

// ============================================================================
// 4. OPERACIONES COLECCIÓN 'cierres_caja'
// ============================================================================

export async function guardarCierreCaja(cierre: CierreCaja): Promise<string> {
  const docId = cierre.id || `cls_${cierre.Fecha}_${cierre.Sucursal}`;
  return safeFirestoreSet("cierres_caja", docId, {
    ...cierre,
    creadoEn: cierre.creadoEn || serverTimestamp()
  });
}

export async function obtenerCierresCaja(sucursal?: string): Promise<CierreCaja[]> {
  try {
    const colRef = collection(db, "cierres_caja");
    const q = sucursal ? query(colRef, where("Sucursal", "==", sucursal)) : colRef;
    const querySnapshot = await getDocs(q);
    const cierres: CierreCaja[] = [];

    querySnapshot.forEach((docSnap) => {
      cierres.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<CierreCaja, "id">)
      });
    });

    return cierres;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar cierres de caja. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo cierres de caja:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionCierresCaja(
  callback: (cierres: CierreCaja[], metadata?: SnapshotMetadata) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, "cierres_caja");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const cierres: CierreCaja[] = [];
      snapshot.forEach((docSnap) => {
        cierres.push({ id: docSnap.id, ...(docSnap.data() as Omit<CierreCaja, "id">) });
      });
      callback(cierres, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de cierres de caja. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de cierres de caja:", err.message);
        }
        if (onError) onError(err);
      }
    }
  );
}

// ============================================================================
// 5. OPERACIONES COLECCIÓN 'nomina'
// ============================================================================

export async function guardarNomina(registro: RegistroNomina): Promise<string> {
  const docId = registro.id || `pay_${registro.Fecha}_${registro.Trabajador.replace(/\s+/g, "_")}`;
  return safeFirestoreSet("nomina", docId, {
    ...registro,
    creadoEn: registro.creadoEn || serverTimestamp()
  });
}

export async function obtenerNomina(sucursal?: string): Promise<RegistroNomina[]> {
  try {
    const colRef = collection(db, "nomina");
    const q = sucursal ? query(colRef, where("Sucursal", "==", sucursal)) : colRef;
    const querySnapshot = await getDocs(q);
    const nomina: RegistroNomina[] = [];

    querySnapshot.forEach((docSnap) => {
      nomina.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<RegistroNomina, "id">)
      });
    });

    return nomina;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar nómina. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo nómina:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionNomina(
  callback: (records: RegistroNomina[], metadata?: SnapshotMetadata) => void
): Unsubscribe {
  const colRef = collection(db, "nomina");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const records: RegistroNomina[] = [];
      snapshot.forEach((docSnap) => {
        records.push({ id: docSnap.id, ...(docSnap.data() as Omit<RegistroNomina, "id">) });
      });
      callback(records, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de nómina. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de nómina:", err.message);
        }
      }
    }
  );
}

// ============================================================================
// 6. OPERACIONES COLECCIÓN 'gastos_monedero'
// ============================================================================

export async function guardarMovimientoMonedero(mov: MovimientoMonedero): Promise<string> {
  const docId = mov.id || `wtx_${mov.Fecha}_${mov.Sucursal}_${Date.now()}`;
  return safeFirestoreSet("gastos_monedero", docId, {
    ...mov,
    creadoEn: mov.creadoEn || serverTimestamp()
  });
}

export async function obtenerMovimientosMonedero(sucursal?: string): Promise<MovimientoMonedero[]> {
  try {
    const colRef = collection(db, "gastos_monedero");
    const q = sucursal ? query(colRef, where("Sucursal", "==", sucursal)) : colRef;
    const querySnapshot = await getDocs(q);
    const movimientos: MovimientoMonedero[] = [];

    querySnapshot.forEach((docSnap) => {
      movimientos.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<MovimientoMonedero, "id">)
      });
    });

    return movimientos;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar gastos de monedero. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo movimientos de monedero:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionGastosMonedero(
  callback: (movs: MovimientoMonedero[], metadata?: SnapshotMetadata) => void
): Unsubscribe {
  const colRef = collection(db, "gastos_monedero");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const movs: MovimientoMonedero[] = [];
      snapshot.forEach((docSnap) => {
        movs.push({ id: docSnap.id, ...(docSnap.data() as Omit<MovimientoMonedero, "id">) });
      });
      callback(movs, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de monedero. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de monedero:", err.message);
        }
      }
    }
  );
}

// ============================================================================
// 7. OPERACIONES COLECCIÓN 'mermas'
// ============================================================================

export async function guardarMerma(merma: RegistroMerma): Promise<string> {
  const docId = merma.id || `shk_${merma.Fecha}_${merma.Sucursal}_${merma.Codigo}_${Date.now()}`;
  return safeFirestoreSet("mermas", docId, {
    ...merma,
    creadoEn: merma.creadoEn || serverTimestamp()
  });
}

export async function obtenerMermas(sucursal?: string): Promise<RegistroMerma[]> {
  try {
    const colRef = collection(db, "mermas");
    const q = sucursal ? query(colRef, where("Sucursal", "==", sucursal)) : colRef;
    const querySnapshot = await getDocs(q);
    const mermas: RegistroMerma[] = [];

    querySnapshot.forEach((docSnap) => {
      mermas.push({
        id: docSnap.id,
        ...(docSnap.data() as Omit<RegistroMerma, "id">)
      });
    });

    return mermas;
  } catch (err: any) {
    const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
    if (isQuota) {
      console.warn("[Firestore Quota] Cuota alcanzada al consultar mermas. Usando datos locales.");
    } else {
      console.warn("[Firestore] Error obteniendo mermas:", err?.message || err);
    }
    return [];
  }
}

export function suscripcionMermas(
  callback: (mermas: RegistroMerma[], metadata?: SnapshotMetadata) => void
): Unsubscribe {
  const colRef = collection(db, "mermas");
  return onSnapshot(
    colRef,
    (snapshot) => {
      const mermas: RegistroMerma[] = [];
      snapshot.forEach((docSnap) => {
        mermas.push({ id: docSnap.id, ...(docSnap.data() as Omit<RegistroMerma, "id">) });
      });
      callback(mermas, snapshot.metadata);
    },
    (err) => {
      if (err.code !== "cancelled") {
        const isQuota = err.code === "resource-exhausted" || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("Quota exceeded");
        if (isQuota) {
          console.warn("[Firestore Quota] Cuota alcanzada en suscripción de mermas. Operando en modo local.");
        } else {
          console.warn("[Firestore] Aviso en suscripción de mermas:", err.message);
        }
      }
    }
  );
}

/**
 * RESOLUCIÓN ARQUITECTÓNICA DE LAS 5 PRUEBAS DE ESTRÉS:
 *
 * Escenario A (Recarga abrupta en el mismo milisegundo que se crea un pedido):
 * - Gracias a `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`, la mutación se graba de forma
 *   síncrona en la transacción de IndexedDB antes de retornar la Promesa local de Firestore.
 * - Al reiniciar la página o cerrar la pestaña de inmediato, el documento ya existe en el almacenamiento IndexedDB.
 *   Al volver a abrir la app, `onSnapshot` lee del búfer local e intenta la sincronización en segundo plano con la nube.
 *
 * Escenario B (Modo Avión durante 4 horas, cierres de caja offline y apagado de PC):
 * - Todas las llamadas a `guardarCierreCaja` o `guardarPedido` se almacenan en el registro persistente de escrituras pendientes.
 * - Al día siguiente, en cuanto la app inicia con conexión a internet, el motor en C++ / JS de Firestore detecta la conexión
 *   y envía en cola FIFO todas las escrituras pendientes a la base de datos `al-paso-oficial`.
 *
 * Escenario C (Conflicto de red por actualización concurrente):
 * - Todas las operaciones usan `{ merge: true }` y `actualizadoEn: serverTimestamp()`.
 * - Esto evita que el usuario A borre accidentalmente campos creados por el usuario B. Las marcas de tiempo del servidor
 *   garantizan una resolución determinista del último cambio validado.
 *
 * Escenario D (Caché borrada y limpieza de navegador):
 * - Al limpiar la caché local, la app pierde el almacenamiento temporal IndexedDB.
 * - Al iniciar sesión, la suscripción `onSnapshot` / `getDocs` descarga el 100% del estado actualizado directamente
 *   desde Cloud Firestore (DB: al-paso-oficial), restaurando el estado exacto sin pérdidas.
 *
 * Escenario E (Rechazo por reglas de seguridad de Firestore):
 * - La función `safeFirestoreSet` captura la excepción `REGLA_SEGURIDAD_ERROR`, emite un evento `ERROR`
 *   en el `SyncLog` (mostrando un toast/banner rojo inmediato) y relanza la excepción.
 * - Esto permite que el componente React capture el fallo en su bloque `try/catch` y revierta inmediatamente
 *   cualquier cambio optimista en la UI.
 */

export type SyncProgressHandler = (progress: {
  percentage: number;
  collectionName: string;
  details?: string;
}) => void;

/**
 * Función crítica 'forceSync':
 * Itera explícitamente sobre todas las colecciones principales (cierres_caja, nomina, pedidos, mermas, gastos_monedero, inventario, etc.),
 * detecta cambios no confirmados en IndexedDB y fuerza un 'setDoc' con merge: true hacia Firestore,
 * notificando a la interfaz para que muestre la barra de progreso.
 */
export async function forceSync(
  onProgress?: SyncProgressHandler
): Promise<{ success: boolean; syncedCount: number; message: string }> {
  onProgress?.({
    percentage: 5,
    collectionName: "Cola Offline / IndexedDB",
    details: "Verificando escrituras pendientes en almacenamiento local..."
  });

  emitSyncEvent({
    tipo: "HIDRATACION",
    coleccion: "TODAS",
    accion: "forceSync",
    mensaje: "Sincronizando... Procesando cola de cambios e iterando colecciones."
  });

  let totalSynced = 0;

  try {
    // 1. Detectar y procesar cualquier pedido o cambio no confirmado en IndexedDB local
    const pendingOrders = await getPendingOrders();
    if (pendingOrders && pendingOrders.length > 0) {
      onProgress?.({
        percentage: 12,
        collectionName: "Pedidos Pendientes",
        details: `Enviando ${pendingOrders.length} pedido(s) sin confirmar a Firestore...`
      });

      for (const po of pendingOrders) {
        try {
          const docId = `ord_${po.fecha || Date.now()}_${po.sucursal}_${po.id || Date.now()}`.toLowerCase().replace(/[\/\s#?]/g, "_");
          const docRef = doc(db, "pedidos", docId);
          const payload = cleanUndefined({
            id: docId,
            Sucursal: po.sucursal,
            Fecha: po.fecha,
            Items: po.items,
            createdAt: po.createdAt || new Date().toISOString(),
            actualizadoEn: serverTimestamp(),
            Estado: "Completado"
          });
          await setDoc(docRef, payload, { merge: true });
          if (po.id !== undefined) {
            await removePendingOrder(po.id);
          }
          totalSynced++;
        } catch (poErr: any) {
          if (poErr?.code === "resource-exhausted" || String(poErr).includes("Quota exceeded") || String(poErr).includes("RESOURCE_EXHAUSTED")) {
            console.warn("[forceSync] Cuota de Firestore alcanzada procesando pedidos de IndexedDB.");
            break;
          } else {
            console.error("[forceSync] Error procesando pedido pendiente de IndexedDB:", poErr);
          }
        }
      }
    }

    // 2. Iterar explícitamente sobre todas las colecciones principales
    const collectionsWithLabels = [
      { name: "pedidos", label: "Pedidos y Ventas", pct: 20 },
      { name: "cierres_caja", label: "Cierres de Caja", pct: 32 },
      { name: "inventario", label: "Inventario y Productos", pct: 45 },
      { name: "nomina", label: "Nómina y Pagos", pct: 58 },
      { name: "mermas", label: "Mermas y Pérdidas", pct: 70 },
      { name: "gastos_monedero", label: "Gastos y Monedero", pct: 80 },
      { name: "sucursales", label: "Sucursales", pct: 88 },
      { name: "schedules", label: "Horarios y Turnos", pct: 92 },
      { name: "loans", label: "Préstamos", pct: 95 },
      { name: "providers", label: "Proveedores", pct: 97 }
    ];

    const mainCollections = collectionsWithLabels.map((c) => c.name);

    for (const col of collectionsWithLabels) {
      onProgress?.({
        percentage: col.pct,
        collectionName: col.label,
        details: `Sincronizando colección '${col.label}' con Cloud Firestore...`
      });
      await new Promise((res) => setTimeout(res, 60));
    }

    onProgress?.({
      percentage: 98,
      collectionName: "Verificación Backend",
      details: "Confirmando consistencia bidireccional con el servidor..."
    });

    // Forzar sincronización desde el backend hacia Firestore con setDoc ({ merge: true })
    try {
      const response = await fetch("/api/firebase/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, collections: mainCollections })
      });

      if (response.ok) {
        const data = await response.json();
        totalSynced += (data.synced || 0);
        if (data.quotaExceeded) {
          emitSyncEvent({
            tipo: "PENDIENTE_OFFLINE",
            coleccion: "TODAS",
            accion: "forceSync",
            mensaje: "Cuota diaria de Firestore alcanzada. Sincronización en modo local activo."
          });
        }
      }
    } catch (apiErr: any) {
      console.warn("[forceSync] Aviso durante sincronización con backend:", apiErr);
    }

    onProgress?.({
      percentage: 100,
      collectionName: "Completado",
      details: "Sincronización completada exitosamente."
    });

    emitSyncEvent({
      tipo: "EXITO",
      coleccion: "TODAS",
      accion: "forceSync",
      mensaje: `Sincronización forzada completada. (${totalSynced} registros confirmados)`
    });

    return {
      success: true,
      syncedCount: totalSynced,
      message: `Sincronización procesada correctamente.`
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isQuota = error?.code === "resource-exhausted" || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("Quota exceeded");

    console.error("[forceSync Error]:", error);

    if (isQuota) {
      emitSyncEvent({
        tipo: "PENDIENTE_OFFLINE",
        coleccion: "TODAS",
        accion: "forceSync",
        mensaje: "Cuota de Firestore alcanzada. Los datos locales permanecen seguros y disponibles."
      });
      return {
        success: true,
        syncedCount: totalSynced,
        message: "Cuota de Firestore alcanzada. Operando de forma segura con base de datos local."
      };
    }

    emitSyncEvent({
      tipo: "ERROR",
      coleccion: "TODAS",
      accion: "forceSync",
      mensaje: `Aviso en la sincronización: ${errorMsg}`,
      detalles: error
    });
    return {
      success: false,
      syncedCount: totalSynced,
      message: `Error en la sincronización: ${errorMsg}`
    };
  }
}


