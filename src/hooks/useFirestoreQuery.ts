import { useState, useEffect } from "react";
import {
  collection,
  query,
  onSnapshot,
  QueryConstraint,
  Query,
  DocumentData
} from "firebase/firestore";
import { db } from "../lib/firebase";

interface UseFirestoreQueryResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

/**
 * Hook personalizado para consultas reactivas en tiempo real con Cloud Firestore.
 * Mantiene la bidireccionalidad de datos de inventario, pedidos y cierres de caja.
 *
 * @param target Nombre de la colección (string) o una Query de Firestore.
 * @param constraints Restricciones de consulta (where, orderBy, limit, etc.) cuando target es string.
 */
export function useFirestoreQuery<T = DocumentData>(
  target: string | Query<DocumentData>,
  constraints: QueryConstraint[] = []
): UseFirestoreQueryResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    let q: Query<DocumentData>;

    try {
      if (typeof target === "string") {
        const colRef = collection(db, target);
        q = constraints.length > 0 ? query(colRef, ...constraints) : colRef;
      } else {
        q = target;
      }
    } catch (err) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      setError(errObj);
      setLoading(false);
      return;
    }

    // Escuchar cambios bidireccionales en tiempo real con onSnapshot
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: T[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as T);
        });
        setData(items);
        setLoading(false);
        setError(null);
      },
      (err) => {
        const isQuota = err?.code === "resource-exhausted" || err?.message?.includes("RESOURCE_EXHAUSTED") || String(err).includes("Quota exceeded");
        if (isQuota) {
          console.warn("[useFirestoreQuery] Cuota de Firestore alcanzada. Operando en modo local.");
        } else {
          console.warn("[useFirestoreQuery] Error de lectura o permisos:", err.message);
        }
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [typeof target === "string" ? target : null, constraints.length]);

  return { data, loading, error };
}

export default useFirestoreQuery;
