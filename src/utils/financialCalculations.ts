import { DailyClosure, WalletTransaction, PayrollRecord } from "../types";

// Respaldo si falla la consulta al servidor. Mismo orden que usa el negocio.
export const DEFAULT_BRANCHES = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];

/**
 * Efectivo que todavía está físicamente en una sucursal.
 *
 * De cada cierre sin recoger se toma lo que queda: el neto del día menos lo que
 * ya se haya recogido a cuenta (Monto_Recaudado). Antes se tomaba el neto
 * completo, así que una recogida parcial no bajaba nada y esa plata aparecía a
 * la vez en la tienda y fuera de ella.
 *
 * Al final se restan los gastos de la sucursal que están pendientes de cuadrar.
 */
export function calculateBranchUncollected(
  closures: DailyClosure[] = [],
  walletTxs: WalletTransaction[] = [],
  branchName: string
): number {
  if (!branchName) return 0;
  const targetBranch = branchName.toLowerCase().trim();

  const uncollectedClosuresSum = closures
    .filter(
      (c) =>
        c &&
        !c.Recaudado_Fisico &&
        (c.Sucursal || "").toLowerCase().trim() === targetBranch
    )
    .reduce(
      (acc, c) =>
        acc +
        Math.max(0, (c.Ventas_Totales || 0) - (c.Gastos_Extra || 0) - (c.Monto_Recaudado || 0)),
      0
    );

  const pendingExpensesSum = walletTxs
    .filter(
      (t) =>
        t &&
        (t.Sucursal || "").toLowerCase().trim() === targetBranch &&
        t.Tipo_Movimiento === "Gasto" &&
        (t.Estado === "Pendiente" || !t.Estado)
    )
    .reduce((acc, t) => acc + (t.Valor || 0), 0);

  return Math.max(0, uncollectedClosuresSum - pendingExpensesSum);
}

/**
 * Counts uncollected closures for a given branch.
 */
export function getBranchPendingCount(
  closures: DailyClosure[] = [],
  branchName: string
): number {
  if (!branchName) return 0;
  const targetBranch = branchName.toLowerCase().trim();
  return closures.filter(
    (c) =>
      c &&
      !c.Recaudado_Fisico &&
      (c.Sucursal || "").toLowerCase().trim() === targetBranch
  ).length;
}

/**
 * Calculates total uncollected cash across all branches.
 */
export function calculateTotalUncollected(
  closures: DailyClosure[] = [],
  walletTxs: WalletTransaction[] = [],
  branches: string[] = DEFAULT_BRANCHES
): number {
  return branches.reduce(
    (acc, b) => acc + calculateBranchUncollected(closures, walletTxs, b),
    0
  );
}

/**
 * Plata que de verdad se ha recogido de las sucursales.
 *
 * Se suma Monto_Recaudado, que incluye las recogidas parciales. Antes se sumaba
 * el neto completo de los cierres marcados como recogidos, y lo recogido a
 * cuenta no figuraba en ninguna parte.
 */
export function calculateReconciledClosuresSum(
  closures: DailyClosure[] = []
): number {
  return closures.reduce((acc, c) => {
    if (!c) return acc;
    const neto = (c.Ventas_Totales || 0) - (c.Gastos_Extra || 0);
    // Cierres viejos, de antes de que se guardara el monto: si están marcados
    // como recogidos se recogió el día entero.
    const recogido = c.Monto_Recaudado ?? (c.Recaudado_Fisico ? neto : 0);
    return acc + recogido;
  }, 0);
}

/**
 * Calculates total paid payroll sum.
 */
export function calculatePaidPayrollSum(
  payroll: PayrollRecord[] = []
): number {
  // Solo la nómina realmente pagada entra al saldo central. Antes se sumaba el
  // Total_Neto de todas las liquidaciones (Pendiente o Pagado), así que generar
  // la nómina del mes —sin haber pagado a nadie— "desaparecía" esa plata de la
  // Caja General.
  return payroll
    .filter((p) => p && p.Estado_Pago === "Pagado")
    .reduce((acc, p) => acc + (p?.Total_Neto || 0), 0);
}

/**
 * Saldo de la Caja General / Monedero.
 *
 * Se lee del libro de movimientos de "Central / Nequi": entra lo que entró,
 * sale lo que salió. Nada se vuelve a deducir de los cierres.
 *
 * Antes el ingreso se armaba de dos pedazos — el neto de los cierres marcados
 * como recogidos, más los ingresos manuales que NO dijeran "Recolección
 * Física". Una recogida parcial caía entre los dos: el cierre no quedaba
 * marcado (solo se recogió una parte), y su movimiento se llama "Recolección
 * Física Parcial Autorizada", así que el filtro de texto también lo descartaba.
 * Esa plata entraba a la caja y no aparecía por ningún lado.
 */
export function calculateCentralBalance(
  _closures: DailyClosure[] = [],
  payroll: PayrollRecord[] = [],
  walletTxs: WalletTransaction[] = []
): number {
  const paidPayroll = calculatePaidPayrollSum(payroll);

  const centralTxs = walletTxs.filter((t) => {
    const s = (t?.Sucursal || "").toLowerCase().trim();
    return s.includes("central") || s.includes("nequi");
  });

  const ingresos = centralTxs
    .filter((t) => t.Tipo_Movimiento === "Ingreso")
    .reduce((acc, t) => acc + (t.Valor || 0), 0);

  const gastos = centralTxs
    .filter((t) => t.Tipo_Movimiento === "Gasto")
    .reduce((acc, t) => acc + (t.Valor || 0), 0);

  return ingresos - (paidPayroll + gastos);
}
