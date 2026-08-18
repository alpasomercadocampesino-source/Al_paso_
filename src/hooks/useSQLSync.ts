import { useEffect, useState } from "react";
import { sqlSyncClient } from "../lib/sqlSyncClient.ts";

export function useSQLSync(entityFilter?: string) {
  const [lastSyncEvent, setLastSyncEvent] = useState<any>(null);

  useEffect(() => {
    // Iniciar conexión en vivo SSE si no está activa
    sqlSyncClient.connectLiveSync();

    // Suscribirse a eventos de cambios en vivo
    const unsubscribe = sqlSyncClient.subscribe(entityFilter || "*", (event) => {
      setLastSyncEvent(event);
    });

    return () => {
      unsubscribe();
    };
  }, [entityFilter]);

  return {
    lastSyncEvent,
    saveProduct: (data: any) => sqlSyncClient.saveProduct(data),
    saveOrder: (data: any) => sqlSyncClient.saveOrder(data),
    saveClosure: (data: any) => sqlSyncClient.saveClosure(data),
    savePayroll: (data: any) => sqlSyncClient.savePayroll(data),
    saveProvider: (data: any) => sqlSyncClient.saveProvider(data),
    flushQueue: () => sqlSyncClient.flushQueue(),
  };
}
