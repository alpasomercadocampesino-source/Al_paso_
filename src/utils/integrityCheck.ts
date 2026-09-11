import { initOfflineDb } from "./indexedDb";
import { ROLES } from "../types";

export interface IntegrityReport {
  ok: boolean;
  repaired: boolean;
  warnings: string[];
  errors: string[];
  details: {
    localStorageAvailable: boolean;
    sessionValid: boolean;
    indexedDbAvailable: boolean;
    keysChecked: number;
    corruptedKeysFixed: string[];
  };
}

export async function runStorageIntegrityCheck(): Promise<IntegrityReport> {
  const report: IntegrityReport = {
    ok: true,
    repaired: false,
    warnings: [],
    errors: [],
    details: {
      localStorageAvailable: false,
      sessionValid: true,
      indexedDbAvailable: false,
      keysChecked: 0,
      corruptedKeysFixed: []
    }
  };

  // 1. Check LocalStorage Basic Availability
  try {
    const testKey = "__alpaso_integrity_test__";
    localStorage.setItem(testKey, "1");
    const val = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);
    if (val === "1") {
      report.details.localStorageAvailable = true;
    } else {
      report.ok = false;
      report.errors.push("El almacenamiento local no retiene datos correctamente.");
    }
  } catch (e: any) {
    report.ok = false;
    report.errors.push("No se puede acceder al almacenamiento local del navegador (bloqueado o no soportado).");
  }

  if (!report.details.localStorageAvailable) {
    return report;
  }

  // 2. Validate Session Data Integrity (`alpaso_session`)
  report.details.keysChecked++;
  const rawSession = localStorage.getItem("alpaso_session");
  if (rawSession) {
    try {
      const parsed = JSON.parse(rawSession);
      const validRoles: readonly string[] = ROLES;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.Usuario !== "string" ||
        !parsed.Usuario.trim() ||
        !validRoles.includes(parsed.Rol)
      ) {
        throw new Error("Estructura de sesión inválida");
      }
    } catch (e: any) {
      console.warn("[IntegrityCheck] Sesión corrupta detectada en localStorage. Eliminando...");
      localStorage.removeItem("alpaso_session");
      report.repaired = true;
      report.details.sessionValid = false;
      report.details.corruptedKeysFixed.push("alpaso_session");
      report.warnings.push("La sesión guardada estaba corrupta y fue restablecida para proteger el sistema.");
    }
  }

  // 3. Validate Drafts and Cached Values
  const jsonKeysToCheck = [
    "alpaso_draft_selected_product",
    "alpaso_draft_branch_qty"
  ];

  for (const key of jsonKeysToCheck) {
    report.details.keysChecked++;
    const rawVal = localStorage.getItem(key);
    if (rawVal) {
      try {
        JSON.parse(rawVal);
      } catch (e) {
        console.warn(`[IntegrityCheck] Borrador corrupto en '${key}'. Eliminando...`);
        localStorage.removeItem(key);
        report.repaired = true;
        report.details.corruptedKeysFixed.push(key);
        report.warnings.push(`Se eliminó un borrador de pedido dañado (${key}).`);
      }
    }
  }

  const numberKeysToCheck = ["valor_total_pedidos", "valor_real_recogido"];
  for (const key of numberKeysToCheck) {
    report.details.keysChecked++;
    const rawVal = localStorage.getItem(key);
    if (rawVal !== null) {
      const num = Number(rawVal);
      if (isNaN(num)) {
        console.warn(`[IntegrityCheck] Valor numérico no válido en '${key}'. Eliminando...`);
        localStorage.removeItem(key);
        report.repaired = true;
        report.details.corruptedKeysFixed.push(key);
        report.warnings.push(`Se restableció un valor numérico corrupto (${key}).`);
      }
    }
  }

  // 5. Test IndexedDB Storage Health
  if ("indexedDB" in window) {
    try {
      const db = await initOfflineDb();
      if (db && db.objectStoreNames.contains("products") && db.objectStoreNames.contains("pendingOrders")) {
        report.details.indexedDbAvailable = true;
      } else {
        report.warnings.push("La base de datos offline (IndexedDB) no contiene las tablas requeridas.");
      }
    } catch (e: any) {
      console.warn("[IntegrityCheck] Error al verificar IndexedDB:", e);
      report.warnings.push("La base de datos offline de respaldo no pudo ser inicializada.");
    }
  }

  if (report.errors.length > 0) {
    report.ok = false;
  }

  return report;
}
