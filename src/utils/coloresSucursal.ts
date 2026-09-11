/**
 * Color de cada sucursal, derivado de su nombre.
 *
 * Antes cada pantalla tenía su propia cadena de `if (sucursal === "Nobsa")`, así
 * que una sucursal nueva salía en gris en todas partes mientras las cinco
 * originales tenían color. Ahora el color se calcula del nombre: siempre el
 * mismo para la misma sucursal, y cualquiera nueva recibe el suyo sin tocar
 * código.
 */

const PALETA = [
  { clases: "bg-blue-50 text-blue-700 border-blue-200", bg: "#eff6ff", texto: "#1d4ed8", borde: "#bfdbfe" },
  { clases: "bg-pink-50 text-pink-700 border-pink-200", bg: "#fdf2f8", texto: "#be185d", borde: "#fbcfe8" },
  { clases: "bg-orange-50 text-orange-700 border-orange-200", bg: "#fff7ed", texto: "#c2410c", borde: "#ffedd5" },
  { clases: "bg-purple-50 text-purple-700 border-purple-200", bg: "#faf5ff", texto: "#6b21a8", borde: "#e9d5ff" },
  { clases: "bg-red-50 text-red-700 border-red-200", bg: "#fff1f2", texto: "#be123c", borde: "#fecdd3" },
  { clases: "bg-amber-50 text-amber-700 border-amber-200", bg: "#fffbeb", texto: "#b45309", borde: "#fde68a" },
  { clases: "bg-teal-50 text-teal-700 border-teal-200", bg: "#f0fdfa", texto: "#0f766e", borde: "#99f6e4" },
  { clases: "bg-indigo-50 text-indigo-700 border-indigo-200", bg: "#eef2ff", texto: "#4338ca", borde: "#c7d2fe" },
];

// "Plaza" y "Descanso" no son sucursales: son estados del turno y conviene que
// se distingan a simple vista del resto.
const ESPECIALES: Record<string, (typeof PALETA)[number]> = {
  plaza: { clases: "bg-emerald-50 text-emerald-700 border-emerald-200", bg: "#ecfdf5", texto: "#047857", borde: "#a7f3d0" },
  descanso: { clases: "bg-slate-100 text-slate-500 border-slate-200", bg: "#f1f5f9", texto: "#64748b", borde: "#e2e8f0" },
};

function indiceDe(nombre: string): number {
  // Suma simple de caracteres: estable entre recargas y entre navegadores.
  let suma = 0;
  const limpio = nombre.toLowerCase().trim();
  for (let i = 0; i < limpio.length; i++) suma += limpio.charCodeAt(i);
  return suma % PALETA.length;
}

function paletaDe(nombre: string) {
  const clave = (nombre || "").toLowerCase().trim();
  if (!clave) return ESPECIALES.descanso;
  return ESPECIALES[clave] || PALETA[indiceDe(clave)];
}

/** Clases de Tailwind (fondo, texto y borde) para una etiqueta de sucursal. */
export function clasesSucursal(nombre: string): string {
  return paletaDe(nombre).clases;
}

/** Colores en hexadecimal, para dibujar en un canvas. */
export function coloresSucursal(nombre: string): { bg: string; texto: string; borde: string } {
  const p = paletaDe(nombre);
  return { bg: p.bg, texto: p.texto, borde: p.borde };
}
