/**
 * Script de Prueba Integral (E2E) para la Arquitectura de Sincronización SQL 'al.paso'
 * Ejecutable desde Node.js / tsx o desde el navegador.
 */

async function runE2ETests() {
  console.log("==========================================================");
  console.log("   INICIANDO PRUEBAS DE SALUD QA: SINCRONIZACIÓN SQL AL.PASO");
  console.log("==========================================================\n");

  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

  // --- 1. PRUEBA DE ESCRITURA INMEDIATA (CRUD DIRECTO) ---
  console.log("[TEST 1/4] Prueba de Escritura Inmediata (CRUD)...");
  try {
    // Producto
    const prodCode = `PROD_E2E_${Date.now()}`;
    const pRes = await fetch(`${baseUrl}/api/sql-sync/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigo: prodCode,
        producto: "Producto Test QA CLI",
        medida: "Kg",
        costoProveedor: 3000,
        precioVentaActual: 4500
      })
    });
    if (!pRes.ok) throw new Error(`HTTP ${pRes.status} en productos`);
    const pData = await pRes.json();
    console.log(`  ✓ Producto guardado en PostgreSQL [ID: ${pData.id || pData.codigo}] (HTTP 201)`);

    // Proveedor
    const provName = `Proveedor CLI ${Date.now()}`;
    const prvRes = await fetch(`${baseUrl}/api/sql-sync/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proveedor: provName, celular: "3100000000" })
    });
    if (!prvRes.ok) throw new Error(`HTTP ${prvRes.status} en proveedores`);
    console.log(`  ✓ Proveedor guardado en PostgreSQL (HTTP 201)`);

    // Pedido
    const ordRes = await fetch(`${baseUrl}/api/sql-sync/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idPedido: `PED_CLI_${Date.now()}`,
        fecha: new Date().toISOString().split("T")[0],
        sucursal: "Plaza",
        codigo: prodCode,
        producto: "Producto Test QA CLI",
        cantidad: "100",
        costoMomento: 3000,
        precioVentaMomento: 4500
      })
    });
    if (!ordRes.ok) throw new Error(`HTTP ${ordRes.status} en pedidos`);
    console.log(`  ✓ Pedido guardado en PostgreSQL (HTTP 201)`);

    // Nómina
    const payRes = await fetch(`${baseUrl}/api/sql-sync/payroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: new Date().toISOString().split("T")[0],
        trabajador: "Operario QA",
        sucursal: "Plaza",
        diasTrabajados: 5,
        pagoBase: 300000,
        totalNeto: 300000
      })
    });
    if (!payRes.ok) throw new Error(`HTTP ${payRes.status} en nómina`);
    console.log(`  ✓ Registro de Nómina guardado en PostgreSQL (HTTP 201)`);

    console.log("  ==> TEST 1 PASADO EXITOSAMENTE.\n");
  } catch (err: any) {
    console.error(`  ❌ TEST 1 FALLADO: ${err.message}\n`);
  }

  // --- 2. PRUEBA DE SINCRONIZACIÓN EN VIVO (SSE) ---
  console.log("[TEST 2/4] Prueba de Sincronización en Vivo (SSE)...");
  try {
    const sseRes = await fetch(`${baseUrl}/api/sql-sync/events`);
    if (sseRes.headers.get("content-type")?.includes("text/event-stream")) {
      console.log("  ✓ Canal SSE /api/sql-sync/events activo y respondiendo 'text/event-stream'");
      console.log("  ==> TEST 2 PASADO EXITOSAMENTE.\n");
    } else {
      throw new Error("El endpoint SSE no devolvió el Content-Type correcto.");
    }
  } catch (err: any) {
    console.error(`  ❌ TEST 2 FALLADO: ${err.message}\n`);
  }

  // --- 3. PRUEBA DE RESILIENCIA OFFLINE (/api/sql-sync/batch) ---
  console.log("[TEST 3/4] Prueba de Resiliencia Offline (Procesamiento por Lote)...");
  try {
    const batchItems = [
      {
        id: `offline_q_${Date.now()}_1`,
        entity: "products",
        action: "create",
        data: {
          codigo: `OFFLINE_CLI_${Date.now()}`,
          producto: "Producto Lote Offline CLI",
          precioVentaActual: 2000
        },
        timestamp: Date.now()
      }
    ];

    const batchRes = await fetch(`${baseUrl}/api/sql-sync/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batchItems, clientId: "cli_runner" })
    });

    if (!batchRes.ok) throw new Error(`HTTP ${batchRes.status} en procesamiento por lote`);
    const batchData = await batchRes.json();

    if (batchData.success && batchData.processedCount > 0) {
      console.log(`  ✓ Lote procesado exitosamente: ${batchData.processedCount} registro(s) sincronizado(s)`);
      console.log("  ==> TEST 3 PASADO EXITOSAMENTE.\n");
    } else {
      throw new Error("Respuesta de lote no indicó éxito");
    }
  } catch (err: any) {
    console.error(`  ❌ TEST 3 FALLADO: ${err.message}\n`);
  }

  // --- 4. AUDITORÍA DE RESTRICCIÓN CRÍTICA (CIERRES DE CAJA) ---
  console.log("[TEST 4/4] Auditoría de Restricción Crítica (Cierres de Caja)...");
  try {
    const dirtyClosurePayload = {
      fecha: new Date().toISOString().split("T")[0],
      sucursal: "Plaza",
      ventasTotales: 950000,
      gastosExtra: 20000,
      montoRecaudado: 930000,
      // CAMPOS SUCIOS INTENCIONALES
      historialEntregas: [{ recogi: "Pedro", monto: 500000 }],
      auditoriaDinero: { sospechoso: true }
    };

    const cRes = await fetch(`${baseUrl}/api/sql-sync/closures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dirtyClosurePayload)
    });

    if (!cRes.ok) throw new Error(`HTTP ${cRes.status} guardando cierre`);
    const cData = await cRes.json();
    const saved = cData.data || cData;

    const hasProhibitedKey = "historialEntregas" in saved || "auditoriaDinero" in saved;

    if (!hasProhibitedKey) {
      console.log("  ✓ Servidor sanitizó los datos: Atributos 'historialEntregas' y 'auditoriaDinero' eliminados.");
      console.log(`  ✓ Cierre ID ${saved.id} almacenado en PostgreSQL respetando la regla estricta de negocio.`);
      console.log("  ==> TEST 4 PASADO EXITOSAMENTE.\n");
    } else {
      throw new Error("VIOLACIÓN DE RESTRICCIÓN: Los campos de entregas de dinero no fueron sanitizados.");
    }
  } catch (err: any) {
    console.error(`  ❌ TEST 4 FALLADO: ${err.message}\n`);
  }

  console.log("==========================================================");
  console.log("   PRUEBAS DE INTEGRIDAD Y RESTRICCIÓN FINALIZADAS");
  console.log("==========================================================");
}

runE2ETests();
