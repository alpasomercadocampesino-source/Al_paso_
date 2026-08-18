export type UserRole = "Admin" | "Comprador" | "Sucursal";

export interface User {
  Usuario: string;
  Rol: UserRole;
  Contraseña?: string;
}

export interface Product {
  Codigo: string;
  Producto: string;
  Medida: string;
  Merma: number;
  Utilidad: number;
  Proveedor: string;
  Celular: string;
  Costo_Proveedor: number;
  Precio_Venta_Actual: number;
  Precio_Anterior: number;
  Venta_Anterior: number;
  Factor_Bulto: number;
  Factor_Canastilla: number;
}

export interface Provider {
  Proveedor: string;
  Celular: string;
}

export interface Order {
  ID_Pedido: string;
  Fecha: string;
  Sucursal: string;
  Codigo: string;
  Producto: string;
  Medida: string;
  Cantidad: string;
  Notas: string;
  Precio_Anterior: number;
  Porcentaje_Ganancia: number;
  Cantidad_Comprada: number;
  Costo_Momento: number;
  Precio_Venta_Momento: number;
  Kilos: number;
  Estado: "Pendiente" | "Comprado" | "Cancelado";
  Estado_Pago: "Pendiente" | "Pagado";
  Proveedor: string;
  Celular: string;
}

export interface DailyClosure {
  Fecha: string;
  Sucursal: string;
  Ventas_Totales: number;
  Gastos_Extra: number;
  Descripcion_Gastos: string;
  Persona_Recogio: string;
  Recaudado_Fisico: boolean;
  Foto_Factura?: string;
  Monto_Recaudado?: number;
}

export interface WalletTransaction {
  Fecha: string;
  Sucursal: string;
  Tipo_Movimiento: "Ingreso" | "Gasto";
  Valor: number;
  Descripcion: string;
  Responsable: string;
  Estado: "Pendiente" | "Reconciliado";
  Foto_Factura?: string;
}

export interface Shrinkage {
  Fecha: string;
  Sucursal: string;
  Codigo: string;
  Producto: string;
  Cantidad: string;
  Unidad?: string;
  Motivo: string;
  Costo_Proveedor: number;
  Perdida_Monetaria: number;
  Foto?: string;
}

export interface PackagingMovement {
  ID_Movimiento: string;
  Fecha: string;
  Proveedor: string;
  Tipo_Activo: "Canastilla" | "Estiva";
  Cantidad_Entregada: number;
  Cantidad_Devuelta: number;
  Notas: string;
}

export interface EmployeeSchedule {
  Fecha: string;
  Empleado: string;
  Sucursal: string;
  Horas_Trabajadas: number;
}

export interface EmployeeLoan {
  Fecha: string;
  Empleado: string;
  Sucursal: string;
  Monto: number;
  Motivo: string;
  Estado: "Pendiente" | "Descontado";
}

export interface EmployeeRate {
  Empleado: string;
  Valor_Dia: number;
  Valor_Hora: number;
  Auxilio_Transporte?: number;
  Celular?: string;
  Cedula?: string;
}

export interface PayrollRecord {
  Fecha: string;
  Trabajador: string;
  Sucursal: string;
  Dias_Trabajados: number;
  Horas_Trabajadas: number;
  Pago_Base: number;
  Pago_Horas: number;
  Prestamos_Descontados: number;
  Total_Neto: number;
  Estado_Pago: "Pendiente" | "Pagado";
}

export interface PriceHistory {
  Fecha_Hora: string;
  Codigo: string;
  Producto: string;
  Costo_Anterior: number;
  Costo_Nuevo: number;
  Venta_Anterior: number;
  Venta_Nueva: number;
  Usuario: string;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  service: "Firebase";
  action: string;
  status: "success" | "error" | "warning";
  details: string;
  itemsCount?: number;
  durationMs?: number;
}
