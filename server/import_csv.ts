import { DatabaseSchema, Product, Order } from "./db.ts";

const CSV_RAW = `PRODUCTO;TIBASOSA;NOBSA;FIRA;AQUITANIA;Hansel;PROVEEDOR;PRECIO COMPRA;;;PRECIO TOTAL
Sobre Ajo pasta;0      ;0      ;0      ;10      ;0      ;adobos;;SI;;0      
Sobre Miel;0      ;0      ;0      ;10      ;0      ;adobos;;SI;;0      
Papa Pastusa Gr;3      ;1      ;0      ;3      ;2      ;ADRIAN;;SI;;0      
Papa Pastusa Pj;0      ;1      ;0      ;2      ;1      ;ADRIAN;;SI;;0      
Ahuya Ama;1      ;1      ;0      ;0      ;0      ;ALIRIO;;SI;Nobsa: 1 de 5 kg;0      
Aromatica;20      ;30      ;15      ;80      ;20      ;ARO;;SI;;0      
Aromatica Surtida;0      ;4000      ;0      ;0      ;0      ;ARO;;SI;;0      
Laurel y Tomillo;5      ;0      ;5      ;10      ;5      ;ARO;;SI;;0      
ZZ Bolsas;0      ;0      ;1      ;0      ;0      ;DARIO;;SI;;0      
Fresa G. Paq;10      ;30      ;10      ;20      ;0      ;EFRAIN;;SI;;0      
Fresa Par. Paq;0      ;10      ;0      ;20      ;0      ;EFRAIN;;SI;;0      
Mora Pq;10      ;20      ;10      ;20      ;0      ;EFRAIN;;SI;;0      
MANZANA ROYAL KG;0      ;9      ;0      ;0      ;0      ;ELIZA;;SI;;0      
Ajo Impo;1      ;0      ;0      ;2      ;0      ;ELIZA;;SI;;0      
Banano Boc;10      ;35      ;5      ;10      ;2      ;ELIZA;;SI;;0      
Borojo;0      ;0      ;0      ;1      ;0      ;ELIZA;;SI;;0      
Champiñon;5      ;3      ;2      ;2      ;0      ;ELIZA;;SI;;0      
Champiñon 250G;3      ;3      ;2      ;0      ;0      ;ELIZA;;SI;;0      
Granadilla;  1/2 ;  1/4 ;  1/2 ;  1/4 ;0      ;ELIZA;;SI;;0      
Granadilla Pj;0      ;  1/4 ;0      ;0      ;0      ;ELIZA;;SI;;0      
Guatila;0      ;3      ;0      ;5      ;0      ;ELIZA;;SI;;0      
Jengibre;2      ;0      ;1      ;0      ;1      ;ELIZA;;SI;;0      
Kiwi;2      ;3      ;3      ;3      ;0      ;ELIZA;;SI;;0      
Manz Roja 125;0      ;0      ;0      ;  2/5 ;0      ;ELIZA;;SI;;0      
Manz Royal 150;  2/5 ;  1/5 ;  1/5 ;  3/5 ;0      ;ELIZA;;SI;;0      
Manz Royal 198 bj;0      ;0      ;15      ;20      ;0      ;ELIZA;;SI;;0      
Manz Ver 150;  1/5 ;  1/5 ;  1/5 ;  1/5 ;0      ;ELIZA;;SI;;0      
Manz Verde 198 bj;0      ;5      ;6      ;10      ;0      ;ELIZA;;SI;;0      
Melon Guacal;0      ;1      ;1      ;0      ;0      ;ELIZA;;SI;;0      
Papaya encrd;2      ;3      ;0      ;0      ;0      ;ELIZA;;SI;;0      
Pera Chilena;0      ;0      ;  1/8 ;0      ;0      ;ELIZA;;SI;;0      
Pitaya;2      ;0      ;3      ;5      ;0      ;ELIZA;;SI;;0      
Tomat Cherry;0      ;4      ;0      ;0      ;0      ;ELIZA;;SI;;0      
Uchuvas;0      ;0      ;0      ;3      ;0      ;ELIZA;;SI;;0      
Uva bande;0      ;  1/2 ;0      ;  1/2 ;0      ;ELIZA;;SI;;0      
Uva Isabella;0      ;  1/4 ;0      ;  1/2 ;0      ;ELIZA;;SI;;0      
Frijol;  1/8 ;  1/8 ;  1/4 ;  1/4 ;0      ;EMILIO;;SI;;0      
Zuquini Amar;5      ;3      ;2      ;3      ;0      ;EMILIO;;SI;;0      
Zuquini Verd;3      ;5      ;3      ;5      ;0      ;EMILIO;;SI;;0      
Calabacin;0      ;  1/4 ;  1/4 ;0      ;0      ;ESTEBAN;;SI;;0      
Calabaza;  1/4 ;  1/2 ;  1/4 ;  1/4 ;  1/4 ;ESTEBAN;;SI;;0      
Lulo Grueso;  1/4 ;  1/2 ;  1/4 ;  1/4 ;0      ;ESTEBAN;;SI;;0      
Pepino Guiso;  1/2 ;  1/2 ;  1/4 ;1      ;0      ;ESTEBAN;;SI;;0      
Pepino Guiso PJ;0      ;  1/2 ;0      ;0      ;0      ;ESTEBAN;;SI;;0      
Tomate A. co Gr;0      ;0      ;  1/4 ;  1/2 ;0      ;ESTEBAN;;SI;;0      
Tomate A. Co Pj;0      ;  1/4 ;0      ;0      ;0      ;ESTEBAN;;SI;;0      
Tomate A. Poll Gr;  1/4 ;0      ;  1/4 ;  1/4 ;0      ;ESTEBAN;;SI;;0      
Tomate A. Poll Pj;0      ;  1/4 ;0      ;0      ;0      ;ESTEBAN;;SI;;0      
Cebolla Larg;  1/2 ;2  1/2 ;1      ;0      ;0      ;EVELIO;;SI;;0      
Agua Haz;10      ;20      ;15      ;30      ;0      ;FREDY;;SI;;0      
Agua Hazz Pj;0      ;10      ;0      ;40      ;10      ;FREDY;;SI;;0      
Agua pap;10      ;30      ;20      ;0      ;10      ;FREDY;;SI;;0      
Agua pap 2da;0      ;5      ;0      ;30      ;0      ;FREDY;;SI;;0      
Ahuyamin;0      ;  1/8 ;  1/8 ;  1/8 ;  1/8 ;GERMAN;;SI;;0      
Limon Tahiti;1      ;0      ;1      ;  1/2 ;  1/4 ;GERMAN;;SI;;0      
Mandarina A;0      ;0      ;0      ;  1/2 ;0      ;GERMAN;;SI;;0      
Mango Tom;0      ;1      ;1      ;1      ;0      ;GERMAN;;SI;;0      
Mango Yulima;1      ;1  1/2 ;0      ;1      ;  1/2 ;GERMAN;;SI;;0      
Melon Canast;0      ;1      ;0      ;0      ;0      ;GERMAN;;SI;;0      
Nar Tang Par ;0      ;1      ;1      ;1      ;  1/2 ;GERMAN;;SI;;0      
Nar Tange Gr;1      ;1      ;  1/2 ;0      ;0      ;GERMAN;;SI;;0      
Nara Val Gru;  1/4 ;  3/4 ;0      ;  1/4 ;0      ;GERMAN;;SI;;0      
patilla baby;10      ;10      ;10      ;10      ;0      ;GERMAN;;SI;;0      
Pepino Coho;  1/4 ;1      ;  1/4 ;  1/2 ;0      ;GERMAN;;SI;;0      
Pimenton Pj;0      ;1      ;0      ;  1/2 ;0      ;GERMAN;;SI;;0      
Piña Miel;15      ;0      ;10      ;15      ;4      ;GERMAN;;SI;;0      
P Criolla gr;  1/4 ;1  1/8 ;  1/2 ;1  1/4 ;  1/8 ;GUALALI;;SI;;0      
P Criolla Pj;  1/8 ;  1/4 ;  1/4 ;0      ;  1/4 ;GUALALI;;SI;;0      
Coco;0      ;0      ;5      ;5      ;0      ;JAIRO;;SI;;0      
Guanabana;15      ;20      ;5      ;10      ;0      ;JAIRO;;SI;;0      
Guayaba;0      ;1      ;  1/4 ;  1/2 ;0      ;JAIRO;;SI;;0      
Guayaba Pj;0      ;  1/2 ;0      ;0      ;0      ;JAIRO;;SI;;0      
Mandarina Li;1      ;1      ;1      ;0      ;0      ;JAIRO;;SI;;0      
Pimenton;  1/2 ;  1/2 ;  1/8 ;1      ;  1/8 ;JAIRO;;SI;;0      
Arveja;  3/8 ;1      ;  1/2 ;1      ;0      ;JESUS;;SI;;0      
Aji Grande;0      ;4      ;2      ;0      ;0      ;JOHANA;;SI;;0      
Aji Mediano;0      ;0      ;4      ;0      ;0      ;JOHANA;;SI;;0      
Limon Mand;0      ;  1/2 ;  1/4 ;  1/4 ;  1/4 ;JOHANA;;SI;;0      
Platano Coli;0      ;1      ;0      ;1      ;0      ;JOHANA;;SI;;0      
H Lechuga H.;1      ;2      ;1      ;4      ;0      ;LAURA;;SI;;0      
Agraz;0      ;4      ;0      ;2      ;0      ;LIGIA;;SI;;0      
Tomate RIO;1      ;2  1/2 ;2      ;2      ;0      ;LUIS;;SI;;0      
Banano Criollo;50      ;130      ;60      ;100      ;15      ;MANUEL;;SI;;0      
Zanahoria;  1/4 ;  5/8 ;  1/2 ;  3/4 ;  1/8 ;MARCIAL;;SI;;0      
Zanahoria Pj;  3/8 ;  1/2 ;  1/4 ;1      ;0      ;MARCIAL;;SI;;0      
Haba;  1/16;  1/8 ;  1/4 ;  1/4 ;  1/16;MARTHA;;SI;;0      
Nabos;0      ;  1/16;  1/8 ;  1/8 ;0      ;MARTHA;;SI;;0      
Remolacha;  1/8 ;0      ;  1/8 ;  1/8 ;  1/16;MARTHA;;SI;;0      
Rubas;  1/8 ;  1/16;0      ;  1/8 ;0      ;MARTHA;;SI;;0      
Cebolla B;  1/2 ;  1/8 ;  1/4 ;1      ;  1/8 ;MERY;;SI;;0      
Cebolla pj;0      ;  1/4 ;0      ;0      ;0      ;MERY;;SI;;0      
Cebolla Roja;  1/2 ;0      ;0      ;  1/4 ;  1/8 ;MERY;;SI;;0      
Cebolla Roja pl;0      ;  1/4 ;0      ;0      ;0      ;MERY;;SI;;0      
sabila;0      ;10      ;10      ;20      ;5      ;NELA;;SI;;0      
Apio Rama;3      ;4      ;4      ;3      ;1      ;NELCY;;SI;;0      
H Cilantro;0      ;0      ;0      ;0      ;  1/2 ;NELCY;;SI;;0      
H Perejil;0      ;0      ;;0      ;5000      ;NELCY;;SI;;0      
Repollo;0      ;  1/8 ;0      ;  1/8 ;0      ;NELCY;;SI;;0      
Maracuya;  1/2 ;3  1/2 ;1      ;2      ;0      ;PABLO;;SI;;0      
Plata Mad Gr;1      ;2      ;1      ;3      ;0      ;PABLO;;SI;;0      
Plata pica;2      ;0      ;1      ;3      ;0      ;PABLO;;SI;;0      
Plata verd Gr;1      ;2      ;2      ;2      ;1      ;PABLO;;SI;;0      
Yuca;  1/2 ;1  1/2 ;  3/4 ;2      ;  1/4 ;PABLO;;SI;;0      
Durazno 2da;0      ;15      ;0      ;15      ;0      ;PEDRO;;SI;;0      
Durazno Co;  1/2 ;  1/2 ;  1/4 ;0      ;0      ;PEDRO;;SI;;0      
Durazno pj;0      ;  1/4 ;0      ;0      ;0      ;PEDRO;;SI;;0      
Manzana Ana;  1/4 ;  1/2 ;  1/4 ;0      ;0      ;PEDRO;;SI;;0      
Pera Nacion;  1/4 ;1      ;  1/4 ;  1/2 ;0      ;PEDRO;;SI;;0      
Arandano 1/4;0      ;30      ;0      ;30      ;8      ;PROFE;;SI;;0      
Arandano libra;0      ;8      ;0      ;3      ;0      ;PROFE;;SI;;0      
Banano Urab;2      ;2      ;2      ;3      ;1      ;ROBIN;;SI;;0      
papaya;2      ;3      ;2      ;3      ;1      ;ROBIN;;SI;;0      
Papaya Pj;0      ;3      ;0      ;0      ;0      ;ROBIN;;SI;;0      
Raices Chinas;3      ;0      ;0      ;8      ;0      ;ROBIN;;SI;;0      
Arracacha;  1/8 ;  1/4 ;  1/8 ;  1/2 ;0      ;SANDY;;SI;;0      
Mazorc preco;0      ;0      ;5      ;5      ;0      ;SANDY;;SI;;0      
Mazorca Ban;10      ;10      ;15      ;40      ;3      ;SANDY;;SI;;0      
Mazorca und;15      ;10      ;8      ;10      ;5      ;SANDY;;SI;;0      
Habichuela;  1/4 ;0      ;  1/2 ;1      ;0      ;SNEIDER;;SI;;0      
Tomat Chonto;  1/2 ;1  1/2 ;1      ;1      ;1      ;SNEIDER;;SI;;0      
Tomate Pare;  1/2 ;2      ;0      ;2      ;  1/2 ;SNEIDER;;SI;;0      
Ajo atado;  1/2 ;  1/2 ;0      ;2      ;0      ;VIVIANA;;SI;;0      
Ajo pelado;15      ;30      ;10      ;30      ;0      ;VIVIANA;;SI;;0      
Arroz 500 gr;0      ;0      ;0      ;0      ;1      ;ZZ GRANOS;;SI;;0      
Panelada;0      ;0      ;0      ;20      ;0      ;ZZ GRANOS;;SI;;0      
AZUCAR Morena  KG;0      ;0      ;0      ;0      ;  1/2 ;ZZ GRANOS;;SI;;0      
AZUCAR BLANCA KG;0      ;0      ;0      ;0      ;  1/2 ;ZZ GRANOS;;SI;;0      
ZZ Varios 4;1      ;0      ;0      ;0      ;0      ;;;SI;;0;`;

function parseFraction(q: string): number {
  if (!q) return 0;
  const cleaned = q.trim().replace(",", ".");
  if (cleaned === "" || cleaned === "-" || cleaned === "0") return 0;

  if (cleaned.includes("/")) {
    const parts = cleaned.split("/");
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (!isNaN(num) && !isNaN(den) && den !== 0) {
        return num / den;
      }
    }
  }

  const mixedMatch = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/) || cleaned.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    if (den !== 0) {
      return whole + (num / den);
    }
  }

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

export function importCsvToDb(db: DatabaseSchema, targetDate: string = "2026-07-22"): boolean {
  const orderDate = targetDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

  // Check if orders for this date already exist to avoid wiping user modifications on restarts
  if (db.orders && db.orders.some(o => o.Fecha === orderDate)) {
    console.log("Omitiendo importacion CSV: ya existen pedidos para la fecha " + orderDate);
    return false;
  }

  console.log("Iniciando importacion CSV para la fecha " + orderDate);

  const lines = CSV_RAW.split("\n");
  const headers = lines[0].split(";");
  
  const sucursales = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];

  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  // Grouped order IDs for today to keep them organized
  const oids: Record<string, string> = {
    Tibasosa: "PED-TIBASOSA-" + timestamp,
    Nobsa: "PED-NOBSA-" + timestamp,
    Fira: "PED-FIRA-" + timestamp,
    Aquitania: "PED-AQUITANIA-" + timestamp,
    Hansel: "PED-HANSEL-" + timestamp
  };

  let updatedCount = 0;
  let addedCount = 0;
  let orderCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    if (parts.length < 8) continue;

    const prodName = parts[0].trim();
    const tibQtyRaw = parts[1].trim();
    const nobQtyRaw = parts[2].trim();
    const firQtyRaw = parts[3].trim();
    const aquQtyRaw = parts[4].trim();
    const hanQtyRaw = parts[5].trim();
    const provName = parts[6].trim() || "Plaza Central";
    const rawCost = parts[7].trim();
    const extraNotes = parts[8] && parts[8].trim() !== "SI" && parts[8].trim() !== "" ? parts[8].trim() : "";

    const costNum = rawCost ? parseFloat(rawCost) : 0;

    // 1. Try to find existing product
    let prod = db.products.find(p => p.Producto.toLowerCase().trim() === prodName.toLowerCase().trim());

    if (!prod) {
      // Create new product
      const firstLetter = prodName.charAt(0).toUpperCase() || "X";
      const count = db.products.filter(p => p.Codigo.startsWith(firstLetter)).length + 1;
      const code = firstLetter + String(count).padStart(2, "0");

      prod = {
        Codigo: code,
        Producto: prodName,
        Medida: "Kg",
        Merma: 0.05,
        Utilidad: 0.30,
        Proveedor: provName,
        Celular: "3100000000",
        Costo_Proveedor: costNum || 1000,
        Precio_Venta_Actual: Math.round((costNum || 1000) * 1.30),
        Precio_Anterior: costNum || 1000,
        Venta_Anterior: Math.round((costNum || 1000) * 1.30),
        Factor_Bulto: 1,
        Factor_Canastilla: 1
      };
      db.products.push(prod);
      addedCount++;
    } else {
      // Update catalog details
      prod.Proveedor = provName;
      if (costNum > 0) {
        prod.Costo_Proveedor = costNum;
        prod.Precio_Venta_Actual = Math.round(costNum * (1 + prod.Utilidad));
      }
      updatedCount++;
    }

    // 2. Create orders for the sucursales
    const sucursalQtys = [
      { name: "Tibasosa", raw: tibQtyRaw },
      { name: "Nobsa", raw: nobQtyRaw },
      { name: "Fira", raw: firQtyRaw },
      { name: "Aquitania", raw: aquQtyRaw },
      { name: "Hansel", raw: hanQtyRaw }
    ];

    for (const sq of sucursalQtys) {
      const parsedQty = parseFraction(sq.raw);
      if (parsedQty > 0) {
        // Calculate kilos
        let kilos = parsedQty;
        const medLower = prod.Medida.toLowerCase();
        if (medLower.includes("bulto") || medLower === "kg") {
          kilos = parsedQty * prod.Factor_Bulto;
        } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
          kilos = parsedQty * prod.Factor_Canastilla;
        }

        const newOrder: Order = {
          ID_Pedido: oids[sq.name],
          Fecha: orderDate,
          Sucursal: sq.name,
          Codigo: prod.Codigo,
          Producto: prod.Producto,
          Medida: prod.Medida,
          Cantidad: sq.raw.trim(),
          Notas: extraNotes || "Sincronizado vía adjunto de pedido",
          Precio_Anterior: prod.Precio_Venta_Actual,
          Porcentaje_Ganancia: prod.Utilidad,
          Cantidad_Comprada: parsedQty,
          Costo_Momento: costNum || prod.Costo_Proveedor,
          Precio_Venta_Momento: prod.Precio_Venta_Actual,
          Kilos: kilos,
          Estado: "Comprado",
          Estado_Pago: "Pendiente",
          Proveedor: prod.Proveedor,
          Celular: prod.Celular
        };

        const exists = db.orders.some(o => 
          o.Fecha === orderDate && 
          o.Sucursal.toLowerCase().trim() === sq.name.toLowerCase().trim() && 
          o.Codigo === prod.Codigo
        );
        if (!exists) {
          db.orders.push(newOrder);
          orderCount++;
        }
      }
    }
  }

  console.log("Importacion completada: " + addedCount + " nuevos, " + updatedCount + " actualizados, " + orderCount + " pedidos creados para la fecha " + orderDate);
  return true;
}
