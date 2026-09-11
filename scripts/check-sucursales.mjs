/**
 * Impide que vuelvan a aparecer listas de sucursales escritas a mano.
 *
 * Por qué existe: las sucursales estuvieron listadas como texto fijo en más de
 * una docena de lugares — columnas del catálogo, selectores, tablas de
 * proveedores, el monedero, la nómina, la matriz de compras. Cuando se creó
 * 18sogamoso no apareció en ninguno, y cada pantalla rota se fue descubriendo
 * de a una, en producción y con el negocio andando.
 *
 * La lista debe venir del servidor (GET /api/admin/branch-configs), que además
 * la filtra según el rol de quien mira. DEFAULT_BRANCHES queda solo como
 * respaldo si esa petición falla.
 *
 * Qué se marca: DOS O MÁS sucursales nombradas juntas — una lista, un objeto
 * con una clave por sucursal, o una cadena de comparaciones. Ese es el patrón
 * que deja fuera a una sucursal nueva. Una mención suelta (un valor por
 * defecto, un texto de ayuda, la ciudad en una dirección) no rompe nada y no
 * se marca.
 *
 * Si esto te bloquea: no agregues tu archivo a PERMITIDOS. Usa la lista de la
 * sesión — `sucursales` en Comprador y Sucursal, `sucursalesPermitidas` en Admin.
 */
import fs from "fs";
import path from "path";

const NOMBRES = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];

// financialCalculations.ts define DEFAULT_BRANCHES (el respaldo sin conexión) y
// server/db.ts la configuración inicial que se siembra en la base.
const PERMITIDOS = new Set([
  path.normalize("src/utils/financialCalculations.ts"),
  path.normalize("server/db.ts"),
]);

/** Ventana de líneas que se examina junta, para detectar objetos multilínea. */
const VENTANA = 6;

function archivosDe(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      archivosDe(completo, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(completo);
    }
  }
  return acc;
}

/**
 * Líneas que no cuentan: solo comentarios. El texto visible NO se perdona:
 * antes sí, y por eso pasaron los ejemplos del pegado de pedidos, que el
 * servidor reparte por posición de columna.
 *
 * Se evalúa LÍNEA POR LÍNEA a propósito: al evaluarlo sobre toda la ventana,
 * un comentario cercano desactivaba el chequeo del bloque entero.
 */
function seIgnora(linea) {
  const t = linea.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** Quita el comentario del final de una línea de código. */
function sinComentarioFinal(linea) {
  const i = linea.indexOf("//");
  if (i === -1) return linea;
  // Se evita cortar dentro de una URL como https://…
  if (i > 0 && linea[i - 1] === ":") return linea;
  return linea.slice(0, i);
}

const hallazgos = [];
for (const archivo of [...archivosDe("src"), ...archivosDe("server"), "server.ts"]) {
  const relativo = path.normalize(archivo);
  if (PERMITIDOS.has(relativo) || !fs.existsSync(archivo)) continue;

  const lineas = fs.readFileSync(archivo, "utf-8").split("\n");
  const yaReportadas = new Set();

  for (let i = 0; i < lineas.length; i++) {
    // Se descartan las líneas ignorables y se examina lo que queda.
    const fragmento = lineas
      .slice(i, i + VENTANA)
      .filter((l) => !seIgnora(l))
      .map(sinComentarioFinal)
      .join("\n");

    const enMinusculas = fragmento.toLowerCase();
    const presentes = NOMBRES.filter((n) => enMinusculas.includes(n.toLowerCase()));
    // Con una sola sucursal no hay lista: no rompe a las demás.
    if (presentes.length < 2) continue;
    if (yaReportadas.has(i)) continue;

    for (let j = i; j < i + VENTANA; j++) yaReportadas.add(j);
    hallazgos.push({
      archivo: relativo,
      linea: i + 1,
      sucursales: presentes.join(", "),
      texto: lineas[i].trim().slice(0, 100),
    });
  }
}

if (hallazgos.length > 0) {
  console.error("\n❌ Hay listas de sucursales escritas a mano:\n");
  for (const h of hallazgos) {
    console.error(`   ${h.archivo}:${h.linea}  (${h.sucursales})`);
    console.error(`      ${h.texto}\n`);
  }
  console.error("   Una sucursal nueva no aparecería aquí.");
  console.error("   Usa `sucursales` (Comprador/Sucursal) o `sucursalesPermitidas` (Admin),");
  console.error("   que salen de /api/admin/branch-configs y ya vienen filtradas por rol.\n");
  process.exit(1);
}

console.log("✓ Sin listas de sucursales escritas a mano.");
