import React, { useState, useEffect } from "react";
import { LogOut, User as UserIcon, ShoppingBag, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, X, Activity } from "lucide-react";
import Login from "./components/Login";
import SucursalDashboard from "./components/SucursalDashboard";
import CompradorDashboard from "./components/CompradorDashboard";
import AdminDashboard from "./components/AdminDashboard";
import { SQLSyncHealthCheck } from "./components/SQLSyncHealthCheck";
import { runStorageIntegrityCheck, IntegrityReport } from "./utils/integrityCheck";
import { subscribeSyncLogs, SyncLogEvent, forceSync } from "./firebase";

interface SessionUser {
  Usuario: string;
  Rol: "Admin" | "Comprador" | "Sucursal";
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    percentage: number;
    collectionName: string;
    details?: string;
  }>({
    percentage: 0,
    collectionName: "Iniciando...",
    details: "Conectando con Cloud Firestore..."
  });
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastGlobalSync, setLastGlobalSync] = useState(Date.now());
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);
  const [showSQLHealthModal, setShowSQLHealthModal] = useState(false);
  const [integrityAlert, setIntegrityAlert] = useState<string | null>(null);
  const [syncLogsList, setSyncLogsList] = useState<SyncLogEvent[]>([]);

  // Escuchar eventos del motor de sincronización de Firebase en tiempo real
  useEffect(() => {
    const unsub = subscribeSyncLogs((logs) => {
      setSyncLogsList(logs);
      const latest = logs[0];
      if (latest) {
        if (latest.tipo === "ERROR") {
          setSyncMessage({ type: "error", text: latest.mensaje });
          setTimeout(() => setSyncMessage(null), 6000);
        } else if (latest.tipo === "PENDIENTE_OFFLINE") {
          setSyncMessage({ type: "success", text: latest.mensaje });
          setTimeout(() => setSyncMessage(null), 3000);
        }
      }
    });
    return unsub;
  }, []);

  // Run integrity check & load session from localStorage on startup/reload
  useEffect(() => {
    let isMounted = true;
    (async () => {
      const report = await runStorageIntegrityCheck();
      if (!isMounted) return;
      setIntegrityReport(report);

      if (report.repaired) {
        setIntegrityAlert("Se detectaron y corrigieron automáticamente inconsistencias en el almacenamiento local de este navegador.");
      } else if (!report.ok) {
        setIntegrityAlert("Advertencia: El almacenamiento local del navegador reporta un problema.");
      }

      // Load session
      const saved = localStorage.getItem("alpaso_session");
      if (saved) {
        try {
          setUser(JSON.parse(saved));
        } catch (e) {
          localStorage.removeItem("alpaso_session");
        }
      }
    })();

    return () => { isMounted = false; };
  }, []);

  const handleRecheckIntegrity = async () => {
    const report = await runStorageIntegrityCheck();
    setIntegrityReport(report);
    if (report.repaired) {
      setSyncMessage({ type: "success", text: "Integridad verificada y datos reparados con éxito." });
    } else if (report.ok) {
      setSyncMessage({ type: "success", text: "Comprobación completada: Almacenamiento 100% íntegro." });
    } else {
      setSyncMessage({ type: "error", text: "Se encontraron problemas con el almacenamiento local." });
    }
    setTimeout(() => setSyncMessage(null), 4000);
  };

  // Modo Local Autónomo: No se realizan llamadas periódicas a APIs externas
  useEffect(() => {
    // Sincronización e hidratación puramente local
  }, [user]);

  const handleLoginSuccess = (loggedInUser: SessionUser) => {
    setUser(loggedInUser);
    localStorage.setItem("alpaso_session", JSON.stringify(loggedInUser));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("alpaso_session");
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncProgress({
      percentage: 5,
      collectionName: "IndexedDB / Cola Local",
      details: "Verificando pendientes locales..."
    });
    setSyncMessage({ type: "success", text: "Iniciando sincronización de colecciones..." });
    try {
      const result = await forceSync((progress) => {
        setSyncProgress(progress);
      });
      setSyncProgress({
        percentage: 100,
        collectionName: "Completado",
        details: `${result.syncedCount} registros confirmados`
      });
      setSyncMessage({
        type: "success",
        text: `¡Sincronización completada! (${result.syncedCount} registros confirmados en Firestore)`
      });
      setTimeout(() => {
        setSyncMessage(null);
      }, 4000);
    } catch (err: any) {
      console.error(err);
      setSyncMessage({ type: "error", text: `Error en la sincronización: ${err?.message || err}` });
      setTimeout(() => setSyncMessage(null), 5000);
    } finally {
      setTimeout(() => {
        setSyncing(false);
      }, 600);
    }
  };

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Visual Feedback Banner: Sincronizando... con barra de progreso visual */}
      {syncing && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-slate-900/95 backdrop-blur-md text-white border-b border-amber-500/30 shadow-xl px-4 py-2.5 text-xs transition-all duration-300">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
            {/* Estado y Colección Activa */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex items-center justify-center shrink-0">
                <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 truncate">
                <span className="font-extrabold text-slate-100 tracking-tight">Sincronización Bidireccional</span>
                <span className="hidden sm:inline text-slate-500">•</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[11px] font-bold shrink-0">
                  {syncProgress.collectionName}
                </span>
                {syncProgress.details && (
                  <span className="text-slate-400 text-[11px] truncate hidden lg:inline">
                    ({syncProgress.details})
                  </span>
                )}
              </div>
            </div>

            {/* Barra de Progreso Visual */}
            <div className="w-full md:w-80 flex items-center gap-3 shrink-0">
              <div className="flex-1 bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700/80 p-0.5 relative shadow-inner">
                <div
                  className="bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-xs"
                  style={{ width: `${Math.max(4, Math.min(100, syncProgress.percentage))}%` }}
                />
              </div>
              <span className="font-mono text-amber-400 font-extrabold text-xs w-10 text-right shrink-0">
                {Math.round(syncProgress.percentage)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {syncMessage && (
        <div className="fixed top-20 right-4 z-50 animate-bounce">
          <div className={`px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold flex items-center gap-2 ${
            syncMessage.type === "success" 
              ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}>
            <span>{syncMessage.type === "success" ? "✅" : "❌"}</span>
            <span>{syncMessage.text}</span>
          </div>
        </div>
      )}

      {/* Storage Integrity Notification Banner */}
      {integrityAlert && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs font-medium text-amber-900 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2 max-w-5xl mx-auto w-full">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{integrityAlert}</span>
            <button
              onClick={() => setShowIntegrityModal(true)}
              className="underline font-bold hover:text-amber-950 ml-2 cursor-pointer"
            >
              Ver reporte de integridad
            </button>
          </div>
          <button
            onClick={() => setIntegrityAlert(null)}
            className="p-1 hover:bg-amber-100 rounded-lg transition text-amber-700 cursor-pointer"
            title="Cerrar notificación"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Global Navbar */}
      <nav className="bg-white border-b border-slate-200/80 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🥑</span>
            <div>
              <span className="font-extrabold text-slate-800 text-lg tracking-tight">Al Paso</span>
              <span className="hidden sm:inline-block ml-1.5 px-1.5 py-0.5 bg-slate-100 text-slate-500 font-bold text-[9px] rounded-md uppercase">
                v9.0
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Force Sync Button */}
            <button
              id="forceSyncNavBtn"
              onClick={handleSyncAll}
              disabled={syncing}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                syncing
                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs"
              }`}
              title="Forzar Sincronización Completa con Firestore (forceSync)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "Sincronizando..." : "Sincronizar"}</span>
            </button>

            {/* QA Health Check SQL Button */}
            <button
              onClick={() => setShowSQLHealthModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-xs cursor-pointer"
              title="Ejecutar suite de pruebas de salud QA para sincronización SQL"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Health Check SQL</span>
            </button>

            {/* Storage Integrity Badge */}
            <button
              onClick={() => setShowIntegrityModal(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                integrityReport?.repaired || integrityReport?.warnings.length
                  ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                  : integrityReport?.ok
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                  : "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100"
              }`}
              title="Estado de integridad del almacenamiento local"
            >
              {integrityReport?.repaired || integrityReport?.warnings.length ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              ) : integrityReport?.ok ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              )}
              <span className="hidden md:inline">
                {integrityReport?.repaired ? "Almacenamiento Reparado" : integrityReport?.ok ? "Almacenamiento Íntegro" : "Revisar Almacenamiento"}
              </span>
            </button>

            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-50 border border-slate-150 rounded-2xl">
              <UserIcon className="w-4 h-4 text-slate-500" />
              <div className="text-left">
                <div className="text-xs font-extrabold text-slate-850 leading-none">{user.Usuario}</div>
                <div className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">
                  {user.Rol === "Admin" ? "Administrador" : user.Rol === "Comprador" ? "Comprador Plaza" : "Sucursal"}
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
              title="Cerrar Sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Integrity Diagnostic Modal */}
      {showIntegrityModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-slate-800">Comprobación de Integridad Local</h3>
                  <p className="text-xs text-slate-500">Diagnóstico del almacenamiento del navegador y sesión</p>
                </div>
              </div>
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 my-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Acceso a LocalStorage:</span>
                  <span className={`font-bold flex items-center gap-1 ${integrityReport?.details.localStorageAvailable ? "text-emerald-600" : "text-rose-600"}`}>
                    {integrityReport?.details.localStorageAvailable ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    {integrityReport?.details.localStorageAvailable ? "Disponible" : "Bloqueado"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Integridad de Sesión:</span>
                  <span className={`font-bold flex items-center gap-1 ${integrityReport?.details.sessionValid ? "text-emerald-600" : "text-amber-600"}`}>
                    {integrityReport?.details.sessionValid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    {integrityReport?.details.sessionValid ? "Válida" : "Restablecida"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-700">Base de Datos Offline (IndexedDB):</span>
                  <span className={`font-bold flex items-center gap-1 ${integrityReport?.details.indexedDbAvailable ? "text-emerald-600" : "text-amber-600"}`}>
                    {integrityReport?.details.indexedDbAvailable ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    {integrityReport?.details.indexedDbAvailable ? "Operativa" : "No inicializada"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500">
                  <span>Claves verificadas:</span>
                  <span className="font-bold text-slate-700">{integrityReport?.details.keysChecked || 0}</span>
                </div>
              </div>

              {integrityReport?.repaired && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                  <p className="font-bold mb-1">✅ Reparación completada:</p>
                  <p className="text-[11px]">Se encontraron claves corruptas ({integrityReport.details.corruptedKeysFixed.join(", ")}) y fueron limpiadas o corregidas adecuadamente.</p>
                </div>
              )}

              {integrityReport?.warnings && integrityReport.warnings.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-1">
                  <p className="font-bold mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Observaciones:
                  </p>
                  <ul className="list-disc list-inside text-[11px] space-y-0.5">
                    {integrityReport.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {integrityReport?.errors && integrityReport.errors.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-1">
                  <p className="font-bold mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Errores Críticos:
                  </p>
                  <ul className="list-disc list-inside text-[11px] space-y-0.5">
                    {integrityReport.errors.map((e, idx) => (
                      <li key={idx}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={handleRecheckIntegrity}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Ejecutar Comprobación Manual
              </button>
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SQL Sync QA Health Check Modal */}
      {showSQLHealthModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-4xl w-full relative animate-in fade-in zoom-in-95 duration-200 my-auto">
            <button
              onClick={() => setShowSQLHealthModal(false)}
              className="absolute top-4 right-4 z-10 p-2 bg-slate-800/80 text-slate-300 hover:text-white rounded-xl transition cursor-pointer"
              title="Cerrar modal QA"
            >
              <X className="w-5 h-5" />
            </button>
            <SQLSyncHealthCheck />
          </div>
        </div>
      )}

      {/* Main Area based on Role */}
      <div className="flex-1">
        {user.Rol === "Admin" && <AdminDashboard adminName={user.Usuario} lastGlobalSync={lastGlobalSync} />}
        {user.Rol === "Comprador" && <CompradorDashboard username={user.Usuario} lastGlobalSync={lastGlobalSync} />}
        {user.Rol === "Sucursal" && <SucursalDashboard branchName={user.Usuario} lastGlobalSync={lastGlobalSync} />}
      </div>
    </div>
  );
}
