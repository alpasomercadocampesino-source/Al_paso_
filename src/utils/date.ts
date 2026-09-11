/**
 * Returns the current date in Colombia's timezone (UTC-5) formatted as YYYY-MM-DD.
 * Colombia does not observe Daylight Saving Time (DST).
 */
export function getColombiaDate(): string {
  const d = new Date();
  // Adjust UTC time by subtracting 5 hours to get Colombia local time
  const colTime = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return colTime.toISOString().split("T")[0];
}

/**
 * Returns yesterday's date in Colombia's timezone (UTC-5) formatted as YYYY-MM-DD.
 */
export function getColombiaYesterdayDate(): string {
  const d = new Date();
  // Adjust UTC time by subtracting 5 hours (Colombia) and another 24 hours (yesterday)
  const colTime = new Date(d.getTime() - 5 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return colTime.toISOString().split("T")[0];
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Convierte "2026-09" en "Septiembre 2026", para mostrarlo en pantalla.
 * Se arma con los números del texto, sin pasar por Date, porque construir una
 * fecha desde un día 01 la corre al mes anterior en la zona de Colombia.
 */
export function nombreDeMes(mes: string): string {
  if (!mes || mes.length < 7) return mes || "";
  const anio = mes.slice(0, 4);
  const indice = Number(mes.slice(5, 7)) - 1;
  if (indice < 0 || indice > 11) return mes;
  return `${MESES[indice]} ${anio}`;
}
