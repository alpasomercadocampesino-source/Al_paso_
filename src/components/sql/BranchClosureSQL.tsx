import React, { useState, useEffect } from "react";
import { useSQLSync } from "../../hooks/useSQLSync";
import {
  DollarSign,
  Calendar,
  Store,
  FileText,
  UserCheck,
  CheckSquare,
  Square,
  Save,
  RefreshCw,
  CheckCircle2,
  WifiOff,
  History,
  ShieldCheck,
  Camera,
  AlertCircle
} from "lucide-react";

export interface BranchClosureData {
  id?: number;
  fecha: string;
  sucursal: string;
  ventasTotales: number;
  gastosExtra: number;
  descripcionGastos: string;
  personaRecogio: string;
  recaudadoFisico: boolean;
  montoRecaudado: number;
  fotoFactura?: string;
  createdAt?: string;
}

export function BranchClosureSQL() {
  const [closures, setClosures] = useState<BranchClosureData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [notification, setNotification] = useState<{
    type: "success" | "offline" | "error";
    title: string;
    text: string;
  } | null>(null);

  // 1. Hook de Sincronización SQL (SSE + Resiliencia Offline)
  const { lastSyncEvent, saveClosure } = useSQLSync("closures");

  // Estado del Formulario Consolidado de Cierre
  const [formData, setFormData] = useState<BranchClosureData>({
    fecha: new Date().toISOString().split("T")[0],
    sucursal: "Plaza",
    ventasTotales: 0,
    gastosExtra: 0,
    descripcionGastos: "",
    personaRecogio: "",
    recaudadoFisico: true,
    montoRecaudado: 0,
    fotoFactura: ""
  });

  // Cálculo automático del monto a recaudar estimado
  useEffect(() => {
    const estimado = Math.max(0, formData.ventasTotales - formData.gastosExtra);
    setFormData((prev) => ({ ...prev, montoRecaudado: estimado }));
  }, [formData.ventasTotales, formData.gastosExtra]);

  // Carga del historial reciente de cierres
  const fetchClosuresFromSQL = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sql-sync/closures");
      if (res.ok) {
        const data = await res.json();
        setClosures(data);
      }
    } catch (err) {
      console.error("Error cargando cierres de caja desde SQL:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClosuresFromSQL();
  }, []);

  // 2. Escuchar cambios en vivo vía SSE
  useEffect(() => {
    if (lastSyncEvent && lastSyncEvent.entity === "closures") {
      console.log("⚡ [SSE Closures] Cierre de caja actualizado en tiempo real:", lastSyncEvent.data);
      setClosures((prev) => [lastSyncEvent.data, ...prev]);

      setNotification({
        type: "success",
        title: "Sincronización en Vivo",
        text: `Nuevo cierre registrado para la sucursal ${lastSyncEvent.data.sucursal || "Plaza"}.`
      });
      setTimeout(() => setNotification(null), 4000);
    }
  }, [lastSyncEvent]);

  // 3. Envío del Cierre de Caja con Resiliencia Offline
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fecha || !formData.sucursal) return;

    setSaving(true);
    setNotification(null);

    /**
     * REGLA DE NEGOCIO CRÍTICA DE SEGURIDAD:
     * Unicamente se envía el consolidado operacional diario.
     * Estrictamente prohibido adjuntar historiales de entregas de dinero
     * o desgloses de auditoría de efectivo.
     */
    const payloadToSend = {
      fecha: formData.fecha,
      sucursal: formData.sucursal,
      ventasTotales: Number(formData.ventasTotales),
      gastosExtra: Number(formData.gastosExtra),
      descripcionGastos: formData.descripcionGastos.trim(),
      personaRecogio: formData.personaRecogio.trim(),
      recaudadoFisico: formData.recaudadoFisico,
      montoRecaudado: Number(formData.montoRecaudado),
      fotoFactura: formData.fotoFactura || ""
    };

    try {
      const response = await saveClosure(payloadToSend);
      setSaving(false);

      if (response && response._offline) {
        // Alerta de guardado offline (resiliencia)
        setNotification({
          type: "offline",
          title: "Guardado Offline Registrado",
          text: "El cierre diario se guardó localmente en la cola de resiliencia. Se enviará a PostgreSQL cuando vuelva la conexión."
        });
      } else {
        // Confirmación en PostgreSQL
        setNotification({
          type: "success",
          title: "Cierre Guardado Exitosamente",
          text: `Cierre consolidado registrado en PostgreSQL para la sucursal ${formData.sucursal}.`
        });

        // Limpiar formulario para nuevo día
        setFormData({
          fecha: new Date().toISOString().split("T")[0],
          sucursal: formData.sucursal,
          ventasTotales: 0,
          gastosExtra: 0,
          descripcionGastos: "",
          personaRecogio: "",
          recaudadoFisico: true,
          montoRecaudado: 0,
          fotoFactura: ""
        });

        fetchClosuresFromSQL();
      }
    } catch (err: any) {
      setSaving(false);
      setNotification({
        type: "error",
        title: "Error al Registrar Cierre",
        text: err.message || "No se pudo procesar la solicitud de cierre."
      });
    }

    setTimeout(() => setNotification(null), 5000);
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Banner Encabezado */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-2xl shadow-md border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-500/20 border border-indigo-400/30 rounded-xl text-indigo-400">
              <DollarSign className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
                Cierre Diario de Caja por Sucursal
              </h1>
              <p className="text-slate-400 text-xs mt-0.5">
                Consolidado operativo respaldado por PostgreSQL y Cola de Resiliencia Offline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700 text-xs font-medium text-emerald-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Consolidado Operativo Sanitizado</span>
          </div>
        </div>

        {/* Notificaciones Visuales de Estado */}
        {notification && (
          <div
            className={`p-4 rounded-xl text-sm font-semibold flex items-start gap-3 shadow-md transition-all ${
              notification.type === "offline"
                ? "bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-300 bg-amber-50"
                : notification.type === "error"
                ? "bg-rose-500/10 border border-rose-500/30 text-rose-900 bg-rose-50"
                : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 bg-emerald-50"
            }`}
          >
            {notification.type === "offline" ? (
              <WifiOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : notification.type === "error" ? (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div>
              <h4 className="font-bold text-sm">{notification.title}</h4>
              <p className="text-xs opacity-90 mt-0.5">{notification.text}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Formulario Consolidado de Cierre */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>Formulario Consolidado de Cierre</span>
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                {formData.fecha}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Fila 1: Fecha y Sucursal */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>Fecha de Cierre</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.fecha}
                    onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-slate-500" />
                    <span>Sucursal</span>
                  </label>
                  <select
                    value={formData.sucursal}
                    onChange={(e) => setFormData({ ...formData, sucursal: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="Plaza">Sucursal Plaza</option>
                    <option value="Centro">Sucursal Centro</option>
                    <option value="Norte">Sucursal Norte</option>
                    <option value="Sur">Sucursal Sur</option>
                  </select>
                </div>
              </div>

              {/* Fila 2: Ventas Totales y Gastos Extra */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Ventas Totales ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    required
                    value={formData.ventasTotales || ""}
                    onChange={(e) => setFormData({ ...formData, ventasTotales: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Gastos Extra / Salidas ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={formData.gastosExtra || ""}
                    onChange={(e) => setFormData({ ...formData, gastosExtra: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold text-rose-600 focus:ring-2 focus:ring-indigo-500"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Descripción de Gastos */}
              {formData.gastosExtra > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Concepto / Descripción de Gastos Extra
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.descripcionGastos}
                    onChange={(e) => setFormData({ ...formData, descripcionGastos: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500"
                    placeholder="Ej: Compra de bolsas, hielo, insumos menores"
                  />
                </div>
              )}

              {/* Persona que Recogió / Responsable */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                  <span>Persona que Recogió / Responsable</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.personaRecogio}
                  onChange={(e) => setFormData({ ...formData, personaRecogio: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Nombre de la persona encargada"
                />
              </div>

              {/* Link Foto o Comprobante */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-slate-500" />
                  <span>URL Foto de Factura / Planilla (Opcional)</span>
                </label>
                <input
                  type="url"
                  value={formData.fotoFactura}
                  onChange={(e) => setFormData({ ...formData, fotoFactura: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://..."
                />
              </div>

              {/* Casilla Check Recaudado Físico */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, recaudadoFisico: !formData.recaudadoFisico })}
                  className="text-indigo-600 focus:outline-none"
                >
                  {formData.recaudadoFisico ? (
                    <CheckSquare className="w-5 h-5 text-indigo-600" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-400" />
                  )}
                </button>
                <span className="text-xs font-semibold text-slate-700">
                  Confirmación de recaudación física completada
                </span>
              </div>

              {/* Botón de Guardado */}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-400"
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Save className="w-4 h-4 text-white" />
                )}
                <span>Registrar Cierre Consolidado en SQL</span>
              </button>
            </form>
          </div>

          {/* Panel Lateral: Resumen Neto & Historial */}
          <div className="space-y-6">
            
            {/* Tarjeta Resumen Neto Estimado */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-md space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Monto Recaudado Estimado
              </span>
              <div className="text-3xl font-black text-emerald-400 font-mono">
                ${formData.montoRecaudado.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 space-y-1 border-t border-slate-800 pt-3">
                <div className="flex justify-between">
                  <span>Ventas Totales:</span>
                  <span className="font-mono text-slate-200">${formData.ventasTotales.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Gastos Extra:</span>
                  <span className="font-mono text-rose-400">-${formData.gastosExtra.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Lista Historial Reciente */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-600" />
                  <span>Historial Reciente</span>
                </h3>
                <button
                  onClick={fetchClosuresFromSQL}
                  className="p-1 hover:bg-slate-100 rounded text-slate-500"
                  title="Actualizar historial"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {closures.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center italic py-4">
                    No hay cierres registrados.
                  </p>
                ) : (
                  closures.slice(0, 5).map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1"
                    >
                      <div className="flex justify-between font-bold text-slate-800">
                        <span>{item.sucursal}</span>
                        <span className="font-mono text-emerald-600">
                          ${(item.montoRecaudado || item.ventasTotales - item.gastosExtra).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-500 text-[11px]">
                        <span>{item.fecha}</span>
                        <span>Resp: {item.personaRecogio || "N/A"}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
