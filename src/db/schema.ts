import { pgTable, serial, text, timestamp, integer, doublePrecision, boolean, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Tabla de usuarios (autenticación propia usuario/contraseña con hash bcrypt)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  usuario: text("usuario").notNull().unique(),
  contrasena: text("contrasena").notNull(), // hash bcrypt
  rol: text("rol").default("Sucursal"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}).enableRLS();

// Tabla de Productos
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  codigo: text("codigo").notNull().unique(),
  producto: text("producto").notNull(),
  medida: text("medida").default("Kg"),
  merma: doublePrecision("merma").default(0),
  utilidad: doublePrecision("utilidad").default(0),
  proveedor: text("proveedor").default(""),
  celular: text("celular").default(""),
  costoProveedor: doublePrecision("costo_proveedor").default(0),
  precioVentaActual: doublePrecision("precio_venta_actual").default(0),
  precioAnterior: doublePrecision("precio_anterior").default(0),
  ventaAnterior: doublePrecision("venta_anterior").default(0),
  factorBulto: doublePrecision("factor_bulto").default(1),
  factorCanastilla: doublePrecision("factor_canastilla").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("products_proveedor_idx").on(table.proveedor),
]).enableRLS();

// Tabla de Proveedores
export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  proveedor: text("proveedor").notNull().unique(),
  celular: text("celular").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}).enableRLS();

// Tabla de Pedidos / Órdenes
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  idPedido: text("id_pedido").notNull(),
  fecha: text("fecha").notNull(),
  sucursal: text("sucursal").notNull(),
  codigo: text("codigo").notNull(),
  producto: text("producto").notNull(),
  medida: text("medida").default("Kg"),
  cantidad: text("cantidad").default("0"),
  notas: text("notas").default(""),
  precioAnterior: doublePrecision("precio_anterior").default(0),
  porcentajeGanancia: doublePrecision("porcentaje_ganancia").default(0),
  cantidadComprada: doublePrecision("cantidad_comprada").default(0),
  costoMomento: doublePrecision("costo_momento").default(0),
  precioVentaMomento: doublePrecision("precio_venta_momento").default(0),
  kilos: doublePrecision("kilos").default(0),
  estado: text("estado").default("Pendiente"),
  estadoPago: text("estado_pago").default("Pendiente"),
  proveedor: text("proveedor").default(""),
  celular: text("celular").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("orders_codigo_idx").on(table.codigo),
  index("orders_proveedor_idx").on(table.proveedor),
  index("orders_fecha_idx").on(table.fecha),
  index("orders_sucursal_idx").on(table.sucursal),
]).enableRLS();

// Tabla de Cierres Diarios
export const closures = pgTable("closures", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  idCierre: text("id_cierre").notNull().unique(),
  fecha: text("fecha").notNull(),
  sucursal: text("sucursal").notNull(),
  ventasTotales: doublePrecision("ventas_totales").default(0),
  gastosExtra: doublePrecision("gastos_extra").default(0),
  descripcionGastos: text("descripcion_gastos").default(""),
  personaRecogio: text("persona_recogio").default(""),
  recaudadoFisico: boolean("recaudado_fisico").default(false),
  fotoFactura: text("foto_factura").default(""),
  montoRecaudado: doublePrecision("monto_recaudado").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("closures_fecha_idx").on(table.fecha),
  index("closures_sucursal_idx").on(table.sucursal),
]).enableRLS();

// Tabla de Transacciones de Billetera
export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  idTransaccion: text("id_transaccion").notNull().unique(),
  fecha: text("fecha").notNull(),
  sucursal: text("sucursal").notNull(),
  tipoMovimiento: text("tipo_movimiento").notNull(),
  valor: doublePrecision("valor").default(0),
  descripcion: text("descripcion").default(""),
  responsable: text("responsable").default(""),
  estado: text("estado").default("Pendiente"),
  fotoFactura: text("foto_factura").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("wallet_transactions_fecha_idx").on(table.fecha),
  index("wallet_transactions_sucursal_idx").on(table.sucursal),
]).enableRLS();

// Tabla de Mermas
export const shrinkages = pgTable("shrinkages", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  fecha: text("fecha").notNull(),
  sucursal: text("sucursal").notNull(),
  codigo: text("codigo").notNull(),
  producto: text("producto").notNull(),
  cantidad: text("cantidad").default("0"),
  unidad: text("unidad").default("Kg"),
  motivo: text("motivo").default(""),
  costoProveedor: doublePrecision("costo_proveedor").default(0),
  perdidaMonetaria: doublePrecision("perdida_monetaria").default(0),
  foto: text("foto").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("shrinkages_codigo_idx").on(table.codigo),
]).enableRLS();

// Tabla de Empaques / Movimientos
export const packagingMovements = pgTable("packaging_movements", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  idMovimiento: text("id_movimiento").notNull(),
  fecha: text("fecha").notNull(),
  proveedor: text("proveedor").notNull(),
  tipoActivo: text("tipo_activo").notNull(),
  cantidadEntregada: integer("cantidad_entregada").default(0),
  cantidadDevuelta: integer("cantidad_devuelta").default(0),
  notas: text("notas").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("packaging_movements_proveedor_idx").on(table.proveedor),
]).enableRLS();

// Tabla de Horarios de Empleados
export const employeeSchedules = pgTable("employee_schedules", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  fecha: text("fecha").notNull(),
  empleado: text("empleado").notNull(),
  sucursal: text("sucursal").notNull(),
  horasTrabajadas: doublePrecision("horas_trabajadas").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("employee_schedules_empleado_idx").on(table.empleado),
]).enableRLS();

// Tabla de Préstamos
export const employeeLoans = pgTable("employee_loans", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  fecha: text("fecha").notNull(),
  empleado: text("empleado").notNull(),
  sucursal: text("sucursal").notNull(),
  monto: doublePrecision("monto").default(0),
  motivo: text("motivo").default(""),
  estado: text("estado").default("Pendiente"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("employee_loans_empleado_idx").on(table.empleado),
]).enableRLS();

// Tabla de Tarifas / Tasas de Empleados
export const employeeRates = pgTable("employee_rates", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  empleado: text("empleado").notNull().unique(),
  valorDia: doublePrecision("valor_dia").default(0),
  valorHora: doublePrecision("valor_hora").default(0),
  auxilioTransporte: doublePrecision("auxilio_transporte").default(0),
  celular: text("celular").default(""),
  cedula: text("cedula").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}).enableRLS();

// Tabla de Registros de Nómina
export const payrollRecords = pgTable("payroll_records", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  fecha: text("fecha").notNull(),
  trabajador: text("trabajador").notNull(),
  sucursal: text("sucursal").notNull(),
  diasTrabajados: doublePrecision("dias_trabajados").default(0),
  horasTrabajadas: doublePrecision("horas_trabajadas").default(0),
  pagoBase: doublePrecision("pago_base").default(0),
  pagoHoras: doublePrecision("pago_horas").default(0),
  prestamosDescontados: doublePrecision("prestamos_descontados").default(0),
  totalNeto: doublePrecision("total_neto").default(0),
  estadoPago: text("estado_pago").default("Pendiente"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("payroll_records_trabajador_idx").on(table.trabajador),
]).enableRLS();

// Tabla de Historial de Precios
export const priceHistories = pgTable("price_histories", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  fechaHora: text("fecha_hora").notNull(),
  codigo: text("codigo").notNull(),
  producto: text("producto").notNull(),
  costoAnterior: doublePrecision("costo_anterior").default(0),
  costoNuevo: doublePrecision("costo_nuevo").default(0),
  ventaAnterior: doublePrecision("venta_anterior").default(0),
  ventaNueva: doublePrecision("venta_nueva").default(0),
  usuario: text("usuario").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("price_histories_codigo_idx").on(table.codigo),
]).enableRLS();

// Tabla de Gastos Nequi (reconciliación de caja)
export const nequiExpenses = pgTable("nequi_expenses", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  idGasto: text("id_gasto").notNull().unique(),
  fecha: text("fecha").notNull(),
  sucursal: text("sucursal").notNull(),
  valorGasto: doublePrecision("valor_gasto").default(0),
  descripcionGasto: text("descripcion_gasto").default(""),
  responsable: text("responsable").default(""),
  reconciliadoFisico: boolean("reconciliado_fisico").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}).enableRLS();

// Tabla de Logs de Sincronización
export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  timestamp: timestamp("timestamp").defaultNow(),
  service: text("service").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  details: text("details").default(""),
  itemsCount: integer("items_count").default(0),
  durationMs: integer("duration_ms").default(0),
}).enableRLS();

// Tabla de Configuración por Sucursal
export const branchConfigs = pgTable("branch_configs", {
  id: serial("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  sucursal: text("sucursal").notNull().unique(),
  baseCaja: doublePrecision("base_caja").default(0),
  recolectorPredeterminado: text("recolector_predeterminado").default(""),
  montoAlerta: doublePrecision("monto_alerta").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}).enableRLS();

// Relaciones entre entidades
export const usersRelations = relations(users, () => ({}));

export const productsRelations = relations(products, ({ one, many }) => ({
  provider: one(providers, {
    fields: [products.proveedor],
    references: [providers.proveedor],
  }),
  orders: many(orders),
  shrinkages: many(shrinkages),
  priceHistories: many(priceHistories),
}));

export const providersRelations = relations(providers, ({ many }) => ({
  products: many(products),
  orders: many(orders),
  packagingMovements: many(packagingMovements),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  product: one(products, {
    fields: [orders.codigo],
    references: [products.codigo],
  }),
  provider: one(providers, {
    fields: [orders.proveedor],
    references: [providers.proveedor],
  }),
}));

export const closuresRelations = relations(closures, () => ({}));

export const walletTransactionsRelations = relations(walletTransactions, () => ({}));

export const shrinkagesRelations = relations(shrinkages, ({ one }) => ({
  product: one(products, {
    fields: [shrinkages.codigo],
    references: [products.codigo],
  }),
}));

export const packagingMovementsRelations = relations(packagingMovements, ({ one }) => ({
  provider: one(providers, {
    fields: [packagingMovements.proveedor],
    references: [providers.proveedor],
  }),
}));

export const employeeRatesRelations = relations(employeeRates, ({ many }) => ({
  schedules: many(employeeSchedules),
  loans: many(employeeLoans),
  payrollRecords: many(payrollRecords),
}));

export const employeeSchedulesRelations = relations(employeeSchedules, ({ one }) => ({
  employeeRate: one(employeeRates, {
    fields: [employeeSchedules.empleado],
    references: [employeeRates.empleado],
  }),
}));

export const employeeLoansRelations = relations(employeeLoans, ({ one }) => ({
  employeeRate: one(employeeRates, {
    fields: [employeeLoans.empleado],
    references: [employeeRates.empleado],
  }),
}));

export const payrollRecordsRelations = relations(payrollRecords, ({ one }) => ({
  employeeRate: one(employeeRates, {
    fields: [payrollRecords.trabajador],
    references: [employeeRates.empleado],
  }),
}));

export const priceHistoriesRelations = relations(priceHistories, ({ one }) => ({
  product: one(products, {
    fields: [priceHistories.codigo],
    references: [products.codigo],
  }),
}));
