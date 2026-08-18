import { collection, getDocs, writeBatch, doc } from "firebase/firestore";
import { dbDefault, dbNamed } from "./firebase.ts";
import { DatabaseSchema } from "./db.ts";

/**
 * Script de Limpieza Manual de Históricos Antiguos
 * Elimina de Firestore y de la base de datos local los registros de "pedidos" y "cierres_caja"
 * que correspondan a meses pasados del año actual (antes del primer día del mes en curso).
 */
export async function purgePastMonthsHistory(localDb?: DatabaseSchema): Promise<{
  deletedOrders: number;
  deletedClosures: number;
}> {
  // Obtener fecha actual en zona horaria de Colombia
  const colombiaNow = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  // Primer día del mes actual (ejemplo: "2026-08-01")
  const currentMonthStart = colombiaNow.slice(0, 7) + "-01";

  let deletedOrders = 0;
  let deletedClosures = 0;

  console.log(`[Purge] Iniciando purga de registros anteriores a: ${currentMonthStart}`);

  // 1. Limpieza en la Base de Datos Local (si se proporciona)
  if (localDb) {
    if (Array.isArray(localDb.orders)) {
      const initLen = localDb.orders.length;
      localDb.orders = localDb.orders.filter((o) => !o.Fecha || o.Fecha >= currentMonthStart);
      deletedOrders += initLen - localDb.orders.length;
    }
    if (Array.isArray(localDb.closures)) {
      const initLen = localDb.closures.length;
      localDb.closures = localDb.closures.filter((c) => !c.Fecha || c.Fecha >= currentMonthStart);
      deletedClosures += initLen - localDb.closures.length;
    }
  }

  // 2. Limpieza en Cloud Firestore (instancia por defecto y nombreada)
  const targets = [
    { key: "orders", cols: ["pedidos", "orders"] },
    { key: "closures", cols: ["cierres_caja", "cierres", "closures"] },
  ];

  const dbInstances = [dbDefault, dbNamed].filter(Boolean) as any[];

  for (const firestoreInstance of dbInstances) {
    for (const target of targets) {
      for (const colName of target.cols) {
        try {
          const colRef = collection(firestoreInstance, colName);
          const snapshot = await getDocs(colRef);

          if (!snapshot.empty) {
            const batch = writeBatch(firestoreInstance);
            let countInBatch = 0;

            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              const recordDate = data.Fecha || data.fecha || "";

              // Si la fecha existe y pertenece a un mes anterior al mes actual
              if (recordDate && recordDate < currentMonthStart) {
                batch.delete(docSnap.ref);
                countInBatch++;
                if (target.key === "orders") deletedOrders++;
                if (target.key === "closures") deletedClosures++;
              }
            });

            if (countInBatch > 0) {
              await batch.commit();
              console.log(`[Purge] Se eliminaron ${countInBatch} documentos antiguos de '${colName}' en Firestore.`);
            }
          }
        } catch (err: any) {
          console.warn(`[Purge Warning] Error procesando colección '${colName}':`, err?.message || err);
        }
      }
    }
  }

  console.log(`[Purge] Limpieza completada exitosamente. Total eliminados -> Pedidos: ${deletedOrders}, Cierres: ${deletedClosures}`);
  return { deletedOrders, deletedClosures };
}
