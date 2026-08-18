import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
dotenv.config();

// Import dinámico: los `import` estáticos se izan (hoisting) antes que
// dotenv.config(), así que src/db/index.ts vería SQL_HOST/etc. vacíos si se
// importara de forma estática arriba. El import() dinámico corre en orden real.
const { db } = await import("../src/db/index.ts");
const schema = await import("../src/db/schema.ts");

/**
 * SCRIPT DE MIGRACIÓN INICIAL (ONE-TIME MIGRATION)
 * data/db.json (fuente de datos real y actualizada) ---> PostgreSQL (Supabase vía Drizzle ORM)
 */

const BATCH_SIZE = 200;
const isBcryptHash = (value: string) => /^\$2[aby]\$/.test(value);

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const dbPath = path.resolve(process.cwd(), "data/db.json");
  const raw = JSON.parse(fs.readFileSync(dbPath, "utf-8"));

  const report: Record<string, { total: number; inserted: number }> = {};

  const run = async (name: string, items: any[], fn: (chunk: any[]) => Promise<void>) => {
    report[name] = { total: items.length, inserted: 0 };
    if (items.length === 0) {
      console.log(`- ${name}: 0 registros, nada que migrar.`);
      return;
    }
    for (const chunk of chunks(items, BATCH_SIZE)) {
      await fn(chunk);
      report[name].inserted += chunk.length;
    }
    console.log(`✅ ${name}: ${report[name].inserted}/${items.length} migrados.`);
  };

  console.log("=================================================================");
  console.log("   MIGRACIÓN: data/db.json ---> SUPABASE POSTGRESQL");
  console.log("=================================================================\n");

  // 1. Usuarios (con hashing de contraseñas legacy en texto plano)
  await run("users", raw.users || [], async (chunk) => {
    const mapped = chunk
      .map((u: any) => {
        const usuario = String(u.Usuario || "").trim();
        const rawPass = String(u.Contraseña || "").trim();
        if (!usuario || !rawPass) return null;
        const contrasena = isBcryptHash(rawPass) ? rawPass : bcrypt.hashSync(rawPass, 10);
        return { usuario, contrasena, rol: String(u.Rol || "Sucursal").trim() };
      })
      .filter(Boolean) as any[];
    for (const item of mapped) {
      await db.insert(schema.users).values(item)
        .onConflictDoUpdate({ target: schema.users.usuario, set: { contrasena: item.contrasena, rol: item.rol } });
    }
  });

  // 2. Proveedores
  await run("providers", raw.providers || [], async (chunk) => {
    const mapped = chunk
      .map((p: any) => ({ proveedor: String(p.Proveedor || "").trim(), celular: String(p.Celular || "").trim() }))
      .filter((p: any) => p.proveedor.length > 0);
    for (const item of mapped) {
      await db.insert(schema.providers).values(item)
        .onConflictDoUpdate({ target: schema.providers.proveedor, set: { celular: item.celular } });
    }
  });

  // 3. Productos
  await run("products", raw.products || [], async (chunk) => {
    const mapped = chunk
      .map((p: any) => ({
        codigo: String(p.Codigo || "").trim(),
        producto: String(p.Producto || "Sin Nombre").trim(),
        medida: String(p.Medida || "Kg").trim(),
        merma: parseFloat(p.Merma) || 0,
        utilidad: parseFloat(p.Utilidad) || 0,
        proveedor: String(p.Proveedor || "").trim(),
        celular: String(p.Celular || "").trim(),
        costoProveedor: parseFloat(p.Costo_Proveedor) || 0,
        precioVentaActual: parseFloat(p.Precio_Venta_Actual) || 0,
        precioAnterior: parseFloat(p.Precio_Anterior) || 0,
        ventaAnterior: parseFloat(p.Venta_Anterior) || 0,
        factorBulto: parseFloat(p.Factor_Bulto) || 1,
        factorCanastilla: parseFloat(p.Factor_Canastilla) || 1,
      }))
      .filter((p: any) => p.codigo.length > 0);
    for (const item of mapped) {
      await db.insert(schema.products).values(item)
        .onConflictDoUpdate({ target: schema.products.codigo, set: item });
    }
  });

  // 4. Pedidos
  await run("orders", raw.orders || [], async (chunk) => {
    const mapped = chunk.map((o: any, idx: number) => ({
      idPedido: String(o.ID_Pedido || `PED_${idx}`).trim(),
      fecha: String(o.Fecha || "").trim(),
      sucursal: String(o.Sucursal || "").trim(),
      codigo: String(o.Codigo || "").trim(),
      producto: String(o.Producto || "").trim(),
      medida: String(o.Medida || "Kg").trim(),
      cantidad: String(o.Cantidad ?? "0").trim(),
      notas: String(o.Notas || "").trim(),
      precioAnterior: parseFloat(o.Precio_Anterior) || 0,
      porcentajeGanancia: parseFloat(o.Porcentaje_Ganancia) || 0,
      cantidadComprada: parseFloat(o.Cantidad_Comprada) || 0,
      costoMomento: parseFloat(o.Costo_Momento) || 0,
      precioVentaMomento: parseFloat(o.Precio_Venta_Momento) || 0,
      kilos: parseFloat(o.Kilos) || 0,
      estado: String(o.Estado || "Pendiente").trim(),
      estadoPago: String(o.Estado_Pago || "Pendiente").trim(),
      proveedor: String(o.Proveedor || "").trim(),
      celular: String(o.Celular || "").trim(),
    }));
    await db.insert(schema.orders).values(mapped);
  });

  // 5. Cierres de caja
  await run("closures", raw.closures || [], async (chunk) => {
    const mapped = chunk.map((c: any) => ({
      fecha: String(c.Fecha || "").trim(),
      sucursal: String(c.Sucursal || "").trim(),
      ventasTotales: parseFloat(c.Ventas_Totales) || 0,
      gastosExtra: parseFloat(c.Gastos_Extra) || 0,
      descripcionGastos: String(c.Descripcion_Gastos || "").trim(),
      personaRecogio: String(c.Persona_Recogio || "").trim(),
      recaudadoFisico: Boolean(c.Recaudado_Fisico),
      fotoFactura: String(c.Foto_Factura || "").trim(),
      montoRecaudado: parseFloat(c.Monto_Recaudado) || 0,
    }));
    await db.insert(schema.closures).values(mapped);
  });

  // 6. Transacciones de billetera
  await run("walletTransactions", raw.walletTransactions || [], async (chunk) => {
    const mapped = chunk.map((w: any) => ({
      fecha: String(w.Fecha || "").trim(),
      sucursal: String(w.Sucursal || "").trim(),
      tipoMovimiento: String(w.Tipo_Movimiento || "Gasto").trim(),
      valor: parseFloat(w.Valor) || 0,
      descripcion: String(w.Descripcion || "").trim(),
      responsable: String(w.Responsable || "").trim(),
      estado: String(w.Estado || "Pendiente").trim(),
      fotoFactura: String(w.Foto_Factura || "").trim(),
    }));
    await db.insert(schema.walletTransactions).values(mapped);
  });

  // 7. Mermas
  await run("shrinkages", raw.shrinkages || [], async (chunk) => {
    const mapped = chunk.map((s: any) => ({
      fecha: String(s.Fecha || "").trim(),
      sucursal: String(s.Sucursal || "").trim(),
      codigo: String(s.Codigo || "").trim(),
      producto: String(s.Producto || "").trim(),
      cantidad: String(s.Cantidad ?? "0").trim(),
      unidad: String(s.Unidad || "Kg").trim(),
      motivo: String(s.Motivo || "").trim(),
      costoProveedor: parseFloat(s.Costo_Proveedor) || 0,
      perdidaMonetaria: parseFloat(s.Perdida_Monetaria) || 0,
      foto: String(s.Foto || "").trim(),
    }));
    await db.insert(schema.shrinkages).values(mapped);
  });

  // 8. Movimientos de empaques
  await run("packagingMovements", raw.packagingMovements || [], async (chunk) => {
    const mapped = chunk.map((m: any, idx: number) => ({
      idMovimiento: String(m.ID_Movimiento || `MOV_${idx}`).trim(),
      fecha: String(m.Fecha || "").trim(),
      proveedor: String(m.Proveedor || "").trim(),
      tipoActivo: String(m.Tipo_Activo || "Canastilla").trim(),
      cantidadEntregada: parseInt(m.Cantidad_Entregada) || 0,
      cantidadDevuelta: parseInt(m.Cantidad_Devuelta) || 0,
      notas: String(m.Notas || "").trim(),
    }));
    await db.insert(schema.packagingMovements).values(mapped);
  });

  // 9. Horarios de empleados
  await run("employeeSchedules", raw.schedules || [], async (chunk) => {
    const mapped = chunk.map((s: any) => ({
      fecha: String(s.Fecha || "").trim(),
      empleado: String(s.Empleado || "").trim(),
      sucursal: String(s.Sucursal || "").trim(),
      horasTrabajadas: parseFloat(s.Horas_Trabajadas) || 0,
    }));
    await db.insert(schema.employeeSchedules).values(mapped);
  });

  // 10. Préstamos de empleados
  await run("employeeLoans", raw.loans || [], async (chunk) => {
    const mapped = chunk.map((l: any) => ({
      fecha: String(l.Fecha || "").trim(),
      empleado: String(l.Empleado || "").trim(),
      sucursal: String(l.Sucursal || "").trim(),
      monto: parseFloat(l.Monto) || 0,
      motivo: String(l.Motivo || "").trim(),
      estado: String(l.Estado || "Pendiente").trim(),
    }));
    await db.insert(schema.employeeLoans).values(mapped);
  });

  // 11. Tarifas de empleados
  await run("employeeRates", raw.rates || [], async (chunk) => {
    const mapped = chunk
      .map((r: any) => ({
        empleado: String(r.Empleado || "").trim(),
        valorDia: parseFloat(r.Valor_Dia) || 0,
        valorHora: parseFloat(r.Valor_Hora) || 0,
        auxilioTransporte: parseFloat(r.Auxilio_Transporte) || 0,
        celular: String(r.Celular || "").trim(),
        cedula: String(r.Cedula || "").trim(),
      }))
      .filter((r: any) => r.empleado.length > 0);
    for (const item of mapped) {
      await db.insert(schema.employeeRates).values(item)
        .onConflictDoUpdate({ target: schema.employeeRates.empleado, set: item });
    }
  });

  // 12. Nómina
  await run("payrollRecords", raw.payroll || [], async (chunk) => {
    const mapped = chunk.map((p: any) => ({
      fecha: String(p.Fecha || "").trim(),
      trabajador: String(p.Trabajador || "").trim(),
      sucursal: String(p.Sucursal || "").trim(),
      diasTrabajados: parseFloat(p.Dias_Trabajados) || 0,
      horasTrabajadas: parseFloat(p.Horas_Trabajadas) || 0,
      pagoBase: parseFloat(p.Pago_Base) || 0,
      pagoHoras: parseFloat(p.Pago_Horas) || 0,
      prestamosDescontados: parseFloat(p.Prestamos_Descontados) || 0,
      totalNeto: parseFloat(p.Total_Neto) || 0,
      estadoPago: String(p.Estado_Pago || "Pendiente").trim(),
    }));
    await db.insert(schema.payrollRecords).values(mapped);
  });

  // 13. Historial de precios
  await run("priceHistories", raw.priceHistory || [], async (chunk) => {
    const mapped = chunk.map((h: any) => ({
      fechaHora: String(h.Fecha_Hora || "").trim(),
      codigo: String(h.Codigo || "").trim(),
      producto: String(h.Producto || "").trim(),
      costoAnterior: parseFloat(h.Costo_Anterior) || 0,
      costoNuevo: parseFloat(h.Costo_Nuevo) || 0,
      ventaAnterior: parseFloat(h.Venta_Anterior) || 0,
      ventaNueva: parseFloat(h.Venta_Nueva) || 0,
      usuario: String(h.Usuario || "").trim(),
    }));
    await db.insert(schema.priceHistories).values(mapped);
  });

  // 14. Gastos Nequi
  await run("nequiExpenses", raw.nequiExpenses || [], async (chunk) => {
    const mapped = chunk.map((n: any) => ({
      fecha: String(n.Fecha || "").trim(),
      sucursal: String(n.Sucursal || "").trim(),
      valorGasto: parseFloat(n.Valor_Gasto) || 0,
      descripcionGasto: String(n.Descripcion_Gasto || "").trim(),
      responsable: String(n.Responsable || "").trim(),
      reconciliadoFisico: Boolean(n.Reconciliado_Fisico),
    }));
    await db.insert(schema.nequiExpenses).values(mapped);
  });

  // 15. Logs de sincronización
  await run("syncLogs", raw.syncLogs || [], async (chunk) => {
    const mapped = chunk.map((l: any) => ({
      timestamp: l.timestamp ? new Date(l.timestamp) : new Date(),
      service: String(l.service || "Firebase").trim(),
      action: String(l.action || "").trim(),
      status: String(l.status || "success").trim(),
      details: String(l.details || "").trim(),
      itemsCount: parseInt(l.itemsCount) || 0,
      durationMs: parseInt(l.durationMs) || 0,
    }));
    await db.insert(schema.syncLogs).values(mapped);
  });

  // 16. Configuración por sucursal (objeto keyed por nombre de sucursal, no un array)
  const branchConfigsArr = Object.entries(raw.branchConfigs || {}).map(([sucursal, cfg]: [string, any]) => ({
    sucursal,
    baseCaja: parseFloat(cfg.baseCaja) || 0,
    recolectorPredeterminado: String(cfg.recolectorPredeterminado || "").trim(),
    montoAlerta: parseFloat(cfg.montoAlerta) || 0,
  }));
  await run("branchConfigs", branchConfigsArr, async (chunk) => {
    for (const item of chunk) {
      await db.insert(schema.branchConfigs).values(item)
        .onConflictDoUpdate({ target: schema.branchConfigs.sucursal, set: item });
    }
  });

  console.log("\n=================================================================");
  console.log("🎉 MIGRACIÓN COMPLETADA");
  console.log("=================================================================");
  console.table(
    Object.entries(report).map(([entidad, r]) => ({ Entidad: entidad, "En JSON": r.total, "Migrados a Postgres": r.inserted }))
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ ERROR DURANTE LA MIGRACIÓN:", err);
  process.exit(1);
});
