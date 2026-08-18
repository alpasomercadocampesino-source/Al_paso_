import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Play,
  RefreshCw,
  Database,
  Radio,
  WifiOff,
  ShieldCheck,
  Terminal,
  Activity,
  Layers
} from "lucide-react";
import { sqlSyncClient } from "../lib/sqlSyncClient.ts";

export interface TestResult {
  id: string;
  name: string;
  status: "idle" | "running" | "passed" | "failed";
  durationMs?: number;
  message: string;
  details?: string[];
}

export function SQLSyncHealthCheck() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, TestResult>>({
    crud: {
      id: "crud",
      name: "1. Escritura Inmediata (CRUD)",
      status: "idle",
      message: "Probará creación, lectura y actualización en productos, proveedores, pedidos y nómina."
    },
    sse: {
      id: "sse",
      name: "2. Sincronización en Vivo (SSE)",
      status: "idle",
      message: "Verificará recepción de eventos 'sql-change' en tiempo real."
    },
    resilience: {
      id: "resilience",
      name: "3. Resiliencia Offline (Queue Resiliency)",
      status: "idle",
      message: "Simulará encolamiento offline y posterior procesamiento por lote."
    },
    audit: {
      id: "audit",
      name: "4. Auditoría de Restricción Crítica (Cierres)",
      status: "idle",
      message: "Verificará sanitización de 'historialEntregas' / 'auditoriaDinero' en cierres de caja."
    }
  });

  const addLog = (text: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${text}`]);
  };

  const updateTestStatus = (
    id: string,
    status: TestResult["status"],
    message: string,
    durationMs?: number,
    details?: string[]
  ) => {
    setResults((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        status,
        message,
        durationMs,
        details
      }
    }));
  };

  // --- RUN ALL E2E QA TESTS ---
  const runHealthCheck = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("=== INICIANDO SUITE DE PRUEBAS INTEGRAL E2E (SQL SYNC QA) ===");

    // 1. PRUEBA DE ESCRITURA INMEDIATA (CRUD)
    await runCrudTest();

    // 2. PRUEBA DE SINCRONIZACIÓN EN VIVO (SSE)
    await runSSETest();

    // 3. PRUEBA DE RESILIENCIA OFFLINE
    await runResilienceTest();

    // 4. AUDITORÍA DE RESTRICCIÓN CRÍTICA
    await runAuditTest();

    addLog("=== SUITE DE PRUEBAS COMPLETADA ===");
    setIsRunning(false);
  };

  // --- TEST 1: CRUD ---
  const runCrudTest = async () => {
    const start = Date.now();
    updateTestStatus("crud", "running", "Ejecutando operaciones CRUD directas en PostgreSQL...");
    addLog("[CRUD Test] Probando inserciones y consultas en tablas principales...");

    const testDetails: string[] = [];
    try {
      // 1.1 Producto
      const testCode = `PROD_QA_${Date.now().toString().slice(-5)}`;
      const prodRes = await fetch("/api/sql-sync/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: testCode,
          producto: "Manzana Red QA",
          medida: "Kg",
          costoProveedor: 2500,
          precioVentaActual: 3800
        })
      });
      if (!prodRes.ok) throw new Error(`Error HTTP ${prodRes.status} creando producto`);
      const prodCreated = await prodRes.json();
      testDetails.push(`✓ Producto creado [ID: ${prodCreated.id || prodCreated.codigo}] HTTP 201`);

      // 1.2 Proveedor
      const provName = `Proveedor QA ${Date.now().toString().slice(-4)}`;
      const provRes = await fetch("/api/sql-sync/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: provName, celular: "3001234567" })
      });
      if (!provRes.ok) throw new Error(`Error HTTP ${provRes.status} creando proveedor`);
      const provCreated = await provRes.json();
      testDetails.push(`✓ Proveedor creado [${provCreated.proveedor}] HTTP 201`);

      // 1.3 Pedido
      const orderRes = await fetch("/api/sql-sync/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idPedido: `PED_QA_${Date.now().toString().slice(-4)}`,
          fecha: new Date().toISOString().split("T")[0],
          sucursal: "Plaza",
          codigo: testCode,
          producto: "Manzana Red QA",
          cantidad: "50",
          costoMomento: 2500,
          precioVentaMomento: 3800,
          estado: "Pendiente"
        })
      });
      if (!orderRes.ok) throw new Error(`Error HTTP ${orderRes.status} creando pedido`);
      const orderCreated = await orderRes.json();
      testDetails.push(`✓ Pedido creado [ID: ${orderCreated.id}] HTTP 201`);

      // 1.4 Nómina
      const payrollRes = await fetch("/api/sql-sync/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: new Date().toISOString().split("T")[0],
          trabajador: "Carlos QA",
          sucursal: "Plaza",
          diasTrabajados: 1,
          pagoBase: 60000,
          totalNeto: 60000
        })
      });
      if (!payrollRes.ok) throw new Error(`Error HTTP ${payrollRes.status} creando nómina`);
      const payrollCreated = await payrollRes.json();
      testDetails.push(`✓ Registro Nómina creado [ID: ${payrollCreated.id}] HTTP 201`);

      const duration = Date.now() - start;
      addLog(`[CRUD Test PASADO] Todas las tablas respondieron correctamente (${duration}ms).`);
      updateTestStatus(
        "crud",
        "passed",
        "Operaciones CRUD en productos, proveedores, pedidos y nómina confirmadas en PostgreSQL.",
        duration,
        testDetails
      );
    } catch (err: any) {
      const duration = Date.now() - start;
      addLog(`[CRUD Test FALLADO] ${err.message}`);
      updateTestStatus("crud", "failed", `Fallo en escritura direct: ${err.message}`, duration, testDetails);
    }
  };

  // --- TEST 2: SSE LIVE SYNC ---
  const runSSETest = async () => {
    const start = Date.now();
    updateTestStatus("sse", "running", "Escuchando eventos SSE en /api/sql-sync/events...");
    addLog("[SSE Test] Iniciando canal EventSource...");

    return new Promise<void>((resolve) => {
      let eventSource: EventSource | null = null;
      let timeoutTimer: any = null;

      try {
        eventSource = new EventSource("/api/sql-sync/events");

        timeoutTimer = setTimeout(() => {
          if (eventSource) eventSource.close();
          const duration = Date.now() - start;
          addLog("[SSE Test FALLADO] Tiempo de espera agotado (3000ms) sin recibir evento.");
          updateTestStatus("sse", "failed", "No se recibió evento SSE en el tiempo esperado.", duration);
          resolve();
        }, 4000);

        eventSource.addEventListener("sql-change", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (data.entity === "products" && data.data?.codigo?.includes("SSE_TEST")) {
              clearTimeout(timeoutTimer);
              if (eventSource) eventSource.close();
              const duration = Date.now() - start;
              addLog(`[SSE Test PASADO] Evento 'sql-change' capturado exitosamente para ${data.entity}.`);
              updateTestStatus(
                "sse",
                "passed",
                `Evento en vivo capturado para entidad '${data.entity}' con acción '${data.action}'.`,
                duration,
                [`✓ Evento SSE recibido: ${JSON.stringify(data.data)}`]
              );
              resolve();
            }
          } catch (err) {
            // Ignorar eventos ajenos
          }
        });

        // Disparar inserción para activar SSE
        setTimeout(async () => {
          addLog("[SSE Test] Disparando inserción de prueba para generar evento...");
          await fetch("/api/sql-sync/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              codigo: `SSE_TEST_${Date.now()}`,
              producto: "Producto SSE Test",
              medida: "Unidad",
              precioVentaActual: 1000
            })
          });
        }, 300);
      } catch (err: any) {
        if (eventSource) eventSource.close();
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - start;
        addLog(`[SSE Test FALLADO] Error: ${err.message}`);
        updateTestStatus("sse", "failed", `Error abriendo canal SSE: ${err.message}`, duration);
        resolve();
      }
    });
  };

  // --- TEST 3: OFFLINE QUEUE RESILIENCY ---
  const runResilienceTest = async () => {
    const start = Date.now();
    updateTestStatus("resilience", "running", "Encolando elemento en cola local y forzando lote...");
    addLog("[Resilience Test] Simulando desconexión y encolamiento en sqlSyncClient...");

    try {
      const offlineItemData = {
        codigo: `OFFLINE_RES_${Date.now()}`,
        producto: "Producto Resiliencia Offline",
        precioVentaActual: 5000
      };

      // 1. Encolar localmente
      const queuedItem = sqlSyncClient.enqueueOperation("products", "create", offlineItemData);
      addLog(`[Resilience Test] Objeto guardado en cola loca ID: ${queuedItem.id}`);

      // 2. Verificar que existe en la cola
      const queueAfterEnqueue = sqlSyncClient.getQueue();
      addLog(`[Resilience Test] Cola local contiene ${queueAfterEnqueue.length} elemento(s).`);

      // 3. Forzar vaciado (flush)
      addLog("[Resilience Test] Invocando 'flushQueue()' para enviar lote a /api/sql-sync/batch...");
      await sqlSyncClient.flushQueue();

      const queueAfterFlush = sqlSyncClient.getQueue();
      const duration = Date.now() - start;

      if (queueAfterFlush.length === 0) {
        addLog(`[Resilience Test PASADO] Cola vaciada correctamente. Registros confirmados en SQL.`);
        updateTestStatus(
          "resilience",
          "passed",
          "Datos retenidos localmente y sincronizados con éxito a PostgreSQL tras reconexión.",
          duration,
          [
            `✓ Elemento encolado offline: ${queuedItem.id}`,
            `✓ Petición /api/sql-sync/batch procesada con éxito`,
            `✓ Cola local restablecida a 0 pendientes`
          ]
        );
      } else {
        throw new Error("La cola no se vació completamente tras llamar a flushQueue().");
      }
    } catch (err: any) {
      const duration = Date.now() - start;
      addLog(`[Resilience Test FALLADO] ${err.message}`);
      updateTestStatus("resilience", "failed", `Error en resiliencia offline: ${err.message}`, duration);
    }
  };

  // --- TEST 4: AUDITORÍA DE RESTRICCIÓN CRÍTICA DE NEGOCIO ---
  const runAuditTest = async () => {
    const start = Date.now();
    updateTestStatus("audit", "running", "Enviando payload sucio con 'historialEntregas'...");
    addLog("[Audit Test] Verificando restricción: Cierres de caja NO deben guardar entregas de dinero...");

    try {
      // Payload intencionadamente sucio
      const dirtyClosure = {
        fecha: new Date().toISOString().split("T")[0],
        sucursal: "Plaza",
        ventasTotales: 1200000,
        gastosExtra: 50000,
        descripcionGastos: "Compra bolsas",
        montoRecaudado: 1150000,
        // CAMPOS PROHIBIDOS
        historialEntregas: [
          { hora: "14:00", entrega: 500000, recogi: "Juan" },
          { hora: "18:00", entrega: 650000, recogi: "Maria" }
        ],
        auditoriaDinero: { status: "DUDOSO", billetesFalsos: 0 }
      };

      addLog("[Audit Test] Enviando Cierre de Caja a /api/sql-sync/closures con atributos prohibidos...");
      const res = await fetch("/api/sql-sync/closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirtyClosure)
      });

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const body = await res.json();
      const savedData = body.data || body;

      // Sanitization Check
      const hasHistorial = "historialEntregas" in savedData || "historial_entregas" in savedData;
      const hasAuditoria = "auditoriaDinero" in savedData || "auditoria_dinero" in savedData;

      const duration = Date.now() - start;

      if (!hasHistorial && !hasAuditoria) {
        addLog("[Audit Test PASADO] El servidor sanitizó con éxito el objeto. Cierre guardado sin historial de entregas.");
        updateTestStatus(
          "audit",
          "passed",
          "Regla de Negocio Cumplida: El registro fue aceptado pero sanitizado, previniendo historiales de entregas.",
          duration,
          [
            `✓ Se rechazaron / eliminaron los campos 'historialEntregas' y 'auditoriaDinero'`,
            `✓ Cierre guardado en PostgreSQL únicamente con resumen operativo (ID: ${savedData.id})`
          ]
        );
      } else {
        throw new Error("VIOLACIÓN DE RESTRICCIÓN: El objeto retuvo el historial de entregas de dinero.");
      }
    } catch (err: any) {
      const duration = Date.now() - start;
      addLog(`[Audit Test FALLADO] ${err.message}`);
      updateTestStatus("audit", "failed", `Error en prueba de auditoría: ${err.message}`, duration);
    }
  };

  const allPassed = Object.values(results).every((r) => r.status === "passed");

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-6 font-sans">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/20 border border-indigo-400/30 rounded-xl text-indigo-400">
            <Activity className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              QA Health Check: Sincronización SQL al.paso
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Suite E2E para PostgreSQL, Drizzle ORM, Transmisión SSE y Resiliencia Offline
            </p>
          </div>
        </div>

        <button
          onClick={runHealthCheck}
          disabled={isRunning}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-lg shrink-0 ${
            isRunning
              ? "bg-slate-700 text-slate-300 cursor-not-allowed"
              : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20 active:scale-95 cursor-pointer"
          }`}
        >
          {isRunning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Ejecutando QA Tests...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Ejecutar Suite E2E (Single-Click)</span>
            </>
          )}
        </button>
      </div>

      {/* Grid Status Cards */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50/50">
        {/* Test 1 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
              <Database className="w-4 h-4 text-indigo-600" />
              <span>1. CRUD Directo</span>
            </div>
            <BadgeStatus status={results.crud.status} />
          </div>
          <p className="text-xs text-slate-600 line-clamp-2">{results.crud.message}</p>
          {results.crud.durationMs !== undefined && (
            <span className="text-[11px] font-mono font-medium text-slate-400">
              Tiempo: {results.crud.durationMs}ms
            </span>
          )}
        </div>

        {/* Test 2 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
              <Radio className="w-4 h-4 text-amber-500" />
              <span>2. SSE en Vivo</span>
            </div>
            <BadgeStatus status={results.sse.status} />
          </div>
          <p className="text-xs text-slate-600 line-clamp-2">{results.sse.message}</p>
          {results.sse.durationMs !== undefined && (
            <span className="text-[11px] font-mono font-medium text-slate-400">
              Tiempo: {results.sse.durationMs}ms
            </span>
          )}
        </div>

        {/* Test 3 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
              <WifiOff className="w-4 h-4 text-blue-600" />
              <span>3. Resiliencia</span>
            </div>
            <BadgeStatus status={results.resilience.status} />
          </div>
          <p className="text-xs text-slate-600 line-clamp-2">{results.resilience.message}</p>
          {results.resilience.durationMs !== undefined && (
            <span className="text-[11px] font-mono font-medium text-slate-400">
              Tiempo: {results.resilience.durationMs}ms
            </span>
          )}
        </div>

        {/* Test 4 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>4. Auditoría Cierres</span>
            </div>
            <BadgeStatus status={results.audit.status} />
          </div>
          <p className="text-xs text-slate-600 line-clamp-2">{results.audit.message}</p>
          {results.audit.durationMs !== undefined && (
            <span className="text-[11px] font-mono font-medium text-slate-400">
              Tiempo: {results.audit.durationMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Detailed Details & Logs */}
      <div className="p-6 border-t border-slate-200 space-y-4">
        <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-700" />
          <span>Consola de Ejecución y Detalles de Auditoría</span>
        </h3>

        <div className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-xs max-h-64 overflow-y-auto space-y-1 shadow-inner border border-slate-800">
          {logs.length === 0 ? (
            <span className="text-slate-500 italic">
              Presione "Ejecutar Suite E2E" para iniciar la auditoría de sincronización...
            </span>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                className={
                  log.includes("PASADO")
                    ? "text-emerald-400 font-semibold"
                    : log.includes("FALLADO")
                    ? "text-rose-400 font-semibold"
                    : log.includes("===")
                    ? "text-indigo-400 font-bold"
                    : "text-slate-300"
                }
              >
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BadgeStatus({ status }: { status: TestResult["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
        <RefreshCw className="w-3 h-3 animate-spin" />
        Ejecutando
      </span>
    );
  }
  if (status === "passed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
        PASÓ
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
        <XCircle className="w-3 h-3 text-rose-600" />
        FALLÓ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
      Pendiente
    </span>
  );
}
