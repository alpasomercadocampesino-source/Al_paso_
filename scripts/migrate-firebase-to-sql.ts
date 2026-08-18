import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";

/**
 * SCRIPT DE MIGRACIÓN INICIAL (ONE-TIME MIGRATION)
 * Firestore (Firebase) ---> PostgreSQL (Cloud SQL via Drizzle ORM)
 */

const BATCH_SIZE = 200;

async function initFirebase() {
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Archivo de configuración Firebase no encontrado en ${configPath}`);
  }
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);

  try {
    await signInAnonymously(auth);
    console.log("🔒 Autenticación anónima en Firebase establecida.");
  } catch (e: any) {
    console.warn("⚠️ Advertencia en Auth anónimo (se continuará la lectura):", e.message);
  }

  const firestore = firebaseConfig.firestoreDatabaseId
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

  return firestore;
}

async function runMigration() {
  console.log("=================================================================");
  console.log("   INICIANDO MIGRACIÓN DE DATOS: FIRESTORE ---> POSTGRESQL (SQL)");
  console.log("=================================================================\n");

  const startTime = Date.now();
  const firestore = await initFirebase();

  const reportStats = {
    products: { total: 0, inserted: 0 },
    providers: { total: 0, inserted: 0 },
    employeeRates: { total: 0, inserted: 0 },
    orders: { total: 0, inserted: 0 },
    closures: { total: 0, inserted: 0 },
    payrollRecords: { total: 0, inserted: 0 }
  };

  try {
    // -----------------------------------------------------------------
    // 1. MIGRACIÓN DE PROVEEDORES ('providers')
    // -----------------------------------------------------------------
    console.log("-----------------------------------------------------------------");
    console.log("📦 1/6: Leyendo colección 'providers' desde Firestore...");
    const provSnap = await getDocs(collection(firestore, "providers"));
    reportStats.providers.total = provSnap.docs.length;
    console.log(`📌 Encontrados ${reportStats.providers.total} proveedores.`);

    if (reportStats.providers.total > 0) {
      const rawProviders = provSnap.docs.map((doc) => doc.data());
      const mappedProviders = rawProviders
        .map((p) => ({
          proveedor: String(p.Proveedor || p.proveedor || "").trim(),
          celular: String(p.Celular || p.celular || "").trim()
        }))
        .filter((p) => p.proveedor.length > 0);

      for (let i = 0; i < mappedProviders.length; i += BATCH_SIZE) {
        const chunk = mappedProviders.slice(i, i + BATCH_SIZE);
        for (const item of chunk) {
          await db
            .insert(schema.providers)
            .values(item)
            .onConflictDoUpdate({
              target: schema.providers.proveedor,
              set: { celular: item.celular }
            });
        }
        reportStats.providers.inserted += chunk.length;
        const currentCount = Math.min(i + BATCH_SIZE, mappedProviders.length);
        const percent = ((currentCount / mappedProviders.length) * 100).toFixed(1);
        console.log(`   [Proveedores] Migrando ${currentCount} de ${mappedProviders.length} (${percent}%)...`);
      }
      console.log(`✅ ${reportStats.providers.inserted} proveedores migrados a PostgreSQL.`);
    }

    // -----------------------------------------------------------------
    // 2. MIGRACIÓN DE PRODUCTOS / INVENTARIO ('inventario')
    // -----------------------------------------------------------------
    console.log("\n-----------------------------------------------------------------");
    console.log("🍏 2/6: Leyendo colección 'inventario' desde Firestore...");
    const prodSnap = await getDocs(collection(firestore, "inventario"));
    reportStats.products.total = prodSnap.docs.length;
    console.log(`📌 Encontrados ${reportStats.products.total} productos.`);

    if (reportStats.products.total > 0) {
      const rawProducts = prodSnap.docs.map((doc) => doc.data());
      const mappedProducts = rawProducts
        .map((p) => ({
          codigo: String(p.Codigo || p.codigo || "").trim(),
          producto: String(p.Producto || p.producto || "Sin Nombre").trim(),
          medida: String(p.Medida || p.medida || "Kg").trim(),
          merma: parseFloat(p.Merma || p.merma || 0),
          utilidad: parseFloat(p.Utilidad || p.utilidad || 0),
          proveedor: String(p.Proveedor || p.proveedor || "").trim(),
          celular: String(p.Celular || p.celular || "").trim(),
          costoProveedor: parseFloat(p.Costo_Proveedor || p.costoProveedor || 0),
          precioVentaActual: parseFloat(p.Precio_Venta_Actual || p.precioVentaActual || 0),
          precioAnterior: parseFloat(p.Precio_Anterior || p.precioAnterior || 0),
          ventaAnterior: parseFloat(p.Venta_Anterior || p.ventaAnterior || 0),
          factorBulto: parseFloat(p.Factor_Bulto || p.factorBulto || 1),
          factorCanastilla: parseFloat(p.Factor_Canastilla || p.factorCanastilla || 1)
        }))
        .filter((p) => p.codigo.length > 0);

      for (let i = 0; i < mappedProducts.length; i += BATCH_SIZE) {
        const chunk = mappedProducts.slice(i, i + BATCH_SIZE);
        for (const item of chunk) {
          await db
            .insert(schema.products)
            .values(item)
            .onConflictDoUpdate({
              target: schema.products.codigo,
              set: {
                producto: item.producto,
                medida: item.medida,
                merma: item.merma,
                utilidad: item.utilidad,
                costoProveedor: item.costoProveedor,
                precioVentaActual: item.precioVentaActual,
                precioAnterior: item.precioAnterior,
                ventaAnterior: item.ventaAnterior,
                factorBulto: item.factorBulto,
                factorCanastilla: item.factorCanastilla
              }
            });
        }
        reportStats.products.inserted += chunk.length;
        const currentCount = Math.min(i + BATCH_SIZE, mappedProducts.length);
        const percent = ((currentCount / mappedProducts.length) * 100).toFixed(1);
        console.log(`   [Productos] Migrando ${currentCount} de ${mappedProducts.length} (${percent}%)...`);
      }
      console.log(`✅ ${reportStats.products.inserted} productos migrados a PostgreSQL.`);
    }

    // -----------------------------------------------------------------
    // 3. MIGRACIÓN DE EMPLEADOS / TARIFAS ('rates')
    // -----------------------------------------------------------------
    console.log("\n-----------------------------------------------------------------");
    console.log("👥 3/6: Leyendo colección 'rates' (Empleados) desde Firestore...");
    const ratesSnap = await getDocs(collection(firestore, "rates"));
    reportStats.employeeRates.total = ratesSnap.docs.length;
    console.log(`📌 Encontrados ${reportStats.employeeRates.total} empleados.`);

    if (reportStats.employeeRates.total > 0) {
      const rawRates = ratesSnap.docs.map((doc) => doc.data());
      const mappedRates = rawRates
        .map((r) => ({
          empleado: String(r.Empleado || r.empleado || "").trim(),
          valorDia: parseFloat(r.Valor_Dia || r.valorDia || 0),
          valorHora: parseFloat(r.Valor_Hora || r.valorHora || 0),
          auxilioTransporte: parseFloat(r.Auxilio_Transporte || r.auxilioTransporte || 0),
          celular: String(r.Celular || r.celular || "").trim(),
          cedula: String(r.Cedula || r.cedula || "").trim()
        }))
        .filter((r) => r.empleado.length > 0);

      for (let i = 0; i < mappedRates.length; i += BATCH_SIZE) {
        const chunk = mappedRates.slice(i, i + BATCH_SIZE);
        for (const item of chunk) {
          await db
            .insert(schema.employeeRates)
            .values(item)
            .onConflictDoUpdate({
              target: schema.employeeRates.empleado,
              set: {
                valorDia: item.valorDia,
                valorHora: item.valorHora,
                auxilioTransporte: item.auxilioTransporte,
                celular: item.celular,
                cedula: item.cedula
              }
            });
        }
        reportStats.employeeRates.inserted += chunk.length;
        const currentCount = Math.min(i + BATCH_SIZE, mappedRates.length);
        const percent = ((currentCount / mappedRates.length) * 100).toFixed(1);
        console.log(`   [Empleados/Tarifas] Migrando ${currentCount} de ${mappedRates.length} (${percent}%)...`);
      }
      console.log(`✅ ${reportStats.employeeRates.inserted} empleados migrados a PostgreSQL.`);
    }

    // -----------------------------------------------------------------
    // 4. MIGRACIÓN DE PEDIDOS ('pedidos')
    // -----------------------------------------------------------------
    console.log("\n-----------------------------------------------------------------");
    console.log("🛒 4/6: Leyendo colección 'pedidos' desde Firestore...");
    const ordersSnap = await getDocs(collection(firestore, "pedidos"));
    reportStats.orders.total = ordersSnap.docs.length;
    console.log(`📌 Encontrados ${reportStats.orders.total} pedidos.`);

    if (reportStats.orders.total > 0) {
      const rawOrders = ordersSnap.docs.map((doc) => doc.data());
      const mappedOrders = rawOrders.map((o, idx) => ({
        idPedido: String(o.ID_Pedido || o.idPedido || `PED_${idx}`).trim(),
        fecha: String(o.Fecha || o.fecha || new Date().toISOString().split("T")[0]).trim(),
        sucursal: String(o.Sucursal || o.sucursal || "Plaza").trim(),
        codigo: String(o.Codigo || o.codigo || "").trim(),
        producto: String(o.Producto || o.producto || "Sin Nombre").trim(),
        medida: String(o.Medida || o.medida || "Kg").trim(),
        cantidad: String(o.Cantidad || o.cantidad || "0").trim(),
        notas: String(o.Notas || o.notas || "").trim(),
        precioAnterior: parseFloat(o.Precio_Anterior || o.precioAnterior || 0),
        porcentajeGanancia: parseFloat(o.Porcentaje_Ganancia || o.porcentajeGanancia || 0),
        cantidadComprada: parseFloat(o.Cantidad_Comprada || o.cantidadComprada || 0),
        costoMomento: parseFloat(o.Costo_Momento || o.costoMomento || 0),
        precioVentaMomento: parseFloat(o.Precio_Venta_Momento || o.precioVentaMomento || 0),
        kilos: parseFloat(o.Kilos || o.kilos || 0),
        estado: String(o.Estado || o.estado || "Pendiente").trim(),
        estadoPago: String(o.Estado_Pago || o.estadoPago || "Pendiente").trim(),
        proveedor: String(o.Proveedor || o.proveedor || "").trim(),
        celular: String(o.Celular || o.celular || "").trim()
      }));

      for (let i = 0; i < mappedOrders.length; i += BATCH_SIZE) {
        const chunk = mappedOrders.slice(i, i + BATCH_SIZE);
        await db.insert(schema.orders).values(chunk);
        reportStats.orders.inserted += chunk.length;
        const currentCount = Math.min(i + BATCH_SIZE, mappedOrders.length);
        const percent = ((currentCount / mappedOrders.length) * 100).toFixed(1);
        console.log(`   [Pedidos] Migrando ${currentCount} de ${mappedOrders.length} (${percent}%)...`);
      }
      console.log(`✅ ${reportStats.orders.inserted} pedidos migrados a PostgreSQL.`);
    }

    // -----------------------------------------------------------------
    // 5. MIGRACIÓN DE CIERRES DE CAJA ('cierres_caja') - SANITIZADO ESTRICAMENTE
    // -----------------------------------------------------------------
    console.log("\n-----------------------------------------------------------------");
    console.log("💵 5/6: Leyendo colección 'cierres_caja' desde Firestore...");
    const closuresSnap = await getDocs(collection(firestore, "cierres_caja"));
    reportStats.closures.total = closuresSnap.docs.length;
    console.log(`📌 Encontrados ${reportStats.closures.total} cierres de caja.`);

    if (reportStats.closures.total > 0) {
      const rawClosures = closuresSnap.docs.map((doc) => doc.data());
      
      // Sanitización estricta: NO se mapean ni guardan campos de entregas de dinero
      const mappedClosures = rawClosures.map((c) => ({
        fecha: String(c.Fecha || c.fecha || new Date().toISOString().split("T")[0]).trim(),
        sucursal: String(c.Sucursal || c.sucursal || "Plaza").trim(),
        ventasTotales: parseFloat(c.Ventas_Totales || c.ventasTotales || 0),
        gastosExtra: parseFloat(c.Gastos_Extra || c.gastosExtra || 0),
        descripcionGastos: String(c.Descripcion_Gastos || c.descripcionGastos || "").trim(),
        personaRecogio: String(c.Persona_Recogio || c.personaRecogio || "").trim(),
        recaudadoFisico: Boolean(c.Recaudado_Fisico || c.recaudadoFisico),
        fotoFactura: String(c.Foto_Factura || c.fotoFactura || "").trim(),
        montoRecaudado: parseFloat(c.Monto_Recaudado || c.montoRecaudado || 0)
      }));

      for (let i = 0; i < mappedClosures.length; i += BATCH_SIZE) {
        const chunk = mappedClosures.slice(i, i + BATCH_SIZE);
        await db.insert(schema.closures).values(chunk);
        reportStats.closures.inserted += chunk.length;
        const currentCount = Math.min(i + BATCH_SIZE, mappedClosures.length);
        const percent = ((currentCount / mappedClosures.length) * 100).toFixed(1);
        console.log(`   [Cierres de Caja] Migrando ${currentCount} de ${mappedClosures.length} (${percent}%)...`);
      }
      console.log(`✅ ${reportStats.closures.inserted} cierres sanitizados migrados a PostgreSQL.`);
    }

    // -----------------------------------------------------------------
    // 6. MIGRACIÓN DE NÓMINA ('nomina')
    // -----------------------------------------------------------------
    console.log("\n-----------------------------------------------------------------");
    console.log("🧾 6/6: Leyendo colección 'nomina' desde Firestore...");
    const payrollSnap = await getDocs(collection(firestore, "nomina"));
    reportStats.payrollRecords.total = payrollSnap.docs.length;
    console.log(`📌 Encontrados ${reportStats.payrollRecords.total} registros de nómina.`);

    if (reportStats.payrollRecords.total > 0) {
      const rawPayroll = payrollSnap.docs.map((doc) => doc.data());
      const mappedPayroll = rawPayroll.map((pay) => ({
        fecha: String(pay.Fecha || pay.fecha || new Date().toISOString().split("T")[0]).trim(),
        trabajador: String(pay.Trabajador || pay.trabajador || pay.Empleado || pay.empleado || "").trim(),
        sucursal: String(pay.Sucursal || pay.sucursal || "Plaza").trim(),
        diasTrabajados: parseFloat(pay.Dias_Trabajados || pay.diasTrabajados || 0),
        horasTrabajadas: parseFloat(pay.Horas_Trabajadas || pay.horasTrabajadas || 0),
        pagoBase: parseFloat(pay.Pago_Base || pay.pagoBase || 0),
        pagoHoras: parseFloat(pay.Pago_Horas || pay.pagoHoras || 0),
        prestamosDescontados: parseFloat(pay.Prestamos_Descontados || pay.prestamosDescontados || 0),
        totalNeto: parseFloat(pay.Total_Neto || pay.totalNeto || 0),
        estadoPago: String(pay.Estado_Pago || pay.estadoPago || "Pendiente").trim()
      }));

      for (let i = 0; i < mappedPayroll.length; i += BATCH_SIZE) {
        const chunk = mappedPayroll.slice(i, i + BATCH_SIZE);
        await db.insert(schema.payrollRecords).values(chunk);
        reportStats.payrollRecords.inserted += chunk.length;
        const currentCount = Math.min(i + BATCH_SIZE, mappedPayroll.length);
        const percent = ((currentCount / mappedPayroll.length) * 100).toFixed(1);
        console.log(`   [Nómina] Migrando ${currentCount} de ${mappedPayroll.length} (${percent}%)...`);
      }
      console.log(`✅ ${reportStats.payrollRecords.inserted} registros de nómina migrados a PostgreSQL.`);
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

    // -----------------------------------------------------------------
    // REPORTE FINAL CONSOLIDADO
    // -----------------------------------------------------------------
    console.log("\n=================================================================");
    console.log("🎉 MIGRACIÓN COMPLETADA EXITOSAMENTE EN " + durationSec + "s");
    console.log("=================================================================");
    console.table([
      { Entidad: "Proveedores", Firestore: reportStats.providers.total, PostgreSQL: reportStats.providers.inserted },
      { Entidad: "Productos/Catálogo", Firestore: reportStats.products.total, PostgreSQL: reportStats.products.inserted },
      { Entidad: "Empleados/Tarifas", Firestore: reportStats.employeeRates.total, PostgreSQL: reportStats.employeeRates.inserted },
      { Entidad: "Pedidos", Firestore: reportStats.orders.total, PostgreSQL: reportStats.orders.inserted },
      { Entidad: "Cierres de Caja (Sanitizados)", Firestore: reportStats.closures.total, PostgreSQL: reportStats.closures.inserted },
      { Entidad: "Nómina", Firestore: reportStats.payrollRecords.total, PostgreSQL: reportStats.payrollRecords.inserted }
    ]);
    console.log("=================================================================\n");

    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ ERROR DURANTE LA MIGRACIÓN:", error);
    process.exit(1);
  }
}

runMigration();
