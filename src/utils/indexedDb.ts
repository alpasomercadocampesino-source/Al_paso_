import { Product } from "../types";

const DB_NAME = "FruverOfflineDB";
const DB_VERSION = 1;

export interface PendingOrder {
  id?: number;
  sucursal: string;
  items: Array<{
    Codigo: string;
    Cantidad: string;
    Notas: string;
  }>;
  fecha: string;
  createdAt: string;
}

export function initOfflineDb(): Promise<IDBDatabase> {
  // En algunos navegadores indexedDB.open puede quedar colgado (modo incógnito,
  // cuota llena, bloqueo). Sin tope, el arranque de la app se cuelga completo;
  // con tope, los llamadores tratan la DB como no disponible y siguen en línea.
  const TIMEOUT_MS = 4000;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("IndexedDB open timed out"));
    }, TIMEOUT_MS);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("IndexedDB error:", event);
      clearTimeout(timeout);
      reject(new Error("Error opening IndexedDB"));
    };

    request.onsuccess = (event) => {
      clearTimeout(timeout);
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Store products cache
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "Codigo" });
      }
      
      // Store pending orders queue
      if (!db.objectStoreNames.contains("pendingOrders")) {
        db.createObjectStore("pendingOrders", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

// Product cache operations
export async function saveCachedProducts(products: Product[]): Promise<void> {
  try {
    const db = await initOfflineDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("products", "readwrite");
      const store = transaction.objectStore("products");
      
      // Clear old products first
      store.clear();
      
      products.forEach((product) => {
        store.put(product);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.error("Failed to save cached products:", err);
  }
}

export async function getCachedProducts(): Promise<Product[]> {
  try {
    const db = await initOfflineDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("products", "readonly");
      const store = transaction.objectStore("products");
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.error("Failed to get cached products:", err);
    return [];
  }
}

// Pending orders operations
export async function queuePendingOrder(order: Omit<PendingOrder, "id" | "createdAt">): Promise<number> {
  const db = await initOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("pendingOrders", "readwrite");
    const store = transaction.objectStore("pendingOrders");
    
    const pending: PendingOrder = {
      ...order,
      createdAt: new Date().toISOString()
    };
    
    const request = store.add(pending);

    request.onsuccess = (event) => {
      resolve((event.target as IDBRequest).result as number);
    };
    request.onerror = (e) => reject(e);
  });
}

export async function getPendingOrders(): Promise<PendingOrder[]> {
  try {
    const db = await initOfflineDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("pendingOrders", "readonly");
      const store = transaction.objectStore("pendingOrders");
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.error("Failed to get pending orders:", err);
    return [];
  }
}

export async function removePendingOrder(id: number): Promise<void> {
  const db = await initOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("pendingOrders", "readwrite");
    const store = transaction.objectStore("pendingOrders");
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}
