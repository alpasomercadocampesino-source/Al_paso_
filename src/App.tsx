import { useState, useEffect } from "react";
import { LogOut, User as UserIcon, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, X } from "lucide-react";
import Login from "./components/Login";
import SucursalDashboard from "./components/SucursalDashboard";
import CompradorDashboard from "./components/CompradorDashboard";
import AdminDashboard from "./components/AdminDashboard";
import { runStorageIntegrityCheck, IntegrityReport } from "./utils/integrityCheck";
import { installAuthFetch, setAuthToken, clearAuthToken, getAuthToken, EVENTO_SESION_VENCIDA } from "./utils/authClient";

// Se instala antes de que cualquier panel monte y empiece a pedir datos.
installAuthFetch();

interface SessionUser {
  Usuario: string;
  Rol: "Admin" | "Comprador" | "Sucursal";
  token?: string;
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastGlobalSync] = useState(Date.now());
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);
  const [integrityAlert, setIntegrityAlert] = useState<string | null>(null);

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

      // Load session. Solo se restaura si además hay token: sin él, el servidor
      // rechazaría todo y el usuario vería una pantalla vacía sin explicación.
      const saved = localStorage.getItem("alpaso_session");
      if (saved && getAuthToken()) {
        try {
          setUser(JSON.parse(saved));
        } catch (e) {
          localStorage.removeItem("alpaso_session");
        }
      } else if (saved) {
        localStorage.removeItem("alpaso_session");
      }
    })();

    return () => { isMounted = false; };
  }, []);

  // Si el servidor invalida la sesión (vencida o secreto rotado), se vuelve al login.
  useEffect(() => {
    const alCerrarSesion = () => {
      setUser(null);
      localStorage.removeItem("alpaso_session");
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, alCerrarSesion);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, alCerrarSesion);
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

  const handleLoginSuccess = (loggedInUser: SessionUser) => {
    if (loggedInUser.token) {
      setAuthToken(loggedInUser.token);
    }
    // El token se guarda aparte; la sesión visible no necesita llevarlo.
    const { token: _token, ...sesionVisible } = loggedInUser;
    setUser(sesionVisible as SessionUser);
    localStorage.setItem("alpaso_session", JSON.stringify(sesionVisible));
  };

  const handleLogout = () => {
    setUser(null);
    clearAuthToken();
    localStorage.removeItem("alpaso_session");
  };

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#FBF7EE] flex flex-col font-sans">
      {/* Visual Feedback Banner: Sincronizando... con barra de progreso visual */}
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
      <nav className="bg-white border-b border-[#E7DFCB] shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <img src="/logo_al_paso.png" alt="Al Paso" className="h-9 w-auto" />
            <span className="hidden sm:inline-block px-1.5 py-0.5 bg-[#1F7A4D]/10 text-[#1F7A4D] font-bold text-[9px] rounded-md uppercase">
              v9.0
            </span>
          </div>

          <div className="flex items-center gap-3">
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

            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-[#FBF7EE] border border-[#E7DFCB] rounded-2xl">
              <UserIcon className="w-4 h-4 text-[#1F7A4D]" />
              <div className="text-left">
                <div className="text-xs font-extrabold text-[#2A3B2E] leading-none">{user.Usuario}</div>
                <div className="text-[9px] font-bold text-[#8A7F63] mt-0.5 uppercase tracking-wider">
                  {user.Rol === "Admin" ? "Administrador" : user.Rol === "Comprador" ? "Comprador Plaza" : "Sucursal"}
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 text-[#8A7F63] hover:text-[#D63B2F] hover:bg-[#D63B2F]/[0.06] rounded-xl transition cursor-pointer"
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

      {/* Main Area based on Role */}
      <div className="flex-1">
        {user.Rol === "Admin" && <AdminDashboard adminName={user.Usuario} lastGlobalSync={lastGlobalSync} />}
        {user.Rol === "Comprador" && <CompradorDashboard username={user.Usuario} lastGlobalSync={lastGlobalSync} />}
        {user.Rol === "Sucursal" && <SucursalDashboard branchName={user.Usuario} lastGlobalSync={lastGlobalSync} />}
      </div>
    </div>
  );
}
