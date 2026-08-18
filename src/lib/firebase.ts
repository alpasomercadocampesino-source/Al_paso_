import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  setLogLevel
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Configuración de niveles de log (silenciar avisos normales de red/gRPC y cuota)
setLogLevel("silent");

// Inicialización Singleton de la App de Firebase
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

/**
 * REGLA 1 DE ORO: Inicialización con Persistencia Offline Oficial Multi-Pestaña (IndexedDB).
 * Permite que todas las lecturas y escrituras se guarden en el disco local del navegador
 * antes de enviarse a la nube. Si el usuario pierde conexión o cierra el navegador,
 * los datos permanecen seguros e intactos.
 */
export const db = (() => {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      },
      firebaseConfig.firestoreDatabaseId || undefined
    );
  } catch (e) {
    // Si ya fue inicializada la instancia previamente (HMR), reusar la existente
    return firebaseConfig.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app);
  }
})();

// Instancia de Autenticación
export const auth = getAuth(app);

// Autenticación anónima transparente para permisos de Firestore
signInAnonymously(auth).catch((err) => {
  console.warn("[Firebase Auth] Sesión anónima en progreso:", err?.message || err);
});

