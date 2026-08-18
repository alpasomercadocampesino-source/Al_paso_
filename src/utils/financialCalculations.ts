import { DailyClosure, WalletTransaction, PayrollRecord } from "../types";

export const DEFAULT_BRANCHES = ["Nobsa", "Tibasosa", "Fira", "Aquitania", "Hansel"];

/**
 * Calculates the exact pending uncollected cash for a specific branch.
 * Formula: Sum of net closure amounts (Ventas_Totales - Gastos_Extra) for uncollected closures (!Recaudado_Fisico)
 * MINUS pending branch wallet expenses (Tipo_Movimiento === "Gasto" && Estado === "Pendiente").
 * Note: Per DB architecture, no local delivery history or partial Monto_Recaudado is stored or subtracted per branch.
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
    .reduce((acc, c) => acc + ((c.Ventas_Totales || 0) - (c.Gastos_Extra || 0)), 0);

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
 * Calculates total net cash from reconciled closures.
 */
export function calculateReconciledClosuresSum(
  closures: DailyClosure[] = []
): number {
  return closures
    .filter((c) => c && c.Recaudado_Fisico)
    .reduce((acc, c) => acc + ((c.Ventas_Totales || 0) - (c.Gastos_Extra || 0)), 0);
}

/**
 * Calculates total paid payroll sum.
 */
export function calculatePaidPayrollSum(
  payroll: PayrollRecord[] = []
): number {
  return payroll.reduce((acc, p) => acc + (p?.Total_Neto || 0), 0);
}

/**
 * Calculates Central / Nequi Wallet Balance.
 * Central receives reconciled closure collections and manual Central income,
 * and pays out payroll and manual Central expenses.
 */
export function calculateCentralBalance(
  closures: DailyClosure[] = [],
  payroll: PayrollRecord[] = [],
  walletTxs: WalletTransaction[] = []
): number {
  const reconciledClosures = calculateReconciledClosuresSum(closures);
  const paidPayroll = calculatePaidPayrollSum(payroll);

  const centralTxs = walletTxs.filter((t) => {
    const s = (t?.Sucursal || "").toLowerCase().trim();
    return s.includes("central") || s.includes("nequi");
  });

  const manualCentralIngresos = centralTxs
    .filter(
      (t) =>
        t.Tipo_Movimiento === "Ingreso" &&
        !t.Descripcion?.includes("Recolección Física") &&
        !t.Descripcion?.includes("Recaudo Cierre")
    )
    .reduce((acc, t) => acc + (t.Valor || 0), 0);

  const centralGastos = centralTxs
    .filter((t) => t.Tipo_Movimiento === "Gasto")
    .reduce((acc, t) => acc + (t.Valor || 0), 0);

  return (
    reconciledClosures + manualCentralIngresos - (paidPayroll + centralGastos)
  );
}
