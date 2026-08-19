import fs from "fs";
import path from "path";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  setLogLevel,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  onSnapshot
} from "firebase/firestore";
import type { DatabaseSchema } from "./db";

const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Desactivar logs informativos y de cuota de Firestore SDK para manejo limpio
setLogLevel("silent");

// Inicialización de Firebase Singleton
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const dbDefault = getFirestore(app);
export const dbNamed = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : null;
export const db = dbNamed || dbDefault;
export const auth = getAuth(app);

// Iniciar sesión anónima en segundo plano
signInAnonymously(auth).catch(() => {
  // Ignorar errores si Auth no está activo en la consola de Firebase
});

let isSyncReady = true;
let quotaExhaustedUntil = 0;

export function isFirestoreDisabledState(): boolean {
  return false;
}

export function isFirestoreSyncReady(): boolean {
  return isSyncReady && Date.now() >= quotaExhaustedUntil;
}

export function setFirestoreSyncReady(status: boolean) {
  isSyncReady = status;
}

// Genera un ID seguro y reproducible para guardar documentos en Cloud Firestore
export function getDocIdForRecord(collectionKey: string, record: any, fallbackIndex: number = 0): string {
  if (!record || typeof record !== "object") return `doc_${fallbackIndex}`;
  if (record._id) return String(record._id).toLowerCase().replace(/[\/\s#?]/g, "_");
  if (record.id) return String(record.id).toLowerCase().replace(/[\/\s#?]/g, "_");

  switch (collectionKey) {
    case "users":
    case "usuarios":
      return `usr_${record.Usuario || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "products":
    case "inventario":
      return `prd_${record.Codigo || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "providers":
      return `prv_${record.Proveedor || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "rates":
      return `rat_${record.Empleado || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "orders":
    case "pedidos":
      return `ord_${record.ID_Pedido || record.Fecha || fallbackIndex}_${record.Codigo || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "closures":
    case "cierres_caja":
      return `cls_${record.Fecha || fallbackIndex}_${record.Sucursal || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "payroll":
    case "nomina":
      return `pay_${record.Fecha || fallbackIndex}_${record.Trabajador || record.Empleado || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "walletTransactions":
    case "gastos_monedero":
      return `wtx_${record.Fecha || fallbackIndex}_${record.Sucursal || fallbackIndex}_${record.Responsable || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "shrinkages":
    case "mermas":
      return `shk_${record.Fecha || fallbackIndex}_${record.Sucursal || fallbackIndex}_${record.Codigo || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "packagingMovements":
      return `pkg_${record.ID_Movimiento || `${record.Fecha}_${record.Proveedor}` || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "schedules":
      return `sch_${record.Fecha || fallbackIndex}_${record.Empleado || fallbackIndex}_${record.Sucursal || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    case "loans":
      return `lon_${record.Fecha || fallbackIndex}_${record.Empleado || fallbackIndex}`.toLowerCase().replace(/[\/\s#?]/g, "_");
    default:
      return `rec_${collectionKey}_${fallbackIndex}`;
  }
}

// Limpia recursivamente campos undefined para evitar errores de Firestore (Unsupported field value: undefined)
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

// Mapea cualquier clave de colección local o alias a la colección oficial de Cloud Firestore
export function getFirestoreCollectionName(collectionKey: string): string {
  switch (collectionKey) {
    case "users":
    case "usuarios":
      return "usuarios";
    case "products":
    case "inventario":
      return "inventario";
    case "providers":
    case "proveedores":
      return "providers";
    case "orders":
    case "pedidos":
      return "pedidos";
    case "closures":
    case "cierres_caja":
    case "cierres":
      return "cierres_caja";
    case "payroll":
    case "nomina":
      return "nomina";
    case "walletTransactions":
    case "gastos_monedero":
      return "gastos_monedero";
    case "shrinkages":
    case "mermas":
      return "mermas";
    default:
      return collectionKey;
  }
}

// Guarda un solo registro en Cloud Firestore (Dual Write: dbDefault y dbNamed)
export async function saveRecordToFirestoreDirect(
  collectionKey: string,
  record: any,
  index: number = 0
): Promise<boolean> {
  try {
    const targetCollection = getFirestoreCollectionName(collectionKey);
    const docId = getDocIdForRecord(targetCollection, record, index);
    const cleanPayload = cleanUndefined({ ...record, _id: docId, _updatedAt: new Date().toISOString() });

    const directPromise = (async () => {
      await setDoc(doc(dbDefault, targetCollection, docId), cleanPayload, { merge: true });
      if (dbNamed) {
        await setDoc(doc(dbNamed, targetCollection, docId), cleanPayload, { merge: true });
      }
      return true;
    })();

    const timeoutPromise = new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(false);
      }, 10000)
    );

    return await Promise.race([directPromise, timeoutPromise]);
  } catch (err: any) {
    console.error(`[saveRecordToFirestoreDirect Error] ${collectionKey}:`, err?.message || err);
    return false;
  }
}

// Guarda un lote de registros en Cloud Firestore usando Batched Writes (Dual Write: dbDefault y dbNamed)
export async function saveBatchToFirestoreDirect(
  items: { collectionKey: string; record: any; index?: number }[]
): Promise<boolean> {
  if (!items || items.length === 0) return true;

  try {
    const directPromise = (async () => {
      const batchDefault = writeBatch(dbDefault);
      const batchNamed = dbNamed ? writeBatch(dbNamed) : null;

      items.forEach((item, idx) => {
        const targetCollection = getFirestoreCollectionName(item.collectionKey);
        const docId = getDocIdForRecord(targetCollection, item.record, item.index ?? idx);
        const cleanPayload = cleanUndefined({ ...item.record, _id: docId, _updatedAt: new Date().toISOString() });

        batchDefault.set(doc(dbDefault, targetCollection, docId), cleanPayload, { merge: true });
        if (batchNamed) {
          batchNamed.set(doc(dbNamed, targetCollection, docId), cleanPayload, { merge: true });
        }
      });

      await batchDefault.commit();
      if (batchNamed) {
        await batchNamed.commit();
      }
      return true;
    })();

    const timeoutPromise = new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(false);
      }, 12000)
    );

    return await Promise.race([directPromise, timeoutPromise]);
  } catch (err: any) {
    console.error(`[saveBatchToFirestoreDirect Error] (${items.length} items):`, err?.message || err);
    return false;
  }
}

// Elimina un registro de Cloud Firestore por ID o referencia de objeto
export async function deleteRecordFromFirestoreDirect(
  collectionKey: string,
  recordOrId: any
): Promise<boolean> {
  try {
    const targetCollection = getFirestoreCollectionName(collectionKey);
    const docId = typeof recordOrId === "string" 
      ? recordOrId.toLowerCase().replace(/[\/\s#?]/g, "_")
      : getDocIdForRecord(targetCollection, recordOrId, 0);

    const directPromise = (async () => {
      await deleteDoc(doc(dbDefault, targetCollection, docId));
      if (dbNamed) {
        await deleteDoc(doc(dbNamed, targetCollection, docId));
      }
      return true;
    })();

    const timeoutPromise = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), 8000)
    );

    return await Promise.race([directPromise, timeoutPromise]);
  } catch (err: any) {
    console.error(`[deleteRecordFromFirestoreDirect Error] ${collectionKey}/${recordOrId}:`, err?.message || err);
    return false;
  }
}

// Sincroniza la base de datos local completa hacia Cloud Firestore en segundo plano
export async function syncAllLocalCollectionsToFirestore(dbData: DatabaseSchema): Promise<number> {
  const collectionsMapping: Array<{ key: keyof DatabaseSchema; firestoreKey: string }> = [
    { key: "users", firestoreKey: "usuarios" },
    { key: "products", firestoreKey: "inventario" },
    { key: "providers", firestoreKey: "providers" },
    { key: "orders", firestoreKey: "pedidos" },
    { key: "closures", firestoreKey: "cierres_caja" },
    { key: "payroll", firestoreKey: "nomina" },
    { key: "walletTransactions", firestoreKey: "gastos_monedero" },
    { key: "shrinkages", firestoreKey: "mermas" },
    { key: "packagingMovements", firestoreKey: "packagingMovements" },
    { key: "schedules", firestoreKey: "schedules" },
    { key: "loans", firestoreKey: "loans" },
    { key: "rates", firestoreKey: "rates" },
    { key: "priceHistory", firestoreKey: "priceHistory" },
    { key: "nequiExpenses", firestoreKey: "nequiExpenses" }
  ];

  const batchItems: { collectionKey: string; record: any; index: number }[] = [];

  for (const { key, firestoreKey } of collectionsMapping) {
    const list = dbData[key];
    if (Array.isArray(list)) {
      list.forEach((rec, idx) => {
        if (rec) {
          batchItems.push({ collectionKey: firestoreKey, record: rec, index: idx });
        }
      });
    }
  }

  // Ejecución por trozos pequeños de máximo 50 escrituras
  const chunkSize = 50;
  let synced = 0;
  for (let i = 0; i < batchItems.length; i += chunkSize) {
    const chunk = batchItems.slice(i, i + chunkSize);
    const ok = await saveBatchToFirestoreDirect(chunk);
    if (ok) {
      synced += chunk.length;
    } else {
      // Si falla el lote, guardamos item por item para asegurar los válidos
      for (const item of chunk) {
        const saved = await saveRecordToFirestoreDirect(item.collectionKey, item.record, item.index);
        if (saved) {
          synced++;
        }
      }
    }
  }
  return synced;
}

export function queueFirestoreSync(dbData: DatabaseSchema) {
  if (!isSyncReady) return;
  syncAllLocalCollectionsToFirestore(dbData).catch(() => {
    // Ignore error silently
  });
}

// Lee de Cloud Firestore todas las colecciones para hidratar la base de datos sin borrar datos locales no sincronizados
export async function pullFromFirestore(localDb: DatabaseSchema): Promise<DatabaseSchema> {
  try {
    const collectionsToPull = [
      { fKey: "usuarios", localKey: "users" as keyof DatabaseSchema },
      { fKey: "inventario", localKey: "products" as keyof DatabaseSchema },
      { fKey: "providers", localKey: "providers" as keyof DatabaseSchema },
      { fKey: "pedidos", localKey: "orders" as keyof DatabaseSchema },
      { fKey: "cierres_caja", localKey: "closures" as keyof DatabaseSchema },
      { fKey: "nomina", localKey: "payroll" as keyof DatabaseSchema },
      { fKey: "gastos_monedero", localKey: "walletTransactions" as keyof DatabaseSchema },
      { fKey: "mermas", localKey: "shrinkages" as keyof DatabaseSchema },
      { fKey: "packagingMovements", localKey: "packagingMovements" as keyof DatabaseSchema },
      { fKey: "schedules", localKey: "schedules" as keyof DatabaseSchema },
      { fKey: "loans", localKey: "loans" as keyof DatabaseSchema },
      { fKey: "rates", localKey: "rates" as keyof DatabaseSchema },
      { fKey: "priceHistory", localKey: "priceHistory" as keyof DatabaseSchema },
      { fKey: "nequiExpenses", localKey: "nequiExpenses" as keyof DatabaseSchema }
    ];

    for (const { fKey, localKey } of collectionsToPull) {
      try {
        const colRef = collection(db, fKey);
        const snapshot = await getDocs(colRef);
        if (!snapshot.empty) {
          const fetchedList: any[] = [];
          snapshot.forEach((docSnap) => {
            fetchedList.push(docSnap.data());
          });
          if (fetchedList.length > 0) {
            const currentList = Array.isArray((localDb as any)[localKey]) ? [...((localDb as any)[localKey])] : [];
            
            for (const fItem of fetchedList) {
              const docId = getDocIdForRecord(fKey, fItem, 0);
              const existingIdx = currentList.findIndex((item: any) => {
                const itemId = getDocIdForRecord(fKey, item, 0);
                return itemId === docId;
              });
              if (existingIdx >= 0) {
                currentList[existingIdx] = { ...currentList[existingIdx], ...fItem };
              } else {
                currentList.push(fItem);
              }
            }
            (localDb as any)[localKey] = currentList;
          }
        }
      } catch (colErr: any) {
        if (colErr?.code === "resource-exhausted" || colErr?.message?.includes("RESOURCE_EXHAUSTED") || String(colErr).includes("Quota exceeded")) {
          console.warn(`[Firestore] Cuota alcanzada al leer colección '${fKey}'. Continuando con datos locales.`);
          break;
        } else if (colErr?.code === "permission-denied" || colErr?.message?.includes("PERMISSION_DENIED")) {
          console.warn(`[Firestore] Permiso denegado en '${fKey}'. Continuando con datos locales.`);
        } else {
          console.warn(`[Firestore] Aviso al leer colección '${fKey}':`, colErr?.message || colErr);
        }
      }
    }
    console.log("Sincronización inicial desde Cloud Firestore procesada.");
  } catch (err: any) {
    if (err?.code === "permission-denied" || err?.message?.includes("PERMISSION_DENIED") || String(err).includes("Missing or insufficient permissions")) {
      console.warn("[Firestore] Permisos insuficientes al leer Cloud Firestore. Continuando con almacenamiento local.");
    } else if (err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded")) {
      console.warn("[Firestore] Cuota de lectura/escritura de Firestore alcanzada. Continuando con almacenamiento local.");
    } else {
      console.error("No se pudo descargar datos desde Cloud Firestore:", err?.message || err);
    }
  }
  return localDb;
}

export function subscribeToFirestore(localDb: DatabaseSchema, onUpdateCallback?: () => void) {
  try {
    const colRef = collection(db, "pedidos");
    return onSnapshot(
      colRef,
      (snapshot) => {
        const updatedOrders: any[] = [];
        snapshot.forEach((docSnap) => {
          updatedOrders.push(docSnap.data());
        });
        if (updatedOrders.length > 0) {
          const currentList = Array.isArray(localDb.orders) ? [...localDb.orders] : [];
          for (const item of updatedOrders) {
            const docId = getDocIdForRecord("pedidos", item, 0);
            const idx = currentList.findIndex((existingItem) => {
              const existingId = getDocIdForRecord("pedidos", existingItem, 0);
              return existingId === docId;
            });
            if (idx >= 0) {
              currentList[idx] = { ...currentList[idx], ...item };
            } else {
              currentList.push(item);
            }
          }
          localDb.orders = currentList;
          if (onUpdateCallback) onUpdateCallback();
        }
      },
      (err) => {
        if (err.code !== "cancelled") {
          const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
          if (isQuota) {
            console.warn("[Firestore Server] Cuota de Firestore alcanzada en listener de pedidos. Operando con datos locales.");
          } else {
            console.warn("[Firestore Server] Aviso en listener de pedidos:", err.message);
          }
        }
      }
    );
  } catch (err) {
    console.error("Error al suscribirse a Firestore:", err);
    return () => {};
  }
}

export function unsubscribeFromFirestore() {
  // No-op
}

export async function clearFirestoreOperationalCollections(): Promise<boolean> {
  const collectionsToClear = [
    "pedidos",
    "orders",
    "cierres_caja",
    "cierres",
    "closures",
    "gastos_monedero",
    "walletTransactions",
    "mermas",
    "shrinkages",
    "packagingMovements",
    "schedules",
    "loans",
    "nomina",
    "payroll",
    "priceHistory",
    "nequiExpenses"
  ];

  const dbInstances = [dbDefault, dbNamed].filter(Boolean) as any[];

  try {
    for (const firestoreDb of dbInstances) {
      for (const colName of collectionsToClear) {
        try {
          const colRef = collection(firestoreDb, colName);
          const snapshot = await getDocs(colRef);
          if (!snapshot.empty) {
            const batch = writeBatch(firestoreDb);
            snapshot.forEach((docSnap) => {
              batch.delete(docSnap.ref);
            });
            await batch.commit();
          }
        } catch (e) {
          console.warn(`[Firestore] Aviso al borrar colección '${colName}':`, e);
        }
      }
    }
    return true;
  } catch (err) {
    console.error("Error al borrar colecciones en Firestore:", err);
    return false;
  }
}

// Elimina únicamente los pedidos y cierres de caja pertenecientes a meses pasados del año actual
export async function purgePastMonthsOrdersAndClosures(localDb: DatabaseSchema): Promise<{ deletedOrdersCount: number; deletedClosuresCount: number }> {
  const colombiaNow = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const currentMonthStart = colombiaNow.slice(0, 7) + "-01"; // Ej: "2026-08-01"

  let deletedOrdersCount = 0;
  let deletedClosuresCount = 0;

  // 1. Limpiar base de datos local
  if (Array.isArray(localDb.orders)) {
    const initialOrders = localDb.orders.length;
    localDb.orders = localDb.orders.filter(o => !o.Fecha || o.Fecha >= currentMonthStart);
    deletedOrdersCount += (initialOrders - localDb.orders.length);
  }

  if (Array.isArray(localDb.closures)) {
    const initialClosures = localDb.closures.length;
    localDb.closures = localDb.closures.filter(c => !c.Fecha || c.Fecha >= currentMonthStart);
    deletedClosuresCount += (initialClosures - localDb.closures.length);
  }

  // 2. Limpiar en Firestore (instancia por defecto y nombrada)
  const collectionsToCheck = [
    { key: "orders", cols: ["pedidos", "orders"] },
    { key: "closures", cols: ["cierres_caja", "cierres", "closures"] }
  ];

  const dbInstances = [dbDefault, dbNamed].filter(Boolean) as any[];

  for (const firestoreDb of dbInstances) {
    for (const group of collectionsToCheck) {
      for (const colName of group.cols) {
        try {
          const colRef = collection(firestoreDb, colName);
          const snapshot = await getDocs(colRef);
          if (!snapshot.empty) {
            const batch = writeBatch(firestoreDb);
            let hasDeletes = false;
            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              const recordDate = data.Fecha || data.fecha || "";
              if (recordDate && recordDate < currentMonthStart) {
                batch.delete(docSnap.ref);
                hasDeletes = true;
                if (group.key === "orders") deletedOrdersCount++;
                if (group.key === "closures") deletedClosuresCount++;
              }
            });
            if (hasDeletes) {
              await batch.commit();
            }
          }
        } catch (e) {
          console.warn(`[PurgePastMonths] Aviso al limpiar '${colName}' en Firestore:`, e);
        }
      }
    }
  }

  return { deletedOrdersCount, deletedClosuresCount };
}
