import fs from "fs";
import path from "path";
import { db as pgDb } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";

export interface User {
  Usuario: string;
  Contraseña?: string;
  Rol: "Admin" | "Comprador" | "Sucursal";
}

export interface Product {
  Codigo: string;
  Producto: string;
  Medida: string;
  Merma: number; // Decimal (e.g. 0.05 for 5%)
  Utilidad: number; // Decimal (e.g. 0.3 for 30%)
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
  Fecha: string; // YYYY-MM-DD
  Sucursal: string; // Tibasosa, Nobsa, Fira, Aquitania, Hansel
  Codigo: string;
  Producto: string;
  Medida: string;
  Cantidad: string; // "1/2", "3", etc.
  Notas: string;
  Precio_Anterior: number; // Price when ordered
  Porcentaje_Ganancia: number; // Profit margin when ordered
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
  Recaudado_Fisico: boolean; // Managed by Comprador/Admin
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
  Cantidad_Entregada: number; // Entran
  Cantidad_Devuelta: number;  // Salen
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
  Fecha: string; // Closing date
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

export interface NequiExpense {
  Fecha: string;
  Sucursal: string;
  Valor_Gasto: number;
  Descripcion_Gasto: string;
  Responsable: string;
  Reconciliado_Fisico: boolean;
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

export interface BranchConfig {
  baseCaja: number;
  recolectorPredeterminado: string;
  montoAlerta: number;
}

export interface DatabaseSchema {
  users: User[];
  products: Product[];
  providers: Provider[];
  orders: Order[];
  closures: DailyClosure[];
  walletTransactions: WalletTransaction[];
  shrinkages: Shrinkage[];
  packagingMovements: PackagingMovement[];
  schedules: EmployeeSchedule[];
  loans: EmployeeLoan[];
  rates: EmployeeRate[];
  payroll: PayrollRecord[];
  priceHistory: PriceHistory[];
  nequiExpenses: NequiExpense[];
  syncLogs?: SyncLog[];
  branchConfigs?: { [branch: string]: BranchConfig };
}

export function recordSyncLog(
  localDb: DatabaseSchema,
  service: "Firebase",
  action: string,
  status: "success" | "error" | "warning",
  details: string,
  itemsCount?: number,
  durationMs?: number
): SyncLog {
  if (!localDb) return {} as SyncLog;
  if (!localDb.syncLogs) localDb.syncLogs = [];

  const log: SyncLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    service,
    action,
    status,
    details,
    itemsCount,
    durationMs
  };

  localDb.syncLogs.unshift(log);
  if (localDb.syncLogs.length > 200) {
    localDb.syncLogs = localDb.syncLogs.slice(0, 200);
  }
  return log;
}

const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "db.json");

// Raw Product seed derived from the PRODUCT_CSV in app.py
const PRODUCT_SEED_RAW = `A16;P;Agraz;1;-;1,40;LIGIA;3124341693
A13;P;Agua Haz;1;-;1,50;FREDY;3107704105
za13;P;Agua Hazz Pj;1;-;1,7;FREDY;0
A12;P;Agua pap;1;-;1,50;FREDY;3107704105
ZA12;P;Agua pap 2da;1;-;1,50;FREDY;3107704105
A03;P;Ahuya Ama;1;-;1,50;ALIRIO;3112429812
A06;P;Ahuya Cale;30;-;1,50;JAIRO;3163796473
A04;P;Ahuyamin;48;;1,50;GERMAN;3208370402
A15;P;Aji Grande;1;;1,40;JOHANA;3164779790
A37;P;Aji Mediano;1;;1,50;JOHANA;3164779790
A14;P;Aji peque;1;;1,40;JOHANA;3164779790
A05;P;Ajo atado;10;-;1,30;VIVIANA;3212152429
ZA28;P;Ajo Impo Und;1;-;1,30;VIVIANA;3212152429
A28;P;Ajo Impo;9;;1,40;ELIZA;3107858686
A02;P;Ajo pelado;1;0;1,30;VIVIANA;3212152429
A08;P;Apio Rama;1,5;0,5;1,40;NELCY;3107858686
A32;p;Arandano 1/4;1;-;1,40;;3124341693
A07;P;Aromatica;1;0;1,30;ARO;3108689653
ZA07;P;Aromatica Surtida;1;0;1,30;ARO;3108689653
A10;P;Arracacha;56;6;1,30;ESTEBAN;3208038630
ZA10;P;Arracacha PJ;56;6;1,30;ESTEBAN;3208038630
A09;P;Arveja;48;2;1,30;JESUS;3114561646
B02;P;Banano Boc;1;;1,40;ELIZA;0
B01;P;Banano Criollo;1;;1,40;MANUEL;0
B12;P;Banano Urab;18;1;1,35;ROBIN;3107858686
B13;P;Berenjena;1;;1,50;ELIZA;3107858686
B03;P;Borojo;5;;1,50;ELIZA;3107858686
C02;P;Calabacin;20;3;1,30;ESTEBAN;0
C01;P;Calabaza;14;2;1,30;ESTEBAN;0
C23;P;Carambolo;1;;1,44;ELIZA;0
C04;P;Cebolla B;48;5;1,30;MARTHA;3204088890
c06;P;Cebolla L sin rama;30;5;1,30;;0
C07;P;Cebolla Larg;30;4;1,30;EVELIO;3106780494
ZC04;P;Cebolla pj;48;4;1,30;MARTHA;3204088890
C05;P;Cebolla Roja;48;4;1,30;MERY;3204088890
ZC05;P;Cebolla Roja pl;48;4;1,50;MERY;3204088890
C19;P;Champiñon;1;;1,40;ELIZA;0
C18;P;Champiñon 250G;1;;1,40;ELIZA;0
C10;P;Ciruela;22;2;1,40;PEDRO;3107858686
ZC10;P;Ciruela pj;1;;1,50;PEDRO;3107858686
C11;P;Coco;1;;1,40;JAIRO;3107858686
C13;P;Curuba;22;2;1,45;ALIRIO;3142982541
zc13;P;Curuba Pj;23;3;1,6;ALIRIO;0
D01;P;Durazno Co;30;3;1,30;PEDRO;3142982541
ZD01;P;Durazno pj;30;3;1,50;PEDRO;3142982541
D03;P;Durazno Rey;20;3;1,30;PEDRO;3142982541
ZD02;P;Durazno 2da;1;;1,30;PEDRO;3214758946
F01;P;Feijoa;22;2;1,40;PEDRO;3142982541
zf01;P;Feijoa Pj;21;3;1,6;PEDRO;0
ZF03;P;Fresa G. Paq;15;1;1,35;EFRAIN;3124341693
ZF02;P;Fresa Par. Paq;7;2;1,35;EFRAIN;3124341693
F04;P;Frijol;48;4;1,35;EMILIO;3208038630
G01;P;Granadilla;10;1;1,45;ELIZA;3107858686
ZG01;P;Granadilla Pj;10;1;1,45;ELIZA;3107858686
G02;P;Guanabana;1;;1,40;JAIRO;3115541966
G04;P;Guatila;1;;1,50;ELIZA;3107858686
G05;P;Guayaba;22;2;1,40;JAIRO;3107858686
ZG05;P;Guayaba Pj;22;2;1,50;JAIRO;3107858686
H01;P;Haba;48;8;1,40;MARTHA;3158829104
H02;P;Habichuela;24;2;1,35;JAIRO;3208370402
H03;P;Higos;25;1;1,40;EDUARDO;0
H04;P;Huevo codornis;1;;1,50;LIGIA;0
J01;P;Jengibre;1;;1,50;ELIZA;3107858686
K01;P;Kiwi;1;;1,40;ELIZA;3107858686
T08;P;Laurel y Tomillo;1;;1,50;ARO;0
L02;P;Limon Mand;48;4;1,50;JOHANA;3112094382
L03;P;Limon Tahiti;22;2;1,40;GERMAN;3163796473
ZL03;P;Limon Tahiti Pj;22;2;1,40;GERMAN;3163796473
L04;P;Lulo Grueso;22;2;1,35;ESTEBAN;3107858686
ZL04;P;Lulo pj;22;2;1,45;ESTEBAN;3107858686
M03;P;Mandarina A;23;2;1,35;GERMAN;3163796473
M02;P;Mandarina Li;22;2;1,35;JAIRO;3163796473
zm02;P;Mandarina pj;22;2;1,50;;0
M04;P;Mang Azucar;24;3;1,40;;3213380848
zm04;P;Mango Az pj;22;3;1,5;;0
M05;P;Mango Comun;32;;1,30;;3213380848
ZM07;P;Mango Yulima pj;24;2;1,35;;0
M06;P;Mango Tom;24;2;1,35;;3213380848
ZM06;P;Mango Tom PJ;24;2;1,35;;3213380848
M07;P;Mango Yulima;24;2;1,40;ROBIN;3114607396
M56;P;Manz Roja 125;113;5;1,32;ELIZA;0
M10;P;Manz Royal 150;150;8;1,32;ELIZA;3107858686
M08;P;Manz Royal 198 bj;198;10;8,50;ELIZA;3107858686
M15;P;Manz Ver 150;150;8;1,30;ELIZA;3107858686
ZM15;P;Manz Verde 198 bj;198;10;8,50;ELIZA;3107858686
M14;P;Manzana Ana;18;2;1,40;PEDRO;3142982541
zm14;P;Manzana Ana Pj;18;2;1,6;PEDRO;0
M16;P;Maracuya;9;1;1,30;PABLO;3107858686
zm16;P;Maracuya Pj;9;1;1,6;PABLO;0
B10;P;Mazorc preco;1;;1,40;SANDY;3214758946
B09;P;Mazorca Ban;1;;1,35;SANDY;3214758946
ZB09;P;Mazorca und;1;;1,45;SANDY;0
M20;P;Melon Canast;20;3;1,30;GERMAN;3107858686
zm20;P;Melon Guacal;8;1;1,35;ELIZA;0
M21;P;Mora;10;1;1,30;EFRAIN;3204957731
ZM21;P;Mora Pq;10;1;1,30;EFRAIN;3204957731
M23;P;Mute;1;;1,40;SANDY;0
N01;P;Nabos;48;;1,40;MARTHA;0
ZN03;P;Nar Tang Par;23;2;1,50;GERMAN;3163796473
N03;P;Nar Tange Gr;23;2;1,30;GERMAN;3163796473
N04;P;Nara Val Gru;20;4;1,30;LIGIA;3107858686
ZN04;P;Nara Val pj;20;4;1,30;LIGIA;3107858686
P01;P;P Criolla gr;48;2;1,30;GUALALI;3144637314
ZP01;P;P Criolla Pj;48;2;1,50;GUALALI;3144637314
P03;P;Papa Pastusa Gr;48;5;1,30;ADRIAN;3115895741
ZP03;P;Papa Pastusa Pj;48;5;1,50;ADRIAN;3115895741
P06;P;papaya;18;4;1,35;ROBIN;3202313124
p15;P;Papaya encrd;10;1;1,35;ELIZA;0
zp06;P;Papaya Pj;18;3;1,6;ROBIN;0
P07;P;Papayuela;1;;1,30;;0
P08;P;patilla;1;;1,30;GERMAN;0
p18;P;patilla baby;1;;1,45;GERMAN;0
P10;P;Pepino Coho;24;4;1,40;GERMAN;3163796473
P11;P;Pepino Guiso;11;2;1,40;ESTEBAN;0
ZP11;P;Pepino Guiso PJ;11;2;1,40;ESTEBAN;0
P13;P;Pera Chilena;110;10;1,35;ELIZA;3107858686
P14;P;Pera Nacion;22;3;1,40;PEDRO;0
ZP14;P;Pera nacion pj;22;3;1,50;PEDRO;0
P16;P;Pimenton;12;1;1,45;JAIRO;3112225857
ZP16;P;Pimenton Pj;12;1;1,70;ROBIN;3112225857
P04;P;Piña Miel;1;;1,40;GERMAN;3107618612
zp04;P;Piña Pj;1;-;1,6;GERMAN;0
P05;P;Piña sin rama;;;;;0
P17;P;Pitaya;1;;1,40;ELIZA;3107858686
zp17;P;Pitaya pj;1;-;1,4;ELIZA;0
P20;P;Plata Mad Gr;20;2;1,40;PABLO;3123783263
P23;P;Plata parejo;20;2;1,40;PABLO;3123783263
ZP23;P;Plata pica;20;2;1,40;PABLO;3123783263
P22;P;Plata verd Gr;20;2;1,35;PABLO;3123783263
P19;P;Platano Coli;10;;1,30;JOHANA;0
R01;P;Rabanos;1;;1,40;NELCY;0
R03;P;Raices Chinas;1;;1,40;ROBIN;0
R04;P;Remolacha;48;8;1,40;MARTHA;3158829104
ZR04;P;Remolacha pj;48;8;1,40;MARTHA;3158829104
R05;P;Repollo;50;8;1,45;NELCY;3115890641
R07;P;Repollo Morado;50;8;1,45;NELCY;0
R02;P;Rubas;48;8;1,40;MARTHA;0
s01;P;sabila;1;;1,45;;0
A19;P;Sobre Adobo;1;;1,30;adobos;0
A20;P;Sobre Ajo pasta;1;;1,30;adobos;0
A21;P;Sobre Miel;1;-;1,30;adobos;0
T06;P;Tomat Chonto;21;2;1,35;SNEIDER;3112225857
ZT06;P;Tomat Cherry;1;2;1,35;LIGIA;3112225857
T02;P;Tomate A. co Gr;22;2;1,35;ESTEBAN;3208038630
ZT02;P;Tomate A. Co Pj;22;2;1,50;ESTEBAN;3208038630
T03;P;Tomate A. Poll Gr;22;2;1,35;ESTEBAN;3208038630
ZT03;P;Tomate A. Poll Pj;22;2;1,50;ESTEBAN;3208038630
T10;P;Tomate Pare;21;3;1,50;SNEIDER;3112225857
T07;P;Tomate RIO;21;2;1,35;ROBIN;3112225857
T04;P;Tomate Semi;21;3;1,40;SNEIDER;0
U01;P;Uchuvas;1;;1,50;LIGIA;3124341693
U05;P;Uva bande;16;1;1,35;ELIZA;3107858686
U09;P;Uva Chilena;1;;1,4;ELIZA;0
U03;P;Uva Isabella;25;2;1,35;ELIZA;3107858686
U08;P;Uva red Glove icopor;1;;;GRANOS;0
Y01;P;Yuca;30;8;1,35;PABLO;3123783263
zy01;P;Yuca Pj;;;1,5;PABLO;0
Z01;P;Zanahoria;50;5;1,35;MARCIAL;3158829104
ZZ01;P;Zanahoria Pj;50;5;1,5;MARCIAL;0
Z03;P;Zumo Limon G;1;;1,40;adobos;0
Z04;P;Zumo Limon P;24;;1,40;adobos;0
zz07;P;Zuquini Amar;1;-;1,45;EMILIO;0
z06;P;Zuquini Verd;1;;1,45;EMILIO;3107858686
E003;E;BANDEJA I PEQUEÑA;1;;;ZZ BOLSAS D;0
E001;E;BANDEJA I. ALARGD 17;1;;;ZZ BOLSAS D;0
E002;E;BANDEJA I. ONDA 3 -1;1;;;ZZ BOLSAS D;0
E004;E;BOLSA BASURA;1;;;ZZ BOLSAS D;0
E005;E;BOLSA KILO 2 1/2 X 16;1;;;ZZ BOLSAS D;0
E006;E;BOLSA KILO 5 X 16;1;;;ZZ BOLSAS D;0
E007;E;BOLSA KILO 6 X 16;1;;;ZZ BOLSAS D;0
E008;E;BOLSA KILO 6 X 16 P;1;;;ZZ BOLSAS D;0
E009;E;BOLSA KILO 7 X 16 P;1;;;ZZ BOLSAS D;0
E010;E;BOLSA KILO 9 X 16 P;1;;;ZZ BOLSAS D;0
E011;E;BOLSA KILO/2 TRANS;1;;;ZZ BOLSAS D;0
E012;E;BOLSA ZIPLOC LIBRA;1;;;ZZ BOLSAS D;0
E013;E;GUANTES;1;;;ZZ BOLSAS D;0
E014;E;MALLA AMARILLA;1;;;ZZ BOLSAS D;0
E015;E;MALLA BLANCA;1;;;ZZ BOLSAS D;0
E016;E;MALLA ROJA;1;;;ZZ BOLSAS D;0
E017;E;MILLAR BOLSA 3 KL;1;;;ZZ BOLSAS D;0
E018;E;MILLAR BOLSA 10 KL;1;;;ZZ BOLSAS D;0
E019;E;MILLAR BOLSA 25 KL;1;;;ZZ BOLSAS D;0
E020;E;PRECORTE;1;;;ZZ BOLSAS D;0
E021;E;PRECORTE 10 X 16;1;;;ZZ BOLSAS D;0
E022;E;VINIPEL;1;;;ZZ BOLSAS D;0
GA06;G;Aceite 1000;1;;;IDEAL;0
GA07;G;Aceite 250;1;;;IDEAL;0
GA08;g;Aceite 110;1;;;IDEAL;0
GA10;G;Aceite 500;1;;;IDEAL;0
GA02;G;Arroz 1000 gr;1;;;ZZ GRANOS;0
GA03;G;Arroz 3000 gr;1;;;ZZ GRANOS;0
Ga01;G;Arroz 500 gr;1;;;ZZ GRANOS;0
GA09;G;Arveja 500 gr;1;;;ZZ GRANOS;0
GA11;G;Avena Hojuelas 500 gr;1;;;ZZ GRANOS;0
GA04;G;Azuca blanca 500 gr;1;;;ZZ GRANOS;0
GA05;G;Azucar Morena 500 GR;1;;;ZZ GRANOS;0
GC07;G;Café 25O gr;;;;ZZ GRANOS;0
GC04;G;Café Labastilla 250 gr;1;;;ZZ GRANOS;0
M25;G;Carton adobos;1;;;ZZ GRANOS;0
GC21;G;Chocolate Corona 250 gr;1;;;ZZ GRANOS;0
GC05;G;Chocolate Corona 500 gr;1;;;ZZ GRANOS;0
GC03;G;Chocolate Corona pastilla;1;;;ZZ GRANOS;0
G008;G;colcafe 10 gr;1;;;ZZ GRANOS;0
C27;G;Caldos magui;1;;;ZZ GRANOS;0
GC06;G;Caldos ricostilla;1;;;ZZ GRANOS;0
GT02;G;Fideo doria 200 gr;1;;;ZZ GRANOS;0
GF04;G;Frijol 500 gr;1;;;ZZ GRANOS;0
GG01;G;Garbanzo 500 gr;1;;;ZZ GRANOS;0
GH02;G;Harina nieve 500;1;;;ZZ GRANOS;0
GH01;G;Harina de trigo;;;;ZZ GRANOS;0
G004;G;Harina Promasa;1;;;ZZ GRANOS;0
GM02;G;La fina 125 gr;1;;;ZZ GRANOS;0
GL01;G;Lentejas 500 gr;1;;;ZZ GRANOS;0
G007;G;margarina 125 gr;1;;;ZZ GRANOS;0
S11;G;Mayonesa Fruco;1;;;ZZ GRANOS;0
ZP34;G;Panelada;;;;ZZ GRANOS;0
GP02;G;Pasta nieve Spaguetti;;;;ZZ GRANOS;0
GP01;G;Pasta Nieve Fideo;1;;;ZZ GRANOS;0
GS05;G;SAL 1 Kg;1;;;ZZ GRANOS;0
GS02;G;Sal Refisal 500 gr;1;;;ZZ GRANOS;0
S34;G;Salsa Delika;1;;;ZZ GRANOS;0
S12;G;Salsa tomate fruco;1;;;ZZ GRANOS;0
A01;H;H Acelga;1;;1,50;NELCY;3133625349
C03;H;H Coliflor;1;;1,50;NELCY;3115890641
C09;H;H Cilantro;1;;1,50;NELCY;3133625349
E01;H;H Espinacas;1;;1,50;NELCY;3133625349
HB04;H;H Brocoli;1;;1,50;NELCY;3115890641
L06;H;H Lechuga B.;1;;1,50;NELCY;3133625349
L11;H;H Lechuga H.;1;;1,30;LAURA;3115890641
P02;H;H Perejil;1;;1,50;NELCY;3133625349
A50;O;Adobos Sander x 100 gr;1;;;;0
A49;O;Adobos Sander x 50 gr;1;;;;0
ZA32;O;Arandano libra;1;;;;0
C24;O;Crema leche colanta 180 gr;1;;;;0
C17;O;Crema Leche Parmalat 125 gr;1;;;;0
F10;O;Fresa Organica;1;;1,30;por confirmar;0
G03;O;Guascas;1;;1,30;SABILA;0
H06;O;Huevos;1;;;;0
L10;O;Leche Colanta;1;;;;0
L09;O;Leche Entera Proleche;1;;;;0
L08;O;Leche Parmalat deslactosada;1;;;;0
P31;O;Papa pastusa gruesa;1;;;;0
P30;O;Papa pastusa pj;1;;;;0
P29;O;Papa tocarreña gruesa;1;;;;0
P33;O;Papa tocarreña pj;1;;;;0
Q01;O;Queso 7 cueros;1;;;;0
T05;O;Tomate Milan;22;;1,30;LUIS;3112225857
Y03;O;Yogurt;1;;;;0
C28;O;Chorizo 500 gr colanta;1;;;;0
C29;O;Chorizo Santarrosano X 250GR;1;;;;0
J15;O;Jamon 250 gr colanta;1;;;;0
J16;O;Jamon 400 gr colanta;1;;;;0
M01;O;Mortadela 250 gr colanta;1;;;;0
M33;O;Mortadela 500 gr colanta;1;;;;0
S23;O;Salchicha West 250 gr;1;;;;0
S24;O;Salchicha 250 gr 5 und colanta;1;;;;0
S33;O;Salchicha 2 und 72 gr West;1;;;;0
S35;O;Salchicha 250 gr 10 und colanta;1;;;;0
T09;O;Trucha deshuesada;1;;;;0
ZP26;O;Pechuga Tajada;1;;;;0
zp27;O;Piernas;1;;;;0
ZT09;O;Trucha sin deschuesar;1;;;;0
A17;O;Ajonjoli;1;;;;0
a18;O;Anis 15 gr;1;;;;0
A29;O;Arandanos desidratados;1;;;;0
b15;O;Bicarbonato 250 gr;1;;;;0
c15;O;Canela polvo 25 gr;1;;;;0
c16;O;Carbon activado 80 gr;1;;;;0
c20;O;curcuma 30 gr;1;;;;0
c22;O;Coco rallado;1;;;;0
c25;O;Canela astilla 10 gr;1;;;;0
c34;O;Curri polvo 30 gr;1;;;;0
g07;O;Gelatina sin sabor 250 gr;1;;;;0
g90;O;Guascas beley;1;;;;0
gc10;O;Ciruela pasa 125 gr;1;;;;0
j02;O;Jengibre Polvo 30 gr;1;;;;0
L01;O;Semillas linaza;1;;;;0
p37;O;Pimienta negra 15 gr;1;;;;0
Q06;O;Semillas quinua;1;;;;0
s06;O;Stevia 30 gr;1;;;;0
s08;O;Semillas Chia 150 gr;1;;;;0
s09;O;Sal marina;1;;;;0
s10;O;Sal rosada 130 gr;1;;;;0
s13;O;Sen;1;;;;0
t11;O;Te Verde 50 gr;1;;;;0
u02;O;Uvas Pasas 125 gr;1;;;;0
zm25;O;Moringa 50 gr;1;;;;0
zm29;O;Moringa 30 gr;1;;;;0`;

const PROVIDER_SEED: Provider[] = [
  { Proveedor: "ZZ BOLSAS D", Celular: "3001234567" },
  { Proveedor: "IDEAL", Celular: "3101112233" },
  { Proveedor: "ZZ GRANOS", Celular: "3112223344" },
  { Proveedor: "NELCY", Celular: "3133625349" },
  { Proveedor: "LAURA", Celular: "3115890641" },
  { Proveedor: "LUIS", Celular: "3112225857" },
  { Proveedor: "SNEIDER", Celular: "3112225857" },
  { Proveedor: "JOHANA", Celular: "3164779790" },
  { Proveedor: "GERMAN", Celular: "3107618612" },
  { Proveedor: "ROBIN", Celular: "3114607396" },
  { Proveedor: "EFRAIN", Celular: "3124341693" },
  { Proveedor: "PABLO", Celular: "3123783263" },
  { Proveedor: "MARCIAL", Celular: "3158829104" },
  { Proveedor: "ADRIAN", Celular: "3115895741" },
];

const USER_SEED: User[] = [
  { Usuario: "Cris", Contraseña: "crisadmin2026", Rol: "Admin" },
  { Usuario: "Hamilton", Contraseña: "hamiltoncomp2026", Rol: "Comprador" },
  { Usuario: "Tibasosa", Contraseña: "tibasucursal2026", Rol: "Sucursal" },
  { Usuario: "Nobsa", Contraseña: "nobsasucursal2026", Rol: "Sucursal" },
  { Usuario: "Fira", Contraseña: "firasucursal2026", Rol: "Sucursal" },
  { Usuario: "Aquitania", Contraseña: "aquitsucursal2026", Rol: "Sucursal" },
  { Usuario: "Hansel", Contraseña: "hanselsucursal2026", Rol: "Sucursal" },
  { Usuario: "mache", Contraseña: "macheadmin2026", Rol: "Admin" },
];

const RATES_SEED: EmployeeRate[] = [
  { Empleado: "Hamilton Orlando Pérez Aguilera", Valor_Dia: 80000, Valor_Hora: 12000, Cedula: "1.122.626.750", Celular: "3152240846" },
  { Empleado: "Jefrey Alejandro Moreno Nossa", Valor_Dia: 58364, Valor_Hora: 9953, Cedula: "1.192.910.128", Celular: "3133562140" },
  { Empleado: "Leidy Carolina Camacho Vega", Valor_Dia: 58365, Valor_Hora: 9954, Cedula: "1.053.584.462", Celular: "3165685572" },
  { Empleado: "David Lopez Africano", Valor_Dia: 58365, Valor_Hora: 9953, Cedula: "1.007.364.852", Celular: "3142639254" },
  { Empleado: "Cristian Duvan Carrillo Perez", Valor_Dia: 58365, Valor_Hora: 9953, Cedula: "1.002.760.498", Celular: "3226806418" },
  { Empleado: "Jesús lisandro Rojas Granados", Valor_Dia: 58365, Valor_Hora: 9953, Cedula: "1.053.587.990", Celular: "3123350056" },
  { Empleado: "Nelcy Malaver Ruiz", Valor_Dia: 58365, Valor_Hora: 9953, Cedula: "1.051.590.699", Celular: "3214939345" },
  { Empleado: "Diego Andres Plazas", Valor_Dia: 58365, Valor_Hora: 9953, Cedula: "1.050.692.732", Celular: "3117456120" },
  { Empleado: "Nelson", Valor_Dia: 60000, Valor_Hora: 9000, Celular: "3123334455" },
  { Empleado: "Felipe", Valor_Dia: 60000, Valor_Hora: 9000, Celular: "3134445566" },
];

function loadInitialProducts(): Product[] {
  const products: Product[] = [];
  const lines = PRODUCT_SEED_RAW.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(";");
    if (parts.length >= 3) {
      const codigo = parts[0].trim();
      const cat = parts[1].trim().toUpperCase();
      const producto = parts[2].trim();

      let medida = "Unidad";
      if (cat === "E") medida = "Paquete/Unidad";
      else if (cat === "G") medida = "Unidad comercial";
      else if (cat === "H") medida = "Atado/Amarre";
      else if (cat === "P") medida = "Kg";
      else if (cat === "O") medida = "Unidad";

      const factorBulto = parts[3] && parts[3] !== "-" ? parseFloat(parts[3]) : 1;
      const factorCanastilla = parts[4] && parts[4] !== "-" ? parseFloat(parts[4]) : 1;

      let util = 0.30;
      if (parts[5]) {
        const rawUtil = parseFloat(parts[5].replace(",", "."));
        if (!isNaN(rawUtil)) {
          util = rawUtil > 1.0 ? rawUtil - 1.0 : rawUtil;
        }
      }

      const proveedor = parts[6] && parts[6].trim() !== "" ? parts[6].trim() : "Plaza Central";
      const celular = parts[7] && parts[7] !== "0" && parts[7].trim() !== "" ? parts[7].trim() : "3100000000";

      let costo = 1000;
      if (cat === "P") costo = 1500;
      else if (cat === "H") costo = 1200;
      else if (cat === "G") costo = 3000;
      else if (cat === "E") costo = 500;

      const precioVenta = Math.round(costo * (1 + util));

      products.push({
        Codigo: codigo,
        Producto: producto,
        Medida: medida,
        Merma: cat === "P" ? 0.05 : 0,
        Utilidad: util,
        Proveedor: proveedor,
        Celular: celular,
        Costo_Proveedor: costo,
        Precio_Venta_Actual: precioVenta,
        Precio_Anterior: costo,
        Venta_Anterior: precioVenta,
        Factor_Bulto: isNaN(factorBulto) ? 1 : factorBulto,
        Factor_Canastilla: isNaN(factorCanastilla) ? 1 : factorCanastilla
      });
    }
  }
  return products;
}

export function deduplicateSchema(localDb: DatabaseSchema): DatabaseSchema {
  if (!localDb) return localDb;

  function scoreItem(item: any): number {
    if (!item || typeof item !== "object") return 0;
    let score = 0;
    for (const [k, v] of Object.entries(item)) {
      if (v !== null && v !== undefined && v !== "" && v !== 0) score++;
    }
    if (typeof item._id === "string" && item._id.includes("_")) score += 2;
    return score;
  }

  function deduplicateArray<T>(arr: T[], getKey: (item: T) => string | null): T[] {
    if (!Array.isArray(arr) || arr.length === 0) return arr || [];
    const map = new Map<string, T>();
    for (const item of arr) {
      if (!item) continue;
      const key = getKey(item);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, item);
      } else {
        const existing = map.get(key)!;
        if (scoreItem(item) > scoreItem(existing)) {
          map.set(key, item);
        }
      }
    }
    return Array.from(map.values());
  }

  localDb.users = deduplicateArray(localDb.users || [], u => u?.Usuario ? u.Usuario.toLowerCase().trim() : null);
  localDb.products = deduplicateArray(localDb.products || [], p => p?.Codigo ? p.Codigo.toUpperCase().trim() : null);
  localDb.providers = deduplicateArray(localDb.providers || [], p => p?.Proveedor ? p.Proveedor.toLowerCase().trim() : null);
  localDb.rates = deduplicateArray(localDb.rates || [], r => r?.Empleado ? r.Empleado.toLowerCase().trim() : null);
  localDb.schedules = deduplicateArray(localDb.schedules || [], s => s?.Fecha && s?.Empleado ? `${s.Fecha}-${s.Empleado.toLowerCase().trim()}` : null);
  localDb.closures = deduplicateArray(localDb.closures || [], c => c?.Fecha && c?.Sucursal ? `${c.Fecha}-${c.Sucursal.toLowerCase().trim()}` : null);
  localDb.priceHistory = deduplicateArray(localDb.priceHistory || [], h => h?.Codigo && h?.Fecha_Hora ? `${h.Codigo.toUpperCase().trim()}-${h.Fecha_Hora}-${h.Costo_Nuevo || h.Costo_Anterior || 0}` : null);
  localDb.nequiExpenses = deduplicateArray(localDb.nequiExpenses || [], e => e?.Fecha && e?.Sucursal ? `${e.Fecha}-${e.Sucursal.toLowerCase().trim()}-${e.Valor_Gasto || (e as any).Monto || 0}-${(e.Descripcion_Gasto || '').toLowerCase().trim()}` : null);

  localDb.orders = deduplicateArray(localDb.orders || [], o => {
    if (!o) return null;
    const pedId = (o.ID_Pedido || "").toUpperCase().trim();
    const code = (o.Codigo || "").toUpperCase().trim();
    const branch = (o.Sucursal || "").toLowerCase().trim();
    const date = o.Fecha || "";
    const prod = (o.Producto || "").toLowerCase().trim();
    if (pedId && code) return `${pedId}|${code}|${branch}`;
    if (pedId && prod) return `${pedId}|${prod}|${branch}`;
    return `${date}|${branch}|${code || prod}|${o.Cantidad}`;
  });

  localDb.walletTransactions = deduplicateArray(localDb.walletTransactions || [], w => {
    if (!w) return null;
    const date = w.Fecha || "";
    const branch = (w.Sucursal || "").toLowerCase().trim();
    const type = (w.Tipo_Movimiento || (w as any).Tipo || "").toLowerCase().trim();
    const amount = w.Valor || (w as any).Monto || 0;
    const desc = (w.Descripcion || (w as any).Detalle || "").toLowerCase().trim();
    const resp = (w.Responsable || "").toLowerCase().trim();
    return `${date}|${branch}|${type}|${amount}|${desc}|${resp}`;
  });

  localDb.packagingMovements = deduplicateArray(localDb.packagingMovements || [], m => {
    if (!m) return null;
    const id = m.ID_Movimiento || "";
    const date = m.Fecha || "";
    const prov = (m.Proveedor || "").toLowerCase().trim();
    if (id) return `${id}`;
    return `${date}|${prov}|${m.Cantidad_Entregada || (m as any).Cantidad_Prestada || m.Cantidad_Devuelta || 0}`;
  });

  return localDb;
}

export function ensureRecordIds(localDb: DatabaseSchema): void {
  if (!localDb) return;

  const collections = [
    "users", "products", "providers", "orders", "closures",
    "walletTransactions", "shrinkages", "packagingMovements",
    "schedules", "loans", "rates", "payroll", "priceHistory", "nequiExpenses"
  ];

  for (const colKey of collections) {
    const list = (localDb as any)[colKey];
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item && typeof item === "object") {
          if (!item._id && !item.id) {
            let raw = "";
            switch (colKey) {
              case "users": raw = `usr_${item.Usuario || ''}`; break;
              case "products": raw = `prd_${item.Codigo || ''}`; break;
              case "providers": raw = `prv_${item.Proveedor || ''}`; break;
              case "rates": raw = `rat_${item.Empleado || ''}`; break;
              case "orders": raw = `ord_${item.Fecha || ''}_${item.Sucursal || ''}_${item.Codigo || ''}_${item.ID_Pedido || ''}_${i}`; break;
              case "closures": raw = `cls_${item.Fecha || ''}_${item.Sucursal || ''}`; break;
              case "walletTransactions": raw = `wtx_${item.Fecha || ''}_${item.Sucursal || ''}_${item.Tipo_Movimiento || ''}_${item.Responsable || ''}_${i}`; break;
              case "shrinkages": raw = `shk_${item.Fecha || ''}_${item.Sucursal || ''}_${item.Codigo || ''}_${i}`; break;
              case "packagingMovements": raw = `pkg_${item.ID_Movimiento || `${item.Fecha || ''}_${item.Proveedor || ''}_${i}`}`; break;
              case "schedules": raw = `sch_${item.Fecha || ''}_${item.Empleado || ''}_${i}`; break;
              case "loans": raw = `lon_${item.Fecha || ''}_${item.Empleado || ''}_${i}`; break;
              case "payroll": raw = `pay_${item.Fecha || ''}_${item.Trabajador || ''}_${i}`; break;
              case "priceHistory": raw = `prc_${item.Fecha_Hora || ''}_${item.Codigo || ''}_${i}`; break;
              case "nequiExpenses": raw = `neq_${item.Fecha || ''}_${item.Sucursal || ''}_${i}`; break;
              default: raw = `rec_${colKey}_${i}`; break;
            }
            item._id = raw.toLowerCase().trim().replace(/[\/\s#?]/g, "_").replace(/^[\.\s]+/, "").replace(/[\.\s]+$/, "") || `rec_${i}`;
          } else if (item.id && !item._id) {
            item._id = String(item.id);
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────
// PERSISTENCIA: PostgreSQL (Supabase) es la fuente de la verdad.
// El archivo data/db.json se conserva solo como copia local de respaldo
// (best-effort, nunca bloquea ni se usa para leer si Postgres responde).
// ─────────────────────────────────────────────

function writeJsonBackup(db: DatabaseSchema) {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const jsonString = JSON.stringify(db, null, 2);
  const tempFile = DB_FILE + ".tmp";
  const backupFile = DB_FILE + ".bak";

  if (fs.existsSync(DB_FILE)) {
    try {
      const stats = fs.statSync(DB_FILE);
      if (stats.size > 100) fs.copyFileSync(DB_FILE, backupFile);
    } catch (err: any) {
      console.error("No se pudo crear copia de seguridad .bak previa:", err.message);
    }
  }

  fs.writeFileSync(tempFile, jsonString, "utf-8");
  JSON.parse(fs.readFileSync(tempFile, "utf-8"));
  fs.renameSync(tempFile, DB_FILE);
}

function readJsonBackup(): DatabaseSchema | null {
  const backupFile = DB_FILE + ".bak";
  for (const file of [DB_FILE, backupFile]) {
    if (fs.existsSync(file)) {
      try {
        const data = fs.readFileSync(file, "utf-8");
        if (data.trim().length > 10) return JSON.parse(data) as DatabaseSchema;
      } catch { /* try next */ }
    }
  }
  return null;
}

function defaultBranchConfigs(): { [branch: string]: BranchConfig } {
  return {
    Tibasosa: { baseCaja: 150000, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 },
    Nobsa: { baseCaja: 100000, recolectorPredeterminado: "Cris", montoAlerta: 400000 },
    Fira: { baseCaja: 120000, recolectorPredeterminado: "Hamilton", montoAlerta: 450000 },
    Aquitania: { baseCaja: 200000, recolectorPredeterminado: "Cris", montoAlerta: 600000 },
    Hansel: { baseCaja: 150000, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 },
  };
}

async function loadFromPostgres(): Promise<DatabaseSchema> {
  const [
    usersRows, productsRows, providersRows, ordersRows, closuresRows,
    walletRows, shrinkagesRows, packagingRows, schedulesRows, loansRows,
    ratesRows, payrollRows, priceHistoryRows, nequiRows, branchConfigRows,
  ] = await Promise.all([
    pgDb.select().from(schema.users),
    pgDb.select().from(schema.products),
    pgDb.select().from(schema.providers),
    pgDb.select().from(schema.orders),
    pgDb.select().from(schema.closures),
    pgDb.select().from(schema.walletTransactions),
    pgDb.select().from(schema.shrinkages),
    pgDb.select().from(schema.packagingMovements),
    pgDb.select().from(schema.employeeSchedules),
    pgDb.select().from(schema.employeeLoans),
    pgDb.select().from(schema.employeeRates),
    pgDb.select().from(schema.payrollRecords),
    pgDb.select().from(schema.priceHistories),
    pgDb.select().from(schema.nequiExpenses),
    pgDb.select().from(schema.branchConfigs),
  ]);
  const syncLogsRows = await pgDb.select().from(schema.syncLogs);

  const branchConfigsObj: { [branch: string]: BranchConfig } = {};
  for (const r of branchConfigRows) {
    branchConfigsObj[r.sucursal] = {
      baseCaja: r.baseCaja ?? 0,
      recolectorPredeterminado: r.recolectorPredeterminado ?? "",
      montoAlerta: r.montoAlerta ?? 0,
    };
  }

  return {
    users: usersRows.map((u): User => ({ Usuario: u.usuario, Contraseña: u.contrasena, Rol: (u.rol as any) || "Sucursal" })),
    products: productsRows.map((p): Product => ({
      Codigo: p.codigo, Producto: p.producto, Medida: p.medida || "Kg", Merma: p.merma ?? 0, Utilidad: p.utilidad ?? 0,
      Proveedor: p.proveedor || "", Celular: p.celular || "", Costo_Proveedor: p.costoProveedor ?? 0,
      Precio_Venta_Actual: p.precioVentaActual ?? 0, Precio_Anterior: p.precioAnterior ?? 0, Venta_Anterior: p.ventaAnterior ?? 0,
      Factor_Bulto: p.factorBulto ?? 1, Factor_Canastilla: p.factorCanastilla ?? 1,
    })),
    providers: providersRows.map((p): Provider => ({ Proveedor: p.proveedor, Celular: p.celular || "" })),
    orders: ordersRows.map((o): Order => ({
      ID_Pedido: o.idPedido, Fecha: o.fecha, Sucursal: o.sucursal, Codigo: o.codigo, Producto: o.producto, Medida: o.medida || "Kg",
      Cantidad: o.cantidad || "0", Notas: o.notas || "", Precio_Anterior: o.precioAnterior ?? 0, Porcentaje_Ganancia: o.porcentajeGanancia ?? 0,
      Cantidad_Comprada: o.cantidadComprada ?? 0, Costo_Momento: o.costoMomento ?? 0, Precio_Venta_Momento: o.precioVentaMomento ?? 0,
      Kilos: o.kilos ?? 0, Estado: (o.estado as any) || "Pendiente", Estado_Pago: (o.estadoPago as any) || "Pendiente",
      Proveedor: o.proveedor || "", Celular: o.celular || "",
    })),
    closures: closuresRows.map((c): DailyClosure => ({
      Fecha: c.fecha, Sucursal: c.sucursal, Ventas_Totales: c.ventasTotales ?? 0, Gastos_Extra: c.gastosExtra ?? 0,
      Descripcion_Gastos: c.descripcionGastos || "", Persona_Recogio: c.personaRecogio || "", Recaudado_Fisico: !!c.recaudadoFisico,
      Foto_Factura: c.fotoFactura || "", Monto_Recaudado: c.montoRecaudado ?? 0,
    })),
    walletTransactions: walletRows.map((w): WalletTransaction => ({
      Fecha: w.fecha, Sucursal: w.sucursal, Tipo_Movimiento: (w.tipoMovimiento as any) || "Gasto", Valor: w.valor ?? 0,
      Descripcion: w.descripcion || "", Responsable: w.responsable || "", Estado: (w.estado as any) || "Pendiente", Foto_Factura: w.fotoFactura || "",
    })),
    shrinkages: shrinkagesRows.map((s): Shrinkage => ({
      Fecha: s.fecha, Sucursal: s.sucursal, Codigo: s.codigo, Producto: s.producto, Cantidad: s.cantidad || "0", Unidad: s.unidad || "Kg",
      Motivo: s.motivo || "", Costo_Proveedor: s.costoProveedor ?? 0, Perdida_Monetaria: s.perdidaMonetaria ?? 0, Foto: s.foto || "",
    })),
    packagingMovements: packagingRows.map((m): PackagingMovement => ({
      ID_Movimiento: m.idMovimiento, Fecha: m.fecha, Proveedor: m.proveedor, Tipo_Activo: (m.tipoActivo as any) || "Canastilla",
      Cantidad_Entregada: m.cantidadEntregada ?? 0, Cantidad_Devuelta: m.cantidadDevuelta ?? 0, Notas: m.notas || "",
    })),
    schedules: schedulesRows.map((s): EmployeeSchedule => ({ Fecha: s.fecha, Empleado: s.empleado, Sucursal: s.sucursal, Horas_Trabajadas: s.horasTrabajadas ?? 0 })),
    loans: loansRows.map((l): EmployeeLoan => ({ Fecha: l.fecha, Empleado: l.empleado, Sucursal: l.sucursal, Monto: l.monto ?? 0, Motivo: l.motivo || "", Estado: (l.estado as any) || "Pendiente" })),
    rates: ratesRows.map((r): EmployeeRate => ({ Empleado: r.empleado, Valor_Dia: r.valorDia ?? 0, Valor_Hora: r.valorHora ?? 0, Auxilio_Transporte: r.auxilioTransporte ?? 0, Celular: r.celular || "", Cedula: r.cedula || "" })),
    payroll: payrollRows.map((p): PayrollRecord => ({
      Fecha: p.fecha, Trabajador: p.trabajador, Sucursal: p.sucursal, Dias_Trabajados: p.diasTrabajados ?? 0, Horas_Trabajadas: p.horasTrabajadas ?? 0,
      Pago_Base: p.pagoBase ?? 0, Pago_Horas: p.pagoHoras ?? 0, Prestamos_Descontados: p.prestamosDescontados ?? 0, Total_Neto: p.totalNeto ?? 0, Estado_Pago: (p.estadoPago as any) || "Pendiente",
    })),
    priceHistory: priceHistoryRows.map((h): PriceHistory => ({
      Fecha_Hora: h.fechaHora, Codigo: h.codigo, Producto: h.producto, Costo_Anterior: h.costoAnterior ?? 0, Costo_Nuevo: h.costoNuevo ?? 0,
      Venta_Anterior: h.ventaAnterior ?? 0, Venta_Nueva: h.ventaNueva ?? 0, Usuario: h.usuario || "",
    })),
    nequiExpenses: nequiRows.map((n): NequiExpense => ({
      Fecha: n.fecha, Sucursal: n.sucursal, Valor_Gasto: n.valorGasto ?? 0, Descripcion_Gasto: n.descripcionGasto || "",
      Responsable: n.responsable || "", Reconciliado_Fisico: !!n.reconciliadoFisico,
    })),
    syncLogs: syncLogsRows.map((l): SyncLog => ({
      id: String(l.id), timestamp: (l.timestamp instanceof Date ? l.timestamp : new Date(l.timestamp as any)).toISOString(),
      service: "Firebase", action: l.action, status: (l.status as any) || "success", details: l.details || "",
      itemsCount: l.itemsCount ?? undefined, durationMs: l.durationMs ?? undefined,
    })),
    branchConfigs: Object.keys(branchConfigsObj).length > 0 ? branchConfigsObj : defaultBranchConfigs(),
  };
}

export async function initDb(): Promise<DatabaseSchema> {
  let db: DatabaseSchema;

  try {
    db = await loadFromPostgres();
    console.log("[Database] Datos cargados exitosamente desde Supabase/PostgreSQL.");
  } catch (err: any) {
    console.error("CRITICAL: No se pudo cargar la base de datos desde Supabase/PostgreSQL al iniciar. Usando copia local de respaldo si existe.", err.message || err);
    db = readJsonBackup() || ({} as DatabaseSchema);
  }

  // Semillas solo si una colección clave viene completamente vacía (arranque en frío)
  if (!db.users || db.users.length === 0) db.users = USER_SEED;
  if (!db.products || db.products.length === 0) db.products = loadInitialProducts();
  if (!db.providers || db.providers.length === 0) db.providers = PROVIDER_SEED;
  if (!db.rates || db.rates.length === 0) db.rates = RATES_SEED;
  db.orders = db.orders || [];
  db.closures = db.closures || [];
  db.walletTransactions = db.walletTransactions || [];
  db.shrinkages = db.shrinkages || [];
  db.packagingMovements = db.packagingMovements || [];
  db.schedules = db.schedules || [];
  db.loans = db.loans || [];
  db.payroll = db.payroll || [];
  db.priceHistory = db.priceHistory || [];
  db.nequiExpenses = db.nequiExpenses || [];
  db.syncLogs = db.syncLogs || [];
  db.branchConfigs = db.branchConfigs || defaultBranchConfigs();

  deduplicateSchema(db);
  ensureRecordIds(db);

  try {
    writeJsonBackup(db);
  } catch (err: any) {
    console.error("No se pudo escribir la copia local de respaldo (no crítico):", err.message || err);
  }

  return db;
}

export type CollectionKey = keyof DatabaseSchema;

// Cada colección sabe reemplazar su propia tabla (delete + insert) dentro de una transacción.
const TABLE_SYNCERS: Record<CollectionKey, (db: DatabaseSchema, tx: any) => Promise<void>> = {
  users: async (db, tx) => {
    await tx.delete(schema.users);
    if (db.users.length > 0) {
      await tx.insert(schema.users).values(db.users.map((u) => ({ usuario: u.Usuario, contrasena: u.Contraseña || "", rol: u.Rol })));
    }
  },
  products: async (db, tx) => {
    await tx.delete(schema.products);
    if (db.products.length > 0) {
      await tx.insert(schema.products).values(db.products.map((p) => ({
        codigo: p.Codigo, producto: p.Producto, medida: p.Medida, merma: p.Merma, utilidad: p.Utilidad, proveedor: p.Proveedor,
        celular: p.Celular, costoProveedor: p.Costo_Proveedor, precioVentaActual: p.Precio_Venta_Actual, precioAnterior: p.Precio_Anterior,
        ventaAnterior: p.Venta_Anterior, factorBulto: p.Factor_Bulto, factorCanastilla: p.Factor_Canastilla,
      })));
    }
  },
  providers: async (db, tx) => {
    await tx.delete(schema.providers);
    if (db.providers.length > 0) {
      await tx.insert(schema.providers).values(db.providers.map((p) => ({ proveedor: p.Proveedor, celular: p.Celular })));
    }
  },
  orders: async (db, tx) => {
    await tx.delete(schema.orders);
    if (db.orders.length > 0) {
      await tx.insert(schema.orders).values(db.orders.map((o) => ({
        idPedido: o.ID_Pedido, fecha: o.Fecha, sucursal: o.Sucursal, codigo: o.Codigo, producto: o.Producto, medida: o.Medida,
        cantidad: o.Cantidad, notas: o.Notas, precioAnterior: o.Precio_Anterior, porcentajeGanancia: o.Porcentaje_Ganancia,
        cantidadComprada: o.Cantidad_Comprada, costoMomento: o.Costo_Momento, precioVentaMomento: o.Precio_Venta_Momento,
        kilos: o.Kilos, estado: o.Estado, estadoPago: o.Estado_Pago, proveedor: o.Proveedor, celular: o.Celular,
      })));
    }
  },
  closures: async (db, tx) => {
    await tx.delete(schema.closures);
    if (db.closures.length > 0) {
      await tx.insert(schema.closures).values(db.closures.map((c) => ({
        fecha: c.Fecha, sucursal: c.Sucursal, ventasTotales: c.Ventas_Totales, gastosExtra: c.Gastos_Extra,
        descripcionGastos: c.Descripcion_Gastos, personaRecogio: c.Persona_Recogio, recaudadoFisico: c.Recaudado_Fisico,
        fotoFactura: c.Foto_Factura || "", montoRecaudado: c.Monto_Recaudado || 0,
      })));
    }
  },
  walletTransactions: async (db, tx) => {
    await tx.delete(schema.walletTransactions);
    if (db.walletTransactions.length > 0) {
      await tx.insert(schema.walletTransactions).values(db.walletTransactions.map((w) => ({
        fecha: w.Fecha, sucursal: w.Sucursal, tipoMovimiento: w.Tipo_Movimiento, valor: w.Valor, descripcion: w.Descripcion,
        responsable: w.Responsable, estado: w.Estado, fotoFactura: w.Foto_Factura || "",
      })));
    }
  },
  shrinkages: async (db, tx) => {
    await tx.delete(schema.shrinkages);
    if (db.shrinkages.length > 0) {
      await tx.insert(schema.shrinkages).values(db.shrinkages.map((s) => ({
        fecha: s.Fecha, sucursal: s.Sucursal, codigo: s.Codigo, producto: s.Producto, cantidad: s.Cantidad, unidad: s.Unidad || "Kg",
        motivo: s.Motivo, costoProveedor: s.Costo_Proveedor, perdidaMonetaria: s.Perdida_Monetaria, foto: s.Foto || "",
      })));
    }
  },
  packagingMovements: async (db, tx) => {
    await tx.delete(schema.packagingMovements);
    if (db.packagingMovements.length > 0) {
      await tx.insert(schema.packagingMovements).values(db.packagingMovements.map((m) => ({
        idMovimiento: m.ID_Movimiento, fecha: m.Fecha, proveedor: m.Proveedor, tipoActivo: m.Tipo_Activo,
        cantidadEntregada: m.Cantidad_Entregada, cantidadDevuelta: m.Cantidad_Devuelta, notas: m.Notas,
      })));
    }
  },
  schedules: async (db, tx) => {
    await tx.delete(schema.employeeSchedules);
    if (db.schedules.length > 0) {
      await tx.insert(schema.employeeSchedules).values(db.schedules.map((s) => ({ fecha: s.Fecha, empleado: s.Empleado, sucursal: s.Sucursal, horasTrabajadas: s.Horas_Trabajadas })));
    }
  },
  loans: async (db, tx) => {
    await tx.delete(schema.employeeLoans);
    if (db.loans.length > 0) {
      await tx.insert(schema.employeeLoans).values(db.loans.map((l) => ({ fecha: l.Fecha, empleado: l.Empleado, sucursal: l.Sucursal, monto: l.Monto, motivo: l.Motivo, estado: l.Estado })));
    }
  },
  rates: async (db, tx) => {
    await tx.delete(schema.employeeRates);
    if (db.rates.length > 0) {
      await tx.insert(schema.employeeRates).values(db.rates.map((r) => ({
        empleado: r.Empleado, valorDia: r.Valor_Dia, valorHora: r.Valor_Hora, auxilioTransporte: r.Auxilio_Transporte || 0,
        celular: r.Celular || "", cedula: r.Cedula || "",
      })));
    }
  },
  payroll: async (db, tx) => {
    await tx.delete(schema.payrollRecords);
    if (db.payroll.length > 0) {
      await tx.insert(schema.payrollRecords).values(db.payroll.map((p) => ({
        fecha: p.Fecha, trabajador: p.Trabajador, sucursal: p.Sucursal, diasTrabajados: p.Dias_Trabajados, horasTrabajadas: p.Horas_Trabajadas,
        pagoBase: p.Pago_Base, pagoHoras: p.Pago_Horas, prestamosDescontados: p.Prestamos_Descontados, totalNeto: p.Total_Neto, estadoPago: p.Estado_Pago,
      })));
    }
  },
  priceHistory: async (db, tx) => {
    await tx.delete(schema.priceHistories);
    if (db.priceHistory.length > 0) {
      await tx.insert(schema.priceHistories).values(db.priceHistory.map((h) => ({
        fechaHora: h.Fecha_Hora, codigo: h.Codigo, producto: h.Producto, costoAnterior: h.Costo_Anterior, costoNuevo: h.Costo_Nuevo,
        ventaAnterior: h.Venta_Anterior, ventaNueva: h.Venta_Nueva, usuario: h.Usuario,
      })));
    }
  },
  nequiExpenses: async (db, tx) => {
    await tx.delete(schema.nequiExpenses);
    if (db.nequiExpenses.length > 0) {
      await tx.insert(schema.nequiExpenses).values(db.nequiExpenses.map((n) => ({
        fecha: n.Fecha, sucursal: n.Sucursal, valorGasto: n.Valor_Gasto, descripcionGasto: n.Descripcion_Gasto,
        responsable: n.Responsable, reconciliadoFisico: n.Reconciliado_Fisico,
      })));
    }
  },
  syncLogs: async (db, tx) => {
    await tx.delete(schema.syncLogs);
    const logs = db.syncLogs || [];
    if (logs.length > 0) {
      await tx.insert(schema.syncLogs).values(logs.map((l) => ({
        timestamp: new Date(l.timestamp), service: l.service, action: l.action, status: l.status,
        details: l.details, itemsCount: l.itemsCount || 0, durationMs: l.durationMs || 0,
      })));
    }
  },
  branchConfigs: async (db, tx) => {
    await tx.delete(schema.branchConfigs);
    const configs = Object.entries(db.branchConfigs || {});
    if (configs.length > 0) {
      await tx.insert(schema.branchConfigs).values(configs.map(([sucursal, cfg]) => ({
        sucursal, baseCaja: cfg.baseCaja, recolectorPredeterminado: cfg.recolectorPredeterminado, montoAlerta: cfg.montoAlerta,
      })));
    }
  },
};

const ALL_COLLECTIONS = Object.keys(TABLE_SYNCERS) as CollectionKey[];

/**
 * Persiste la base de datos en Supabase/PostgreSQL.
 * Por rendimiento: si se pasa `only`, únicamente se resincronizan esas colecciones
 * (evita reescribir tablas grandes como `orders` cuando solo cambió, por ejemplo, `products`).
 * Si se omite, se resincronizan todas (usado en operaciones masivas: importaciones, limpiezas, etc.).
 */
export async function saveDb(db: DatabaseSchema, only?: CollectionKey[]): Promise<void> {
  deduplicateSchema(db);
  ensureRecordIds(db);

  // Copia local de respaldo — best-effort, nunca bloquea el guardado real.
  try {
    writeJsonBackup(db);
  } catch (err: any) {
    console.error("No se pudo escribir la copia local de respaldo (no crítico):", err.message || err);
  }

  const targets = only && only.length > 0 ? only : ALL_COLLECTIONS;
  await pgDb.transaction(async (tx) => {
    for (const key of targets) {
      await TABLE_SYNCERS[key](db, tx);
    }
  });
}
