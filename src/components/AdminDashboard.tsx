import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { toPng } from "html-to-image";
import { 
  ShieldCheck, LayoutGrid, ShoppingCart, Library, History, 
  PlusCircle, Edit2, Check, RefreshCw, Smartphone, TrendingUp, DollarSign,
  FileSpreadsheet, Wallet, Calendar, Boxes, Receipt, Printer, Trash2, ArrowUpRight, ArrowDownRight, ClipboardList, Plus, Download, Calculator, X, Settings, Store, Search, Edit,
  ArrowUpDown, ArrowUp, ArrowDown, Users, Phone, PhoneCall, AlertTriangle, CheckCircle2, Camera
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Product, Provider, PriceHistory, DailyClosure, WalletTransaction, EmployeeSchedule, EmployeeLoan, EmployeeRate, PayrollRecord, PackagingMovement, SyncLog } from "../types";
import {
  calculateBranchUncollected,
  calculateTotalUncollected,
  calculateReconciledClosuresSum,
  calculatePaidPayrollSum,
  calculateCentralBalance,
  getBranchPendingCount as getBranchPendingCountUtil,
  DEFAULT_BRANCHES,
} from "../utils/financialCalculations";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
  AreaChart,
  Area,
  Cell
} from "recharts";

interface BranchConfigRowProps {
  branch: string;
  initialConfig?: { baseCaja: number; recolectorPredeterminado: string; montoAlerta: number };
  onSave: (branch: string, baseCaja: number, recolectorPredeterminado: string, montoAlerta: number) => Promise<void>;
}

function BranchConfigRow({ branch, initialConfig, onSave }: BranchConfigRowProps) {
  const defaultConf = { baseCaja: 0, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 };
  const conf = initialConfig || defaultConf;

  const [montoAlerta, setMontoAlerta] = useState(conf.montoAlerta);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (initialConfig) {
      setMontoAlerta(initialConfig.montoAlerta);
    }
  }, [initialConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(branch, 0, "Hamilton", montoAlerta);
    setIsSaving(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  return (
    <tr className="hover:bg-slate-50/50 transition">
      <td className="py-3.5 px-3 font-bold text-slate-800 text-sm">{branch}</td>
      <td className="py-3.5 px-3 font-semibold text-slate-500 text-xs">Hamilton</td>
      <td className="py-3.5 px-3">
        <div className="relative rounded-xl shadow-sm max-w-[160px]">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-450 font-semibold text-xs">$</span>
          <input
            type="number"
            value={montoAlerta}
            onChange={(e) => setMontoAlerta(Number(e.target.value))}
            className="w-full pl-7 pr-3 py-1.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:outline-none rounded-xl text-xs font-semibold text-slate-700"
            placeholder="500000"
          />
        </div>
      </td>
      <td className="py-3.5 px-3 text-right">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`px-3 py-1.5 text-[11px] font-bold rounded-xl transition cursor-pointer inline-flex items-center gap-1 ${
            justSaved
              ? "bg-emerald-500 text-slate-950 font-black shadow-sm"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {isSaving ? "Guardando..." : justSaved ? "¡Guardado!" : "Guardar"}
        </button>
      </td>
    </tr>
  );
}

interface AdminDashboardProps {
  adminName: string;
  lastGlobalSync?: number;
  /**
   * Si viene, este panel administra solo esa sucursal (rol AdminSucursal).
   * El servidor ya filtra los datos; esto además limita lo que se puede elegir
   * en pantalla para no ofrecer sucursales que la sesión no puede tocar.
   */
  sucursalAsignada?: string;
}

export default function AdminDashboard({ adminName, lastGlobalSync, sucursalAsignada }: AdminDashboardProps) {
  // Alcance de sucursales de esta sesión.
  const sucursalesPermitidas = sucursalAsignada ? [sucursalAsignada] : DEFAULT_BRANCHES;
  const esAdminDeUnaSucursal = !!sucursalAsignada;
  const [adminMode, setAdminMode] = useState<
    "master" | "sucursal" | "catalog" | "factors" | "history" | "reconciliation" | "payroll_smart" | "packaging_ledger" | "closures_receipts" | "products_manager" | "provider_accounts" | "purchase_reports" | "users" | "sync_logs"
  >("master");

  // Sync Logs state
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logServiceFilter, setLogServiceFilter] = useState<string>("all");
  const [logStatusFilter, setLogStatusFilter] = useState<"all" | "success" | "error" | "warning">("all");
  const [logSearchQuery, setLogSearchQuery] = useState("");
  const [testingService, setTestingService] = useState<string | null>(null);
  const [syncFeedbackMsg, setSyncFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSyncLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch("/api/sync-logs");
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data);
      }
    } catch (err) {
      console.error("Error al cargar logs de sincronización:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (adminMode === "sync_logs") {
      fetchSyncLogs();
    }
  }, [adminMode]);

  // State filters for master catalog
  const [filterPriceChanges, setFilterPriceChanges] = useState<"all" | "buy" | "sell" | "any">("all");
  // Ver solo los productos que alguna sucursal pidió en la fecha seleccionada.
  const [soloPedidos, setSoloPedidos] = useState(false);
  const [factorsSearch, setFactorsSearch] = useState("");

  // Modal state for adding product in Factors & Weights tab
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [modalCode, setModalCode] = useState("");
  const [modalName, setModalName] = useState("");
  const [modalMedida, setModalMedida] = useState("Kg");
  const [modalProv, setModalProv] = useState("Sin Proveedor");
  const [modalCost, setModalCost] = useState("");
  const [modalUtil, setModalUtil] = useState("30");
  const [modalFactorBto, setModalFactorBto] = useState("56");
  const [modalFactorCan, setModalFactorCan] = useState("22");
  const [modalMerma, setModalMerma] = useState("0");
  
  // Branch simulation state
  const [simBranch, setSimBranch] = useState("Nobsa");

  // Catalog manager state
  const [products, setProducts] = useState<Product[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
  
  // Price history visualization state
  const [historySelectedProduct, setHistorySelectedProduct] = useState<string>("all");
  const [historyChartTab, setHistoryChartTab] = useState<"volatility" | "recent">("volatility");
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [historyShowSuggestions, setHistoryShowSuggestions] = useState(false);

  // Refs for HTML-to-Image generation
  const rosterCaptureRef = useRef<HTMLDivElement>(null);
  const receiptCaptureRef = useRef<HTMLDivElement>(null);

  // Admin Sub-Modules states
  const [closures, setClosures] = useState<DailyClosure[]>([]);
  const [packaging, setPackaging] = useState<PackagingMovement[]>([]);
  const [schedules, setSchedules] = useState<EmployeeSchedule[]>([]);
  const [loans, setLoans] = useState<EmployeeLoan[]>([]);
  const [payroll, setPayroll] = useState<PayrollRecord[]>([]);
  const [rates, setRates] = useState<EmployeeRate[]>([]);

  // Wallet & Filtration States
  const [walletTxs, setWalletTxs] = useState<WalletTransaction[]>([]);
  const [closuresFilterBranch, setClosuresFilterBranch] = useState<string>("all");
  // Orden del listado de cierres: por defecto del más reciente al más antiguo.
  const [ordenCierresAdmin, setOrdenCierresAdmin] = useState<"reciente" | "antiguo">("reciente");
  const [closuresFilterDate, setClosuresFilterDate] = useState<string>("");
  const [closuresFilterStartDate, setClosuresFilterStartDate] = useState<string>("");
  const [closuresFilterEndDate, setClosuresFilterEndDate] = useState<string>("");
  const [selectedBranchForWalletHistory, setSelectedBranchForWalletHistory] = useState<string>(sucursalAsignada || "Nobsa");

  // Smart Voice-Order simulated recording state
  const [isRecording, setIsRecording] = useState(false);

  // Selected supplier for packaging ledger filter
  const [selectedSupplier, setSelectedSupplier] = useState("");

  // Selected closure for Printable Receipt modal
  const [activeReceipt, setActiveReceipt] = useState<DailyClosure | null>(null);
  // Recibo de precios nuevos para enviar a las sucursales (solo precio de venta).
  const [showPriceReceipt, setShowPriceReceipt] = useState(false);

  // Monthly Calendar & Schedule View States
  const [calendarViewMode, setCalendarViewMode] = useState<"weekly" | "monthly">("monthly");
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState<number>(new Date().getMonth());
  const [currentCalendarYear, setCurrentCalendarYear] = useState<number>(new Date().getFullYear());
  const [selectedDayForSchedule, setSelectedDayForSchedule] = useState<string | null>(null); // YYYY-MM-DD
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);
  const [schedFormEmployee, setSchedFormEmployee] = useState("");
  const [schedFormStore, setSchedFormStore] = useState("");
  const [schedFormHours, setSchedFormHours] = useState("8");

  // Reportes de compras por sucursal
  const [reportStartDate, setReportStartDate] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv');
  });
  const [reportEndDate, setReportEndDate] = useState<string>(() => {
    return new Date().toLocaleDateString('sv');
  });
  const [allOrdersForReport, setAllOrdersForReport] = useState<any[]>([]);
  const [isFetchingReportOrders, setIsFetchingReportOrders] = useState<boolean>(false);

  // Table Sorting States
  const [matrixSortField, setMatrixSortField] = useState<string>("Producto");
  const [matrixSortDir, setMatrixSortDir] = useState<"asc" | "desc">("asc");

  const [pmSortField, setPmSortField] = useState<string>("Producto");
  const [pmSortDir, setPmSortDir] = useState<"asc" | "desc">("asc");

  const [paSortField, setPaSortField] = useState<string>("proveedor");
  const [paSortDir, setPaSortDir] = useState<"asc" | "desc">("asc");

  const [prSortField, setPrSortField] = useState<string>("totalReal");
  const [prSortDir, setPrSortDir] = useState<"asc" | "desc">("desc");

  const toggleMatrixSort = (field: string) => {
    if (matrixSortField === field) {
      setMatrixSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setMatrixSortField(field);
      setMatrixSortDir("asc");
    }
  };

  const togglePmSort = (field: string) => {
    if (pmSortField === field) {
      setPmSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setPmSortField(field);
      setPmSortDir("asc");
    }
  };

  const togglePaSort = (field: string) => {
    if (paSortField === field) {
      setPaSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setPaSortField(field);
      setPaSortDir("asc");
    }
  };

  const togglePrSort = (field: string) => {
    if (prSortField === field) {
      setPrSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setPrSortField(field);
      setPrSortDir("asc");
    }
  };

  const [factorsSortField, setFactorsSortField] = useState<string>("Producto");
  const [factorsSortDir, setFactorsSortDir] = useState<"asc" | "desc">("asc");

  const toggleFactorsSort = (field: string) => {
    if (factorsSortField === field) {
      setFactorsSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setFactorsSortField(field);
      setFactorsSortDir("asc");
    }
  };

  // User Management State
  const [users, setUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // Branch Configs State
  const [branchConfigs, setBranchConfigs] = useState<{
    [branch: string]: { baseCaja: number; recolectorPredeterminado: string; montoAlerta: number }
  }>({});

  const fetchBranchConfigs = async () => {
    try {
      const res = await fetch("/api/admin/branch-configs");
      if (res.ok) {
        const data = await res.json();
        setBranchConfigs(data);
      }
    } catch (e) {
      console.error("Error fetching branch configs:", e);
    }
  };

  const handleSaveBranchConfig = async (branch: string, baseCaja: number, recolectorPredeterminado: string, montoAlerta: number) => {
    try {
      const res = await fetch("/api/admin/branch-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, baseCaja, recolectorPredeterminado, montoAlerta }),
      });
      if (res.ok) {
        fetchBranchConfigs();
      }
    } catch (e) {
      console.error("Error saving branch config:", e);
    }
  };

  // Weekly Shift Roster State [LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO]
  const [weeklyRoster, setWeeklyRoster] = useState<{
    [employee: string]: {
      [day: string]: { sucursal: string; horas: number; extras: number }
    }
  }>({
    "Hamilton": {
      "LUNES": { sucursal: "Plaza", horas: 8, extras: 2 },
      "MARTES": { sucursal: "Plaza", horas: 8, extras: 1 },
      "MIERCOLES": { sucursal: "Plaza", horas: 8, extras: 0 },
      "JUEVES": { sucursal: "Plaza", horas: 8, extras: 3 },
      "VIERNES": { sucursal: "Plaza", horas: 8, extras: 0 },
      "SABADO": { sucursal: "Plaza", horas: 8, extras: 2 },
      "DOMINGO": { sucursal: "Descanso", horas: 0, extras: 0 }
    },
    "Nelson": {
      "LUNES": { sucursal: "Nobsa", horas: 8, extras: 0 },
      "MARTES": { sucursal: "Tibasosa", horas: 8, extras: 2 },
      "MIERCOLES": { sucursal: "Fira", horas: 8, extras: 0 },
      "JUEVES": { sucursal: "Nobsa", horas: 8, extras: 1 },
      "VIERNES": { sucursal: "Tibasosa", horas: 8, extras: 0 },
      "SABADO": { sucursal: "Fira", horas: 8, extras: 4 },
      "DOMINGO": { sucursal: "Descanso", horas: 0, extras: 0 }
    },
    "Felipe": {
      "LUNES": { sucursal: "Fira", horas: 8, extras: 0 },
      "MARTES": { sucursal: "Nobsa", horas: 8, extras: 0 },
      "MIERCOLES": { sucursal: "Tibasosa", horas: 8, extras: 2 },
      "JUEVES": { sucursal: "Fira", horas: 8, extras: 0 },
      "VIERNES": { sucursal: "Nobsa", horas: 8, extras: 1 },
      "SABADO": { sucursal: "Tibasosa", horas: 8, extras: 2 },
      "DOMINGO": { sucursal: "Descanso", horas: 0, extras: 0 }
    }
  });

  // Individual payroll selection & loan registry states
  const [selectedPayrollEmployee, setSelectedPayrollEmployee] = useState<string>("Hamilton");
  const [payrollPeriod, setPayrollPeriod] = useState<"Semanal" | "Mensual">("Mensual");
  const [payrollCalculationBase, setPayrollCalculationBase] = useState<"Teorico" | "Calendario">("Calendario");

  // Manual payroll overrides & adjustments
  const [manualDaysWorked, setManualDaysWorked] = useState<string>("");
  const [manualStandardHours, setManualStandardHours] = useState<string>("");
  const [manualOvertimeHours, setManualOvertimeHours] = useState<string>("");
  const [manualFestiveHours, setManualFestiveHours] = useState<string>("0");
  const [manualFestivePay, setManualFestivePay] = useState<string>("");
  const [manualCompDays, setManualCompDays] = useState<string>("0");
  const [discountedExtraHours, setDiscountedExtraHours] = useState<string>("0");
  const [manualTransportAllowance, setManualTransportAllowance] = useState<string>("");
  const [manualDeductions, setManualDeductions] = useState<string>("");

  // Weekly Roster Sync States
  const [selectedRosterWeekIndex, setSelectedRosterWeekIndex] = useState<string>("1");
  const [rosterSyncEmployee, setRosterSyncEmployee] = useState<string>("ALL");

  // Reset manual overrides when employee or period changes
  useEffect(() => {
    setManualDaysWorked("");
    setManualStandardHours("");
    setManualOvertimeHours("");
    setManualFestiveHours("0");
    setManualFestivePay("");
    setManualCompDays("0");
    setDiscountedExtraHours("0");
    setManualTransportAllowance("");
    setManualDeductions("");
  }, [selectedPayrollEmployee, payrollCalculationBase, currentCalendarMonth, currentCalendarYear]);
  
  // Consolidated Payroll View modes and filters
  const [consolidatedViewMode, setConsolidatedViewMode] = useState<"summary" | "daily_excel">("summary");
  const [dailyExcelFilterStore, setDailyExcelFilterStore] = useState<string>("");
  const [dailyExcelFilterWorker, setDailyExcelFilterWorker] = useState<string>("");

  // Employee/Worker management states
  const [editingEmpName, setEditingEmpName] = useState<string | null>(null);
  const [empFormName, setEmpFormName] = useState("");
  const [empFormPhone, setEmpFormPhone] = useState("");
  const [empFormDailyRate, setEmpFormDailyRate] = useState("60000");
  const [empFormHourlyRate, setEmpFormHourlyRate] = useState("9000");
  const [empFormTransportRate, setEmpFormTransportRate] = useState("8303");
  const [empFormCedula, setEmpFormCedula] = useState("");
  const [empFeedback, setEmpFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showEmpFeedback = (type: "success" | "error", message: string) => {
    setEmpFeedback({ type, message });
    setTimeout(() => {
      setEmpFeedback(null);
    }, 5000);
  };

  // Reconcile detail and re-confirmation modal states
  const [selectedBranchForReconcile, setSelectedBranchForReconcile] = useState<string | null>(null);
  const [reconcileModalLoading, setReconcileModalLoading] = useState<boolean>(false);

  const handleToggleSingleClosureReconcile = async (fecha: string, sucursal: string, currentStatus: boolean) => {
    setReconcileModalLoading(true);
    try {
      const res = await fetch("/api/closures/reconcile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: fecha,
          Sucursal: sucursal,
          Recaudado_Fisico: !currentStatus
        })
      });
      if (res.ok) {
        await fetchAdminSubData();
      } else {
        const data = await res.json();
        alert(data.error || "Error al actualizar estado del cierre.");
      }
    } catch (e) {
      alert("Error de red al actualizar estado del cierre.");
    } finally {
      setReconcileModalLoading(false);
    }
  };

  // State for dynamic payroll receipt PNG capture
  const [captureReceiptData, setCaptureReceiptData] = useState<{ emp: string; result: any } | null>(null);

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empFormName) {
      showEmpFeedback("error", "Por favor digite el nombre del colaborador.");
      return;
    }

    try {
      if (editingEmpName) {
        const res = await fetch(`/api/payroll/rates/${encodeURIComponent(editingEmpName)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Empleado: empFormName.trim(),
            Valor_Dia: parseFloat(empFormDailyRate) || 0,
            Valor_Hora: parseFloat(empFormHourlyRate) || 0,
            Auxilio_Transporte: parseFloat(empFormTransportRate) || 0,
            Celular: empFormPhone.trim(),
            Cedula: empFormCedula.trim()
          })
        });
        if (res.ok) {
          showEmpFeedback("success", `¡Colaborador "${empFormName.trim()}" actualizado exitosamente!`);
          setEditingEmpName(null);
          setEmpFormName("");
          setEmpFormPhone("");
          setEmpFormDailyRate("60000");
          setEmpFormHourlyRate("9000");
          setEmpFormTransportRate("8303");
          setEmpFormCedula("");
          if (selectedPayrollEmployee === editingEmpName) {
            setSelectedPayrollEmployee(empFormName.trim());
          }
          await fetchAdminSubData();
        } else {
          const err = await res.json();
          showEmpFeedback("error", err.error || "Error al actualizar el colaborador.");
        }
      } else {
        const res = await fetch("/api/payroll/rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Empleado: empFormName.trim(),
            Valor_Dia: parseFloat(empFormDailyRate) || 0,
            Valor_Hora: parseFloat(empFormHourlyRate) || 0,
            Auxilio_Transporte: parseFloat(empFormTransportRate) || 0,
            Celular: empFormPhone.trim(),
            Cedula: empFormCedula.trim()
          })
        });
        if (res.ok) {
          showEmpFeedback("success", `¡Colaborador "${empFormName.trim()}" guardado exitosamente!`);
          setEmpFormName("");
          setEmpFormPhone("");
          setEmpFormDailyRate("60000");
          setEmpFormHourlyRate("9000");
          setEmpFormTransportRate("8303");
          setEmpFormCedula("");
          await fetchAdminSubData();
        } else {
          const err = await res.json();
          showEmpFeedback("error", err.error || "Error al crear el colaborador.");
        }
      }
    } catch (err) {
      showEmpFeedback("error", "Error de conexión con el servidor.");
    }
  };

  const handleDeleteEmployee = async (name: string) => {
    if (!window.confirm(`¿Seguro que desea eliminar al colaborador ${name}? No aparecerá en el roster ni nómina actual.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/payroll/rates/${encodeURIComponent(name)}`, {
        method: "DELETE"
      });
      if (res.ok) {
        showEmpFeedback("success", `¡Colaborador "${name}" eliminado exitosamente!`);
        if (selectedPayrollEmployee === name) {
          setSelectedPayrollEmployee("Hamilton");
        }
        await fetchAdminSubData();
      } else {
        showEmpFeedback("error", "Error al eliminar el colaborador.");
      }
    } catch (err) {
      showEmpFeedback("error", "Error de conexión al intentar eliminar el colaborador.");
    }
  };

  const sendScheduleToWhatsApp = (emp: string) => {
    const rateObj = rates.find(r => r.Empleado.toLowerCase() === emp.toLowerCase());
    const rawPhone = rateObj?.Celular;
    if (!rawPhone) {
      alert(`El colaborador ${emp} no tiene un número de celular registrado.`);
      return;
    }
    
    const phone = String(rawPhone);
    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 10) {
      formattedPhone = "57" + formattedPhone;
    }

    const roster = weeklyRoster[emp] || {};
    let scheduleText = `🍒 *AL PASO MERCADO CAMPESINO* 🍒\n\n`;
    scheduleText += `¡Hola *${emp}*! Aquí tienes tu programación de turnos para esta semana:\n\n`;
    
    daysOfWeek.forEach(day => {
      const cell = roster[day] || { sucursal: "Descanso" };
      scheduleText += `📅 *${day}*: ${cell.sucursal}\n`;
    });
    
    scheduleText += `\n¡Te deseamos una excelente semana laboral! 🚀✨`;
    
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(scheduleText)}`;
    window.open(whatsappUrl, "_blank");
  };

  const [loanEmp, setLoanEmp] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanReason, setLoanReason] = useState("");
  const [loanBranch, setLoanBranch] = useState("Plaza");

  const handleSaveLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanEmp || !loanAmount) {
      alert("Por favor seleccione un empleado y digite el monto.");
      return;
    }
    try {
      const res = await fetch("/api/payroll/loan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: new Date(Date.now() - 5 * 3600000).toISOString().split("T")[0],
          Empleado: loanEmp,
          Sucursal: loanBranch,
          Monto: parseFloat(loanAmount),
          Motivo: loanReason || "Adelanto de Nómina"
        })
      });
      if (res.ok) {
        alert(`¡Préstamo de $ ${parseFloat(loanAmount).toLocaleString("es-CO")} guardado exitosamente para ${loanEmp}!`);
        setLoanAmount("");
        setLoanReason("");
        setLoanEmp("");
        setLoanBranch("Plaza");
        await fetchAdminSubData();
      } else {
        alert("Error al guardar el préstamo.");
      }
    } catch (err) {
      alert("Error de conexión al guardar el préstamo.");
    }
  };

  const handleSaveCalendarSchedule = async (fecha: string, empleado: string, sucursal: string, horas: number) => {
    if (!fecha || !empleado || !sucursal) {
      alert("Por favor complete todos los datos del turno.");
      return;
    }
    try {
      const res = await fetch("/api/payroll/schedule/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: fecha,
          Empleado: empleado,
          Sucursal: sucursal,
          Horas_Trabajadas: horas
        })
      });
      if (res.ok) {
        await fetchAdminSubData();
      } else {
        alert("Error al guardar el turno.");
      }
    } catch (err) {
      alert("Error de conexión al guardar el turno.");
    }
  };

  const handleDeleteCalendarSchedule = async (fecha: string, empleado: string) => {
    const confirmed = window.confirm(`¿Está seguro de eliminar el turno asignado para ${empleado} el día ${fecha}?`);
    if (!confirmed) return;
    try {
      const res = await fetch("/api/payroll/schedule/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: fecha,
          Empleado: empleado
        })
      });
      if (res.ok) {
        await fetchAdminSubData();
      } else {
        alert("Error al eliminar el turno.");
      }
    } catch (err) {
      alert("Error de conexión al eliminar el turno.");
    }
  };

  const downloadScheduleHTML = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      alert("Su navegador no soporta la generación de imágenes.");
      return;
    }

    const dpr = 2; // high-res
    const colWidths = [180, 130, 130, 130, 130, 130, 130, 130]; // sum = 1090
    const startX = 0;
    const tableWidth = 1090;
    const rowHeight = 65;
    const empCount = rates.length;
    const tableHeight = (empCount + 1) * rowHeight;

    canvas.width = tableWidth * dpr;
    canvas.height = tableHeight * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tableWidth, tableHeight);

    const startY = 0;

    // Table Header Row background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(startX, startY, 1090, rowHeight);

    // Border outline for table
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(startX, startY, 1090, (empCount + 1) * rowHeight);

    // Header labels
    ctx.fillStyle = "#475569";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("COLABORADOR", startX + 20, startY + (rowHeight / 2) + 5);

    ctx.textAlign = "center";
    daysOfWeek.forEach((day, i) => {
      const x = startX + colWidths[0] + (i * colWidths[1]) + (colWidths[1] / 2);
      ctx.fillText(day, x, startY + (rowHeight / 2) + 5);
    });

    // Bottom border for header row
    ctx.strokeStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(startX, startY + rowHeight);
    ctx.lineTo(startX + 1090, startY + rowHeight);
    ctx.stroke();

    // Row drawing
    let currentY = startY + rowHeight;
    rates.forEach((r, idx) => {
      const emp = r.Empleado;
      const roster = weeklyRoster[emp] || {};

      // Alternating row background
      if (idx % 2 === 1) {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(startX, currentY, 1090, rowHeight);
      }

      // Draw name
      ctx.fillStyle = "#1e293b"; // Charcoal
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(emp, startX + 20, currentY + (rowHeight / 2) + 5);

      // Days columns - draw badge
      daysOfWeek.forEach((day, i) => {
        const cell = roster[day] || { sucursal: "Descanso" };
        const store = cell.sucursal || "Descanso";

        const colX = startX + colWidths[0] + (i * colWidths[1]);
        const cellWidth = colWidths[1];

        // Badge measurements
        const pillWidth = 92;
        const pillHeight = 28;
        const pillX = colX + (cellWidth - pillWidth) / 2;
        const pillY = currentY + (rowHeight - pillHeight) / 2;

        // Colors
        let pillBg = "#f1f5f9";
        let pillText = "#475569";
        let pillBorder = "#cbd5e1";

        if (store === "Plaza") {
          pillBg = "#ecfdf5";
          pillText = "#047857";
          pillBorder = "#a7f3d0";
        } else if (store === "Nobsa") {
          pillBg = "#eff6ff";
          pillText = "#1d4ed8";
          pillBorder = "#bfdbfe";
        } else if (store === "Tibasosa") {
          pillBg = "#fdf2f8";
          pillText = "#be185d";
          pillBorder = "#fbcfe8";
        } else if (store === "Fira") {
          pillBg = "#fff7ed";
          pillText = "#c2410c";
          pillBorder = "#ffedd5";
        } else if (store === "Aquitania") {
          pillBg = "#faf5ff";
          pillText = "#6b21a8";
          pillBorder = "#e9d5ff";
        } else if (store === "Hansel") {
          pillBg = "#fff1f2";
          pillText = "#be123c";
          pillBorder = "#fecdd3";
        }

        // Draw pill background
        ctx.fillStyle = pillBg;
        ctx.strokeStyle = pillBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 14);
        } else {
          ctx.rect(pillX, pillY, pillWidth, pillHeight);
        }
        ctx.fill();
        ctx.stroke();

        // Draw pill label
        ctx.fillStyle = pillText;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(store, pillX + (pillWidth / 2), pillY + (pillHeight / 2) + 4);
      });

      // Row bottom line
      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(startX, currentY + rowHeight);
      ctx.lineTo(startX + 1090, currentY + rowHeight);
      ctx.stroke();

      currentY += rowHeight;
    });

    // Trigger download
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `Horario_Semanal_Al_Paso_${new Date().toISOString().split('T')[0]}.png`;
    link.href = dataUrl;
    link.click();
  };

  const buildMonthlyCalendarExcelRows = (year: number, month: number) => {
    const targetPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const dayOfWeekNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

    // Filter schedules for the selected month
    const monthSchedulesSorted = schedules
      .filter((s) => s.Fecha.startsWith(targetPrefix))
      .sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.Empleado.localeCompare(b.Empleado));

    if (monthSchedulesSorted.length === 0) {
      // Generate fallback rows from weeklyRoster if no calendar schedules saved yet
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const rows: any[] = [];
      const daysOfWeekMap = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month, d);
        const dayName = daysOfWeekMap[dt.getDay()];
        const dayStr = dayOfWeekNames[dt.getDay()];
        const monthStr = monthNames[month];
        const dateLabel = `${d}-${monthStr}`;

        employees.forEach((emp) => {
          const roster = weeklyRoster[emp] || {};
          const cell = roster[dayName];
          if (cell && cell.sucursal && cell.sucursal !== "Descanso") {
            const hrs = parseFloat(cell.horas) || 8;
            const extra = Math.max(0, hrs - 7);
            rows.push({
              "FECHA": dateLabel,
              "MES": monthStr,
              "DIA": dayStr,
              "SUCURSAL": cell.sucursal.toUpperCase(),
              "TRABAJADOR": emp.toLowerCase(),
              "HORAS TRABAJADAS": hrs,
              "HORAS EXTRA": parseFloat(extra.toFixed(2))
            });
          }
        });
      }
      return rows;
    }

    return monthSchedulesSorted.map((s) => {
      const dt = new Date(s.Fecha + "T12:00:00");
      const dayNum = dt.getDate();
      const monthStr = monthNames[dt.getMonth()];
      const dayStr = dayOfWeekNames[dt.getDay()];
      const extraHours = Math.max(0, s.Horas_Trabajadas - 7);

      return {
        "FECHA": `${dayNum}-${monthStr}`,
        "MES": monthStr,
        "DIA": dayStr,
        "SUCURSAL": (s.Sucursal || "PLAZA").toUpperCase(),
        "TRABAJADOR": s.Empleado.toLowerCase(),
        "HORAS TRABAJADAS": s.Horas_Trabajadas,
        "HORAS EXTRA": parseFloat(extraHours.toFixed(2))
      };
    });
  };

  const handleExportMonthlyCalendarExcel = () => {
    try {
      const rows = buildMonthlyCalendarExcelRows(currentCalendarYear, currentCalendarMonth);
      const monthNamesFull = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      const monthName = monthNamesFull[currentCalendarMonth];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [
        {
          "FECHA": "1-ene",
          "MES": "ene",
          "DIA": "lunes",
          "SUCURSAL": "PLAZA",
          "TRABAJADOR": "ejemplo",
          "HORAS TRABAJADAS": 8,
          "HORAS EXTRA": 1
        }
      ]);

      // Column formatting widths
      ws["!cols"] = [
        { wch: 12 }, // FECHA
        { wch: 10 }, // MES
        { wch: 14 }, // DIA
        { wch: 16 }, // SUCURSAL
        { wch: 20 }, // TRABAJADOR
        { wch: 18 }, // HORAS TRABAJADAS
        { wch: 15 }  // HORAS EXTRA
      ];

      XLSX.utils.book_append_sheet(wb, ws, "Calendario Mensual");
      XLSX.writeFile(wb, `Calendario_Mensual_${monthName}_${currentCalendarYear}.xlsx`);
    } catch (err: any) {
      alert(`Error al exportar el calendario a Excel: ${err.message || err}`);
    }
  };

  const handleExportScheduleXLSX = () => {
    try {
      // Sheet 1: Roster Semanal
      const weeklyData: any[] = [];
      rates.forEach((r) => {
        const emp = r.Empleado;
        const roster = weeklyRoster[emp] || {};
        const row: any = { Colaborador: emp };
        daysOfWeek.forEach((day) => {
          const cell = roster[day] || { sucursal: "Descanso" };
          row[day] = cell.sucursal || "Descanso";
        });
        weeklyData.push(row);
      });

      // Sheet 2: Cronograma Mensual (Matriz por días)
      const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
      const monthlyData: any[] = [];

      employees.forEach((emp) => {
        const row: any = { Colaborador: emp };
        for (let d = 1; d <= daysInMonth; d++) {
          const paddedM = String(currentCalendarMonth + 1).padStart(2, "0");
          const paddedD = String(d).padStart(2, "0");
          const dateStr = `${currentCalendarYear}-${paddedM}-${paddedD}`;
          const match = schedules.find((s) => s.Fecha === dateStr && s.Empleado.toLowerCase() === emp.toLowerCase());
          row[`Día ${d}`] = match ? `${match.Sucursal} (${match.Horas_Trabajadas}h)` : "Descanso";
        }
        monthlyData.push(row);
      });

      // Sheet 3: Calendario Detallado (Formato Excel por Filas)
      const dailyRows = buildMonthlyCalendarExcelRows(currentCalendarYear, currentCalendarMonth);

      const wb = XLSX.utils.book_new();
      const wsWeekly = XLSX.utils.json_to_sheet(weeklyData);
      const wsMonthly = XLSX.utils.json_to_sheet(monthlyData);
      const wsDaily = XLSX.utils.json_to_sheet(dailyRows.length > 0 ? dailyRows : [
        { FECHA: "N/A", MES: "N/A", DIA: "N/A", SUCURSAL: "N/A", TRABAJADOR: "N/A", "HORAS TRABAJADAS": 0, "HORAS EXTRA": 0 }
      ]);

      XLSX.utils.book_append_sheet(wb, wsDaily, "Calendario Detallado");
      XLSX.utils.book_append_sheet(wb, wsWeekly, "Roster Semanal");
      XLSX.utils.book_append_sheet(wb, wsMonthly, "Matriz Mensual");

      const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      const fileName = `Cronograma_Horarios_${monthNames[currentCalendarMonth]}_${currentCalendarYear}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err: any) {
      alert(`Error al exportar horario a Excel: ${err.message || err}`);
    }
  };

  const downloadPayrollReceipt = async (emp: string, result: any) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      alert("Su navegador no soporta la generación de imágenes.");
      return;
    }

    const {
      daysWorked,
      totalDaysBase,
      standardHours,
      overtimeHours,
      finalOvertimeHours,
      festiveHours,
      festivePay,
      compDays,
      compPay,
      totalSueldoBaseComp,
      basePay,
      extraPay,
      transportAllowance,
      grossPay,
      healthDeduction,
      pensionDeduction,
      totalLoansDeducted,
      totalNet,
      storeSplits
    } = result;

    const dpr = 2.5; // very high-quality print render
    const width = 450;
    const storesCount = Object.keys(storeSplits).length;
    const height = 690 + (storesCount * 18);

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Fine border
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    const drawContent = () => {
      // Header section - Logo on Left, Title Text on Right
      const logoSize = 48;
      ctx.drawImage(img, 30, 20, logoSize, logoSize);

      ctx.textAlign = "left";
      ctx.fillStyle = "#1e293b"; // Charcoal

      ctx.font = "bold 18px monospace";
      ctx.fillText("Al Paso", 88, 38);

      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "#475569";
      ctx.fillText("MERCADO CAMPESINO", 88, 52);

      ctx.font = "9px monospace";
      ctx.fillText("Sogamoso - Boyacá | NIT: 1049615024-1", 88, 65);

      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "#0f766e"; // Teal
      ctx.textAlign = "center";
      ctx.fillText("RECIBO INDIVIDUAL DE PAGO", width / 2, 95);

      // Separator line
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]); // Dashed POS ticket style
      ctx.beginPath();
      ctx.moveTo(25, 110);
      ctx.lineTo(width - 25, 110);
      ctx.stroke();
      ctx.setLineDash([]); // solid

      const dataYStart = 110 + 20; // 130px

      // Info Block
      ctx.textAlign = "left";
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 11px monospace";

      const daysCount = totalDaysBase || daysWorked;
      const netOvertimeHours = finalOvertimeHours !== undefined ? finalOvertimeHours : overtimeHours;

      ctx.fillText(`Colaborador: ${emp.toUpperCase()}`, 30, dataYStart);
      ctx.fillText(`Fecha Pago : ${new Date().toLocaleDateString("es-CO")}`, 30, dataYStart + 16);
      ctx.fillText(`Días Liq.  : ${daysCount} días`, 30, dataYStart + 32);
      ctx.fillText(`Horas Ord. : ${standardHours} h`, 30, dataYStart + 48);
      ctx.fillText(`Horas Ext. : ${netOvertimeHours} h`, 30, dataYStart + 64);

      // Divider
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(25, dataYStart + 78);
      ctx.lineTo(width - 25, dataYStart + 78);
      ctx.stroke();

      const itemYStart = dataYStart + 96;

      // Devengados
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "#475569";
      ctx.fillText("CONCEPTOS DEVENGADOS", 30, itemYStart);

      ctx.font = "11px monospace";
      ctx.fillStyle = "#1e293b";

      // CONSOLIDATED CONCEPT: Sueldo Ordinario y Días Compensados
      const unifiedSueldo = totalSueldoBaseComp || (basePay + (compPay || 0));
      ctx.fillText(`Sueldo Ord. y Comp. (${daysCount} d)`, 30, itemYStart + 18);
      ctx.textAlign = "right";
      ctx.fillText(cop(unifiedSueldo), width - 30, itemYStart + 18);

      ctx.textAlign = "left";
      let nextY = itemYStart + 34;

      if (netOvertimeHours > 0) {
        ctx.fillText(`Horas Extras (${netOvertimeHours} h)`, 30, nextY);
        ctx.textAlign = "right";
        ctx.fillText(`+${cop(extraPay)}`, width - 30, nextY);
        ctx.textAlign = "left";
        nextY += 16;
      }

      if (festivePay > 0) {
        ctx.fillText(`Recargos Festivos (${festiveHours || 0} h)`, 30, nextY);
        ctx.textAlign = "right";
        ctx.fillText(`+${cop(festivePay)}`, width - 30, nextY);
        ctx.textAlign = "left";
        nextY += 16;
      }

      ctx.fillText("Auxilio Transporte", 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(`+${cop(transportAllowance)}`, width - 30, nextY);

      ctx.textAlign = "left";
      nextY += 20;

      // Total Devengado
      ctx.fillStyle = "#0f766e";
      ctx.font = "bold 11px monospace";
      ctx.fillText("Total Devengado:", 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(cop(grossPay), width - 30, nextY);

      ctx.textAlign = "left";
      nextY += 16;

      // Divider
      ctx.strokeStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.moveTo(25, nextY);
      ctx.lineTo(width - 25, nextY);
      ctx.stroke();
      nextY += 14;

      // Deducciones
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "#475569";
      ctx.fillText("DEDUCCIONES LEGALES Y ADELANTOS", 30, nextY);
      nextY += 18;

      ctx.font = "11px monospace";
      ctx.fillStyle = "#1e293b";

      ctx.fillText("Aporte Salud (4%)", 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(`-${cop(healthDeduction)}`, width - 30, nextY);

      ctx.textAlign = "left";
      nextY += 16;

      ctx.fillText("Aporte Pensión (4%)", 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(`-${cop(pensionDeduction)}`, width - 30, nextY);

      ctx.textAlign = "left";
      nextY += 16;

      if (totalLoansDeducted > 0) {
        ctx.fillText("Descuento Adelantos", 30, nextY);
        ctx.textAlign = "right";
        ctx.fillText(`-${cop(totalLoansDeducted)}`, width - 30, nextY);
        ctx.textAlign = "left";
        nextY += 16;
      }

      // Divider
      ctx.strokeStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.moveTo(25, nextY);
      ctx.lineTo(width - 25, nextY);
      ctx.stroke();
      nextY += 15;

      // TOTAL NETO A PAGAR Box
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(25, nextY, width - 50, 42);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(25, nextY, width - 50, 42);

      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "#1e293b";
      ctx.fillText("TOTAL NETO A TRANSFERIR", 35, nextY + 25);
      ctx.textAlign = "right";
      ctx.font = "bold 13px monospace";
      ctx.fillText(cop(totalNet), width - 35, nextY + 25);

      ctx.textAlign = "left";
      nextY += 60;

      // Distribución centros costo
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = "#475569";
      ctx.fillText("DISTRIBUCIÓN POR CENTRO DE COSTO", 30, nextY);
      nextY += 16;

      ctx.font = "9px monospace";
      ctx.fillStyle = "#475569";
      Object.entries(storeSplits).forEach(([store, info]: any) => {
        ctx.fillText(`🏪 Tienda ${store} (${info.daysInBranch || 0} d):`, 30, nextY);
        ctx.textAlign = "right";
        ctx.fillText(cop(info.totalShare), width - 30, nextY);
        ctx.textAlign = "left";
        nextY += 14;
      });

      nextY += 25;

      // Signature line
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, nextY + 30);
      ctx.lineTo(width - 60, nextY + 30);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.font = "9px monospace";
      ctx.fillStyle = "#64748b";
      ctx.fillText("Firma de Conformidad del Colaborador", width / 2, nextY + 44);
      ctx.fillText(`C.C. ___________________________`, width / 2, nextY + 56);

      // Trigger download
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `Recibo_Pago_${emp}_${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      link.click();
    };

    // Draw logo image
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "/logo_al_paso.png";
    img.onload = () => {
      drawContent();
    };
    img.onerror = () => {
      drawContent();
    };
  };

  const generateReceiptCanvasUrl = (emp: string, result: any): string => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    const {
      daysWorked,
      totalDaysBase,
      standardHours,
      overtimeHours,
      finalOvertimeHours,
      festiveHours,
      festivePay,
      compDays,
      compPay,
      totalSueldoBaseComp,
      basePay,
      extraPay,
      transportAllowance,
      grossPay,
      healthDeduction,
      pensionDeduction,
      totalLoansDeducted,
      totalNet,
      storeSplits
    } = result;

    const width = 450;
    const height = 680;

    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Fine border
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    // Header section - Logo layout offset to left, title on right
    ctx.textAlign = "left";
    ctx.fillStyle = "#1e293b"; // Charcoal

    ctx.font = "bold 18px monospace";
    ctx.fillText("Al Paso", 88, 38);

    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText("MERCADO CAMPESINO", 88, 52);

    ctx.font = "9px monospace";
    ctx.fillText("Sogamoso - Boyacá | NIT: 1049615024-1", 88, 65);

    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#0f766e"; // Teal
    ctx.textAlign = "center";
    ctx.fillText("RECIBO INDIVIDUAL DE PAGO", width / 2, 95);

    // Separator line
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]); // Dashed POS ticket style
    ctx.beginPath();
    ctx.moveTo(25, 110);
    ctx.lineTo(width - 25, 110);
    ctx.stroke();
    ctx.setLineDash([]); // solid

    const dataYStart = 110 + 20; // 130px

    // Info Block
    ctx.textAlign = "left";
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 11px monospace";

    const daysCount = totalDaysBase || daysWorked;
    const netOvertimeHours = finalOvertimeHours !== undefined ? finalOvertimeHours : overtimeHours;

    ctx.fillText(`Colaborador: ${emp.toUpperCase()}`, 30, dataYStart);
    ctx.fillText(`Fecha Pago : ${new Date().toLocaleDateString("es-CO")}`, 30, dataYStart + 16);
    ctx.fillText(`Días Liq.  : ${daysCount} días`, 30, dataYStart + 32);
    ctx.fillText(`Horas Ord. : ${standardHours} h`, 30, dataYStart + 48);
    ctx.fillText(`Horas Ext. : ${netOvertimeHours} h`, 30, dataYStart + 64);

    const festH = parseFloat(festiveHours || "0") || 0;
    if (festH > 0) {
      ctx.fillText(`Horas Fest.: ${festH} h`, 30, dataYStart + 80);
    }

    // Divider
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const dividerY = dataYStart + (festH > 0 ? 94 : 78);
    ctx.moveTo(25, dividerY);
    ctx.lineTo(width - 25, dividerY);
    ctx.stroke();

    const itemYStart = dividerY + 18;

    // Devengados
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText("CONCEPTOS DEVENGADOS", 30, itemYStart);

    ctx.font = "11px monospace";
    ctx.fillStyle = "#1e293b";

    // CONSOLIDATED CONCEPT: Sueldo Ordinario y Días Compensados
    const unifiedSueldo = totalSueldoBaseComp || (basePay + (compPay || 0));
    ctx.fillText(`Sueldo Ord. y Comp. (${daysCount} d)`, 30, itemYStart + 18);
    ctx.textAlign = "right";
    ctx.fillText(cop(unifiedSueldo), width - 30, itemYStart + 18);

    ctx.textAlign = "left";
    let nextY = itemYStart + 34;

    if (netOvertimeHours > 0) {
      ctx.fillText(`Horas Extras (${netOvertimeHours} h)`, 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(`+${cop(extraPay)}`, width - 30, nextY);
      ctx.textAlign = "left";
      nextY += 16;
    }

    if (festivePay > 0) {
      ctx.fillText(`Recargos Festivos (${festH} h)`, 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(`+${cop(festivePay)}`, width - 30, nextY);
      ctx.textAlign = "left";
      nextY += 16;
    }

    ctx.fillText("Auxilio Transporte", 30, nextY);
    ctx.textAlign = "right";
    ctx.fillText(`+${cop(transportAllowance)}`, width - 30, nextY);

    ctx.textAlign = "left";
    nextY += 20;

    // Total Devengado
    ctx.fillStyle = "#0f766e";
    ctx.font = "bold 11px monospace";
    ctx.fillText("Total Devengado:", 30, nextY);
    ctx.textAlign = "right";
    ctx.fillText(cop(grossPay), width - 30, nextY);

    ctx.textAlign = "left";
    nextY += 16;

    // Divider
    ctx.strokeStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(25, nextY);
    ctx.lineTo(width - 25, nextY);
    ctx.stroke();
    nextY += 14;

    // Deducciones
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#475569";
    ctx.fillText("DEDUCCIONES LEGALES Y ADELANTOS", 30, nextY);
    nextY += 18;

    ctx.font = "11px monospace";
    ctx.fillStyle = "#1e293b";

    ctx.fillText("Aporte Salud (4%)", 30, nextY);
    ctx.textAlign = "right";
    ctx.fillText(`-${cop(healthDeduction)}`, width - 30, nextY);

    ctx.textAlign = "left";
    nextY += 16;

    ctx.fillText("Aporte Pensión (4%)", 30, nextY);
    ctx.textAlign = "right";
    ctx.fillText(`-${cop(pensionDeduction)}`, width - 30, nextY);

    ctx.textAlign = "left";
    nextY += 16;

    if (totalLoansDeducted > 0) {
      ctx.fillText("Descuento Adelantos", 30, nextY);
      ctx.textAlign = "right";
      ctx.fillText(`-${cop(totalLoansDeducted)}`, width - 30, nextY);
      ctx.textAlign = "left";
      nextY += 16;
    }

    // Divider
    ctx.strokeStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(25, nextY);
    ctx.lineTo(width - 25, nextY);
    ctx.stroke();
    nextY += 15;

    // TOTAL NETO A PAGAR Box
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(25, nextY, width - 50, 42);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(25, nextY, width - 50, 42);

    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#1e293b";
    ctx.fillText("TOTAL NETO A TRANSFERIR", 35, nextY + 25);
    ctx.textAlign = "right";
    ctx.font = "bold 13px monospace";
    ctx.fillText(cop(totalNet), width - 35, nextY + 25);

    ctx.textAlign = "left";
    nextY += 60;

    // Signature line
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, nextY + 30);
    ctx.lineTo(width - 60, nextY + 30);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.font = "9px monospace";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Firma de Conformidad del Colaborador", width / 2, nextY + 44);
    ctx.fillText(`C.C. ___________________________`, width / 2, nextY + 56);

    return canvas.toDataURL("image/png");
  };

  const fetchAdminSubData = async () => {
    try {
      const closuresRes = await fetch("/api/closures");
      if (closuresRes.ok) {
        const closuresData = await closuresRes.json();
        if (Array.isArray(closuresData)) setClosures(closuresData);
      }
    } catch (e) {
      console.warn("Could not fetch closures sub-module data:", e);
    }
    
    try {
      const packRes = await fetch("/api/packaging");
      if (packRes.ok) {
        const packData = await packRes.json();
        if (Array.isArray(packData)) setPackaging(packData);
      }
    } catch (e) {
      console.warn("Could not fetch packaging sub-module data:", e);
    }

    try {
      const payrollRes = await fetch("/api/payroll/data");
      if (payrollRes.ok) {
        const payrollData = await payrollRes.json();
        if (payrollData && typeof payrollData === "object") {
          setSchedules(payrollData.schedules || []);
          setLoans(payrollData.loans || []);
          setRates(payrollData.rates || []);
          setPayroll(payrollData.payroll || []);
        }
      }
    } catch (e) {
      console.warn("Could not fetch payroll sub-module data:", e);
    }

    try {
      const walletRes = await fetch("/api/wallet-transactions");
      if (walletRes.ok) {
        const walletData = await walletRes.json();
        if (Array.isArray(walletData)) setWalletTxs(walletData);
      }
    } catch (e) {
      console.warn("Could not fetch wallet sub-module data:", e);
    }
  };

  // Add Product form state
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newMedida, setNewMedida] = useState("Kg");
  const [newCost, setNewCost] = useState("");
  const [newUtil, setNewUtil] = useState("0.3");
  const [newProv, setNewProv] = useState("");
  
  // Add Provider form state
  const [provName, setProvName] = useState("");
  const [provCell, setProvCell] = useState("");

  // Provider Directory / Manager modal
  const [showProviderManagerModal, setShowProviderManagerModal] = useState(false);
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [editingProviderName, setEditingProviderName] = useState<string | null>(null);
  const [editingProviderCell, setEditingProviderCell] = useState("");
  const [newProvModalName, setNewProvModalName] = useState("");
  const [newProvModalCell, setNewProvModalCell] = useState("");

  const handleSaveProviderPhone = async (provName: string, newCell: string) => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(provName)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Celular: newCell })
      });
      if (res.ok) {
        setSuccessMsg(`¡Teléfono de ${provName} actualizado a "${newCell || "Sin número"}" con éxito!`);
        setEditingProviderName(null);
        await fetchProviders();
        await fetchProducts();
        if (adminMode === "provider_accounts") await fetchAccountsOrders();
      } else {
        const data = await res.json();
        throw new Error(data.error || "No se pudo actualizar el teléfono.");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNewProviderModal = async () => {
    if (!newProvModalName.trim()) {
      setErrorMsg("El nombre del proveedor es obligatorio.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Proveedor: newProvModalName.trim(),
          Celular: newProvModalCell.trim()
        })
      });
      if (res.ok) {
        setSuccessMsg(`¡Proveedor ${newProvModalName.trim()} creado con éxito!`);
        setNewProvModalName("");
        setNewProvModalCell("");
        await fetchProviders();
      } else {
        const data = await res.json();
        throw new Error(data.error || "Error al crear el proveedor.");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Edit product inline modal
  const [editingProd, setEditingProd] = useState<Product | null>(null);
  const [editCost, setEditCost] = useState("");
  const [editVenta, setEditVenta] = useState("");
  const [editUtil, setEditUtil] = useState("");
  const [editProv, setEditProv] = useState("");

  // Edit closure states
  const [editingClosure, setEditingClosure] = useState<DailyClosure | null>(null);
  const [editClosureVentas, setEditClosureVentas] = useState("");
  const [editClosureGastos, setEditClosureGastos] = useState("");
  const [editClosureDesc, setEditClosureDesc] = useState("");
  const [editClosureRecogio, setEditClosureRecogio] = useState("");
  const [editClosureExpenseItems, setEditClosureExpenseItems] = useState<{ desc: string; value: number }[]>([]);

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Custom confirmation modal state to replace window.confirm inside iframe
  const [customConfirm, setCustomConfirm] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Master Matrix states
  const [matrixDate, setMatrixDate] = useState(new Date().toLocaleDateString('sv'));
  const [matrixOrders, setMatrixOrders] = useState<any[]>([]);
  const [matrixEdits, setMatrixEdits] = useState<{ [code: string]: any }>({});
  const [matrixSearch, setMatrixSearch] = useState("");

  // Product Manager states
  const [productManagerSearch, setProductManagerSearch] = useState("");

  // Provider Accounts and CSV Import states
  const [csvTextInput, setCsvTextInput] = useState("");
  const [accountsDate, setAccountsDate] = useState(new Date().toLocaleDateString('sv'));
  const [accountsOrders, setAccountsOrders] = useState<any[]>([]);
  const [activeProviderReceipt, setActiveProviderReceipt] = useState<{
    proveedor: string;
    celular: string;
    totalReal: number;
    totalEstimado: number;
    sucursales: {
      [suc: string]: { real: number; estimado: number };
    };
    unpaidCount: number;
    orders: any[];
  } | null>(null);

  const fetchAccountsOrders = async () => {
    try {
      const res = await fetch(`/api/orders?fecha=${accountsDate}`);
      if (res.ok) {
        const data = await res.json();
        setAccountsOrders(data);
      }
    } catch (e) {
      console.error("Error fetching accounts orders:", e);
    }
  };

  const fetchAllOrdersForReport = async () => {
    setIsFetchingReportOrders(true);
    try {
      const res = await fetch("/api/orders");
      if (res.ok) {
        const data = await res.json();
        setAllOrdersForReport(data);
      }
    } catch (e) {
      console.error("Error fetching all orders for report:", e);
    } finally {
      setIsFetchingReportOrders(false);
    }
  };

  // Add Order Modal states for Admin
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [selectedProductForNewOrder, setSelectedProductForNewOrder] = useState<Product | null>(null);
  const [newOrderSearchQuery, setNewOrderSearchQuery] = useState("");
  const [newOrderBranchQty, setNewOrderBranchQty] = useState<{ [branch: string]: string }>({
    Tibasosa: "",
    Nobsa: "",
    Fira: "",
    Aquitania: "",
    Hansel: ""
  });
  const [newOrderNotes, setNewOrderNotes] = useState("");

  const handleAddNewOrder = async () => {
    if (!selectedProductForNewOrder) {
      setErrorMsg("Debe seleccionar un producto del catálogo");
      return;
    }

    const branchesWithQty = Object.entries(newOrderBranchQty).filter(
      ([_, qty]) => parseQty(qty) > 0
    );

    if (branchesWithQty.length === 0) {
      setErrorMsg("Debe ingresar cantidad mayor a 0 para al menos una sucursal");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      // For each branch, create the order
      for (const [sucursal, qty] of branchesWithQty) {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sucursal,
            fecha: matrixDate,
            items: [
              {
                Codigo: selectedProductForNewOrder.Codigo,
                Cantidad: qty,
                Notes: newOrderNotes
              }
            ]
          })
        });
        if (!res.ok) {
          throw new Error(`Error al crear pedido en sucursal ${sucursal}`);
        }
      }

      setSuccessMsg(`¡Producto ${selectedProductForNewOrder.Producto} agregado con éxito a los pedidos!`);
      setShowAddOrderModal(false);
      setSelectedProductForNewOrder(null);
      setNewOrderSearchQuery("");
      setNewOrderBranchQty({
        Tibasosa: "",
        Nobsa: "",
        Fira: "",
        Aquitania: "",
        Hansel: ""
      });
      setNewOrderNotes("");
      fetchMatrixOrders();
    } catch (err: any) {
      setErrorMsg(err.message || "Error al agregar pedido");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = async (code: string) => {
    setCustomConfirm({
      isOpen: true,
      title: "Eliminar Producto",
      message: `¿Está totalmente segura de que desea eliminar el producto [${code}] del catálogo maestro? Esta acción es irreversible.`,
      onConfirm: async () => {
        setLoading(true);
        setErrorMsg("");
        setSuccessMsg("");
        try {
          const res = await fetch(`/api/products/${code}`, { method: "DELETE" });
          if (res.ok) {
            setSuccessMsg(`Producto [${code}] eliminado con éxito.`);
            await fetchProducts();
          } else {
            const data = await res.json();
            throw new Error(data.error || "No se pudo eliminar el producto");
          }
        } catch (err: any) {
          setErrorMsg(err.message);
        } finally {
          setLoading(false);
          setCustomConfirm(null);
        }
      }
    });
  };

  const handleImportCsvOrders = async () => {
    if (!csvTextInput.trim()) {
      setErrorMsg("Por favor, ingrese o pegue el texto de los pedidos.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/admin/import-csv-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText: csvTextInput,
          fecha: accountsDate
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSuccessMsg(`¡Importación exitosa! Se procesaron ${data.count} pedidos para la fecha ${data.date}.`);
        setCsvTextInput("");
        await fetchProducts();
        await fetchAccountsOrders();
        await fetchMatrixOrders();
      } else {
        const data = await res.json();
        throw new Error(data.error || "Error al importar pedidos");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseQty = (q: string | undefined | null): number => {
    if (!q) return 0;
    const cleaned = String(q).trim().replace(",", ".").replace(/\s+/g, " ");
    if (cleaned === "" || cleaned === "-") return 0;
    
    const mixedMatch = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/) || cleaned.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (mixedMatch) {
      const whole = parseInt(mixedMatch[1], 10);
      const num = parseInt(mixedMatch[2], 10);
      const den = parseInt(mixedMatch[3], 10);
      if (den !== 0) {
        return whole + (num / den);
      }
    }

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
    
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  const formatQty = (val: number): string => {
    if (isNaN(val) || val <= 0) return "-";
    const whole = Math.floor(val);
    const frac = val - whole;
    if (frac === 0) return String(whole);

    let fracStr = "";
    if (Math.abs(frac - 0.5) < 0.05) fracStr = "1/2";
    else if (Math.abs(frac - 0.25) < 0.05) fracStr = "1/4";
    else if (Math.abs(frac - 0.75) < 0.05) fracStr = "3/4";
    else if (Math.abs(frac - 0.33) < 0.05) fracStr = "1/3";
    else if (Math.abs(frac - 0.67) < 0.05) fracStr = "2/3";
    else if (Math.abs(frac - 0.125) < 0.02) fracStr = "1/8";
    else if (Math.abs(frac - 0.375) < 0.02) fracStr = "3/8";
    else if (Math.abs(frac - 0.625) < 0.02) fracStr = "5/8";
    else if (Math.abs(frac - 0.875) < 0.02) fracStr = "7/8";
    else return val.toFixed(1);

    return whole > 0 ? `${whole} ${fracStr}` : fracStr;
  };

  // Conversions Calculator State
  const [calcProduct, setCalcProduct] = useState("");
  const [calcSearch, setCalcSearch] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [calcVal, setCalcVal] = useState("");
  const [calcType, setCalcType] = useState<"kg_to_bto" | "bto_to_kg" | "kg_to_cn" | "cn_to_kg">("kg_to_bto");
  const [calcResult, setCalcResult] = useState("");

  const runCalc = (valStr: string, prod: any, type: string) => {
    const numeric = parseQty(valStr);
    if (numeric <= 0) {
      setCalcResult("");
      return;
    }
    
    const btoWeight = prod.Factor_Bulto || 56;
    const canWeight = prod.Factor_Canastilla || 22;
    
    if (type === "kg_to_bto") {
      const res = numeric / btoWeight;
      setCalcResult(`${valStr} Kg equivale a ${res.toFixed(2)} Bultos (${formatQty(res)} Btos)`);
    } else if (type === "bto_to_kg") {
      const res = numeric * btoWeight;
      setCalcResult(`${valStr} Bultos equivale a ${res.toFixed(1)} Kilos`);
    } else if (type === "kg_to_cn") {
      const res = numeric / canWeight;
      setCalcResult(`${valStr} Kg equivale a ${res.toFixed(2)} Canastillas (${formatQty(res)} Cans)`);
    } else if (type === "cn_to_kg") {
      const res = numeric * canWeight;
      setCalcResult(`${valStr} Canastillas equivale a ${res.toFixed(1)} Kilos`);
    }
  };

  const fetchMatrixOrders = async () => {
    try {
      const res = await fetch(`/api/orders?fecha=${matrixDate}`);
      if (res.ok) {
        const data = await res.json();
        setMatrixOrders(data);
      }
    } catch (e) {
      console.error("Error fetching matrix orders:", e);
    }
  };

  const getAdminMatrixData = () => {
    const PLAZA_CODES = new Set([
      "A16", "A13", "za13", "A12", "ZA12", "A03", "A06", "A04", "A15", "A37", "A14", "A05", "ZA28", "A28", "A02", "A08", "A32", "A07", "ZA07", "A10", "ZA10", "A09", "B02", "B01", "B12", "B13", "B03", "C02", "C01", "C23", "C04", "c06", "C07", "ZC04", "C05", "ZC05", "C19", "C18", "C10", "ZC10", "C11", "C13", "zc13", "D01", "ZD01", "D03", "ZD02", "F01", "zf01", "ZF03", "ZF02", "F04", "G01", "ZG01", "G02", "G04", "G05", "ZG05", "H01", "H02", "H03", "H04", "J01", "K01", "T08", "L02", "L03", "ZL03", "L04", "ZL04", "M03", "M02", "zm02", "M04", "zm04", "M05", "ZM07", "M06", "ZM06", "M07", "M56", "M10", "M08", "M15", "ZM15", "M14", "zm14", "M16", "zm16", "B10", "B09", "ZB09", "M20", "zm20", "M21", "ZM21", "M23", "N01", "ZN03", "N03", "N04", "ZN04", "P01", "ZP01", "P03", "ZP03", "P06", "p15", "zp06", "P07", "P08", "p18", "P10", "P11", "ZP11", "P13", "P14", "ZP14", "P16", "ZP16", "P04", "zp04", "P05", "P17", "zp17", "P20", "P23", "ZP23", "P22", "P19", "R01", "R03", "R04", "ZR04", "R05", "R07", "R02", "s01", "A19", "A20", "A21", "T06", "ZT06", "T02", "ZT02", "T03", "ZT03", "T10", "T07", "T04", "U01", "U05", "U09", "U03", "U08", "Y01", "zy01", "Z01", "ZZ01", "Z03", "Z04", "zz07", "z06"
    ].map(c => c.toUpperCase()));

    let filteredProducts = products;
    if (matrixSearch.trim() !== "") {
      const q = matrixSearch.toLowerCase();
      filteredProducts = products.filter(
        (p) =>
          p.Codigo.toLowerCase().includes(q) ||
          p.Producto.toLowerCase().includes(q)
      );
    }

    return filteredProducts.map((p) => {
      const code = p.Codigo;
      const edit = matrixEdits[code] || {};
      const prodOrders = matrixOrders.filter((o) => o.Codigo === code);

      // Cantidad pedida por sucursal. Se arma desde la lista de sucursales activas
      // (no de nombres escritos a mano) para que una sucursal nueva aparezca sola.
      const cantidadPorSucursal: Record<string, string> = {};
      for (const b of sucursalesPermitidas) cantidadPorSucursal[b] = "-";

      prodOrders.forEach((o) => {
        const branch = o.Sucursal.trim().toLowerCase();
        const match = sucursalesPermitidas.find((b) => b.toLowerCase() === branch);
        if (match) cantidadPorSucursal[match] = String(o.Cantidad);
      });

      for (const b of sucursalesPermitidas) {
        if (edit[b] !== undefined) cantidadPorSucursal[b] = String(edit[b]);
      }

      const requerido = sucursalesPermitidas.reduce(
        (suma, b) => suma + parseQty(cantidadPorSucursal[b]),
        0
      );

      const providerName = edit.Proveedor !== undefined ? edit.Proveedor : (p.Proveedor || "Sin Proveedor");
      const precioCompra = edit.Costo_Momento !== undefined ? parseFloat(edit.Costo_Momento) || 0 : p.Costo_Proveedor || 0;
      const precioAnterior = p.Precio_Anterior || p.Costo_Proveedor || 0;
      const cambio = precioCompra - precioAnterior;

      let observacion = "";
      if (edit.Observacion !== undefined) {
        observacion = edit.Observacion;
      } else {
        const notesList: string[] = [];
        prodOrders.forEach((o) => {
          if (o.Notas && o.Notas.trim() !== "") {
            notesList.push(`${o.Sucursal}: ${o.Notas}`);
          }
        });
        observacion = notesList.join(" | ");
      }

      let me = 1;
      if (edit.ME !== undefined) {
        me = parseFloat(edit.ME) || 1;
      } else {
        const medLower = p.Medida.toLowerCase();
        if (medLower.includes("bulto")) {
          me = p.Factor_Bulto || 56;
        } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
          me = p.Factor_Canastilla || 22;
        }
      }

      const factorBulto = edit.Factor_Bulto !== undefined ? parseFloat(edit.Factor_Bulto) : (p.Factor_Bulto || 56);
      const factorCanastilla = edit.Factor_Canastilla !== undefined ? parseFloat(edit.Factor_Canastilla) : (p.Factor_Canastilla || 22);

      const utilidad = edit.Utilidad !== undefined ? parseFloat(edit.Utilidad) || 0 : p.Utilidad || 0.3;
      const precioVentaAnt = p.Venta_Anterior || p.Precio_Venta_Actual || 0;
      const ventaKl = edit.Precio_Venta_Actual !== undefined ? parseFloat(edit.Precio_Venta_Actual) || 0 : p.Precio_Venta_Actual || 0;

      const merma = edit.Merma !== undefined ? parseFloat(edit.Merma) : (p.Merma !== undefined ? p.Merma : 0);

      return {
        Fecha: matrixDate,
        Codigo: code,
        Producto: edit.Producto !== undefined ? edit.Producto : p.Producto,
        // Una clave por sucursal activa (antes eran cinco campos fijos).
        ...cantidadPorSucursal,
        Proveedor: providerName,
        Precio_Compra: precioCompra,
        Requerido: requerido,
        Observacion: observacion,
        // "Se pidió": permite filtrar el catálogo a solo lo pedido en esta fecha.
        Pedido: requerido > 0,
        Precio_Anterior: precioAnterior,
        Cambio: cambio,
        ME: me,
        Factor_Bulto: factorBulto,
        Factor_Canastilla: factorCanastilla,
        Merma: merma,
        Utilidad: utilidad,
        Precio_Venta_Ant: precioVentaAnt,
        Venta_Kl: ventaKl,
        isPlaza: PLAZA_CODES.has(code.toUpperCase()),
      };
    })
    .filter((row) => {
      if (soloPedidos && !row.Pedido) return false;
      if (filterPriceChanges === "buy") {
        return row.Precio_Compra !== row.Precio_Anterior;
      }
      if (filterPriceChanges === "sell") {
        return row.Venta_Kl !== row.Precio_Venta_Ant;
      }
      if (filterPriceChanges === "any") {
        return (row.Precio_Compra !== row.Precio_Anterior) || (row.Venta_Kl !== row.Precio_Venta_Ant);
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (matrixSortField === "Producto") {
        cmp = a.Producto.localeCompare(b.Producto, "es", { sensitivity: "base" });
      } else if (matrixSortField === "Proveedor") {
        cmp = (a.Proveedor || "").localeCompare(b.Proveedor || "", "es", { sensitivity: "base" });
      } else if (matrixSortField === "Codigo") {
        cmp = a.Codigo.localeCompare(b.Codigo, undefined, { numeric: true });
      } else if (matrixSortField === "Requerido") {
        cmp = a.Requerido - b.Requerido;
      } else if (matrixSortField === "Precio_Compra") {
        cmp = a.Precio_Compra - b.Precio_Compra;
      } else if (matrixSortField === "Utilidad") {
        cmp = a.Utilidad - b.Utilidad;
      } else {
        if (a.isPlaza && !b.isPlaza) return -1;
        if (!a.isPlaza && b.isPlaza) return 1;
        cmp = a.Codigo.localeCompare(b.Codigo, undefined, { numeric: true });
      }
      return matrixSortDir === "asc" ? cmp : -cmp;
    });
  };

  /**
   * Productos cuyo PRECIO DE VENTA cambió respecto al anterior. Es lo único que
   * se le comunica a las sucursales: ellas no ven costo de compra ni margen.
   */
  const productosConPrecioNuevo = products
    .map((p) => {
      const edit = matrixEdits[p.Codigo] || {};
      const ventaNueva =
        edit.Precio_Venta_Actual !== undefined
          ? parseFloat(edit.Precio_Venta_Actual) || 0
          : p.Precio_Venta_Actual || 0;
      const ventaAnterior = p.Venta_Anterior || p.Precio_Venta_Actual || 0;
      return {
        Codigo: p.Codigo,
        Producto: edit.Producto !== undefined ? edit.Producto : p.Producto,
        Medida: p.Medida || "Kg",
        ventaAnterior,
        ventaNueva,
      };
    })
    .filter((p) => p.ventaNueva > 0 && p.ventaNueva !== p.ventaAnterior)
    .sort((a, b) => a.Producto.localeCompare(b.Producto, "es", { sensitivity: "base" }));

  /**
   * Descarga el Catálogo Maestro en Excel tal como está en pantalla: respeta la
   * búsqueda, los filtros y el orden actuales, y usa las mismas columnas.
   */
  const handleExportCatalogoXLSX = () => {
    const filas = getAdminMatrixData();
    if (filas.length === 0) {
      setErrorMsg("No hay productos para exportar con los filtros actuales.");
      return;
    }

    const datos = filas.map((row) => {
      const fila: Record<string, any> = {
        "FECHA PED": row.Fecha,
        "COD": row.Codigo,
        "PRODUCTO": row.Producto,
      };
      // Una columna por sucursal, igual que en la tabla.
      for (const b of sucursalesPermitidas) {
        fila[b.toUpperCase()] = (row as any)[b] ?? "-";
      }
      fila["PEDIDO"] = row.Pedido ? "SÍ" : "NO";
      fila["PROVEEDOR"] = row.Proveedor;
      fila["PRECIO COMPRA"] = row.Precio_Compra;
      fila["REQUERIDO"] = row.Requerido;
      fila["OBSERVACION"] = row.Observacion;
      fila["PRECIO ANT."] = row.Precio_Anterior;
      fila["CAMBIO $"] = row.Cambio;
      fila["PESO BTO (Kg)"] = row.Factor_Bulto;
      fila["PESO CAN (Kg)"] = row.Factor_Canastilla;
      fila["% MERMA"] = row.Merma;
      fila["% UTILIDAD"] = row.Utilidad;
      fila["VENTA ANT."] = row.Precio_Venta_Ant;
      fila["S VENTA KL"] = row.Venta_Kl;
      return fila;
    });

    const ws = XLSX.utils.json_to_sheet(datos);
    const anchoFijo = [{ wch: 12 }, { wch: 10 }, { wch: 28 }];
    const anchoSucursales = sucursalesPermitidas.map(() => ({ wch: 11 }));
    ws["!cols"] = [...anchoFijo, ...anchoSucursales, ...Array(13).fill({ wch: 14 })];
    // Fija el encabezado y las columnas de código/producto al desplazarse en Excel.
    ws["!freeze"] = { xSplit: 3, ySplit: 1 };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Catálogo Maestro");
    XLSX.writeFile(wb, `Catalogo_Maestro_${matrixDate}.xlsx`);
    setSuccessMsg(`Catálogo exportado: ${filas.length} productos.`);
  };

  const getFactorsFilteredProducts = () => {
    let filtered = products;
    if (factorsSearch.trim() !== "") {
      const q = factorsSearch.toLowerCase();
      filtered = products.filter(
        (p) =>
          p.Codigo.toLowerCase().includes(q) ||
          p.Producto.toLowerCase().includes(q) ||
          (p.Proveedor || "").toLowerCase().includes(q)
      );
    }
    return filtered.sort((a, b) => {
      let cmp = 0;
      if (factorsSortField === "Producto") {
        cmp = a.Producto.localeCompare(b.Producto, "es", { sensitivity: "base" });
      } else if (factorsSortField === "Proveedor") {
        cmp = (a.Proveedor || "").localeCompare(b.Proveedor || "", "es", { sensitivity: "base" });
      } else if (factorsSortField === "Codigo") {
        cmp = a.Codigo.localeCompare(b.Codigo, undefined, { numeric: true });
      } else if (factorsSortField === "Factor_Bulto") {
        const aBto = matrixEdits[a.Codigo]?.Factor_Bulto !== undefined ? parseFloat(matrixEdits[a.Codigo].Factor_Bulto) : (a.Factor_Bulto || 56);
        const bBto = matrixEdits[b.Codigo]?.Factor_Bulto !== undefined ? parseFloat(matrixEdits[b.Codigo].Factor_Bulto) : (b.Factor_Bulto || 56);
        cmp = aBto - bBto;
      } else if (factorsSortField === "Factor_Canastilla") {
        const aCan = matrixEdits[a.Codigo]?.Factor_Canastilla !== undefined ? parseFloat(matrixEdits[a.Codigo].Factor_Canastilla) : (a.Factor_Canastilla || 22);
        const bCan = matrixEdits[b.Codigo]?.Factor_Canastilla !== undefined ? parseFloat(matrixEdits[b.Codigo].Factor_Canastilla) : (b.Factor_Canastilla || 22);
        cmp = aCan - bCan;
      } else if (factorsSortField === "Merma") {
        const aMer = matrixEdits[a.Codigo]?.Merma !== undefined ? parseFloat(matrixEdits[a.Codigo].Merma) : (a.Merma || 0);
        const bMer = matrixEdits[b.Codigo]?.Merma !== undefined ? parseFloat(matrixEdits[b.Codigo].Merma) : (b.Merma || 0);
        cmp = aMer - bMer;
      } else if (factorsSortField === "Utilidad") {
        const aUtil = matrixEdits[a.Codigo]?.Utilidad !== undefined ? parseFloat(matrixEdits[a.Codigo].Utilidad) : (a.Utilidad || 0.3);
        const bUtil = matrixEdits[b.Codigo]?.Utilidad !== undefined ? parseFloat(matrixEdits[b.Codigo].Utilidad) : (b.Utilidad || 0.3);
        cmp = aUtil - bUtil;
      } else if (factorsSortField === "Costo_Momento") {
        const aCost = matrixEdits[a.Codigo]?.Costo_Momento !== undefined ? parseFloat(matrixEdits[a.Codigo].Costo_Momento) : (a.Costo_Proveedor || 0);
        const bCost = matrixEdits[b.Codigo]?.Costo_Momento !== undefined ? parseFloat(matrixEdits[b.Codigo].Costo_Momento) : (b.Costo_Proveedor || 0);
        cmp = aCost - bCost;
      } else if (factorsSortField === "Precio_Venta") {
        const aVenta = matrixEdits[a.Codigo]?.Precio_Venta !== undefined ? parseFloat(matrixEdits[a.Codigo].Precio_Venta) : (a.Precio_Venta_Actual || 0);
        const bVenta = matrixEdits[b.Codigo]?.Precio_Venta !== undefined ? parseFloat(matrixEdits[b.Codigo].Precio_Venta) : (b.Precio_Venta_Actual || 0);
        cmp = aVenta - bVenta;
      } else {
        cmp = a.Producto.localeCompare(b.Producto, "es", { sensitivity: "base" });
      }
      return factorsSortDir === "asc" ? cmp : -cmp;
    });
  };

  useEffect(() => {
    if (adminMode === "catalog" || adminMode === "factors") {
      fetchMatrixOrders();
    }
  }, [matrixDate, adminMode, lastGlobalSync]);

  useEffect(() => {
    if (adminMode === "provider_accounts") {
      fetchAccountsOrders();
    }
  }, [accountsDate, adminMode, lastGlobalSync]);

  useEffect(() => {
    if (adminMode === "purchase_reports") {
      fetchAllOrdersForReport();
    }
  }, [adminMode, lastGlobalSync]);

  const handleMatrixEdit = (code: string, field: string, value: any) => {
    const currentEdit = matrixEdits[code] || {};
    currentEdit[field] = value;

    const prodObj = products.find((p) => p.Codigo === code);
    const currentCost = currentEdit.Costo_Momento !== undefined ? parseFloat(currentEdit.Costo_Momento) : (prodObj ? prodObj.Costo_Proveedor : 0);
    const currentUtil = currentEdit.Utilidad !== undefined ? parseFloat(currentEdit.Utilidad) : (prodObj ? prodObj.Utilidad : 0.3);
    
    let currentME = 1;
    if (currentEdit.ME !== undefined) {
      currentME = parseFloat(currentEdit.ME) || 1;
    } else if (prodObj) {
      const medLower = prodObj.Medida.toLowerCase();
      if (medLower.includes("bulto")) {
        currentME = prodObj.Factor_Bulto || 1;
      } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
        currentME = prodObj.Factor_Canastilla || 1;
      }
    }

    const currentMerma = currentEdit.Merma !== undefined ? parseFloat(currentEdit.Merma) : (prodObj?.Merma !== undefined ? prodObj.Merma : 0);
    const shrinkageFactor = (1 - currentMerma);
    const divisor = currentME * (shrinkageFactor > 0 ? shrinkageFactor : 1);

    if (field === "Costo_Momento" || field === "Utilidad" || field === "ME" || field === "Merma") {
      const calculatedVenta = Math.round((currentCost / divisor) * (1 + currentUtil));
      currentEdit.Precio_Venta_Actual = calculatedVenta;
    } else if (field === "Precio_Venta_Actual") {
      const enteredVenta = parseFloat(value) || 0;
      if (currentCost > 0 && divisor > 0) {
        const calculatedUtil = (enteredVenta * divisor / currentCost) - 1;
        currentEdit.Utilidad = parseFloat(calculatedUtil.toFixed(4));
      }
    }

    setMatrixEdits({
      ...matrixEdits,
      [code]: currentEdit
    });
  };

  const handleSaveBulkMatrix = async () => {
    if (Object.keys(matrixEdits).length === 0) {
      setErrorMsg("No hay cambios pendientes por guardar");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/admin/matrix-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: matrixDate,
          edits: matrixEdits,
          user: adminName
        })
      });

      if (res.ok) {
        setSuccessMsg("¡Matriz de Plaza y Catálogo Maestro guardados con éxito!");
        setMatrixEdits({});
        fetchMatrixOrders();
        fetchProducts();
      } else {
        throw new Error("No se pudo guardar la matriz");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  const cop = (val: number) => {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(val);
  };

  useEffect(() => {
    fetchProducts();
    fetchProviders();
    fetchPriceHistory();
    fetchAdminSubData();
    fetchUsers();
    fetchBranchConfigs();

    const interval = setInterval(() => {
      fetchAdminSubData();
    }, 12000);
    return () => clearInterval(interval);
  }, [adminMode, lastGlobalSync]);

  const fetchUsers = async () => {
    // La gestión de usuarios es de alcance global: un administrador de sucursal
    // no tiene esa pestaña, así que tampoco se pide la lista (daría 403).
    if (esAdminDeUnaSucursal) return;
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (e) {
      console.error("Error fetching users:", e);
    }
  };

  const handleUpdatePassword = async (username: string, pass: string) => {
    if (!pass.trim()) {
      setErrorMsg("La contraseña no puede estar vacía.");
      return;
    }
    try {
      const res = await fetch("/api/users/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Usuario: username, Contraseña: pass }),
      });
      if (res.ok) {
        setSuccessMsg(`Contraseña de ${username} actualizada exitosamente.`);
        setEditingUser(null);
        setNewPassword("");
        fetchUsers();
      } else {
        const err = await res.json();
        setErrorMsg(err.error || "Error al actualizar la contraseña");
      }
    } catch (e) {
      console.error(e);
      setErrorMsg("Error de conexión al actualizar la contraseña.");
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = await res.json();
        setProviders(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPriceHistory = async () => {
    try {
      const res = await fetch("/api/price-history");
      if (res.ok) {
        const data = await res.json();
        setPriceHistory(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Packaging form states
  const [packQtyDelivered, setPackQtyDelivered] = useState("");
  const [packQtyReturned, setPackQtyReturned] = useState("");
  const [packAssetType, setPackAssetType] = useState<"Canastilla" | "Estiva">("Canastilla");
  const [packNotesText, setPackNotesText] = useState("");

  // Derived metrics for Reconciliation using unified single source of truth
  const reconciledClosuresSum = calculateReconciledClosuresSum(closures);
  const paidPayrollSum = calculatePaidPayrollSum(payroll);
  const nequiCentralBalance = calculateCentralBalance(closures, payroll, walletTxs);
  const totalNoRecaudado = calculateTotalUncollected(closures, walletTxs, sucursalesPermitidas);
  const totalStoreExpenses = closures.reduce((acc, c) => acc + (c.Gastos_Extra || 0), 0);

  const branches = sucursalesPermitidas;

  const getBranchUncollected = (branchName: string) => calculateBranchUncollected(closures, walletTxs, branchName);
  const getBranchPendingCount = (branchName: string) => getBranchPendingCountUtil(closures, branchName);

  const handleBulkReconcile = async (branchName: string) => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/closures/bulk-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Sucursal: branchName })
      });
      if (res.ok) {
        const data = await res.json();
        const successText = data.msg || `¡Recolección de efectivo de la sucursal ${branchName} exitosamente registrada en Caja Central!`;
        setSuccessMsg(successText);
        alert(`¡Éxito! ${successText}`);
        await fetchAdminSubData();
      } else {
        const err = await res.json();
        const errorText = err.error || "Error al reconciliar el efectivo.";
        setErrorMsg(errorText);
        alert(`Error al registrar recolección: ${errorText}`);
      }
    } catch (e) {
      const errorText = "Ocurrió un error de red al intentar registrar la recolección.";
      setErrorMsg(errorText);
      alert(errorText);
    } finally {
      setLoading(false);
    }
  };

  // Smart Payroll Helpers
  const employees = Array.from(new Set(rates.map((r) => r.Empleado))).filter(Boolean);
  const daysOfWeek = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];
  const availableStores = ["Descanso", "Plaza", "Nobsa", "Tibasosa", "Fira", "Aquitania", "Hansel"];

  const getDailyRate = (emp: string) => {
    const rateObj = rates.find((r) => r.Empleado.toLowerCase() === emp.toLowerCase());
    if (rateObj) return rateObj.Valor_Dia;
    if (emp === "Hamilton") return 45000;
    return 40000; // Nelson & Felipe default
  };

  const getTransportRate = (emp: string) => {
    const rateObj = rates.find((r) => r.Empleado.toLowerCase() === emp.toLowerCase());
    if (rateObj && rateObj.Auxilio_Transporte !== undefined) return rateObj.Auxilio_Transporte;
    return 8303; // Math.round(249095 / 30) = $ 8.303 / día
  };

  const handleRosterChange = (emp: string, day: string, field: "sucursal" | "horas" | "extras", value: any) => {
    setWeeklyRoster((prev) => {
      const currentEmpRoster = prev[emp] || {};
      const currentDayCell = currentEmpRoster[day] || { sucursal: "Descanso", horas: 8, extras: 0 };
      return {
        ...prev,
        [emp]: {
          ...currentEmpRoster,
          [day]: {
            ...currentDayCell,
            [field]: field === "sucursal" ? value : parseFloat(value) || 0
          }
        }
      };
    });
  };

  const computeEmployeePayroll = (emp: string) => {
    let daysWorked = 0;
    let standardHours = 0;
    let overtimeHours = 0;
    const branchDays: { [branch: string]: number } = {};

    const targetPrefix = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, "0")}`;
    const monthSchedules = schedules.filter(
      (s) => s.Fecha.startsWith(targetPrefix) && s.Empleado.toLowerCase() === emp.toLowerCase()
    );

    daysWorked = monthSchedules.length;
    monthSchedules.forEach((s) => {
      // En el calendario, consideramos las primeras 7 horas como jornada normal y el exceso como horas extras (42h/semana)
      const std = Math.min(7, s.Horas_Trabajadas);
      const ovt = Math.max(0, s.Horas_Trabajadas - 7);
      standardHours += std;
      overtimeHours += ovt;

      const branch = s.Sucursal || "Plaza";
      if (!branchDays[branch]) {
        branchDays[branch] = 0;
      }
      branchDays[branch] += 1;
    });

    // APPLY MANUAL OVERRIDES BEFORE CALCULATION
    if (manualDaysWorked !== "") {
      daysWorked = parseFloat(manualDaysWorked) || 0;
    }
    if (manualStandardHours !== "") {
      standardHours = parseFloat(manualStandardHours) || 0;
    }
    if (manualOvertimeHours !== "") {
      overtimeHours = parseFloat(manualOvertimeHours) || 0;
    }

    // DISCOUNT HOURS COMPENSADAS FROM OVERTIME HOURS
    const disc = parseFloat(discountedExtraHours) || 0;
    const finalOvertimeHours = Math.max(0, overtimeHours - disc);

    const dailyRate = getDailyRate(emp);
    const basePay = daysWorked * dailyRate;

    // DÍAS COMPENSADOS (Días Comp. en Ajustes Manuales)
    const compDays = parseFloat(manualCompDays) || 0;
    const compPay = Math.round(compDays * dailyRate);

    // Suma de días base totales (ordinarios + compensados) y sueldo consolidado
    const totalDaysBase = daysWorked + compDays;
    const totalSueldoBaseComp = basePay + compPay;
    
    // Jornada laboral normal de 7 horas diarias (42 horas semanales)
    const hourlyRate = dailyRate / 7;
    // Extra hours pay (1.25x) - calculado sobre el neto final de horas extras
    const extraPay = Math.round(finalOvertimeHours * hourlyRate * 1.25);

    // FESTIVE HOURS SURCHARGE (1.75x sobre tarifa base por hora)
    const festiveHours = parseFloat(manualFestiveHours) || 0;
    const calculatedFestivePay = Math.round(festiveHours * hourlyRate * 1.75);
    const festivePay = manualFestivePay !== "" ? (parseFloat(manualFestivePay) || 0) : calculatedFestivePay;

    // Auxilio de Transporte base sumando días ordinarios + días compensados
    const dailyTransportRate = getTransportRate(emp);
    const calculatedTransportAllowance = Math.round(dailyTransportRate * totalDaysBase);
    const transportAllowance = manualTransportAllowance !== "" ? (parseFloat(manualTransportAllowance) || 0) : calculatedTransportAllowance;

    const grossPay = totalSueldoBaseComp + extraPay + festivePay + transportAllowance;

    // Base Salarial para Salud (4%) y Pensión (4%) = Sueldo Ordinario + Días Compensados
    const salarialBase = totalSueldoBaseComp;
    const calculatedHealth = Math.round(salarialBase * 0.04);
    const calculatedPension = Math.round(salarialBase * 0.04);
    const calculatedSocialDeductions = calculatedHealth + calculatedPension;

    const socialSecurityDeductions = manualDeductions !== "" ? (parseFloat(manualDeductions) || 0) : calculatedSocialDeductions;
    const healthDeduction = Math.round(socialSecurityDeductions / 2);
    const pensionDeduction = socialSecurityDeductions - healthDeduction;

    const empLoans = loans.filter((l) => l.Empleado.toLowerCase() === emp.toLowerCase() && (l.Estado === "Pendiente" || !l.Estado));
    const totalLoansDeducted = empLoans.reduce((acc, l) => acc + l.Monto, 0);

    const totalNet = Math.max(0, grossPay - socialSecurityDeductions - totalLoansDeducted);

    // Identify branches where employee actually worked
    const allKnownBranches = branches.concat(["Plaza"]);
    const workedBranches = allKnownBranches.filter((b) => (branchDays[b] || 0) > 0);
    const workedBranchesCount = workedBranches.length || 1;

    // Division rules for Auxilio de Transporte ($249.095) and Días Compensados:
    // If worked in 2 or more branches, divide equally among all worked branches.
    // If worked in only 1 branch, 100% goes to that single branch.
    const storeTransportShare = Math.round(transportAllowance / workedBranchesCount);
    const storeCompShare = Math.round(compPay / workedBranchesCount);

    const storeSplits: { [store: string]: { daysInBranch: number; baseShare: number; salarialShare: number; transportShare: number; compShare: number; loanShare: number; socialShare: number; totalShare: number; percentage: number } } = {};
    
    allKnownBranches.forEach((branch) => {
      const daysInBranch = branchDays[branch] || 0;
      if (daysInBranch > 0) {
        const totalDaysRef = daysWorked || 1;
        const percentage = daysInBranch / totalDaysRef;

        // Salarial concepts (base pay, overtime, festives) prorated by days worked in branch
        const storeSalarialShare = Math.round((basePay + extraPay + festivePay) * percentage);

        // Auxilio de Transporte & Días Compensados: equal split among worked branches
        const storeTransport = workedBranchesCount >= 2 ? storeTransportShare : transportAllowance;
        const storeComp = workedBranchesCount >= 2 ? storeCompShare : compPay;

        const baseShare = storeSalarialShare + storeTransport + storeComp;
        const socialShare = Math.round(socialSecurityDeductions * percentage);
        
        const loansFromBranch = empLoans
          .filter((l) => l.Sucursal.toLowerCase().trim() === branch.toLowerCase().trim())
          .reduce((acc, l) => acc + l.Monto, 0);

        const totalShare = baseShare - socialShare - loansFromBranch;

        storeSplits[branch] = {
          daysInBranch,
          baseShare,
          salarialShare: storeSalarialShare,
          transportShare: storeTransport,
          compShare: storeComp,
          loanShare: loansFromBranch,
          socialShare,
          totalShare: Math.max(0, totalShare),
          percentage: Math.round(percentage * 100)
        };
      }
    });

    return {
      daysWorked,
      totalDaysBase,
      standardHours,
      overtimeHours,
      finalOvertimeHours,
      discountedExtraHours: disc,
      festiveHours,
      festivePay,
      calculatedFestivePay,
      compDays,
      compPay,
      totalSueldoBaseComp,
      dailyRate,
      basePay,
      extraPay,
      transportAllowance,
      calculatedTransportAllowance,
      grossPay,
      healthDeduction,
      pensionDeduction,
      socialSecurityDeductions,
      calculatedSocialDeductions,
      totalLoansDeducted,
      totalNet,
      storeSplits,
      loansDetail: empLoans
    };
  };

  const formatClosureDateForExcel = (dateStr: string) => {
    try {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const day = parseInt(parts[2], 10);
        const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
        const monthIdx = parseInt(parts[1], 10) - 1;
        return `${day}-${months[monthIdx] || "mes"}`;
      }
    } catch (e) {}
    return dateStr;
  };

  const handleExportDailyClosureExcel = (c: DailyClosure) => {
    const excelDate = formatClosureDateForExcel(c.Fecha);
    
    // Parse individual expenses from Descripcion_Gastos
    const rawExpenses = c.Descripcion_Gastos.split(";");
    const parsedExpenses = rawExpenses.map(part => {
      const p = part.trim();
      if (!p) return null;
      // Look for text followed by parenthesized currency: desc ($ 123) or desc (123)
      const match = p.match(/(.+)\s*\(\$?\s*([\d.,]+)\s*\)/);
      if (match) {
        const desc = match[1].trim();
        const priceStr = match[2].replace(/\./g, "").replace(/,/g, "");
        const value = parseFloat(priceStr) || 0;
        return { desc, value };
      }
      return { desc: p, value: 0 };
    }).filter(Boolean) as { desc: string; value: number }[];

    // Build the rows matching the attached image:
    // FECHA | DESCRIPCION | VENTA TOTAL DIARIA | GASTOS | VENTAS EN EFECTIVO
    const dataRows: any[] = [];

    parsedExpenses.forEach(exp => {
      dataRows.push({
        "FECHA": excelDate,
        "DESCRIPCION": exp.desc,
        "VENTA TOTAL DIARIA": "",
        "GASTOS": exp.value,
        "VENTAS EN EFECTIVO": "ok"
      });
    });

    if (dataRows.length === 0 && c.Gastos_Extra > 0) {
      dataRows.push({
        "FECHA": excelDate,
        "DESCRIPCION": "Gastos reportados",
        "VENTA TOTAL DIARIA": "",
        "GASTOS": c.Gastos_Extra,
        "VENTAS EN EFECTIVO": "ok"
      });
    }

    const cashOnDay = c.Ventas_Totales - c.Gastos_Extra;
    dataRows.push({
      "FECHA": excelDate,
      "DESCRIPCION": "Efectivo del dia",
      "VENTA TOTAL DIARIA": c.Ventas_Totales,
      "GASTOS": c.Gastos_Extra,
      "VENTAS EN EFECTIVO": cashOnDay
    });

    const worksheet = XLSX.utils.json_to_sheet(dataRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Cierre ${c.Sucursal}`);

    const maxW = [12, 35, 22, 15, 22];
    worksheet["!cols"] = maxW.map(w => ({ wch: w }));

    XLSX.writeFile(workbook, `Cierre_Diario_${c.Sucursal}_${c.Fecha}.xlsx`);
  };

  const handleExportConsolidatedPayrollXLSX = () => {
    // 1. Employee Detail Sheet
    const employeeRows = employees.map(emp => {
      const res = computeEmployeePayroll(emp);
      if (!res) return null;
      
      const row: any = {
        "Colaborador": emp,
        "Días Trabajados": res.daysWorked,
        "Sueldo Base": res.basePay,
        "Horas Extras": res.extraPay,
        "Recargos Festivos": res.festivePay,
        "Auxilio Transporte": res.transportAllowance,
        "Total Devengado": res.grossPay,
        "Deducción Salud & Pensión (8%)": res.socialSecurityDeductions,
        "Deducción Préstamos": res.totalLoansDeducted,
        "Total Neto General": res.totalNet
      };

      branches.concat(["Plaza"]).forEach(b => {
        const share = res.storeSplits[b];
        row[`Días en ${b}`] = share ? share.daysInBranch : 0;
        row[`Neto a pagar por ${b}`] = share ? share.totalShare : 0;
      });

      return row;
    }).filter(Boolean);

    // 2. Branch Summary Sheet
    const branchRows = branches.concat(["Plaza"]).map(b => {
      let totalBranchNet = 0;
      let totalBranchBase = 0;
      let totalBranchSocial = 0;
      let totalBranchLoans = 0;
      let totalBranchDays = 0;

      employees.forEach(emp => {
        const res = computeEmployeePayroll(emp);
        if (res && res.storeSplits[b]) {
          totalBranchNet += res.storeSplits[b].totalShare;
          totalBranchBase += res.storeSplits[b].baseShare;
          totalBranchSocial += res.storeSplits[b].socialShare;
          totalBranchLoans += res.storeSplits[b].loanShare;
          totalBranchDays += res.storeSplits[b].daysInBranch || 0;
        }
      });

      return {
        "Sucursal": b,
        "Total Días Laborados en Sucursal": totalBranchDays,
        "Total Devengados Prorrateados": totalBranchBase,
        "Total Deducciones Salud & Pensión (8%)": totalBranchSocial,
        "Total Préstamos Descontados": totalBranchLoans,
        "Total Neto a pagar desde Caja Sucursal": totalBranchNet
      };
    });

    // 3. Daily Schedules Sheet (Excel layout)
    const targetPrefix = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, "0")}`;
    const monthSchedulesSorted = schedules
      .filter((s) => s.Fecha.startsWith(targetPrefix))
      .sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.Empleado.localeCompare(b.Empleado));

    const dailySchedulesRows = monthSchedulesSorted.map((s) => {
      const dt = new Date(s.Fecha + "T12:00:00");
      const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const dayOfWeekNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const dayNum = dt.getDate();
      const monthStr = monthNames[dt.getMonth()];
      const dayStr = dayOfWeekNames[dt.getDay()];
      const extraHours = Math.max(0, s.Horas_Trabajadas - 7);

      return {
        "FECHA": `${dayNum}-${monthStr}`,
        "MES": monthStr,
        "DIA": dayStr,
        "SUCURSAL": (s.Sucursal || "Plaza").toUpperCase(),
        "TRABAJADOR": s.Empleado,
        "HORAS TRABAJADAS": s.Horas_Trabajadas,
        "HORAS EXTRA": parseFloat(extraHours.toFixed(2))
      };
    });

    const wb = XLSX.utils.book_new();
    const wsEmp = XLSX.utils.json_to_sheet(employeeRows);
    const wsBranch = XLSX.utils.json_to_sheet(branchRows);
    const wsDaily = XLSX.utils.json_to_sheet(dailySchedulesRows.length > 0 ? dailySchedulesRows : [{ FECHA: "N/A", MES: "N/A", DIA: "N/A", SUCURSAL: "N/A", TRABAJADOR: "N/A", "HORAS TRABAJADAS": 0, "HORAS EXTRA": 0 }]);

    XLSX.utils.book_append_sheet(wb, wsEmp, "Detalle Colaboradores");
    XLSX.utils.book_append_sheet(wb, wsBranch, "Consolidado por Sucursal");
    XLSX.utils.book_append_sheet(wb, wsDaily, "Registro Diario de Turnos");

    XLSX.writeFile(wb, `Distribucion_Nomina_Sucursales_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Helper to compute weeks for current month
  const getWeeksOfMonth = (year: number, month: number) => {
    const weeks: { weekIndex: number; startDay: number; endDay: number; label: string; dates: string[] }[] = [];
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    let currentWeekDates: string[] = [];
    let currentWeekIndex = 1;
    let startDay = 1;

    for (let d = 1; d <= totalDays; d++) {
      const dateObj = new Date(year, month, d);
      const dayOfWeek = dateObj.getDay(); // 0 is Sunday, 1 is Monday...
      const paddedMonth = String(month + 1).padStart(2, "0");
      const paddedDay = String(d).padStart(2, "0");
      const dateStr = `${year}-${paddedMonth}-${paddedDay}`;
      currentWeekDates.push(dateStr);

      // If Sunday (0) or last day of month
      if (dayOfWeek === 0 || d === totalDays) {
        weeks.push({
          weekIndex: currentWeekIndex,
          startDay: startDay,
          endDay: d,
          label: `Semana ${currentWeekIndex} (${["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][month]} ${startDay} - ${d})`,
          dates: [...currentWeekDates]
        });
        currentWeekDates = [];
        currentWeekIndex++;
        startDay = d + 1;
      }
    }
    return weeks;
  };

  const handleApplyRosterToWeek = async (weekIdxStr: string, targetEmp: string = "ALL") => {
    const weekIdx = parseInt(weekIdxStr, 10);
    const weeksList = getWeeksOfMonth(currentCalendarYear, currentCalendarMonth);
    const selectedWeekObj = weeksList.find(w => w.weekIndex === weekIdx);
    if (!selectedWeekObj) {
      alert("Semana seleccionada no es válida.");
      return;
    }

    const scopeText = targetEmp === "ALL" ? "TODOS los colaboradores" : `el colaborador ${targetEmp}`;
    const confirmMsg = `¿Está seguro de que desea vincular y cargar el Roster Semanal actual para ${scopeText} en la ${selectedWeekObj.label}? 
Esto sobrescribirá o creará los turnos en el Calendario únicamente para las fechas comprendidas entre el día ${selectedWeekObj.startDay} y el ${selectedWeekObj.endDay} de este mes.`;
    
    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    try {
      const weekdaysMap = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
      const generatedSchedules: any[] = [];

      // For each date in the selected week
      selectedWeekObj.dates.forEach((dateStr) => {
        const dObj = new Date(dateStr + "T00:00:00");
        const dayName = weekdaysMap[dObj.getDay()];

        const targetEmployees = targetEmp === "ALL" ? employees : [targetEmp];

        targetEmployees.forEach((emp) => {
          const cell = weeklyRoster[emp]?.[dayName];
          if (cell && cell.sucursal !== "Descanso" && cell.horas > 0) {
            generatedSchedules.push({
              Fecha: dateStr,
              Empleado: emp,
              Sucursal: cell.sucursal,
              Horas_Trabajadas: cell.horas + cell.extras
            });
          }
        });
      });

      // Clear only for targetEmp (or ALL) on the selected week dates
      const res = await fetch("/api/payroll/schedules/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedules: generatedSchedules,
          clearEmployee: targetEmp,
          clearDates: selectedWeekObj.dates
        })
      });

      if (res.ok) {
        alert(`¡Roster de ${scopeText} vinculado exitosamente a la ${selectedWeekObj.label}!`);
        await fetchAdminSubData();
      } else {
        alert("Error al vincular el roster.");
      }
    } catch (err) {
      console.error(err);
      alert("Error de red al vincular el roster.");
    } finally {
      setLoading(false);
    }
  };



  const handleSaveSmartPayroll = async (
    emp: string, totalNet: number, basePay: number, extraPay: number, loanDed: number, daysWork: number, hoursWork: number, splits: any
  ) => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const today = new Date(Date.now() - 5 * 3600000).toISOString().split("T")[0];
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Empleado: emp,
          Fecha_Inicio: today,
          Fecha_Fin: today,
          Pago_Base: basePay,
          Pago_Horas: extraPay,
          Prestamos_Descontados: loanDed,
          Total_Neto: totalNet,
          Dias_Trabajados: daysWork,
          Horas_Trabajadas: hoursWork
        })
      });
      if (res.ok) {
        setSuccessMsg(`¡Liquidación de nómina de ${emp} por ${cop(totalNet)} registrada con éxito! Costos prorrateados en tiendas.`);
        await fetchAdminSubData();
      } else {
        const err = await res.json();
        setErrorMsg(err.error || "Error al liquidar nómina.");
      }
    } catch (e) {
      setErrorMsg("Error de conexión al guardar la liquidación.");
    } finally {
      setLoading(false);
    }
  };

  // Packaging Ledger helpers
  const supplierPackagingLogs = packaging.filter(
    (p) => p.Proveedor.toLowerCase().trim() === selectedSupplier.toLowerCase().trim()
  );

  const canastillasLoaned = supplierPackagingLogs
    .filter((p) => p.Tipo_Activo === "Canastilla")
    .reduce((acc, p) => acc + p.Cantidad_Entregada, 0);

  const canastillasReturned = supplierPackagingLogs
    .filter((p) => p.Tipo_Activo === "Canastilla")
    .reduce((acc, p) => acc + p.Cantidad_Devuelta, 0);

  const netCanastillas = canastillasLoaned - canastillasReturned;

  const estivasLoaned = supplierPackagingLogs
    .filter((p) => p.Tipo_Activo === "Estiva")
    .reduce((acc, p) => acc + p.Cantidad_Entregada, 0);

  const estivasReturned = supplierPackagingLogs
    .filter((p) => p.Tipo_Activo === "Estiva")
    .reduce((acc, p) => acc + p.Cantidad_Devuelta, 0);

  const netEstivas = estivasLoaned - estivasReturned;

  const handleCreatePackagingMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) {
      setErrorMsg("Debe seleccionar un proveedor primero.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/packaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Proveedor: selectedSupplier,
          Tipo_Activo: packAssetType,
          Cantidad_Entregada: parseInt(packQtyDelivered) || 0,
          Cantidad_Devuelta: parseInt(packQtyReturned) || 0,
          Notas: packNotesText
        })
      });
      if (res.ok) {
        setSuccessMsg("¡Registro de logística de empaque guardado con éxito!");
        setPackQtyDelivered("");
        setPackQtyReturned("");
        setPackNotesText("");
        await fetchAdminSubData();
      } else {
        const err = await res.json();
        setErrorMsg(err.error || "Error al guardar el movimiento.");
      }
    } catch (e) {
      setErrorMsg("Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // Create Product
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode || !newName || !newCost || !newUtil || !newProv) {
      setErrorMsg("Por favor complete todos los campos requeridos");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const matchedProv = providers.find((p) => p.Proveedor === newProv);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Codigo: newCode.trim().toUpperCase(),
          Producto: newName.trim(),
          Medida: newMedida,
          Proveedor: newProv,
          Celular: matchedProv?.Celular || "",
          Costo_Proveedor: parseFloat(newCost),
          Utilidad: parseFloat(newUtil),
        })
      });

      if (res.ok) {
        setSuccessMsg(`Producto [${newCode.toUpperCase()}] creado exitosamente.`);
        setNewCode("");
        setNewName("");
        setNewCost("");
        fetchProducts();
      } else {
        const data = await res.json();
        throw new Error(data.error || "No se pudo crear el producto");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Create Product from Factors Tab Modal
  const handleModalCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalCode || !modalName) {
      setErrorMsg("El código y nombre de producto son obligatorios.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const matchedProv = providers.find((p) => p.Proveedor === modalProv);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Codigo: modalCode.trim().toUpperCase(),
          Producto: modalName.trim(),
          Medida: modalMedida.trim(),
          Proveedor: modalProv,
          Celular: matchedProv?.Celular || "",
          Costo_Proveedor: parseFloat(modalCost) || 0,
          Utilidad: (parseFloat(modalUtil) || 30) / 100,
          Factor_Bulto: parseFloat(modalFactorBto) || 56,
          Factor_Canastilla: parseFloat(modalFactorCan) || 22,
          Merma: (parseFloat(modalMerma) || 0) / 100
        })
      });

      if (res.ok) {
        setSuccessMsg(`Producto [${modalCode.toUpperCase()}] creado exitosamente.`);
        setShowAddProductModal(false);
        setModalCode("");
        setModalName("");
        setModalMedida("Kg");
        setModalProv("Sin Proveedor");
        setModalCost("");
        setModalUtil("30");
        setModalFactorBto("56");
        setModalFactorCan("22");
        setModalMerma("0");
        await fetchProducts();
      } else {
        const data = await res.json();
        throw new Error(data.error || "No se pudo crear el producto");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Create Provider
  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provName) {
      setErrorMsg("Escriba el nombre del proveedor");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Proveedor: provName.trim().toUpperCase(),
          Celular: provCell.trim()
        })
      });

      if (res.ok) {
        setSuccessMsg(`Proveedor ${provName.toUpperCase()} registrado exitosamente.`);
        setProvName("");
        setProvCell("");
        fetchProviders();
      } else {
        const data = await res.json();
        throw new Error(data.error || "El proveedor ya existe");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Open Edit Product Inline Form
  const startEditProduct = (p: Product) => {
    setEditingProd(p);
    setEditCost(String(p.Costo_Proveedor));
    setEditVenta(String(p.Precio_Venta_Actual));
    setEditUtil(String(p.Utilidad));
    setEditProv(p.Proveedor);
  };

  // Save Edit Product Pricing
  const handleSaveProductEdit = async () => {
    if (!editingProd) return;
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const matchedProv = providers.find((p) => p.Proveedor === editProv);

    try {
      const res = await fetch(`/api/products/${editingProd.Codigo}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Costo_Proveedor: parseFloat(editCost),
          Precio_Venta_Actual: parseFloat(editVenta),
          Utilidad: parseFloat(editUtil),
          Proveedor: editProv,
          Celular: matchedProv?.Celular || "",
          user: adminName
        })
      });

      if (res.ok) {
        setSuccessMsg(`Precios y proveedor actualizados para ${editingProd.Producto}.`);
        setEditingProd(null);
        fetchProducts();
      } else {
        throw new Error("No se pudo actualizar el producto");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatNumberWithDots = (num: number | string): string => {
    const raw = String(num).replace(/\D/g, "");
    if (!raw) return "";
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(parseFloat(raw));
  };

  const handleUpdateExpenseItem = (index: number, updatedItem: { desc: string; value: number }) => {
    const newItems = [...editClosureExpenseItems];
    newItems[index] = updatedItem;
    setEditClosureExpenseItems(newItems);
    
    // Recalculate total Gastos
    const total = newItems.reduce((acc, item) => acc + item.value, 0);
    setEditClosureGastos(formatNumberWithDots(total));
    
    // Serialize description
    const descStr = newItems
      .filter(item => item.desc.trim() !== "")
      .map(item => `${item.desc.trim()} ($${formatNumberWithDots(item.value)})`)
      .join("; ");
    setEditClosureDesc(descStr);
  };

  const handleAddExpenseItem = () => {
    const newItems = [...editClosureExpenseItems, { desc: "", value: 0 }];
    setEditClosureExpenseItems(newItems);
  };

  const handleRemoveExpenseItem = (index: number) => {
    const newItems = editClosureExpenseItems.filter((_, i) => i !== index);
    setEditClosureExpenseItems(newItems);
    
    // Recalculate total Gastos
    const total = newItems.reduce((acc, item) => acc + item.value, 0);
    setEditClosureGastos(formatNumberWithDots(total));
    
    // Serialize description
    const descStr = newItems
      .filter(item => item.desc.trim() !== "")
      .map(item => `${item.desc.trim()} ($${formatNumberWithDots(item.value)})`)
      .join("; ");
    setEditClosureDesc(descStr);
  };

  const handleSaveClosureEdit = async () => {
    if (!editingClosure) return;
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/closures", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ID_Cierre: editingClosure.ID_Cierre,
          Fecha: editingClosure.Fecha,
          Sucursal: editingClosure.Sucursal,
          Ventas_Totales: parseFloat(editClosureVentas.replace(/\D/g, "")) || 0,
          Gastos_Extra: parseFloat(editClosureGastos.replace(/\D/g, "")) || 0,
          Descripcion_Gastos: editClosureDesc,
          Persona_Recogio: editClosureRecogio
        })
      });

      if (res.ok) {
        setSuccessMsg(`Cierre de ${editingClosure.Sucursal} del ${editingClosure.Fecha} actualizado con éxito.`);
        setEditingClosure(null);
        await fetchAdminSubData();
      } else {
        const data = await res.json();
        throw new Error(data.error || "No se pudo actualizar el cierre");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Admin sub-header navigation */}
      <div className="bg-slate-900 text-slate-200 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                {adminName}{" "}
                <span className="text-xs bg-emerald-500 text-slate-950 px-2 py-0.5 rounded-full font-extrabold uppercase">
                  {esAdminDeUnaSucursal ? sucursalAsignada : "Admin Master"}
                </span>
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">
                {esAdminDeUnaSucursal
                  ? `Administración de la sucursal ${sucursalAsignada}.`
                  : "Control Central y Configuración de Al Paso."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 w-full md:w-auto pb-1 md:pb-0">
            <button
              onClick={() => setAdminMode("master")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "master" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Consola Master
            </button>

            <button
              onClick={() => setAdminMode("reconciliation")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "reconciliation" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Efectivo & Monedero
            </button>

            <button
              onClick={() => setAdminMode("payroll_smart")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "payroll_smart" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Nómina Inteligente
            </button>

            <button
              onClick={() => setAdminMode("packaging_ledger")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "packaging_ledger" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              Canastillas & Estivas
            </button>

            <button
              onClick={() => setAdminMode("closures_receipts")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "closures_receipts" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              Recibos de Cierre
            </button>

            <button
              onClick={() => setAdminMode("catalog")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "catalog" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <Library className="w-3.5 h-3.5" />
              Catálogo Maestro
            </button>

            <button
              onClick={() => setAdminMode("factors")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "factors" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <Boxes className="w-3.5 h-3.5 text-amber-300" />
              Factores y Pesos
            </button>

            <button
              onClick={() => setAdminMode("products_manager")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "products_manager" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5 text-emerald-300" />
              Añadir/Quitar Productos
            </button>

            <button
              onClick={() => setAdminMode("provider_accounts")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "provider_accounts" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-300" />
              Cuentas Proveedores
            </button>

            <button
              onClick={() => setAdminMode("purchase_reports")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "purchase_reports" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
              Reporte Compras
            </button>

            <button
              onClick={() => setAdminMode("history")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                adminMode === "history" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Auditoría Precios
            </button>





            {/* Gestión de usuarios y logs son de alcance global: el servidor solo se
                los permite al administrador general, así que a un administrador de
                sucursal no se le ofrecen (verían un error de permisos). */}
            {!esAdminDeUnaSucursal && (
              <button
                onClick={() => setAdminMode("users")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  adminMode === "users" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                }`}
              >
                <Settings className="w-3.5 h-3.5 text-amber-300" />
                Contraseñas
              </button>
            )}

            {!esAdminDeUnaSucursal && (
              <button
                onClick={() => setAdminMode("sync_logs")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  adminMode === "sync_logs" ? "bg-emerald-500 text-slate-950 font-extrabold" : "bg-slate-800 hover:bg-slate-750 text-slate-300"
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
                Logs Sincronización
              </button>
            )}


          </div>
        </div>
      </div>

      {/* Main Admin Contents */}
      <div className="bg-slate-50 min-h-[calc(100vh-140px)] py-6">
        {/* SUCCESS/ERROR TOASTS */}
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          {successMsg && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 rounded-2xl mb-6 flex justify-between items-center text-sm font-medium">
              <span className="flex items-center gap-2"><Check className="w-4 h-4" /> {successMsg}</span>
              <button onClick={() => setSuccessMsg("")} className="text-emerald-800 hover:underline text-xs">Cerrar</button>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-800 rounded-2xl mb-6 flex justify-between items-center text-sm font-medium">
              <span className="flex items-center gap-2">{errorMsg}</span>
              <button onClick={() => setErrorMsg("")} className="text-rose-800 hover:underline text-xs">Cerrar</button>
            </div>
          )}
        </div>

        {/* 1. MASTER SUMMARY VIEW */}
        {adminMode === "master" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">Catálogo Activo</span>
                  <h3 className="text-3xl font-extrabold text-slate-800 mt-2">{products.length} Productos</h3>
                  <p className="text-slate-500 text-xs mt-1">Señoritas de plaza, granos, empaques, y verduras tradicionales.</p>
                </div>
                <button
                  onClick={() => setAdminMode("catalog")}
                  className="mt-4 text-emerald-600 font-bold text-xs text-left hover:underline cursor-pointer"
                >
                  Administrar catálogo Maestro &rarr;
                </button>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">Proveedores de Plaza</span>
                  <h3 className="text-3xl font-extrabold text-slate-800 mt-2">{providers.length} Proveedores</h3>
                  <p className="text-slate-500 text-xs mt-1">Proveedores registrados con balances de canastillas y activos.</p>
                </div>
                <button
                  onClick={() => setAdminMode("catalog")}
                  className="mt-4 text-emerald-600 font-bold text-xs text-left hover:underline cursor-pointer"
                >
                  Registrar proveedores &rarr;
                </button>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">Últimos Cambios de Precios</span>
                  <h3 className="text-3xl font-extrabold text-slate-800 mt-2">{priceHistory.length} Cambios</h3>
                  <p className="text-slate-500 text-xs mt-1">Auditoría de ajustes de precios y costos de proveedores.</p>
                </div>
                <button
                  onClick={() => setAdminMode("history")}
                  className="mt-4 text-emerald-600 font-bold text-xs text-left hover:underline cursor-pointer"
                >
                  Ver bitácora de auditoría &rarr;
                </button>
              </div>
            </div>

            {/* Quick Admin instructions */}
            <div className="p-6 bg-slate-900 text-white rounded-3xl border border-slate-800/80 shadow-md">
              <h3 className="text-lg font-extrabold text-emerald-400 mb-2">💡 Consola Unificada de {adminName}</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">
                {esAdminDeUnaSucursal ? (
                  <>
                    Usted administra la sucursal <strong className="text-white">{sucursalAsignada}</strong>. Desde las
                    pestañas superiores puede registrar y revisar sus pedidos, cierres de caja, mermas, monedero y
                    personal. La información de las demás sucursales no forma parte de su panel.
                  </>
                ) : (
                  <>
                    Como administradora principal, usted posee privilegios totales sobre la plataforma Al Paso. Puede
                    utilizar las pestañas de navegación superiores para saltar entre el Catálogo Maestro de precios,
                    simular una venta/pedido en cualquiera de sus sucursales ({sucursalesPermitidas.join(", ")}), o
                    revisar la planilla de compras y nómina del Comprador.
                  </>
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-800">
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
                  <strong className="text-emerald-300 block mb-1">Catálogo Maestro</strong>
                  Cree nuevos códigos de productos, configure márgenes y asocie proveedores.
                </div>
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
                  <strong className="text-emerald-300 block mb-1">Auditoría de Precios</strong>
                  Trazabilidad de quién ajustó los precios de plaza y cuánto cambiaron.
                </div>
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
                  <strong className="text-emerald-300 block mb-1">Plaza &amp; Nómina</strong>
                  Supervise las compras de Hamilton y liquide el salario de los trabajadores.
                </div>
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
                  <strong className="text-emerald-300 block mb-1">Simulación Sucursales</strong>
                  Haga pruebas de pedidos, registre cierres diarios y mermas por tienda.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. CATALOG MANAGEMENT - FULL WIDTH TABLE + CREATION FORMS BELOW */}
        {adminMode === "catalog" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-8">
            {/* Header and Filter Controls */}
            <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 text-white shadow-lg space-y-4 animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-emerald-400">Administración de Precios, Márgenes y Pedidos</h3>
                  <p className="text-slate-400 text-xs mt-1">
                    Gestione el catálogo maestro de Fruver, ajuste precios de plaza, márgenes y registre pedidos por sucursal en tiempo real. Todo es editable directamente en la grilla.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                    <input
                      type="date"
                      value={matrixDate}
                      onChange={(e) => {
                        setMatrixDate(e.target.value);
                        setMatrixEdits({});
                      }}
                      className="bg-transparent text-white font-extrabold text-xs focus:outline-none cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 w-44 md:w-56">
                    <Library className="w-4 h-4 text-emerald-400" />
                    <input
                      type="text"
                      placeholder="Buscar producto..."
                      value={matrixSearch}
                      onChange={(e) => setMatrixSearch(e.target.value)}
                      className="bg-transparent text-white font-semibold text-xs focus:outline-none w-full"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setSelectedProductForNewOrder(null);
                      setNewOrderSearchQuery("");
                      setNewOrderBranchQty({
                        Tibasosa: "",
                        Nobsa: "",
                        Fira: "",
                        Aquitania: "",
                        Hansel: ""
                      });
                      setNewOrderNotes("");
                      setShowAddOrderModal(true);
                    }}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow transition cursor-pointer"
                    title="Añadir pedido de un producto adicional para hoy"
                  >
                    <Plus className="w-4 h-4" />
                    Añadir Pedido
                  </button>
                  <button
                    onClick={handleSaveBulkMatrix}
                    disabled={loading || Object.keys(matrixEdits).length === 0}
                    className={`px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow transition cursor-pointer ${
                      Object.keys(matrixEdits).length > 0
                        ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 animate-pulse"
                        : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    {loading ? "Guardando..." : `Guardar Cambios (${Object.keys(matrixEdits).length})`}
                  </button>
                </div>
              </div>

              {/* Status notifications */}
              {successMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-xl font-bold">
                  {successMsg}
                </div>
              )}
              {errorMsg && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl font-bold">
                  {errorMsg}
                </div>
              )}

              {/* Price change filters */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-slate-800">
                <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Ver Cambios de Precio en Catálogo:</span>
                <div className="flex flex-wrap bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setFilterPriceChanges("all")}
                    className={`px-3 py-1 rounded-lg transition ${
                      filterPriceChanges === "all" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Todos ({products.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPriceChanges("buy")}
                    className={`px-3 py-1 rounded-lg transition flex items-center gap-1 ${
                      filterPriceChanges === "buy" ? "bg-rose-600 text-white font-black" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-ping"></span>
                    Cambió Compra
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPriceChanges("sell")}
                    className={`px-3 py-1 rounded-lg transition flex items-center gap-1 ${
                      filterPriceChanges === "sell" ? "bg-violet-600 text-white font-black" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-ping"></span>
                    Cambió Venta
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPriceChanges("any")}
                    className={`px-3 py-1 rounded-lg transition flex items-center gap-1 ${
                      filterPriceChanges === "any" ? "bg-amber-500 text-slate-950 font-black" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Cualquier Cambio
                  </button>
                </div>

                {/* Mostrar solo lo que alguna sucursal pidió en la fecha seleccionada. */}
                <div className="flex items-center gap-2 bg-slate-950/60 p-1 rounded-xl border border-slate-800 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setSoloPedidos(false)}
                    className={`px-3 py-1 rounded-lg transition ${
                      !soloPedidos ? "bg-emerald-500 text-slate-950 font-black" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Todos los productos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSoloPedidos(true)}
                    title="Ver solo los productos que alguna sucursal pidió en esta fecha"
                    className={`px-3 py-1 rounded-lg transition flex items-center gap-1 ${
                      soloPedidos ? "bg-rose-600 text-white font-black" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Solo lo pedido
                  </button>
                </div>

                {/* Descarga el catálogo tal como se está viendo (filtros y orden incluidos). */}
                <button
                  type="button"
                  onClick={handleExportCatalogoXLSX}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition shadow-xs"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Descargar en Excel
                </button>

                {/* Imagen con los precios de venta que cambiaron, para mandar a las tiendas. */}
                <button
                  type="button"
                  onClick={() => {
                    if (productosConPrecioNuevo.length === 0) {
                      setErrorMsg("No hay cambios de precio de venta para enviar hoy.");
                      return;
                    }
                    setShowPriceReceipt(true);
                  }}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition shadow-xs"
                >
                  <Camera className="w-4 h-4" />
                  Enviar precios nuevos ({productosConPrecioNuevo.length})
                </button>
              </div>
            </div>

            {/* Conversion Calculator */}
            <div className="bg-gradient-to-br from-indigo-50/70 to-indigo-100/40 p-6 rounded-3xl border border-indigo-100 shadow-sm animate-fade-in">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-600 rounded-2xl text-white shadow-md">
                    <Calculator className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-indigo-950 text-sm">Calculadora de Conversión (Kg / Bto / Can)</h4>
                    <p className="text-[11px] text-indigo-600 font-medium">Convierta instantáneamente kilos a bultos o canastillas usando los factores reales del catálogo.</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  {/* Select product with Autocomplete search input */}
                  <div className="w-full md:w-80 relative">
                    <div className="flex items-center gap-1.5 bg-white border border-indigo-200/60 rounded-xl px-2.5 py-1 shadow-sm">
                      <input
                        type="text"
                        placeholder="Escriba o busque producto..."
                        value={calcSearch}
                        onChange={(e) => {
                          setCalcSearch(e.target.value);
                          setIsDropdownOpen(true);
                          const match = products.find(
                            p => p.Producto.toLowerCase() === e.target.value.toLowerCase() || p.Codigo.toLowerCase() === e.target.value.toLowerCase()
                          );
                          if (match) {
                            setCalcProduct(match.Codigo);
                            if (calcVal) runCalc(calcVal, match, calcType);
                          }
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                        className="w-full bg-transparent focus:outline-none text-xs font-bold text-indigo-950 py-1"
                      />
                      {calcSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setCalcProduct("");
                            setCalcSearch("");
                            setCalcResult("");
                          }}
                          className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {isDropdownOpen && (
                      <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg z-50">
                        {products
                          .filter(p => 
                            p.Producto.toLowerCase().includes(calcSearch.toLowerCase()) || 
                            p.Codigo.toLowerCase().includes(calcSearch.toLowerCase())
                          )
                          .map((p, idx) => (
                            <div
                              key={`${p.Codigo}-${p.Producto}-${idx}`}
                              onClick={() => {
                                setCalcProduct(p.Codigo);
                                setCalcSearch(`${p.Codigo} - ${p.Producto}`);
                                setIsDropdownOpen(false);
                                if (calcVal) {
                                  runCalc(calcVal, p, calcType);
                                }
                              }}
                              className="px-3 py-2 text-xs text-slate-800 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-b-0"
                            >
                              <span className="font-extrabold text-indigo-950">{p.Codigo}</span> - {p.Producto} 
                              <span className="text-[10px] text-slate-400 block font-semibold">
                                Bto: {p.Factor_Bulto || 56}kg | Can: {p.Factor_Canastilla || 22}kg
                              </span>
                            </div>
                          ))}
                        {products.filter(p => 
                          p.Producto.toLowerCase().includes(calcSearch.toLowerCase()) || 
                          p.Codigo.toLowerCase().includes(calcSearch.toLowerCase())
                        ).length === 0 && (
                          <div className="p-3 text-xs text-slate-400 italic text-center">
                            Ningún producto coincide. (Escriba para simular)
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Operation Type */}
                  <div className="w-full md:w-44">
                    <select
                      value={calcType}
                      onChange={(e: any) => {
                        setCalcType(e.target.value);
                        const prodObj = products.find(p => p.Codigo === calcProduct);
                        if (prodObj && calcVal) {
                          runCalc(calcVal, prodObj, e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white border border-indigo-200/60 rounded-xl focus:outline-none focus:border-indigo-400 text-xs font-bold text-indigo-950 shadow-sm"
                    >
                      <option value="kg_to_bto">Kilos ➔ Bultos</option>
                      <option value="bto_to_kg">Bultos ➔ Kilos</option>
                      <option value="kg_to_cn">Kilos ➔ Canastillas</option>
                      <option value="cn_to_kg">Canastillas ➔ Kilos</option>
                    </select>
                  </div>

                  {/* Qty Input */}
                  <div className="w-full md:w-32">
                    <input
                      type="text"
                      placeholder="Cantidad..."
                      value={calcVal}
                      onChange={(e) => {
                        setCalcVal(e.target.value);
                        const prodObj = products.find(p => p.Codigo === calcProduct);
                        if (prodObj) {
                          runCalc(e.target.value, prodObj, calcType);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white border border-indigo-200/60 rounded-xl focus:outline-none focus:border-indigo-400 text-xs font-black text-indigo-950 shadow-sm text-center font-mono"
                    />
                  </div>
                </div>
              </div>

              {calcResult && (
                <div className="mt-4 p-3 bg-white/90 border border-indigo-150 rounded-2xl flex items-center justify-center text-center shadow-inner animate-fade-in">
                  <div className="text-xs font-black text-indigo-950">
                    <span className="text-indigo-500 font-extrabold uppercase mr-2 tracking-wider text-[10px]">Resultado:</span>
                    {calcResult}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Sorting Toolbar for Consola Master */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-900 rounded-3xl border border-slate-800 text-white shadow-md">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 mr-1">
                  <ArrowUpDown className="w-4 h-4" />
                  Ordenar Catálogo Por:
                </span>
                <button
                  type="button"
                  onClick={() => toggleMatrixSort("Producto")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    matrixSortField === "Producto"
                      ? "bg-emerald-500 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🔤 Producto {matrixSortField === "Producto" ? (matrixSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleMatrixSort("Proveedor")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    matrixSortField === "Proveedor"
                      ? "bg-emerald-500 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🏢 Proveedor {matrixSortField === "Proveedor" ? (matrixSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleMatrixSort("Codigo")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    matrixSortField === "Codigo"
                      ? "bg-emerald-500 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🔢 Código {matrixSortField === "Codigo" ? (matrixSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleMatrixSort("Precio_Compra")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    matrixSortField === "Precio_Compra"
                      ? "bg-emerald-500 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  💰 Precio Compra {matrixSortField === "Precio_Compra" ? (matrixSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleMatrixSort("Requerido")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    matrixSortField === "Requerido"
                      ? "bg-emerald-500 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  📦 Cant. Requerida {matrixSortField === "Requerido" ? (matrixSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleMatrixSort("Total")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    matrixSortField === "Total"
                      ? "bg-emerald-500 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  💵 Total Valor {matrixSortField === "Total" ? (matrixSortDir === "asc" ? "▲" : "▼") : ""}
                </button>
              </div>
              <span className="text-[11px] text-slate-400 italic">
                Haga clic en los encabezados de columna para cambiar el orden
              </span>
            </div>

            {/* The Ultimate Matrix Spreadsheet Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md overflow-hidden animate-fade-in">
              <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
                <table className="w-full text-left text-xs border-collapse min-w-[2200px]">
                  <thead className="sticky top-0 z-30 shadow-xs bg-white">
                    {/* Level 1 Headers: PEDIDO, PAGOS, PRECIO DE VENTA groups */}
                    <tr className="text-center font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                      <th colSpan={3 + sucursalesPermitidas.length} className="bg-rose-600 text-white py-2 px-3 border-r border-rose-700">
                        PEDIDO
                      </th>
                      <th colSpan={4} className="bg-amber-100 text-amber-900 py-2 px-3 border-r border-slate-300">
                        DATOS PRODUCTO / PROVEEDOR
                      </th>
                      <th colSpan={9} className="bg-violet-700 text-white py-2 px-3">
                        PRECIOS DE VENTA & MARGENES
                      </th>
                    </tr>
                    
                    {/* Level 2 Headers: Column titles */}
                    <tr className="border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[9px] tracking-wider bg-slate-50 select-none">
                      {/* PEDIDO */}
                      <th className="py-2.5 px-2 border-r border-slate-200">FECHA PED</th>
                      <th 
                        onClick={() => toggleMatrixSort("Codigo")}
                        className="py-2.5 px-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition sticky left-0 z-20 bg-slate-50"
                      >
                        <div className="flex items-center gap-1">
                          <span>COD</span>
                          {matrixSortField === "Codigo" && (matrixSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleMatrixSort("Producto")}
                        className="py-2.5 px-2 border-r border-slate-200 min-w-[180px] cursor-pointer hover:bg-slate-200 transition text-slate-900 font-black sticky left-[70px] z-20 bg-slate-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]"
                      >
                        <div className="flex items-center gap-1">
                          <span>PRODUCTO</span>
                          {matrixSortField === "Producto" ? (matrixSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </th>
                      {sucursalesPermitidas.map((b) => (
                        <th key={b} className="py-2.5 px-2 border-r border-slate-200 text-center w-16 uppercase">{b}</th>
                      ))}

                      {/* DATOS PROV */}
                      <th 
                        onClick={() => toggleMatrixSort("Proveedor")}
                        className="py-2.5 px-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition text-slate-900 font-black"
                      >
                        <div className="flex items-center gap-1">
                          <span>PROVEEDOR</span>
                          {matrixSortField === "Proveedor" ? (matrixSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleMatrixSort("Precio_Compra")}
                        className="py-2.5 px-2 border-r border-slate-200 text-right w-24 cursor-pointer hover:bg-slate-200 transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>PRECIO COMPR.</span>
                          {matrixSortField === "Precio_Compra" && (matrixSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleMatrixSort("Requerido")}
                        className="py-2.5 px-2 border-r border-slate-200 text-center w-20 cursor-pointer hover:bg-slate-200 transition"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>REQUERIDO</span>
                          {matrixSortField === "Requerido" && (matrixSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th className="py-2.5 px-2 border-r border-slate-200 min-w-[150px]">OBSERVACION</th>

                      {/* PRECIO DE VENTA */}
                      <th className="py-2.5 px-2 border-r border-slate-200 text-right">PRECIO UNIT.</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-right text-slate-400">PRECIO ANT.</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-right">CAMBIO $</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-center w-14 text-[10px] font-bold text-slate-500" title="Peso de un Bulto (Kg)">PESO BTO (Kg)</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-center w-14 text-[10px] font-bold text-slate-500" title="Peso de una Canastilla (Kg)">PESO CAN (Kg)</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-center text-rose-600 font-extrabold w-14" title="Merma (%)">me (% Merma)</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-center w-20">% UTILIDAD</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-right text-slate-400">VENTA ANT.</th>
                      <th className="py-2.5 px-2 border-r border-slate-200 text-right bg-violet-50 text-violet-900 font-black">S VENTA KL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                    {getAdminMatrixData().map((row, idx) => {
                      const isVarying = row.Precio_Compra !== row.Precio_Anterior;
                      return (
                        <tr
                          key={`${row.Codigo}-${row.Producto}-${idx}`}
                          className={`hover:bg-slate-50 transition text-slate-800 ${
                            row.isPlaza ? "bg-emerald-50/5 font-medium" : ""
                          }`}
                        >
                          {/* FECHA PED */}
                          <td className="py-1.5 px-2 font-mono text-[10px] text-slate-500 border-r border-slate-150">{row.Fecha}</td>
                          
                          {/* COD — queda fijo al desplazarse a la derecha */}
                          <td className="py-1.5 px-2 font-mono font-bold text-[10px] text-slate-600 border-r border-slate-150 sticky left-0 z-10 bg-white">
                            {row.Codigo}
                            {row.isPlaza && (
                              <span className="ml-1 px-1 bg-emerald-100 text-emerald-800 text-[8px] font-black rounded-sm uppercase">P</span>
                            )}
                          </td>

                          {/* PRODUCTO — queda fijo al desplazarse a la derecha */}
                          <td className="py-1.5 px-2 border-r border-slate-150 sticky left-[70px] z-10 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                            <input
                              type="text"
                              value={row.Producto}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Producto", e.target.value)}
                              className="font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-full px-1 py-0.5 rounded transition text-xs"
                            />
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {row.Precio_Compra !== row.Precio_Anterior && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-extrabold flex items-center gap-0.5 uppercase tracking-wide shadow-xs ${
                                  row.Precio_Compra > row.Precio_Anterior 
                                    ? "bg-rose-100 text-rose-800 border border-rose-200" 
                                    : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                }`}>
                                  {row.Precio_Compra > row.Precio_Anterior ? "📈 Costo Sube" : "📉 Costo Baja"} 
                                  ({row.Precio_Compra > row.Precio_Anterior ? "+" : ""}{row.Precio_Anterior > 0 ? Math.round(((row.Precio_Compra - row.Precio_Anterior)/row.Precio_Anterior)*100) : 0}%)
                                </span>
                              )}
                              {row.Venta_Kl !== row.Precio_Venta_Ant && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-extrabold flex items-center gap-0.5 uppercase tracking-wide shadow-xs ${
                                  row.Venta_Kl > row.Precio_Venta_Ant 
                                    ? "bg-violet-100 text-violet-800 border border-violet-200" 
                                    : "bg-amber-100 text-amber-800 border border-amber-200"
                                }`}>
                                  {row.Venta_Kl > row.Precio_Venta_Ant ? "✨ Venta Sube" : "⚠️ Venta Baja"} 
                                  ({row.Venta_Kl > row.Precio_Venta_Ant ? "+" : ""}{row.Precio_Venta_Ant > 0 ? Math.round(((row.Venta_Kl - row.Precio_Venta_Ant)/row.Precio_Venta_Ant)*100) : 0}%)
                                </span>
                              )}
                            </div>
                          </td>
                          
                          {/* Una celda por sucursal activa */}
                          {sucursalesPermitidas.map((b) => (
                            <td key={b} className="py-1.5 px-2 border-r border-slate-150 text-center">
                              <input
                                type="text"
                                value={(row as any)[b] ?? "-"}
                                onChange={(e) => handleMatrixEdit(row.Codigo, b, e.target.value)}
                                className="text-center font-bold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-10 px-1 py-0.5 rounded transition text-xs"
                              />
                            </td>
                          ))}

                          {/* PROVEEDOR */}
                          <td className="py-1.5 px-2 border-r border-slate-150">
                            <input
                              list="providers-datalist"
                              value={row.Proveedor}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Proveedor", e.target.value)}
                              placeholder="Sin Proveedor"
                              className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white px-1 py-0.5 rounded font-semibold text-slate-800 transition text-xs w-full"
                            />
                            <datalist id="providers-datalist">
                              <option value="Sin Proveedor" />
                              {providers.map((p, pIdx) => (
                                <option key={`${p.Proveedor}-${pIdx}`} value={p.Proveedor} />
                              ))}
                            </datalist>
                          </td>

                           {/* PRECIO COMPRA */}
                          <td className={`py-1.5 px-2 border-r border-slate-150 text-right transition-colors ${
                            row.Precio_Compra > row.Precio_Anterior 
                              ? "bg-rose-50" 
                              : row.Precio_Compra < row.Precio_Anterior 
                                ? "bg-emerald-50" 
                                : ""
                          }`}>
                            <div className="relative inline-block w-full">
                              <input
                                type="number"
                                value={row.Precio_Compra || ""}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Costo_Momento", parseFloat(e.target.value) || 0)}
                                className={`text-right font-mono font-extrabold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-20 px-1 py-0.5 rounded transition text-xs ${
                                  row.Precio_Compra > row.Precio_Anterior 
                                    ? "text-rose-950 font-black" 
                                    : row.Precio_Compra < row.Precio_Anterior 
                                      ? "text-emerald-950 font-black" 
                                      : "text-slate-900"
                                }`}
                              />
                              {row.Precio_Compra !== row.Precio_Anterior && (
                                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                    row.Precio_Compra > row.Precio_Anterior ? "bg-rose-400" : "bg-emerald-400"
                                  }`}></span>
                                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                                    row.Precio_Compra > row.Precio_Anterior ? "bg-rose-500" : "bg-emerald-500"
                                  }`}></span>
                                </span>
                              )}
                            </div>
                          </td>

                          {/* REQUERIDO */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-center font-black text-slate-900 text-xs">
                            {formatQty(row.Requerido)}
                          </td>

                          {/* OBSERVACION */}
                          <td className="py-1.5 px-2 border-r border-slate-150">
                            <input
                              type="text"
                              value={row.Observacion}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Observacion", e.target.value)}
                              placeholder="Notas..."
                              className="italic text-slate-500 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-full px-1 py-0.5 rounded transition text-xs"
                            />
                          </td>


                          {/* PRECIO DE VENTA */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-right font-mono font-semibold text-slate-600">{cop(row.Precio_Compra)}</td>
                          <td className="py-1.5 px-2 border-r border-slate-150 text-right font-mono text-slate-400">{cop(row.Precio_Anterior)}</td>
                          <td className={`py-1.5 px-2 border-r border-slate-150 text-right font-mono font-bold ${
                            row.Cambio > 0 ? "text-rose-600" : row.Cambio < 0 ? "text-emerald-600" : "text-slate-400"
                          }`}>
                            {row.Cambio > 0 ? `+${cop(row.Cambio)}` : row.Cambio < 0 ? cop(row.Cambio) : "$ 0"}
                          </td>
                          
                          {/* Factor Bulto */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-center">
                            <input
                              type="number"
                              value={row.Factor_Bulto}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Factor_Bulto", parseFloat(e.target.value) || 56)}
                              className="text-center font-bold text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-10 px-1 py-0.5 rounded transition text-xs font-mono"
                            />
                          </td>
                          
                          {/* Factor Canastilla */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-center">
                            <input
                              type="number"
                              value={row.Factor_Canastilla}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Factor_Canastilla", parseFloat(e.target.value) || 22)}
                              className="text-center font-bold text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-10 px-1 py-0.5 rounded transition text-xs font-mono"
                            />
                          </td>
                          
                          {/* me (Merma) */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-center">
                            <input
                              type="number"
                              step="any"
                              value={row.Merma !== undefined ? Math.round(row.Merma * 100) : 0}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Merma", (parseFloat(e.target.value) || 0) / 100)}
                              className="text-center font-bold text-rose-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-10 px-1 py-0.5 rounded transition text-xs"
                            />
                            <span className="text-rose-600 font-extrabold text-[10px] ml-0.5">%</span>
                          </td>
                          
                          {/* % UTILIDAD */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-center">
                            <input
                              type="number"
                              step="any"
                              value={row.Utilidad ? Math.round(row.Utilidad * 100) : 0}
                              onChange={(e) => handleMatrixEdit(row.Codigo, "Utilidad", (parseFloat(e.target.value) || 0) / 100)}
                              className="text-center font-black text-emerald-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-12 px-1 py-0.5 rounded transition text-xs"
                            />
                            <span className="text-emerald-600 font-extrabold text-[10px] ml-0.5">%</span>
                          </td>
                          
                          {/* VENTA ANT. */}
                          <td className="py-1.5 px-2 border-r border-slate-150 text-right font-mono text-slate-400">{cop(row.Precio_Venta_Ant)}</td>
                          
                          {/* $ VENTA KL */}
                          <td className={`py-1.5 px-2 border-r border-slate-150 text-right font-mono font-black text-xs transition-colors ${
                            row.Venta_Kl > row.Precio_Venta_Ant
                              ? "bg-violet-100 text-violet-950"
                              : row.Venta_Kl < row.Precio_Venta_Ant
                                ? "bg-amber-100 text-amber-950"
                                : "bg-violet-50/60 text-violet-950"
                          }`}>
                            <div className="relative inline-block w-full">
                              <input
                                type="number"
                                value={row.Venta_Kl || ""}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Precio_Venta_Actual", parseFloat(e.target.value) || 0)}
                                className={`text-right font-mono font-black bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-20 px-1 py-0.5 rounded transition text-xs ${
                                  row.Venta_Kl > row.Precio_Venta_Ant
                                    ? "text-violet-950"
                                    : row.Venta_Kl < row.Precio_Venta_Ant
                                      ? "text-amber-950"
                                      : "text-violet-950"
                                }`}
                              />
                              {row.Venta_Kl !== row.Precio_Venta_Ant && (
                                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                    row.Venta_Kl > row.Precio_Venta_Ant ? "bg-violet-400" : "bg-amber-400"
                                  }`}></span>
                                  <span className={`relative inline-flex rounded-full h-2 w-2 ${
                                    row.Venta_Kl > row.Precio_Venta_Ant ? "bg-violet-500" : "bg-amber-500"
                                  }`}></span>
                                </span>
                              )}
                            </div>
                          </td>
                          
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Side-by-Side creation forms displayed below */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              {/* Product Form */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
                <h3 className="text-md font-bold text-slate-800 mb-4 flex items-center gap-1.5">
                  <PlusCircle className="w-5 h-5 text-emerald-500" />
                  Agregar Nuevo Producto
                </h3>

                <form onSubmit={handleCreateProduct} className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Código *</label>
                      <input
                        type="text"
                        placeholder="Ej: P40"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                        required
                        className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Unidad *</label>
                      <input
                        type="text"
                        placeholder="Ej: Bulto (Kg)"
                        value={newMedida}
                        onChange={(e) => setNewMedida(e.target.value)}
                        required
                        className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Nombre Producto *</label>
                    <input
                      type="text"
                      placeholder="Ej: Papa pastusa criolla"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Costo Plaza *</label>
                      <input
                        type="number"
                        placeholder="Ej: 45000"
                        value={newCost}
                        onChange={(e) => setNewCost(e.target.value)}
                        required
                        className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase">Margen Utilidad (0.3 = 30%)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="0.3"
                        value={newUtil}
                        onChange={(e) => setNewUtil(e.target.value)}
                        required
                        className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Asociar Proveedor *</label>
                    <input
                      list="providers-datalist"
                      value={newProv}
                      onChange={(e) => setNewProv(e.target.value)}
                      placeholder="Seleccione o escriba proveedor"
                      required
                      className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-slate-900 hover:bg-slate-850 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow"
                  >
                    Crear Producto
                  </button>
                </form>
              </div>

              {/* Provider Form */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
                <h3 className="text-md font-bold text-slate-800 mb-4 flex items-center gap-1.5">
                  <Smartphone className="w-5 h-5 text-emerald-500" />
                  Agregar Proveedor de Plaza
                </h3>

                <form onSubmit={handleCreateProvider} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Nombre Proveedor *</label>
                    <input
                      type="text"
                      placeholder="Ej: ALIRIO o SABILA"
                      value={provName}
                      onChange={(e) => setProvName(e.target.value)}
                      required
                      className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Celular / Teléfono</label>
                    <input
                      type="text"
                      placeholder="Ej: 3101234567"
                      value={provCell}
                      onChange={(e) => setProvCell(e.target.value)}
                      className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-slate-900 hover:bg-slate-850 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow"
                  >
                    Registrar Proveedor
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* 2.5. FACTORS & WEIGHTS SHEET */}
        {adminMode === "factors" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
            {/* Header Control Panel */}
            <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 text-white shadow-lg space-y-4 animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-amber-400 flex items-center gap-2">
                    <Boxes className="w-5 h-5 text-amber-400" />
                    Factores de Empaque, Pesos y Márgenes
                  </h3>
                  <p className="text-slate-400 text-xs mt-1">
                    Vista maestra enfocada en la configuración de conversión de empaques (Factores de bulto y canastilla), mermas, utilidades y precios, sin la carga visual de las cantidades de pedidos.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 w-44 md:w-56">
                    <Library className="w-4 h-4 text-amber-400" />
                    <input
                      type="text"
                      placeholder="Buscar producto..."
                      value={factorsSearch}
                      onChange={(e) => setFactorsSearch(e.target.value)}
                      className="bg-transparent text-white font-semibold text-xs focus:outline-none w-full"
                    />
                  </div>
                  <button
                    onClick={() => setShowAddProductModal(true)}
                    className="px-4 py-1.5 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1.5 shadow transition cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Añadir Producto
                  </button>
                  <button
                    onClick={handleSaveBulkMatrix}
                    disabled={loading || Object.keys(matrixEdits).length === 0}
                    className={`px-4 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow transition cursor-pointer ${
                      Object.keys(matrixEdits).length > 0
                        ? "bg-amber-400 hover:bg-amber-300 text-slate-950 animate-pulse"
                        : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    {loading ? "Guardando..." : `Guardar Cambios (${Object.keys(matrixEdits).length})`}
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Sorting Toolbar for Factores */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900 text-white rounded-2xl border border-slate-800 shadow">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5 mr-1">
                  <ArrowUpDown className="w-4 h-4" />
                  Ordenar Factores Por:
                </span>
                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Producto")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Producto"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🔤 Producto {factorsSortField === "Producto" ? (factorsSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Proveedor")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Proveedor"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🏢 Proveedor {factorsSortField === "Proveedor" ? (factorsSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Codigo")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Codigo"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🔢 Código {factorsSortField === "Codigo" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Factor_Bulto")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Factor_Bulto"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  📦 Factor Bulto {factorsSortField === "Factor_Bulto" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Factor_Canastilla")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Factor_Canastilla"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  🧺 Factor Canastilla {factorsSortField === "Factor_Canastilla" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Merma")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Merma"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  📉 Merma % {factorsSortField === "Merma" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Utilidad")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Utilidad"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  📈 Utilidad % {factorsSortField === "Utilidad" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Costo_Momento")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Costo_Momento"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  💰 Precio Compra {factorsSortField === "Costo_Momento" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => toggleFactorsSort("Precio_Venta")}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    factorsSortField === "Precio_Venta"
                      ? "bg-amber-400 text-slate-950 font-black shadow"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  💵 Precio Venta {factorsSortField === "Precio_Venta" ? (factorsSortDir === "asc" ? "▲" : "▼") : ""}
                </button>
              </div>
            </div>

            {/* Clean Spreadsheet Table */}
            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-md overflow-hidden animate-fade-in">
              <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
                <table className="w-full text-left text-xs border-collapse min-w-[1300px]">
                  <thead className="sticky top-0 z-30 shadow-xs bg-slate-50 select-none">
                    <tr className="border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[9px] tracking-wider bg-slate-50">
                      <th 
                        onClick={() => toggleFactorsSort("Codigo")}
                        className="py-3 px-3 w-20 text-center cursor-pointer hover:bg-slate-200 transition"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>CÓDIGO</span>
                          {factorsSortField === "Codigo" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Producto")}
                        className="py-3 px-3 min-w-[180px] cursor-pointer hover:bg-slate-200 transition text-slate-900 font-black"
                      >
                        <div className="flex items-center gap-1">
                          <span>PRODUCTO</span>
                          {factorsSortField === "Producto" ? (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </th>
                      <th className="py-3 px-2 w-32">UNIDAD MEDIDA</th>
                      <th 
                        onClick={() => toggleFactorsSort("Factor_Bulto")}
                        className="py-3 px-2 w-28 text-center bg-amber-50/50 text-amber-950 font-black cursor-pointer hover:bg-amber-100 transition"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>FACTOR BTO (Kg)</span>
                          {factorsSortField === "Factor_Bulto" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-amber-700" /> : <ArrowDown className="w-3 h-3 text-amber-700" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Factor_Canastilla")}
                        className="py-3 px-2 w-28 text-center bg-amber-50/50 text-amber-950 font-black cursor-pointer hover:bg-amber-100 transition"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>FACTOR CAN (Kg)</span>
                          {factorsSortField === "Factor_Canastilla" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-amber-700" /> : <ArrowDown className="w-3 h-3 text-amber-700" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Merma")}
                        className="py-3 px-2 w-24 text-center text-rose-600 font-extrabold cursor-pointer hover:bg-rose-50 transition"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>% MERMA</span>
                          {factorsSortField === "Merma" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-rose-600" /> : <ArrowDown className="w-3 h-3 text-rose-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Utilidad")}
                        className="py-3 px-2 w-24 text-center text-emerald-600 font-extrabold cursor-pointer hover:bg-emerald-50 transition"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>% UTILIDAD</span>
                          {factorsSortField === "Utilidad" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Proveedor")}
                        className="py-3 px-3 min-w-[150px] cursor-pointer hover:bg-slate-200 transition text-slate-900 font-black"
                      >
                        <div className="flex items-center gap-1">
                          <span>PROVEEDOR</span>
                          {factorsSortField === "Proveedor" ? (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Costo_Momento")}
                        className="py-3 px-3 text-right w-28 bg-emerald-50/40 cursor-pointer hover:bg-emerald-100/50 transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>PRECIO COMPRA</span>
                          {factorsSortField === "Costo_Momento" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-700" /> : <ArrowDown className="w-3 h-3 text-emerald-700" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => toggleFactorsSort("Precio_Venta")}
                        className="py-3 px-3 text-right w-28 bg-violet-50/40 cursor-pointer hover:bg-violet-100/50 transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>PRECIO VENTA</span>
                          {factorsSortField === "Precio_Venta" && (factorsSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-violet-700" /> : <ArrowDown className="w-3 h-3 text-violet-700" />)}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                    {getFactorsFilteredProducts().map((p, idx) => {
                      const code = p.Codigo;
                      const edit = matrixEdits[code] || {};
                      
                      const currentCodigo = edit.Nuevo_Codigo !== undefined ? edit.Nuevo_Codigo : p.Codigo;
                      const producto = edit.Producto !== undefined ? edit.Producto : p.Producto;
                      const factorBulto = edit.Factor_Bulto !== undefined ? parseFloat(edit.Factor_Bulto) : (p.Factor_Bulto || 56);
                      const factorCanastilla = edit.Factor_Canastilla !== undefined ? parseFloat(edit.Factor_Canastilla) : (p.Factor_Canastilla || 22);
                      const merma = edit.Merma !== undefined ? parseFloat(edit.Merma) : (p.Merma !== undefined ? p.Merma : 0);
                      const utilidad = edit.Utilidad !== undefined ? parseFloat(edit.Utilidad) : (p.Utilidad || 0.3);
                      const providerName = edit.Proveedor !== undefined ? edit.Proveedor : (p.Proveedor || "Sin Proveedor");
                      const precioCompra = edit.Costo_Momento !== undefined ? parseFloat(edit.Costo_Momento) : (p.Costo_Proveedor || 0);
                      const precioAnterior = p.Precio_Anterior || p.Costo_Proveedor || 0;
                      const precioVenta = edit.Precio_Venta_Actual !== undefined ? parseFloat(edit.Precio_Venta_Actual) : (p.Precio_Venta_Actual || 0);
                      const precioVentaAnt = p.Venta_Anterior || p.Precio_Venta_Actual || 0;

                      return (
                        <tr key={`${code}-${idx}`} className="hover:bg-slate-50 transition text-slate-800">
                          {/* CÓDIGO */}
                          <td className="py-2 px-3 bg-slate-50/50 text-center">
                            <input
                              type="text"
                              value={currentCodigo}
                              onChange={(e) => handleMatrixEdit(code, "Nuevo_Codigo", e.target.value.trim().toUpperCase())}
                              className="font-mono font-bold text-[11px] text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-14 px-1 py-0.5 rounded transition text-center focus:ring-1 focus:ring-amber-500"
                            />
                          </td>

                          {/* PRODUCTO */}
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={producto}
                              onChange={(e) => handleMatrixEdit(code, "Producto", e.target.value)}
                              className="font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-full px-1 py-0.5 rounded transition text-xs"
                            />
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {precioCompra !== precioAnterior && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-extrabold flex items-center gap-0.5 uppercase tracking-wide ${
                                  precioCompra > precioAnterior ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                                }`}>
                                  {precioCompra > precioAnterior ? "📈 Costo Sube" : "📉 Costo Baja"} ({precioAnterior > 0 ? Math.round(((precioCompra - precioAnterior)/precioAnterior)*100) : 0}%)
                                </span>
                              )}
                              {precioVenta !== precioVentaAnt && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-extrabold flex items-center gap-0.5 uppercase tracking-wide ${
                                  precioVenta > precioVentaAnt ? "bg-violet-100 text-violet-800" : "bg-amber-100 text-amber-800"
                                }`}>
                                  {precioVenta > precioVentaAnt ? "✨ Venta Sube" : "⚠️ Venta Baja"} ({precioVentaAnt > 0 ? Math.round(((precioVenta - precioVentaAnt)/precioVentaAnt)*100) : 0}%)
                                </span>
                              )}
                            </div>
                          </td>

                          {/* UNIDAD MEDIDA */}
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={edit.Medida !== undefined ? edit.Medida : p.Medida}
                              onChange={(e) => handleMatrixEdit(code, "Medida", e.target.value)}
                              className="font-semibold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-28 px-1 py-0.5 rounded transition text-xs italic focus:ring-1 focus:ring-amber-500"
                            />
                          </td>

                          {/* FACTOR BULTO */}
                          <td className="py-2 px-2 text-center bg-amber-50/10">
                            <input
                              type="number"
                              value={factorBulto}
                              onChange={(e) => handleMatrixEdit(code, "Factor_Bulto", parseFloat(e.target.value) || 56)}
                              className="text-center font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-16 px-1 py-0.5 rounded transition text-xs font-mono"
                            />
                          </td>

                          {/* FACTOR CANASTILLA */}
                          <td className="py-2 px-2 text-center bg-amber-50/10">
                            <input
                              type="number"
                              value={factorCanastilla}
                              onChange={(e) => handleMatrixEdit(code, "Factor_Canastilla", parseFloat(e.target.value) || 22)}
                              className="text-center font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-16 px-1 py-0.5 rounded transition text-xs font-mono"
                            />
                          </td>

                          {/* MERMA */}
                          <td className="py-2 px-2 text-center">
                            <div className="inline-flex items-center justify-center">
                              <input
                                type="number"
                                step="any"
                                value={Math.round(merma * 100)}
                                onChange={(e) => handleMatrixEdit(code, "Merma", (parseFloat(e.target.value) || 0) / 100)}
                                className="text-center font-bold text-rose-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-10 px-1 py-0.5 rounded transition text-xs font-mono"
                              />
                              <span className="text-rose-600 font-extrabold text-[10px] ml-0.5">%</span>
                            </div>
                          </td>

                          {/* UTILIDAD */}
                          <td className="py-2 px-2 text-center">
                            <div className="inline-flex items-center justify-center">
                              <input
                                type="number"
                                step="any"
                                value={Math.round(utilidad * 100)}
                                onChange={(e) => handleMatrixEdit(code, "Utilidad", (parseFloat(e.target.value) || 0) / 100)}
                                className="text-center font-black text-emerald-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-10 px-1 py-0.5 rounded transition text-xs font-mono"
                              />
                              <span className="text-emerald-600 font-extrabold text-[10px] ml-0.5">%</span>
                            </div>
                          </td>

                          {/* PROVEEDOR */}
                          <td className="py-2 px-3">
                            <input
                              list="providers-datalist-factors"
                              value={providerName}
                              onChange={(e) => handleMatrixEdit(code, "Proveedor", e.target.value)}
                              placeholder="Sin Proveedor"
                              className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white px-1 py-0.5 rounded font-semibold text-slate-800 transition text-xs w-full focus:ring-1 focus:ring-amber-500"
                            />
                            <datalist id="providers-datalist-factors">
                              <option value="Sin Proveedor" />
                              {providers.map((pr, prIdx) => (
                                <option key={`${pr.Proveedor}-${prIdx}`} value={pr.Proveedor} />
                              ))}
                            </datalist>
                          </td>

                          {/* PRECIO COMPRA */}
                          <td className={`py-2 px-3 text-right bg-emerald-50/10 font-mono font-bold ${
                            precioCompra !== precioAnterior ? "bg-rose-50/70" : ""
                          }`}>
                            <input
                              type="number"
                              value={precioCompra || ""}
                              onChange={(e) => handleMatrixEdit(code, "Costo_Momento", parseFloat(e.target.value) || 0)}
                              className={`text-right font-mono font-extrabold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-20 px-1 py-0.5 rounded transition text-xs ${
                                precioCompra !== precioAnterior ? "text-rose-950 font-black" : "text-slate-900"
                              }`}
                            />
                          </td>

                          {/* PRECIO VENTA */}
                          <td className={`py-2 px-3 text-right bg-violet-50/10 font-mono font-bold ${
                            precioVenta !== precioVentaAnt ? "bg-violet-100/70" : ""
                          }`}>
                            <input
                              type="number"
                              value={precioVenta || ""}
                              onChange={(e) => handleMatrixEdit(code, "Precio_Venta_Actual", parseFloat(e.target.value) || 0)}
                              className={`text-right font-mono font-black bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-500 focus:bg-white w-20 px-1 py-0.5 rounded transition text-xs text-violet-950`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ADD NEW PRODUCT MODAL */}
            {showAddProductModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-fade-in">
                <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-scale-up">
                  <div className="bg-slate-900 px-6 py-4 text-white flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Boxes className="w-5 h-5 text-amber-400" />
                      <div>
                        <h3 className="font-black text-sm text-amber-400">Crear Nuevo Producto</h3>
                        <p className="text-[10px] text-slate-400">Configure los factores iniciales del catálogo maestro</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddProductModal(false)}
                      className="text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleModalCreateProduct} className="p-6 space-y-4 text-xs">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Código *</label>
                        <input
                          type="text"
                          placeholder="Ej: P40"
                          value={modalCode}
                          onChange={(e) => setModalCode(e.target.value)}
                          required
                          className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Unidad Medida *</label>
                        <input
                          type="text"
                          placeholder="Ej: Kg o Bulto (Kg)"
                          value={modalMedida}
                          onChange={(e) => setModalMedida(e.target.value)}
                          required
                          className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nombre del Producto *</label>
                      <input
                        type="text"
                        placeholder="Ej: Papa Única"
                        value={modalName}
                        onChange={(e) => setModalName(e.target.value)}
                        required
                        className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Proveedor *</label>
                        <input
                          list="providers-datalist"
                          value={modalProv}
                          onChange={(e) => setModalProv(e.target.value)}
                          placeholder="Escriba o seleccione"
                          className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Costo Proveedor ($) *</label>
                        <input
                          type="number"
                          placeholder="Ej: 50000"
                          value={modalCost}
                          onChange={(e) => setModalCost(e.target.value)}
                          required
                          className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-amber-50/50 p-3 rounded-2xl border border-amber-100">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">Factor Bto (Kg)</label>
                        <input
                          type="number"
                          value={modalFactorBto}
                          onChange={(e) => setModalFactorBto(e.target.value)}
                          className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-semibold text-slate-950 text-center"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">Factor Can (Kg)</label>
                        <input
                          type="number"
                          value={modalFactorCan}
                          onChange={(e) => setModalFactorCan(e.target.value)}
                          className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-semibold text-slate-950 text-center"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">% Merma Inicial</label>
                        <input
                          type="number"
                          value={modalMerma}
                          onChange={(e) => setModalMerma(e.target.value)}
                          className="w-full mt-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-mono font-semibold text-slate-950 text-center"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">% Utilidad Inicial</label>
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="number"
                          value={modalUtil}
                          onChange={(e) => setModalUtil(e.target.value)}
                          className="w-20 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-slate-900 text-center focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <span className="font-bold text-slate-500">%</span>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setShowAddProductModal(false)}
                        className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 transition font-bold"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition font-black flex items-center gap-1.5 cursor-pointer"
                      >
                        {loading ? "Creando..." : "Crear Producto"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. PRICE HISTORY */}
        {adminMode === "history" && (() => {
          // Unique products list
          const uniqueHistoryProducts = Array.from(
            new Set(priceHistory.map((h) => JSON.stringify({ Codigo: h.Codigo, Producto: h.Producto })))
          ).map((str) => JSON.parse(str) as { Codigo: string; Producto: string })
           .sort((a, b) => a.Producto.localeCompare(b.Producto));

          // Force focus on single product. Default to first product if 'all' or empty.
          const activeProductCode = (historySelectedProduct === "all" || !historySelectedProduct)
            ? (uniqueHistoryProducts[0]?.Codigo || "")
            : historySelectedProduct;

          const activeProduct = uniqueHistoryProducts.find((p) => p.Codigo === activeProductCode);

          // All history records of this single product
          const productHistory = priceHistory
            .filter((h) => h.Codigo === activeProductCode)
            .sort((a, b) => new Date(a.Fecha_Hora).getTime() - new Date(b.Fecha_Hora).getTime());

          const totalProductChanges = productHistory.length;

          // Latest prices
          const latestChange = productHistory[productHistory.length - 1];
          const latestCost = latestChange ? latestChange.Costo_Nuevo : 0;
          const latestVenta = latestChange ? latestChange.Venta_Nueva : 0;
          const latestMarginPct = latestVenta > 0 ? Math.round(((latestVenta - latestCost) / latestVenta) * 100) : 0;

          // Previous prices
          const prevCost = latestChange ? latestChange.Costo_Anterior : 0;
          const prevVenta = latestChange ? latestChange.Venta_Anterior : 0;

          // Differences
          const costDiff = latestCost - prevCost;
          const ventaDiff = latestVenta - prevVenta;

          // Trend chart data mapping for this product
          const filteredTrendData = productHistory.map((h) => ({
            fecha: new Date(h.Fecha_Hora).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            "Costo ($)": h.Costo_Nuevo,
            "Precio Venta ($)": h.Venta_Nueva,
            "Margen (%)": Math.round(((h.Venta_Nueva - h.Costo_Nuevo) / (h.Venta_Nueva || 1)) * 100),
          }));

          return (
            <div id="price-history-section" className="max-w-7xl mx-auto px-4 md:px-6 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <History className="w-5 h-5 text-emerald-600" />
                    Historial de Precios de Venta e Históricos por Producto
                  </h3>
                  <p className="text-slate-400 text-xs">Busque un producto para ver la tendencia de sus costos, precios de venta y evolución histórica individual.</p>
                </div>

                {/* Single Product Search & Selector */}
                <div className="relative flex items-center gap-2 z-50">
                  <span className="text-[11px] font-black text-slate-500 uppercase hidden sm:inline">Seleccionar Producto:</span>
                  <div className="relative w-72 sm:w-80">
                    <input
                      type="text"
                      placeholder="🔍 Buscar por nombre o código..."
                      value={historySearchTerm}
                      onFocus={() => setHistoryShowSuggestions(true)}
                      onBlur={() => {
                        // Small timeout to allow suggestion click to register
                        setTimeout(() => {
                          setHistoryShowSuggestions(false);
                        }, 250);
                      }}
                      onChange={(e) => {
                        setHistorySearchTerm(e.target.value);
                        setHistoryShowSuggestions(true);
                      }}
                      className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 pr-8 transition-all"
                    />
                    {historySearchTerm && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistorySearchTerm("");
                          if (uniqueHistoryProducts.length > 0) {
                            setHistorySelectedProduct(uniqueHistoryProducts[0].Codigo);
                          }
                          setHistoryShowSuggestions(false);
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                      >
                        ✕
                      </button>
                    )}

                    {historyShowSuggestions && (
                      <div className="absolute right-0 top-full mt-1.5 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl z-[999] p-2 space-y-0.5">
                        {(() => {
                          const filtered = uniqueHistoryProducts.filter(
                            (p) =>
                              p.Producto.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
                              p.Codigo.toLowerCase().includes(historySearchTerm.toLowerCase())
                          );

                          if (filtered.length === 0) {
                            return (
                              <p className="text-slate-400 text-xs italic text-center py-4">
                                No se encontraron productos
                              </p>
                            );
                          }

                          return filtered.map((p, idx) => (
                            <button
                              key={`${p.Codigo}-${p.Producto}-${idx}`}
                              type="button"
                              onClick={() => {
                                setHistorySelectedProduct(p.Codigo);
                                setHistorySearchTerm(p.Producto);
                                setHistoryShowSuggestions(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all truncate flex items-center justify-between ${
                                activeProductCode === p.Codigo
                                  ? "bg-emerald-500 text-white"
                                  : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              <span className="truncate">{p.Producto}</span>
                              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ml-2 ${
                                activeProductCode === p.Codigo ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                              }`}>
                                {p.Codigo}
                              </span>
                            </button>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {priceHistory.length > 0 && activeProduct ? (
                <div className="space-y-6">
                  {/* Active Product Headline Info */}
                  <div className="bg-emerald-50/40 border border-emerald-100/50 p-4 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider bg-emerald-100 px-2.5 py-1 rounded-full">Producto Activo</span>
                      <h4 className="text-lg font-black text-slate-800 mt-1.5">
                        {activeProduct.Producto}
                      </h4>
                      <p className="text-slate-400 text-xs mt-0.5">Código de barras / referencia: <span className="font-mono font-bold text-slate-600">{activeProduct.Codigo}</span></p>
                    </div>
                    {latestChange && (
                      <div className="text-right sm:text-right text-xs">
                        <span className="text-slate-400 block">Último cambio por:</span>
                        <span className="font-bold text-slate-800">{latestChange.Usuario}</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">{new Date(latestChange.Fecha_Hora).toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Focused Metric Cards for Single Product */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Ajustes Totales</span>
                        <History className="w-4 h-4 text-slate-500" />
                      </div>
                      <p className="text-2xl font-black text-slate-800 mt-1">{totalProductChanges}</p>
                      <p className="text-[10px] text-slate-400 mt-1">Registros auditados</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Costo Anterior</span>
                        <ArrowDownRight className="w-4 h-4 text-slate-400" />
                      </div>
                      <p className="text-xl font-black text-slate-800 mt-1.5">{cop(prevCost)}</p>
                      <p className="text-[10px] text-slate-400 mt-1">Costo antes del cambio</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Costo Actual</span>
                        <span className={`w-2 h-2 rounded-full ${costDiff > 0 ? "bg-rose-500" : costDiff < 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
                      </div>
                      <p className="text-xl font-black text-slate-800 mt-1.5">{cop(latestCost)}</p>
                      <p className={`text-[10px] font-bold mt-1 ${
                        costDiff > 0 ? "text-rose-600" : costDiff < 0 ? "text-emerald-600" : "text-slate-400"
                      }`}>
                        {costDiff === 0 ? "Sin variación" : `${costDiff > 0 ? "▲ +" : "▼ "}${cop(costDiff)}`}
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Precio Venta</span>
                        <span className={`w-2 h-2 rounded-full ${ventaDiff > 0 ? "bg-emerald-500" : ventaDiff < 0 ? "bg-rose-500" : "bg-slate-300"}`} />
                      </div>
                      <p className="text-xl font-black text-slate-800 mt-1.5">{cop(latestVenta)}</p>
                      <p className={`text-[10px] font-bold mt-1 ${
                        ventaDiff > 0 ? "text-emerald-600" : ventaDiff < 0 ? "text-rose-600" : "text-slate-400"
                      }`}>
                        {ventaDiff === 0 ? "Sin variación" : `${ventaDiff > 0 ? "▲ +" : "▼ "}${cop(ventaDiff)}`}
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl col-span-2 md:col-span-1">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Margen Utilidad</span>
                        <span className="text-slate-400 text-[11px] font-bold">%</span>
                      </div>
                      <p className="text-xl font-black text-slate-800 mt-1.5">{latestMarginPct}%</p>
                      <p className="text-[10px] text-slate-400 mt-1">Margen sobre venta actual</p>
                    </div>
                  </div>

                  {/* Single Wide Line Chart for the Product */}
                  <div className="bg-slate-50/50 border border-slate-100 p-5 rounded-3xl space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                          Línea de Tendencia: {activeProduct.Producto}
                        </h4>
                        <p className="text-[10px] text-slate-400">Fluctuación de Costo de Compra vs Precio de Venta en cada ajuste</p>
                      </div>
                    </div>

                    <div className="h-[300px] w-full bg-white p-3 rounded-2xl border border-slate-100/80">
                      {filteredTrendData.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-400 text-xs italic">
                          No hay suficientes datos históricos guardados para graficar.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={filteredTrendData} margin={{ top: 15, right: 20, left: -5, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="fecha" stroke="#94a3b8" fontSize={9} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} />
                            <ChartTooltip
                              contentStyle={{ backgroundColor: "#1e293b", borderRadius: "12px", border: "none", color: "#fff", fontSize: "11px" }}
                              labelClassName="font-bold text-amber-400"
                            />
                            <Legend wrapperStyle={{ fontSize: "10px" }} />
                            <Line type="monotone" dataKey="Costo ($)" stroke="#f43f5e" strokeWidth={3.5} activeDot={{ r: 6 }} name="Costo de Compra" />
                            <Line type="monotone" dataKey="Precio Venta ($)" stroke="#10b981" strokeWidth={3.5} activeDot={{ r: 6 }} name="Precio de Venta" />
                            <Line type="monotone" dataKey="Margen (%)" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" name="Margen de Utilidad (%)" />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-12 text-center space-y-3">
                  <p className="text-slate-400 text-sm italic">Cargando datos del historial o no existen registros de auditoría de precios en la base de datos.</p>
                </div>
              )}

              {/* Table filtered strictly to this product */}
              <div className="space-y-3 pt-2">
                <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5 px-1">
                  <History className="w-4 h-4 text-slate-500" />
                  Historial de Cambios Individuales ({productHistory.length})
                </h4>
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  {productHistory.length === 0 ? (
                    <p className="text-slate-400 text-xs italic text-center py-12 bg-slate-50/50">No hay cambios registrados en la base de datos para este producto.</p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse bg-white">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                          <th className="py-3 px-3">Fecha y Hora</th>
                          <th className="py-3 px-2">Código</th>
                          <th className="py-3 px-2">Producto</th>
                          <th className="py-3 px-2 text-right">Costo Anterior</th>
                          <th className="py-3 px-2 text-right">Costo Nuevo</th>
                          <th className="py-3 px-2 text-right">Venta Anterior</th>
                          <th className="py-3 px-2 text-right">Venta Nueva</th>
                          <th className="py-3 px-2 text-center">Cambio Costo</th>
                          <th className="py-3 px-2 text-center">Cambio Venta</th>
                          <th className="py-3 px-3">Modificado Por</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...productHistory].reverse().map((h, idx) => {
                          const rowCostDiff = h.Costo_Nuevo - h.Costo_Anterior;
                          const rowVentaDiff = h.Venta_Nueva - h.Venta_Anterior;
                          return (
                            <tr
                              key={idx}
                              className="border-b border-slate-50 hover:bg-slate-50/50 transition"
                            >
                              <td className="py-2.5 px-3 text-slate-500 font-medium">{new Date(h.Fecha_Hora).toLocaleString()}</td>
                              <td className="py-2.5 px-2 font-mono font-bold text-slate-400">{h.Codigo}</td>
                              <td className="py-2.5 px-2 font-bold text-slate-800">{h.Producto}</td>
                              <td className="py-2.5 px-2 text-right font-mono text-slate-600">{cop(h.Costo_Anterior)}</td>
                              <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-800">{cop(h.Costo_Nuevo)}</td>
                              <td className="py-2.5 px-2 text-right font-mono text-slate-600">{cop(h.Venta_Anterior)}</td>
                              <td className="py-2.5 px-2 text-right font-mono font-bold text-emerald-700">{cop(h.Venta_Nueva)}</td>
                              <td className="py-2.5 px-2 text-center">
                                <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                                  rowCostDiff > 0 ? "bg-rose-50 text-rose-700" : rowCostDiff < 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                                }`}>
                                  {rowCostDiff > 0 ? "+" : ""}{cop(rowCostDiff)}
                                </span>
                              </td>
                              <td className="py-2.5 px-2 text-center">
                                <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                                  rowVentaDiff > 0 ? "bg-emerald-50 text-emerald-700" : rowVentaDiff < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"
                                }`}>
                                  {rowVentaDiff > 0 ? "+" : ""}{cop(rowVentaDiff)}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 font-semibold">{h.Usuario}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          );
        })()}



        {/* PRODUCTS MANAGER TAB */}
        {adminMode === "products_manager" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-8 animate-fade-in" id="admin-products-manager-section">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 text-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-slate-900">Añadir & Quitar Productos</h3>
                  <p className="text-slate-500 text-xs mt-1">
                    Gestione de forma rápida los productos en el catálogo maestro. Puede agregar nuevos productos o eliminarlos de forma permanente.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 w-full md:w-64">
                    <Search className="w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar producto por nombre o código..."
                      value={productManagerSearch}
                      onChange={(e) => setProductManagerSearch(e.target.value)}
                      className="bg-transparent text-slate-900 font-semibold text-xs focus:outline-none w-full"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setModalCode("");
                      setModalName("");
                      setModalMedida("Kg");
                      setModalProv("Sin Proveedor");
                      setModalCost("");
                      setModalUtil("30");
                      setModalFactorBto("56");
                      setModalFactorCan("22");
                      setModalMerma("0");
                      setShowAddProductModal(true);
                    }}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 shadow transition cursor-pointer"
                    id="admin-btn-add-product-mgr"
                  >
                    <Plus className="w-4 h-4" />
                    Crear Producto
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Sorting Toolbar for Products Manager */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5 mr-1">
                  <ArrowUpDown className="w-4 h-4 text-emerald-600" />
                  Ordenar Catálogo Por:
                </span>
                <button
                  type="button"
                  onClick={() => togglePmSort("Producto")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    pmSortField === "Producto"
                      ? "bg-slate-900 text-white shadow"
                      : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  🔤 Producto {pmSortField === "Producto" ? (pmSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => togglePmSort("Proveedor")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    pmSortField === "Proveedor"
                      ? "bg-slate-900 text-white shadow"
                      : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  🏢 Proveedor {pmSortField === "Proveedor" ? (pmSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => togglePmSort("Codigo")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    pmSortField === "Codigo"
                      ? "bg-slate-900 text-white shadow"
                      : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  🔢 Código {pmSortField === "Codigo" ? (pmSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => togglePmSort("Costo_Proveedor")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    pmSortField === "Costo_Proveedor"
                      ? "bg-slate-900 text-white shadow"
                      : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  💰 Costo {pmSortField === "Costo_Proveedor" ? (pmSortDir === "asc" ? "▲" : "▼") : ""}
                </button>

                <button
                  type="button"
                  onClick={() => togglePmSort("Precio_Venta_Actual")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    pmSortField === "Precio_Venta_Actual"
                      ? "bg-slate-900 text-white shadow"
                      : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  💵 Venta {pmSortField === "Precio_Venta_Actual" ? (pmSortDir === "asc" ? "▲" : "▼") : ""}
                </button>
              </div>
            </div>

            {/* Products Table */}
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs" id="admin-product-manager-table">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[10px] select-none">
                      <th 
                        onClick={() => togglePmSort("Codigo")}
                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition"
                      >
                        <div className="flex items-center gap-1">
                          <span>Código</span>
                          {pmSortField === "Codigo" && (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => togglePmSort("Producto")}
                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition text-slate-900 font-black"
                      >
                        <div className="flex items-center gap-1">
                          <span>Producto</span>
                          {pmSortField === "Producto" ? (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </th>
                      <th 
                        onClick={() => togglePmSort("Medida")}
                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition"
                      >
                        <div className="flex items-center gap-1">
                          <span>Medida</span>
                          {pmSortField === "Medida" && (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => togglePmSort("Proveedor")}
                        className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition text-slate-900 font-black"
                      >
                        <div className="flex items-center gap-1">
                          <span>Proveedor</span>
                          {pmSortField === "Proveedor" ? (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </th>
                      <th 
                        onClick={() => togglePmSort("Costo_Proveedor")}
                        className="py-3 px-4 text-right cursor-pointer hover:bg-slate-100 transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Costo ($)</span>
                          {pmSortField === "Costo_Proveedor" && (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => togglePmSort("Utilidad")}
                        className="py-3 px-4 text-right cursor-pointer hover:bg-slate-100 transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Márgen (%)</span>
                          {pmSortField === "Utilidad" && (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th 
                        onClick={() => togglePmSort("Precio_Venta_Actual")}
                        className="py-3 px-4 text-right cursor-pointer hover:bg-slate-100 transition font-black"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Venta ($)</span>
                          {pmSortField === "Precio_Venta_Actual" && (pmSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                        </div>
                      </th>
                      <th className="py-3 px-4 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {products
                      .filter((p) => {
                        const q = productManagerSearch.toLowerCase().trim();
                        return (
                          p.Codigo.toLowerCase().includes(q) ||
                          p.Producto.toLowerCase().includes(q) ||
                          p.Proveedor.toLowerCase().includes(q)
                        );
                      })
                      .sort((a, b) => {
                        let cmp = 0;
                        if (pmSortField === "Producto") {
                          cmp = a.Producto.localeCompare(b.Producto, "es", { sensitivity: "base" });
                        } else if (pmSortField === "Proveedor") {
                          cmp = (a.Proveedor || "").localeCompare(b.Proveedor || "", "es", { sensitivity: "base" });
                        } else if (pmSortField === "Codigo") {
                          cmp = a.Codigo.localeCompare(b.Codigo, undefined, { numeric: true });
                        } else if (pmSortField === "Medida") {
                          cmp = a.Medida.localeCompare(b.Medida);
                        } else if (pmSortField === "Costo_Proveedor") {
                          cmp = a.Costo_Proveedor - b.Costo_Proveedor;
                        } else if (pmSortField === "Utilidad") {
                          cmp = a.Utilidad - b.Utilidad;
                        } else if (pmSortField === "Precio_Venta_Actual") {
                          cmp = a.Precio_Venta_Actual - b.Precio_Venta_Actual;
                        }
                        return pmSortDir === "asc" ? cmp : -cmp;
                      })
                      .map((p, idx) => (
                        <tr key={`${p.Codigo}-${p.Producto}-${idx}`} className="hover:bg-slate-50 transition text-slate-700">
                          <td className="py-3 px-4">
                            <span className="bg-slate-100 text-slate-800 font-extrabold px-2.5 py-1 rounded-lg border border-slate-200">
                              {p.Codigo}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-extrabold text-slate-900">{p.Producto}</td>
                          <td className="py-3 px-4 text-slate-500 font-semibold">{p.Medida}</td>
                          <td className="py-3 px-4 text-slate-600 font-semibold">{p.Proveedor}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-900 font-bold">{cop(p.Costo_Proveedor)}</td>
                          <td className="py-3 px-4 text-right font-mono text-indigo-600 font-bold">{(p.Utilidad * 100).toFixed(0)}%</td>
                          <td className="py-3 px-4 text-right font-mono text-emerald-700 font-extrabold">{cop(p.Precio_Venta_Actual)}</td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleDeleteProduct(p.Codigo)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg text-rose-600 transition cursor-pointer"
                              title="Eliminar producto de forma permanente"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PROVIDER ACCOUNTS TAB */}
        {adminMode === "provider_accounts" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-8 animate-fade-in" id="admin-provider-accounts-section">
            {/* Control Panel Header */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 text-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-slate-900">Liquidación y Cuentas de Proveedores</h3>
                  <p className="text-slate-500 text-xs mt-1">
                    Visualice el dinero adeudado por pedido a cada proveedor de forma general y detallado por sucursal.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setShowProviderManagerModal(true)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-2 shadow-sm transition cursor-pointer"
                  >
                    <Users className="w-4 h-4" />
                    Directorio / Cambiar Teléfonos
                  </button>
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                    <Calendar className="w-4 h-4 text-indigo-500" />
                    <input
                      type="date"
                      value={accountsDate}
                      onChange={(e) => setAccountsDate(e.target.value)}
                      className="bg-transparent text-slate-800 font-extrabold text-xs focus:outline-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bento Grid layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column - Financial summary & Comprador budget */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-gradient-to-br from-indigo-950 to-slate-900 text-white p-6 rounded-3xl border border-slate-800 shadow-lg space-y-6">
                  <div>
                    <h4 className="text-indigo-300 text-xs font-bold uppercase tracking-wider">PRESUPUESTO REQUERIDO</h4>
                    <h3 className="text-xl font-black mt-1">Entregas al Comprador</h3>
                    <p className="text-slate-300 text-[10px] mt-0.5">Dinero total que Cris debe entregar al comprador (Hamilton) para surtir el día.</p>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-slate-800 text-xs">
                    <div className="flex justify-between items-center bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                      <div>
                        <span className="font-bold block text-slate-400">Total Comprado (Real)</span>
                        <span className="text-[10px] text-emerald-400 font-semibold">Pedidos ejecutados</span>
                      </div>
                      <span className="font-mono text-base font-black text-emerald-400">
                        {cop(
                          accountsOrders
                            .filter((o) => o.Estado === "Comprado")
                            .reduce((sum, o) => sum + (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0), 0)
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                      <div>
                        <span className="font-bold block text-slate-400">Total Pendiente (Estimado)</span>
                        <span className="text-[10px] text-amber-400 font-semibold">Pedidos sin comprar</span>
                      </div>
                      <span className="font-mono text-base font-black text-amber-400">
                        {cop(
                          accountsOrders
                            .filter((o) => o.Estado === "Pendiente")
                            .reduce((sum, o) => sum + parseQty(o.Cantidad) * (o.Costo_Momento || 0), 0)
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center bg-indigo-900/40 p-4 rounded-2xl border border-indigo-500/30">
                      <div>
                        <span className="font-black block text-indigo-200">PRESUPUESTO TOTAL</span>
                        <span className="text-[10px] text-indigo-300">Suma total de compras</span>
                      </div>
                      <span className="font-mono text-lg font-black text-white">
                        {cop(
                          accountsOrders.reduce((sum, o) => {
                            const qty = o.Estado === "Comprado" ? (o.Cantidad_Comprada || 0) : parseQty(o.Cantidad);
                            return sum + qty * (o.Costo_Momento || 0);
                          }, 0)
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CSV Import Panel */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <div>
                    <h4 className="text-slate-800 text-sm font-black flex items-center gap-1.5">
                      <FileSpreadsheet className="w-5 h-5 text-emerald-500" /> Importar Pedidos Adjuntos
                    </h4>
                    <p className="text-slate-500 text-[10px] mt-0.5">Pegue las filas de pedidos con el formato delimitado por punto y coma (;) para importarlas de inmediato.</p>
                  </div>

                  <div className="space-y-3">
                    <textarea
                      rows={5}
                      placeholder="PRODUCTO;TIBASOSA;NOBSA;FIRA;AQUITANIA;Hansel;PROVEEDOR;PRECIO COMPRA
Sobre Adobo;0;0;10;0;0;adobos;2100"
                      value={csvTextInput}
                      onChange={(e) => setCsvTextInput(e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-[10px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-[9px] font-bold text-slate-400">Se importarán a: {accountsDate}</span>
                      <button
                        onClick={handleImportCsvOrders}
                        disabled={loading || !csvTextInput.trim()}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-xl flex items-center gap-1.5 transition disabled:opacity-40 cursor-pointer shadow-sm"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                        {loading ? "Procesando..." : "Subir y Procesar"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - Provider Account List */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider">Cuentas Pendientes por Proveedor ({accountsDate})</h4>
                    <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-bold">
                      {new Set(accountsOrders.map((o) => o.Proveedor || "Sin Proveedor")).size} Proveedores
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs" id="admin-provider-accounts-table">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[9px] select-none">
                          <th 
                            onClick={() => togglePaSort("proveedor")}
                            className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition text-slate-900 font-black"
                          >
                            <div className="flex items-center gap-1">
                              <span>Proveedor</span>
                              {paSortField === "proveedor" ? (paSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                            </div>
                          </th>
                          <th className="py-3 px-2 text-right">Tibasosa</th>
                          <th className="py-3 px-2 text-right">Nobsa</th>
                          <th className="py-3 px-2 text-right">Fira</th>
                          <th className="py-3 px-2 text-right">Aquitania</th>
                          <th className="py-3 px-2 text-right">Hansel</th>
                          <th 
                            onClick={() => togglePaSort("totalEstimado")}
                            className="py-3 px-2 text-right bg-slate-100/50 cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>Pendiente</span>
                              {paSortField === "totalEstimado" && (paSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                            </div>
                          </th>
                          <th 
                            onClick={() => togglePaSort("totalReal")}
                            className="py-3 px-4 text-right bg-indigo-50/50 text-indigo-950 font-black cursor-pointer hover:bg-indigo-100 transition"
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>Total Real</span>
                              {paSortField === "totalReal" && (paSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-indigo-700" /> : <ArrowDown className="w-3 h-3 text-indigo-700" />)}
                            </div>
                          </th>
                          <th className="py-3 px-4 text-center">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                        {(() => {
                          const summary: {
                            [prov: string]: {
                              proveedor: string;
                              celular: string;
                              totalReal: number;
                              totalEstimado: number;
                              sucursales: {
                                [suc: string]: { real: number; estimado: number };
                              };
                              unpaidCount: number;
                            }
                          } = {};

                          const branches = sucursalesPermitidas;

                          accountsOrders.forEach((o) => {
                            const prov = o.Proveedor || "Sin Proveedor";
                            if (!summary[prov]) {
                              summary[prov] = {
                                proveedor: prov,
                                celular: o.Celular || "",
                                totalReal: 0,
                                totalEstimado: 0,
                                sucursales: {},
                                unpaidCount: 0
                              };
                              for (const b of branches) {
                                summary[prov].sucursales[b] = { real: 0, estimado: 0 };
                              }
                            }

                            const qtyReal = o.Cantidad_Comprada || 0;
                            const qtyEst = parseQty(o.Cantidad);
                            const cost = o.Costo_Momento || 0;

                            const valReal = qtyReal * cost;
                            const valEst = o.Estado === "Pendiente" ? qtyEst * cost : 0;

                            summary[prov].totalReal += valReal;
                            summary[prov].totalEstimado += valEst;

                            const bName = o.Sucursal;
                            if (summary[prov].sucursales[bName]) {
                              summary[prov].sucursales[bName].real += valReal;
                              summary[prov].sucursales[bName].estimado += valEst;
                            }

                            if (o.Estado_Pago !== "Pagado") {
                              summary[prov].unpaidCount++;
                            }
                          });

                          const list = Object.values(summary).sort((a, b) => {
                            let cmp = 0;
                            if (paSortField === "proveedor") {
                              cmp = a.proveedor.localeCompare(b.proveedor, "es", { sensitivity: "base" });
                            } else if (paSortField === "totalEstimado") {
                              cmp = a.totalEstimado - b.totalEstimado;
                            } else {
                              cmp = a.totalReal - b.totalReal;
                            }
                            return paSortDir === "asc" ? cmp : -cmp;
                          });

                          if (list.length === 0) {
                            return (
                              <tr>
                                <td colSpan={9} className="py-8 text-center text-slate-400 font-bold">
                                  No hay pedidos registrados para la fecha {accountsDate}.
                                </td>
                              </tr>
                            );
                          }
                          return list.map((summary, idx) => (
                            <tr key={`${summary.proveedor}-${idx}`} className="hover:bg-slate-50 transition text-[11px]">
                              <td className="py-3.5 px-4 font-extrabold text-slate-900">
                                <div className="flex flex-col">
                                  <span>{summary.proveedor}</span>
                                  {summary.celular && (
                                    <span className="text-[9px] text-slate-400 font-semibold">{summary.celular}</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono text-slate-600">
                                {summary.sucursales.Tibasosa?.real > 0 ? cop(summary.sucursales.Tibasosa.real) : "—"}
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono text-slate-600">
                                {summary.sucursales.Nobsa?.real > 0 ? cop(summary.sucursales.Nobsa.real) : "—"}
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono text-slate-600">
                                {summary.sucursales.Fira?.real > 0 ? cop(summary.sucursales.Fira.real) : "—"}
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono text-slate-600">
                                {summary.sucursales.Aquitania?.real > 0 ? cop(summary.sucursales.Aquitania.real) : "—"}
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono text-slate-600">
                                {summary.sucursales.Hansel?.real > 0 ? cop(summary.sucursales.Hansel.real) : "—"}
                              </td>
                              <td className="py-3.5 px-2 text-right font-mono text-amber-600 bg-slate-100/30">
                                {summary.totalEstimado > 0 ? cop(summary.totalEstimado) : "—"}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono text-emerald-700 font-extrabold bg-indigo-50/20">
                                {cop(summary.totalReal)}
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => {
                                      const providerOrders = accountsOrders.filter(
                                        (o) => (o.Proveedor || "Sin Proveedor").toLowerCase().trim() === summary.proveedor.toLowerCase().trim()
                                      );
                                      setActiveProviderReceipt({
                                        proveedor: summary.proveedor,
                                        celular: summary.celular,
                                        totalReal: summary.totalReal,
                                        totalEstimado: summary.totalEstimado,
                                        sucursales: summary.sucursales,
                                        unpaidCount: summary.unpaidCount,
                                        orders: providerOrders
                                      });
                                    }}
                                    className="px-2.5 py-1.5 bg-indigo-50 text-indigo-750 hover:bg-indigo-100 font-black text-[10px] rounded-lg transition flex items-center gap-1 cursor-pointer border border-indigo-100 shadow-xs"
                                    title="Ver Recibo de caja tipo imagen y enviar a WhatsApp"
                                  >
                                    <Receipt className="w-3.5 h-3.5 text-indigo-650" />
                                    Ver Recibo
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingProviderName(summary.proveedor);
                                      setEditingProviderCell(summary.celular || "");
                                      setShowProviderManagerModal(true);
                                    }}
                                    className="px-2 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-[10px] rounded-lg transition flex items-center gap-1 cursor-pointer border border-slate-200"
                                    title="Cambiar número de teléfono o celular"
                                  >
                                    <Phone className="w-3.5 h-3.5 text-emerald-600" />
                                    Cambiar Celular
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PURCHASE REPORTS TAB */}
        {adminMode === "purchase_reports" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-8 animate-fade-in" id="admin-purchase-reports-section">
            {/* Header Control Panel */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 text-slate-800 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-xl font-black text-slate-900">Consolidado y Reportes de Compras</h3>
                  <p className="text-slate-500 text-xs mt-1">
                    Filtre todas las compras realizadas por sucursal en el rango de fechas que desee y visualice el consolidado sumado.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                    <span className="text-slate-500 font-bold">Desde:</span>
                    <input
                      type="date"
                      value={reportStartDate}
                      onChange={(e) => setReportStartDate(e.target.value)}
                      className="bg-transparent text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                    <span className="text-slate-500 font-bold">Hasta:</span>
                    <input
                      type="date"
                      value={reportEndDate}
                      onChange={(e) => setReportEndDate(e.target.value)}
                      className="bg-transparent text-slate-800 font-extrabold focus:outline-none cursor-pointer"
                    />
                  </div>
                  <button
                    onClick={fetchAllOrdersForReport}
                    disabled={isFetchingReportOrders}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-850 font-black text-xs rounded-xl flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer border border-slate-200 shadow-xs"
                    title="Actualizar datos"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingReportOrders ? "animate-spin" : ""}`} />
                    Recargar
                  </button>
                  <button
                    onClick={() => {
                      // Export to Excel logic
                      const filtered = allOrdersForReport.filter(o => o.Fecha >= reportStartDate && o.Fecha <= reportEndDate);
                      
                      // Sheet 1: Resumen por sucursal
                      const branches = sucursalesPermitidas;
                      const branchTotals = branches.map(b => {
                        const branchOrders = filtered.filter(o => o.Sucursal.trim().toLowerCase() === b.toLowerCase());
                        const compradoReal = branchOrders.reduce((sum, o) => sum + (o.Estado === "Comprado" ? (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0) : 0), 0);
                        const estimadoSolicitado = branchOrders.reduce((sum, o) => sum + (parseQty(o.Cantidad) * (o.Costo_Momento || 0)), 0);
                        const kilos = branchOrders.reduce((sum, o) => sum + (o.Estado === "Comprado" ? (o.Kilos || 0) : 0), 0);
                        const itemsCount = branchOrders.length;
                        return {
                          "Sucursal": b,
                          "Total Comprado (Real COP)": compradoReal,
                          "Total Solicitado (Est. COP)": estimadoSolicitado,
                          "Kilos Comprados": kilos,
                          "Cantidad de Items": itemsCount,
                          "Cumplimiento %": estimadoSolicitado > 0 ? parseFloat(((compradoReal / estimadoSolicitado) * 100).toFixed(1)) : 0
                        };
                      });

                      // Sheet 2: Detalle por proveedor
                      const providerSummary: { [prov: string]: { [b: string]: number } } = {};
                      filtered.forEach(o => {
                        const prov = o.Proveedor || "Sin Proveedor";
                        const bName = o.Sucursal.trim();
                        const val = o.Estado === "Comprado" ? (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0) : 0;
                        if (!providerSummary[prov]) {
                          providerSummary[prov] = { "Tibasosa": 0, "Nobsa": 0, "Fira": 0, "Aquitania": 0, "Hansel": 0 };
                        }
                        const canonicalBranch = branches.find(b => b.toLowerCase() === bName.toLowerCase());
                        if (canonicalBranch) {
                          providerSummary[prov][canonicalBranch] += val;
                        }
                      });
                      const providerRows = Object.entries(providerSummary).map(([prov, bMap]) => {
                        const total = Object.values(bMap).reduce((sum, v) => sum + v, 0);
                        return {
                          "Proveedor": prov,
                          "Tibasosa": bMap["Tibasosa"],
                          "Nobsa": bMap["Nobsa"],
                          "Fira": bMap["Fira"],
                          "Aquitania": bMap["Aquitania"],
                          "Hansel": bMap["Hansel"],
                          "Total Comprado (Real)": total
                        };
                      });

                      // Sheet 3: Detalle individual de pedidos
                      const orderRows = filtered.map(o => ({
                        "Fecha": o.Fecha,
                        "Sucursal": o.Sucursal,
                        "Producto": o.Producto,
                        "Proveedor": o.Proveedor || "Sin Proveedor",
                        "Medida": o.Medida,
                        "Cantidad Solicitada": o.Cantidad,
                        "Cantidad Comprada": o.Cantidad_Comprada || 0,
                        "Costo Unitario": o.Costo_Momento || 0,
                        "Total Comprado (Real)": (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0),
                        "Total Estimado": parseQty(o.Cantidad) * (o.Costo_Momento || 0),
                        "Kilos": o.Kilos || 0,
                        "Estado": o.Estado
                      }));

                      const wb = XLSX.utils.book_new();
                      const ws1 = XLSX.utils.json_to_sheet(branchTotals);
                      const ws2 = XLSX.utils.json_to_sheet(providerRows);
                      const ws3 = XLSX.utils.json_to_sheet(orderRows);

                      XLSX.utils.book_append_sheet(wb, ws1, "Resumen Sucursales");
                      XLSX.utils.book_append_sheet(wb, ws2, "Por Proveedor");
                      XLSX.utils.book_append_sheet(wb, ws3, "Listado Completo");

                      XLSX.writeFile(wb, `Reporte_Consolidado_Al_Paso_${reportStartDate}_a_${reportEndDate}.xlsx`);
                    }}
                    className="px-3.5 py-1.5 bg-indigo-650 hover:bg-indigo-550 text-white font-black text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                    title="Exportar a Excel"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exportar Excel
                  </button>
                </div>
              </div>
            </div>

            {isFetchingReportOrders ? (
              <div className="py-20 text-center space-y-4">
                <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin mx-auto" />
                <p className="text-slate-500 text-sm font-bold animate-pulse">Procesando base de datos consolidada...</p>
              </div>
            ) : (() => {
              const filtered = allOrdersForReport.filter(o => o.Fecha >= reportStartDate && o.Fecha <= reportEndDate);
              
              // Totales globales
              const totalRealComprado = filtered.reduce((sum, o) => sum + (o.Estado === "Comprado" ? (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0) : 0), 0);
              const totalEstimadoSolicitado = filtered.reduce((sum, o) => sum + (parseQty(o.Cantidad) * (o.Costo_Momento || 0)), 0);
              const compliancePercentage = totalEstimadoSolicitado > 0 ? (totalRealComprado / totalEstimadoSolicitado) * 100 : 0;
              const totalKilosComprados = filtered.reduce((sum, o) => sum + (o.Estado === "Comprado" ? (o.Kilos || 0) : 0), 0);
              const totalItemsComprados = filtered.filter(o => o.Estado === "Comprado" && (o.Cantidad_Comprada || 0) > 0).length;

              // Agrupar por sucursal
              const branches = sucursalesPermitidas;
              const branchData: { [key: string]: { compradoReal: number; estimadoSolicitado: number; kilos: number; count: number } } = {};
              
              branches.forEach(b => {
                branchData[b] = { compradoReal: 0, estimadoSolicitado: 0, kilos: 0, count: 0 };
              });

              filtered.forEach(o => {
                const bName = o.Sucursal.trim();
                const matchedBranch = branches.find(b => b.toLowerCase() === bName.toLowerCase());
                if (matchedBranch) {
                  const valReal = o.Estado === "Comprado" ? (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0) : 0;
                  const valEst = parseQty(o.Cantidad) * (o.Costo_Momento || 0);
                  
                  branchData[matchedBranch].compradoReal += valReal;
                  branchData[matchedBranch].estimadoSolicitado += valEst;
                  if (o.Estado === "Comprado") {
                    branchData[matchedBranch].kilos += o.Kilos || 0;
                    if ((o.Cantidad_Comprada || 0) > 0) {
                      branchData[matchedBranch].count++;
                    }
                  }
                }
              });

              // Recharts data
              const chartData = branches.map(b => ({
                name: b,
                Comprado: branchData[b].compradoReal,
                Solicitado: branchData[b].estimadoSolicitado
              }));

              // Agrupar por proveedor
              const providerData: {
                [prov: string]: {
                  proveedor: string;
                  totalReal: number;
                  sucursales: { [suc: string]: number };
                }
              } = {};

              filtered.forEach(o => {
                const prov = o.Proveedor || "Sin Proveedor";
                if (!providerData[prov]) {
                  providerData[prov] = {
                    proveedor: prov,
                    totalReal: 0,
                    sucursales: { Tibasosa: 0, Nobsa: 0, Fira: 0, Aquitania: 0, Hansel: 0 }
                  };
                }

                const bName = o.Sucursal.trim();
                const matchedBranch = branches.find(b => b.toLowerCase() === bName.toLowerCase());
                const valReal = o.Estado === "Comprado" ? (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0) : 0;

                providerData[prov].totalReal += valReal;
                if (matchedBranch) {
                  providerData[prov].sucursales[matchedBranch] += valReal;
                }
              });

              const providerList = Object.values(providerData).sort((a, b) => {
                let cmp = 0;
                if (prSortField === "proveedor") {
                  cmp = a.proveedor.localeCompare(b.proveedor, "es", { sensitivity: "base" });
                } else if (prSortField === "totalReal") {
                  cmp = a.totalReal - b.totalReal;
                } else if (branches.includes(prSortField)) {
                  cmp = (a.sucursales[prSortField] || 0) - (b.sucursales[prSortField] || 0);
                } else {
                  cmp = a.totalReal - b.totalReal;
                }
                return prSortDir === "asc" ? cmp : -cmp;
              });

              return (
                <div className="space-y-6">
                  {/* KPI Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">COMPRAS REALES TOTALES</span>
                        <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                          <DollarSign className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="mt-3">
                        <h3 className="text-2xl font-black text-slate-850">{cop(totalRealComprado)}</h3>
                        <p className="text-[10px] text-emerald-500 font-bold mt-1 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Facturado e ingresado
                        </p>
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">MERCADO SOLICITADO</span>
                        <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-100">
                          <ClipboardList className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="mt-3">
                        <h3 className="text-2xl font-black text-slate-850">{cop(totalEstimadoSolicitado)}</h3>
                        <p className="text-[10px] text-slate-400 font-medium mt-1">Costo estimado original</p>
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">CUMPLIMIENTO DE COMPRA</span>
                        <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="mt-3">
                        <h3 className="text-2xl font-black text-slate-850">{compliancePercentage.toFixed(1)}%</h3>
                        <p className="text-[10px] text-indigo-500 font-semibold mt-1">Suministro real vs pedido</p>
                      </div>
                    </div>

                    <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider block">VOLUMEN DESPACHADO</span>
                        <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                          <Boxes className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="mt-3">
                        <h3 className="text-2xl font-black text-slate-850">{(totalKilosComprados).toLocaleString("es-CO", { maximumFractionDigits: 1 })} Kg</h3>
                        <p className="text-[10px] text-slate-400 font-medium mt-1">En {totalItemsComprados} productos diferentes</p>
                      </div>
                    </div>
                  </div>

                  {/* Charts & Bento Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Recharts chart */}
                    <div className="lg:col-span-8 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider">Distribución Financiera de Compras</h4>
                        <span className="text-[10px] text-slate-400 font-semibold">Comparativa COP Real vs Estimado</span>
                      </div>
                      
                      <div className="h-72 w-full pt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                            <YAxis 
                              stroke="#64748b" 
                              fontSize={10} 
                              tickLine={false} 
                              axisLine={false} 
                              tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} 
                            />
                            <ChartTooltip 
                              formatter={(value: any) => [cop(value), ""]}
                              contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, fontWeight: "bold" }} />
                            <Bar dataKey="Comprado" fill="#059669" name="Comprado Real" radius={[6, 6, 0, 0]} />
                            <Bar dataKey="Solicitado" fill="#cbd5e1" name="Estimado Pedido" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Bento List of Sucursales */}
                    <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
                      <div>
                        <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider pb-3 border-b border-slate-100">Cómputo por Sucursal</h4>
                        <p className="text-slate-500 text-[10px] mt-1.5">Acumulado total de gastos en mercado en el rango de fechas actual.</p>
                      </div>

                      <div className="space-y-3 my-4 flex-1 overflow-y-auto max-h-[250px] pr-1">
                        {branches.map(b => {
                          const data = branchData[b];
                          const pct = data.estimadoSolicitado > 0 ? (data.compradoReal / data.estimadoSolicitado) * 100 : 0;
                          
                          // Custom styles for badge depending on branch
                          let badgeBg = "bg-slate-50 text-slate-600";
                          if (b === "Tibasosa") badgeBg = "bg-rose-50 text-rose-700 border-rose-100";
                          else if (b === "Nobsa") badgeBg = "bg-blue-50 text-blue-700 border-blue-100";
                          else if (b === "Fira") badgeBg = "bg-amber-50 text-amber-700 border-amber-100";
                          else if (b === "Aquitania") badgeBg = "bg-purple-50 text-purple-700 border-purple-100";
                          else if (b === "Hansel") badgeBg = "bg-red-50 text-red-700 border-red-100";

                          return (
                            <div key={b} className="flex items-center justify-between p-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-100 rounded-2xl transition">
                              <div className="space-y-1">
                                <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-lg border ${badgeBg}`}>
                                  {b}
                                </span>
                                <span className="block text-[10px] text-slate-400 font-semibold">{data.count} items • {data.kilos.toFixed(1)} Kg</span>
                              </div>
                              <div className="text-right">
                                <span className="font-mono text-xs font-black text-slate-800 block">{cop(data.compradoReal)}</span>
                                <span className="text-[9px] text-emerald-500 font-bold">{pct.toFixed(0)}% cumplido</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-500">Total Sumado:</span>
                        <span className="font-mono font-black text-emerald-700 text-sm">{cop(totalRealComprado)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Breakdown by Supplier */}
                  <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                      <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider">Compras Acumuladas por Proveedor</h4>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-bold">
                        {providerList.length} Proveedores con Compras
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[9px] select-none">
                            <th 
                              onClick={() => togglePrSort("proveedor")}
                              className="py-3 px-4 cursor-pointer hover:bg-slate-100 transition text-slate-900 font-black"
                            >
                              <div className="flex items-center gap-1">
                                <span>Proveedor</span>
                                {prSortField === "proveedor" ? (prSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                              </div>
                            </th>
                            <th 
                              onClick={() => togglePrSort("Tibasosa")}
                              className="py-3 px-2 text-right cursor-pointer hover:bg-slate-100 transition"
                            >
                              Tibasosa
                            </th>
                            <th 
                              onClick={() => togglePrSort("Nobsa")}
                              className="py-3 px-2 text-right cursor-pointer hover:bg-slate-100 transition"
                            >
                              Nobsa
                            </th>
                            <th 
                              onClick={() => togglePrSort("Fira")}
                              className="py-3 px-2 text-right cursor-pointer hover:bg-slate-100 transition"
                            >
                              Fira
                            </th>
                            <th 
                              onClick={() => togglePrSort("Aquitania")}
                              className="py-3 px-2 text-right cursor-pointer hover:bg-slate-100 transition"
                            >
                              Aquitania
                            </th>
                            <th 
                              onClick={() => togglePrSort("Hansel")}
                              className="py-3 px-2 text-right cursor-pointer hover:bg-slate-100 transition"
                            >
                              Hansel
                            </th>
                            <th 
                              onClick={() => togglePrSort("totalReal")}
                              className="py-3 px-4 text-right bg-emerald-50/50 text-emerald-900 font-extrabold cursor-pointer hover:bg-emerald-100 transition"
                            >
                              <div className="flex items-center justify-end gap-1">
                                <span>Total Comprado (Real)</span>
                                {prSortField === "totalReal" && (prSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-700" /> : <ArrowDown className="w-3 h-3 text-emerald-700" />)}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                          {providerList.map((p, idx) => {
                            if (p.totalReal === 0) return null;
                            return (
                              <tr key={`${p.proveedor}-${idx}`} className="hover:bg-slate-50 transition text-[11px]">
                                <td className="py-3 px-4 font-black text-slate-900">{p.proveedor}</td>
                                <td className="py-3 px-2 text-right font-mono text-slate-550">
                                  {p.sucursales.Tibasosa > 0 ? cop(p.sucursales.Tibasosa) : "—"}
                                </td>
                                <td className="py-3 px-2 text-right font-mono text-slate-550">
                                  {p.sucursales.Nobsa > 0 ? cop(p.sucursales.Nobsa) : "—"}
                                </td>
                                <td className="py-3 px-2 text-right font-mono text-slate-550">
                                  {p.sucursales.Fira > 0 ? cop(p.sucursales.Fira) : "—"}
                                </td>
                                <td className="py-3 px-2 text-right font-mono text-slate-550">
                                  {p.sucursales.Aquitania > 0 ? cop(p.sucursales.Aquitania) : "—"}
                                </td>
                                <td className="py-3 px-2 text-right font-mono text-slate-550">
                                  {p.sucursales.Hansel > 0 ? cop(p.sucursales.Hansel) : "—"}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-black text-emerald-700 bg-emerald-50/20">
                                  {cop(p.totalReal)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}



        {/* 6.5 GESTIÓN DE CONTRASEÑAS DE USUARIOS */}
        {adminMode === "users" && (
          <div className="max-w-4xl mx-auto px-4 md:px-6 space-y-6">
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-5">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
                  <Settings className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-850 tracking-tight">Administración de Contraseñas</h3>
                  <p className="text-slate-500 text-xs mt-0.5">
                    Modifique las contraseñas de acceso para cada rol y usuario de Al Paso.
                  </p>
                </div>
              </div>

              {/* Users Table / Grid */}
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                        <th className="py-3 px-4">Usuario</th>
                        <th className="py-3 px-4">Rol / Permiso</th>
                        <th className="py-3 px-4">Contraseña</th>
                        <th className="py-3 px-4 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {users.map((u) => {
                        const isEditingThis = editingUser?.Usuario === u.Usuario;
                        return (
                          <tr key={u.Usuario} className="hover:bg-slate-50/50 transition">
                            <td className="py-4 px-4 font-extrabold text-slate-800">
                              {u.Usuario}
                            </td>
                            <td className="py-4 px-4">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                u.Rol === "Admin" 
                                  ? "bg-purple-100 text-purple-700" 
                                  : u.Rol === "Comprador"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-emerald-100 text-emerald-700"
                              }`}>
                                {u.Rol}
                              </span>
                            </td>
                            <td className="py-4 px-4 font-mono text-xs text-slate-500">
                              {isEditingThis ? (
                                <input
                                  type="text"
                                  value={newPassword}
                                  onChange={(e) => setNewPassword(e.target.value)}
                                  placeholder="Nueva contraseña"
                                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 max-w-xs"
                                  autoFocus
                                />
                              ) : (
                                <span className="tracking-widest font-bold text-slate-300 select-none">••••••••</span>
                              )}
                            </td>
                            <td className="py-4 px-4 text-right">
                              {isEditingThis ? (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => handleUpdatePassword(u.Usuario, newPassword)}
                                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold text-xs rounded-xl flex items-center gap-1 cursor-pointer shadow-sm active:scale-95 transition"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Guardar
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingUser(null);
                                      setNewPassword("");
                                    }}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl cursor-pointer active:scale-95 transition"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingUser(u);
                                    setNewPassword(u.Contraseña || "");
                                  }}
                                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 ml-auto cursor-pointer active:scale-95 transition"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-slate-500" /> Cambiar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bg-amber-50 border border-amber-200/70 p-4 rounded-2xl flex gap-3">
                  <span className="shrink-0 text-amber-600 font-bold text-sm">ℹ️</span>
                  <p className="text-amber-800 text-xs leading-relaxed font-medium">
                    <strong>Importante:</strong> Las contraseñas de las sucursales (Tibasosa, Nobsa, Fira, Aquitania, Hansel) son de uso diario para los colaboradores de cada punto. Modifíquelas con discreción para evitar interrupciones de acceso.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6.6 LOGS Y ESTADO DE ALMACENAMIENTO LOCAL */}
        {adminMode === "sync_logs" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
            {/* Header banner */}
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-cyan-50 text-cyan-600 rounded-2xl border border-cyan-100">
                    <RefreshCw className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-850 tracking-tight flex items-center gap-2">
                      Logs y Estado de Almacenamiento
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded-full uppercase">
                        Modo Local Autónomo
                      </span>
                    </h3>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Almacenamiento local directo y seguro con base de datos sincronizada (Firebase / IndexedDB).
                    </p>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={fetchSyncLogs}
                    disabled={isLoadingLogs}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? "animate-spin" : ""}`} />
                    Refrescar
                  </button>

                  <button
                    onClick={async () => {
                      setTestingService("local_db");
                      setSyncFeedbackMsg(null);
                      try {
                        const res = await fetch("/api/sync-logs");
                        const data = await res.json();
                        if (res.ok) {
                          setSyncLogs(data || []);
                          setSyncFeedbackMsg({ type: "success", text: "¡Base de datos local verificada y en estado óptimo!" });
                        }
                      } catch (err: any) {
                        setSyncFeedbackMsg({ type: "error", text: "Error al verificar la base de datos local" });
                      } finally {
                        setTestingService(null);
                      }
                    }}
                    disabled={testingService !== null}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {testingService === "local_db" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Verificar Estado Local
                  </button>

                  <button
                    onClick={async () => {
                      if (!confirm("¿Está seguro de borrar el historial de logs de la base de datos local?")) return;
                      try {
                        const res = await fetch("/api/sync-logs/clear", { method: "POST" });
                        if (res.ok) {
                          setSyncLogs([]);
                          setSyncFeedbackMsg({ type: "success", text: "Historial de logs borrado." });
                        }
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl transition flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Limpiar
                  </button>
                </div>
              </div>

              {/* Feedback Alert */}
              {syncFeedbackMsg && (
                <div
                  className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-bold ${
                    syncFeedbackMsg.type === "success"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-rose-50 text-rose-800 border-rose-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {syncFeedbackMsg.type === "success" ? <Check className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-rose-600" />}
                    {syncFeedbackMsg.text}
                  </span>
                  <button onClick={() => setSyncFeedbackMsg(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold">
                    Cerrar
                  </button>
                </div>
              )}

              {/* KPI Metrics Cards */}
              {(() => {
                const totalLogs = syncLogs.length;
                const errorLogs = syncLogs.filter((l) => l.status === "error");
                const successLogs = syncLogs.filter((l) => l.status === "success");
                const lastLog = syncLogs[0];

                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Eventos Registrados</span>
                      <div className="text-2xl font-black text-slate-800">{totalLogs}</div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        💾 Almacenamiento Local Autónomo
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Operaciones Exitosas</span>
                      <div className="text-2xl font-black text-emerald-800 flex items-center gap-2">
                        {successLogs.length}
                        <span className="text-xs bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-full font-bold">
                          {totalLogs > 0 ? Math.round((successLogs.length / totalLogs) * 100) : 100}%
                        </span>
                      </div>
                      <div className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                        <Check className="w-3 h-3" /> Operación normal local sin bloqueos
                      </div>
                    </div>

                    <div className={`p-4 rounded-2xl border space-y-1 ${errorLogs.length > 0 ? "bg-rose-50/80 border-rose-200" : "bg-slate-50 border-slate-100"}`}>
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${errorLogs.length > 0 ? "text-rose-700" : "text-slate-400"}`}>
                        Fallos Detectados
                      </span>
                      <div className={`text-2xl font-black ${errorLogs.length > 0 ? "text-rose-700" : "text-slate-800"}`}>
                        {errorLogs.length}
                      </div>
                      <div className={`text-[11px] font-medium ${errorLogs.length > 0 ? "text-rose-600 font-bold" : "text-slate-500"}`}>
                        {errorLogs.length > 0 ? "⚠️ Atención requerida" : "Sin errores detectados"}
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-cyan-50/60 border border-cyan-100 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-700">Último Registro</span>
                      <div className="text-sm font-black text-cyan-950 truncate">
                        {lastLog ? new Date(lastLog.timestamp).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "medium" }) : "Sin registros"}
                      </div>
                      <div className="text-[11px] text-cyan-700 font-medium truncate">
                        {lastLog ? `${lastLog.service} - ${lastLog.action}` : "Esperando primera acción"}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Filters & Search Bar */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Service filter */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                    <button
                      onClick={() => setLogServiceFilter("all")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        logServiceFilter === "all" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Todos
                    </button>
                  </div>

                  {/* Status filter */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                    <button
                      onClick={() => setLogStatusFilter("all")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        logStatusFilter === "all" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Estado: Todos
                    </button>
                    <button
                      onClick={() => setLogStatusFilter("success")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        logStatusFilter === "success" ? "bg-white text-emerald-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Éxito
                    </button>
                    <button
                      onClick={() => setLogStatusFilter("error")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        logStatusFilter === "error" ? "bg-white text-rose-700 shadow-xs" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Errores
                    </button>
                  </div>
                </div>

                {/* Search input */}
                <div className="relative min-w-[240px]">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    placeholder="Buscar en logs..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:outline-none rounded-xl text-xs font-medium text-slate-700"
                  />
                  {logSearchQuery && (
                    <button onClick={() => setLogSearchQuery("")} className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Logs List / Table */}
              {(() => {
                const filtered = syncLogs.filter((log) => {
                  if (logServiceFilter !== "all" && log.service !== logServiceFilter) return false;
                  if (logStatusFilter !== "all" && log.status !== logStatusFilter) return false;
                  if (logSearchQuery.trim()) {
                    const q = logSearchQuery.toLowerCase();
                    const inAction = log.action?.toLowerCase().includes(q);
                    const inDetails = log.details?.toLowerCase().includes(q);
                    const inService = log.service?.toLowerCase().includes(q);
                    if (!inAction && !inDetails && !inService) return false;
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl space-y-3">
                      <RefreshCw className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-slate-500 text-sm font-semibold">No se encontraron logs de sincronización con los filtros aplicados.</p>
                      <button
                        onClick={() => {
                          setLogServiceFilter("all");
                          setLogStatusFilter("all");
                          setLogSearchQuery("");
                        }}
                        className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer"
                      >
                        Restablecer Filtros
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                          <th className="py-3 px-4 w-[160px]">Fecha y Hora</th>
                          <th className="py-3 px-4 w-[130px]">Servicio</th>
                          <th className="py-3 px-4 w-[180px]">Acción</th>
                          <th className="py-3 px-4 w-[110px]">Estado</th>
                          <th className="py-3 px-4 w-[110px] text-right">Registros / Ms</th>
                          <th className="py-3 px-4">Detalles del Evento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-medium">
                        {filtered.map((log) => {
                          const isError = log.status === "error";
                          const isWarning = log.status === "warning";

                          return (
                            <tr key={log.id} className={`transition ${isError ? "bg-rose-50/30 hover:bg-rose-50/60" : "hover:bg-slate-50/60"}`}>
                              <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                {new Date(log.timestamp).toLocaleString("es-CO", {
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit"
                                })}
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-[11px] bg-slate-100 text-slate-800 border border-slate-200"
                                >
                                  💾 Local DB
                                </span>
                              </td>

                              <td className="py-3.5 px-4 font-bold text-slate-800 whitespace-nowrap">
                                {log.action}
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase tracking-wider ${
                                    isError
                                      ? "bg-rose-100 text-rose-800 border border-rose-200"
                                      : isWarning
                                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                                      : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  }`}
                                >
                                  {isError ? (
                                    <>
                                      <X className="w-3 h-3 text-rose-600" /> Error
                                    </>
                                  ) : isWarning ? (
                                    "Advertencia"
                                  ) : (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-600" /> Éxito
                                    </>
                                  )}
                                </span>
                              </td>

                              <td className="py-3.5 px-4 font-mono text-slate-600 text-right whitespace-nowrap">
                                {log.itemsCount !== undefined ? `${log.itemsCount} reg.` : "-"}
                                {log.durationMs !== undefined && (
                                  <span className="block text-[10px] text-slate-400 font-normal">{log.durationMs} ms</span>
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-slate-700">
                                <div className={`p-2 rounded-xl text-xs ${isError ? "bg-rose-100/60 text-rose-900 border border-rose-200 font-mono" : "bg-slate-50 border border-slate-100 text-slate-700"}`}>
                                  {log.details}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* 7. EFECTIVO & MONEDERO GENERAL */}
        {adminMode === "reconciliation" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
            <h3 className="text-xl font-bold text-slate-850">Conciliación de Efectivo y Monedero General</h3>
            <p className="text-slate-500 text-xs mt-1">Monitoree el fondo líquido unificado ("Caja Central") versus el dinero aún depositado físicamente en los puntos de venta de cada municipio.</p>

            {/* LIVE POOL METRICS GRID */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block">Caja General / Monedero</span>
                  <h3 className="text-3xl font-black text-emerald-700 mt-2">{cop(nequiCentralBalance)}</h3>
                  <p className="text-slate-500 text-[11px] mt-2">Fondos reales recibidos centralmente y listos para giros de plaza o pagos corporativos.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                  <span>Recaudación Física Acumulada:</span>
                  <span className="font-bold text-slate-850">{cop(reconciledClosuresSum)}</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block text-amber-600">Efectivo Acumulado / No Recaudado</span>
                  <h3 className="text-3xl font-black text-slate-800 mt-2">{cop(totalNoRecaudado)}</h3>
                  <p className="text-slate-500 text-[11px] mt-2">Efectivo total en tránsito resguardado físicamente en las cajas registradoras de las tiendas.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                  <span>Sueldos Pagados desde Caja:</span>
                  <span className="font-bold text-rose-600">-{cop(paidPayrollSum)}</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                <div>
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block">Retenciones por Gastos de Operación</span>
                  <h3 className="text-3xl font-black text-rose-600 mt-2">{cop(totalStoreExpenses)}</h3>
                  <p className="text-slate-500 text-[11px] mt-2">Deducciones de caja menor efectuadas en tiendas para fletes, viáticos o insumos locales.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500">
                  <span>Cierres Procesados:</span>
                  <span className="font-bold text-slate-850">{closures.length} días</span>
                </div>
              </div>
            </div>

            {/* BRANCH BALANCE AND PICKUP TOKENS */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <h4 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span>🏪 Balance Físico en Tiendas y Confirmación de Recolección</span>
              </h4>
              <p className="text-slate-400 text-xs mb-6">Autorice la recolección física de efectivo por parte del transportador de plaza. Al presionar el botón, el dinero acumulado en la tienda se descarga y se transfiere al saldo del Monedero General.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {branches.map((bName) => {
                  const uncollected = getBranchUncollected(bName);
                  const count = getBranchPendingCount(bName);
                  const conf = branchConfigs[bName] || { baseCaja: 150000, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 };
                  const isAlert = uncollected > conf.montoAlerta;
                  const surplus = Math.max(0, uncollected - conf.baseCaja);

                  return (
                    <div key={bName} className={`p-4 border rounded-2xl flex flex-col justify-between transition-all ${
                      isAlert 
                        ? "border-rose-300 bg-rose-50/55 shadow-sm shadow-rose-100" 
                        : "border-slate-200 bg-slate-50"
                    }`}>
                      <div>
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-slate-800 text-sm">{bName}</span>
                          {uncollected > 0 && (
                            <span className={`animate-pulse w-2.5 h-2.5 rounded-full ${isAlert ? "bg-rose-500" : "bg-amber-500"}`} />
                          )}
                        </div>
                        <div className="mt-3 space-y-1.5">
                          <div>
                            <span className="text-slate-400 text-[10px] uppercase block tracking-wider font-semibold">Efectivo en Tienda</span>
                            <span className={`text-lg font-black ${isAlert ? "text-rose-700" : "text-slate-800"}`}>{cop(uncollected)}</span>
                          </div>
                          
                          <div className="flex justify-between text-[10.5px] text-slate-500 border-t border-slate-200/50 pt-1.5">
                            <span>Límite Alerta:</span>
                            <span className="font-bold text-slate-700">{cop(conf.montoAlerta)}</span>
                          </div>

                          <div className="flex justify-between text-[10.5px] text-slate-500">
                            <span>Recolector Autorizado:</span>
                            <span className="font-semibold text-slate-700">Hamilton</span>
                          </div>
                        </div>

                        {isAlert && (
                          <div className="mt-3 px-2 py-1 bg-rose-100 border border-rose-250 text-rose-700 rounded-lg text-[9px] font-black text-center uppercase tracking-wide">
                            ⚠️ Alerta Exceso {cop(conf.montoAlerta)}
                          </div>
                        )}

                        <span className="text-[10px] text-slate-400 block mt-2">{count} Cierres pendientes</span>
                      </div>

                      <div className="mt-4 space-y-2">
                        <button
                          onClick={() => {
                            if (count === 0) {
                              setSelectedBranchForReconcile(bName);
                              return;
                            }
                            setCustomConfirm({
                              isOpen: true,
                              title: "Recaudar Efectivo Sede",
                              message: `¿Confirma que ha recibido físicamente el efectivo acumulado de ${bName} por valor de ${cop(uncollected)}?`,
                              onConfirm: async () => {
                                await handleBulkReconcile(bName);
                              }
                            });
                          }}
                          disabled={loading}
                          className={`w-full py-2.5 text-[11px] font-extrabold rounded-xl transition flex justify-center items-center gap-1 cursor-pointer ${
                            count > 0 
                              ? isAlert ? "bg-rose-600 text-white hover:bg-rose-700 shadow-sm" : "bg-slate-900 text-white hover:bg-slate-800 shadow-sm" 
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          {loading ? "Sincronizando..." : count > 0 ? "Confirmar Recibo" : "Ver Cierres / Historial"}
                        </button>
                        
                        <button
                          onClick={() => setSelectedBranchForReconcile(bName)}
                          className="w-full py-1.5 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50/70 hover:bg-indigo-100/80 rounded-xl transition flex justify-center items-center gap-1 cursor-pointer border border-indigo-100/50"
                        >
                          <Settings className="w-3 h-3" />
                          Menú Re-confirmación
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CONFIGURATION PANEL FOR BRANCH CASH COLLECTIONS */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <div className="mb-4">
                <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-600" />
                  <span>⚙️ Configuración de Alertas de Recaudos por Sucursal</span>
                </h4>
                <p className="text-slate-400 text-xs mt-1">Establezca los parámetros de control financiero para el dinero en caja de cada sucursal (Límite de alerta de efectivo acumulado).</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-3">Sucursal</th>
                      <th className="py-3 px-3">Recolector Autorizado</th>
                      <th className="py-3 px-3">Límite Alerta Efectivo (COP)</th>
                      <th className="py-3 px-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branches.map((bName) => {
                      const conf = branchConfigs[bName] || { baseCaja: 150000, recolectorPredeterminado: "Hamilton", montoAlerta: 500000 };
                      return (
                        <BranchConfigRow 
                          key={bName} 
                          branch={bName} 
                          initialConfig={conf} 
                          onSave={handleSaveBranchConfig} 
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AUDIT LOG PRE-COLLECTION EXPENDITURES */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <h4 className="text-lg font-bold text-slate-800 mb-2">Historial de Gastos de Tienda (Caja Menor / Pre-Recaudo)</h4>
              <p className="text-slate-400 text-xs mb-6">Detalle auditable de fondos retenidos directamente en la sucursal antes de autorizar la recolección física.</p>

              <div className="overflow-x-auto">
                {closures.filter(c => c.Gastos_Extra > 0).length === 0 ? (
                  <p className="text-slate-400 text-xs italic text-center py-10">No se registran gastos de caja menor en los cierres de caja actuales.</p>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-2">Fecha</th>
                        <th className="py-3 px-2">Sucursal</th>
                        <th className="py-3 px-2">Gasto de Caja Menor (-)</th>
                        <th className="py-3 px-2">Concepto / Justificación de Gasto</th>
                        <th className="py-3 px-2">Persona Responsable</th>
                        <th className="py-3 px-2">Estado Recolección Fiel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closures.filter(c => c.Gastos_Extra > 0).map((c, idx) => (
                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                          <td className="py-2.5 px-2 text-slate-500 font-medium">{c.Fecha}</td>
                          <td className="py-2.5 px-2 font-bold text-slate-800">{c.Sucursal}</td>
                          <td className="py-2.5 px-2 text-rose-600 font-bold">-{cop(c.Gastos_Extra)}</td>
                          <td className="py-2.5 px-2 text-slate-700 italic">{c.Descripcion_Gastos || "Sin descripción"}</td>
                          <td className="py-2.5 px-2 text-slate-600 font-semibold">{c.Persona_Recogio}</td>
                          <td className="py-2.5 px-2">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                              c.Recaudado_Fisico 
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}>
                              {c.Recaudado_Fisico ? "Recolectado / Caja Central" : "Pendiente en Tienda"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 8. SMART PAYROLL */}
        {adminMode === "payroll_smart" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-slate-850">Sistema de Nómina Inteligente por Horarios</h3>
                <p className="text-slate-500 text-xs mt-1">Defina el cuadrante semanal de turnos y liquide automáticamente salarios prorrateados, prestaciones legales, aportes a pensión/salud y descuentos de préstamos.</p>
              </div>
            </div>

            {/* GESTIÓN DE COLABORADORES */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                <div>
                  <h4 className="text-base font-bold text-slate-800">Administración de Personal (Colaboradores)</h4>
                  <p className="text-slate-400 text-xs mt-0.5">Gestione la nómina agregando nuevos colaboradores, editando nombres, tarifas o actualizando sus números de contacto para notificaciones de WhatsApp.</p>
                </div>
                <div className="bg-emerald-50/90 border border-emerald-200 p-3 rounded-2xl flex items-center gap-3 shrink-0">
                  <span className="text-xl">🚚</span>
                  <div>
                    <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider block">Variable Auxilio de Transporte</span>
                    <span className="text-xs font-black text-emerald-950">{cop(8303)} / día <span className="text-[10px] font-normal text-emerald-700">({cop(249095)} / mes)</span></span>
                    <span className="text-[9px] text-emerald-700 block font-medium mt-0.5 leading-tight max-w-xs">
                      * Si labora en 2 sucursales o más, se divide equitativamente entre las sucursales; si solo laboró en 1 sucursal, se le pasa el 100% a esa sola sede.
                    </span>
                  </div>
                </div>
              </div>

              {empFeedback && (
                <div className={`p-3 rounded-2xl mb-4 flex justify-between items-center text-xs font-bold transition-all ${
                  empFeedback.type === "success" ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : "bg-rose-100 text-rose-800 border border-rose-300"
                }`}>
                  <span className="flex items-center gap-2">
                    {empFeedback.type === "success" ? "✅" : "⚠️"} {empFeedback.message}
                  </span>
                  <button onClick={() => setEmpFeedback(null)} className="text-slate-500 hover:text-slate-800 font-black ml-2 cursor-pointer">✕</button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* List of workers (8 cols) */}
                <div className="lg:col-span-8 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider bg-slate-50/50">
                        <th className="py-2.5 px-3">Colaborador</th>
                        <th className="py-2.5 px-3">Celular (WhatsApp)</th>
                        <th className="py-2.5 px-3 text-right">Tarifa Día</th>
                        <th className="py-2.5 px-3 text-right">Tarifa Hora</th>
                        <th className="py-2.5 px-3 text-right">Aux. Transp. Día</th>
                        <th className="py-2.5 px-3 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map((r, rIdx) => {
                        const isEditingThis = editingEmpName === r.Empleado;
                        return (
                          <tr key={`${r.Empleado}-${rIdx}`} className={`border-b border-slate-100 transition ${
                            isEditingThis ? "bg-amber-50/80 border-l-4 border-l-amber-500" : "hover:bg-slate-50/20"
                          }`}>
                            <td className="py-2.5 px-3">
                              {isEditingThis ? (
                                <div className="space-y-1">
                                  <input
                                    type="text"
                                    value={empFormName}
                                    onChange={(e) => setEmpFormName(e.target.value)}
                                    className="w-full px-2 py-1 bg-white border border-amber-300 rounded text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-800"
                                    placeholder="Nombre completo"
                                  />
                                  <input
                                    type="text"
                                    value={empFormCedula}
                                    onChange={(e) => setEmpFormCedula(e.target.value)}
                                    className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono focus:outline-none text-slate-600"
                                    placeholder="Cédula"
                                  />
                                </div>
                              ) : (
                                <>
                                  <div className="font-extrabold text-slate-800">{r.Empleado}</div>
                                  {r.Cedula && (
                                    <div className="text-[10px] text-slate-400 font-mono">C.C. {r.Cedula}</div>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600">
                              {isEditingThis ? (
                                <input
                                  type="text"
                                  value={empFormPhone}
                                  onChange={(e) => setEmpFormPhone(e.target.value)}
                                  className="w-28 px-2 py-1 bg-white border border-amber-300 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-800"
                                  placeholder="Celular"
                                />
                              ) : r.Celular ? (
                                <span className="bg-emerald-50 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                                  {r.Celular}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">No registrado</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                              {isEditingThis ? (
                                <input
                                  type="number"
                                  value={empFormDailyRate}
                                  onChange={(e) => setEmpFormDailyRate(e.target.value)}
                                  className="w-20 px-2 py-1 bg-white border border-amber-300 rounded text-xs text-right font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-800"
                                />
                              ) : (
                                cop(r.Valor_Dia)
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                              {isEditingThis ? (
                                <input
                                  type="number"
                                  value={empFormHourlyRate}
                                  onChange={(e) => setEmpFormHourlyRate(e.target.value)}
                                  className="w-20 px-2 py-1 bg-white border border-amber-300 rounded text-xs text-right font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-800"
                                />
                              ) : (
                                cop(r.Valor_Hora)
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-emerald-800">
                              {isEditingThis ? (
                                <input
                                  type="number"
                                  value={empFormTransportRate}
                                  onChange={(e) => setEmpFormTransportRate(e.target.value)}
                                  className="w-20 px-2 py-1 bg-white border border-amber-300 rounded text-xs text-right font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-800"
                                />
                              ) : (
                                cop(r.Auxilio_Transporte ?? 8303)
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isEditingThis ? (
                                <div className="flex justify-center gap-1">
                                  <button
                                    onClick={handleSaveEmployee}
                                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition shadow-sm cursor-pointer"
                                  >
                                    💾 Guardar
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingEmpName(null);
                                      setEmpFormName("");
                                      setEmpFormPhone("");
                                      setEmpFormDailyRate("60000");
                                      setEmpFormHourlyRate("9000");
                                      setEmpFormTransportRate("8303");
                                      setEmpFormCedula("");
                                    }}
                                    className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] font-bold transition cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div className="flex justify-center gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingEmpName(r.Empleado);
                                      setEmpFormName(r.Empleado);
                                      setEmpFormPhone(r.Celular || "");
                                      setEmpFormDailyRate(r.Valor_Dia.toString());
                                      setEmpFormHourlyRate(r.Valor_Hora.toString());
                                      setEmpFormTransportRate((r.Auxilio_Transporte ?? 8303).toString());
                                      setEmpFormCedula(r.Cedula || "");
                                    }}
                                    className="px-2 py-1 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded text-[11px] font-bold transition flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <Edit2 className="w-3 h-3" /> Editar
                                  </button>
                                  <button
                                    onClick={() => handleDeleteEmployee(r.Empleado)}
                                    className="px-2 py-1 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded text-[11px] font-bold transition flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" /> Eliminar
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Form (4 cols) */}
                <div className="lg:col-span-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/50">
                  <h5 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-3">
                    {editingEmpName ? `Editar: ${editingEmpName}` : "Añadir Nuevo Trabajador"}
                  </h5>
                  <form onSubmit={handleSaveEmployee} className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nombre Completo *</label>
                      <input
                        type="text"
                        value={empFormName}
                        onChange={(e) => setEmpFormName(e.target.value)}
                        placeholder="Ej: Hamilton"
                        required
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Celular / WhatsApp</label>
                      <input
                        type="text"
                        value={empFormPhone}
                        onChange={(e) => setEmpFormPhone(e.target.value)}
                        placeholder="Ej: 3112223344"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cédula de Ciudadanía</label>
                      <input
                        type="text"
                        value={empFormCedula}
                        onChange={(e) => setEmpFormCedula(e.target.value)}
                        placeholder="Ej: 1012345678"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Tarifa Día ($) *</label>
                        <input
                          type="number"
                          value={empFormDailyRate}
                          onChange={(e) => setEmpFormDailyRate(e.target.value)}
                          placeholder="Ej: 60000"
                          required
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Tarifa Hora ($) *</label>
                        <input
                          type="number"
                          value={empFormHourlyRate}
                          onChange={(e) => setEmpFormHourlyRate(e.target.value)}
                          placeholder="Ej: 9000"
                          required
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Aux. Transp. Día</label>
                        <input
                          type="number"
                          value={empFormTransportRate}
                          onChange={(e) => setEmpFormTransportRate(e.target.value)}
                          placeholder="Ej: 8303"
                          className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-800"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="submit"
                        className="flex-1 py-2 bg-slate-900 hover:bg-slate-850 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                      >
                        {editingEmpName ? "Guardar Cambios" : "Guardar Trabajador"}
                      </button>
                      {editingEmpName && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEmpName(null);
                            setEmpFormName("");
                            setEmpFormPhone("");
                            setEmpFormDailyRate("60000");
                            setEmpFormHourlyRate("9000");
                            setEmpFormTransportRate("8303");
                            setEmpFormCedula("");
                          }}
                          className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </div>
            </div>

            {/* VISTA DE ROSTER/CALENDARIO TOGGLE TABS */}
            <div className="flex bg-slate-100 p-1.5 rounded-2xl max-w-sm mb-6">
              <button
                type="button"
                onClick={() => setCalendarViewMode("monthly")}
                className={`flex-1 py-2 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  calendarViewMode === "monthly" 
                    ? "bg-white text-slate-900 shadow-md" 
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Calendar className="w-4 h-4 text-emerald-500" />
                Calendario Mensual
              </button>
              <button
                type="button"
                onClick={() => setCalendarViewMode("weekly")}
                className={`flex-1 py-2 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                  calendarViewMode === "weekly" 
                    ? "bg-white text-slate-900 shadow-md" 
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <ClipboardList className="w-4 h-4 text-slate-600" />
                Roster Semanal
              </button>
            </div>

            {calendarViewMode === "monthly" ? (
              /* MONTHLY INTERACTIVE CALENDAR */
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                  <div>
                    <h4 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-emerald-500" />
                      Planificador Mensual de Asistencias (Calendario)
                    </h4>
                    <p className="text-slate-400 text-xs mt-0.5">Gestione los turnos de asistencia mensual de forma visual en tiempo real. Use el botón "+" para programar.</p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (currentCalendarMonth === 0) {
                          setCurrentCalendarMonth(11);
                          setCurrentCalendarYear(currentCalendarYear - 1);
                        } else {
                          setCurrentCalendarMonth(currentCalendarMonth - 1);
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition text-slate-600 hover:text-slate-900 text-xs font-bold cursor-pointer"
                    >
                      &larr; Ant
                    </button>

                    <div className="flex items-center gap-1 font-bold text-slate-800 text-xs">
                      <select
                        value={currentCalendarMonth}
                        onChange={(e) => setCurrentCalendarMonth(parseInt(e.target.value))}
                        className="bg-transparent border-b border-slate-300 py-0.5 font-extrabold focus:outline-none"
                      >
                        {[
                          "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                          "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
                        ].map((m, idx) => (
                          <option key={m} value={idx}>{m}</option>
                        ))}
                      </select>
                      <select
                        value={currentCalendarYear}
                        onChange={(e) => setCurrentCalendarYear(parseInt(e.target.value))}
                        className="bg-transparent border-b border-slate-300 py-0.5 font-extrabold focus:outline-none"
                      >
                        {[2025, 2026, 2027, 2028].map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (currentCalendarMonth === 11) {
                          setCurrentCalendarMonth(0);
                          setCurrentCalendarYear(currentCalendarYear + 1);
                        } else {
                          setCurrentCalendarMonth(currentCalendarMonth + 1);
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition text-slate-600 hover:text-slate-900 text-xs font-bold cursor-pointer"
                    >
                      Sig &rarr;
                    </button>

                    <button
                      type="button"
                      onClick={handleExportMonthlyCalendarExcel}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition text-xs font-black shadow-sm flex items-center gap-1.5 cursor-pointer ml-1"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Descargar Calendario Excel (.xlsx)
                    </button>
                  </div>
                </div>

                {/* MENU UNIFICADO DE VINCULACIÓN CON ROSTER SEMANAL */}
                <div className="p-5 bg-gradient-to-br from-emerald-50/50 via-teal-50/20 to-white rounded-2xl border border-emerald-150/50 shadow-xs space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">⚡</span>
                    <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider">Menú de Vinculación con Roster Semanal</h5>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    Copie y asigne la programación del Roster Semanal (planilla) directamente al Calendario para una semana específica del mes, una por una, evitando multiplicaciones automáticas y permitiendo horarios reales variables.
                  </p>
                  
                  <div className="flex flex-wrap items-end gap-4 bg-white p-3 rounded-xl border border-slate-200/80">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Colaborador(es)</label>
                      <select
                        value={rosterSyncEmployee}
                        onChange={(e) => setRosterSyncEmployee(e.target.value)}
                        className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                      >
                        <option value="ALL">👥 TODOS los colaboradores</option>
                        {employees.map((emp) => (
                          <option key={emp} value={emp}>👤 {emp}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Semana del Calendario a Cargar</label>
                      <select
                        value={selectedRosterWeekIndex}
                        onChange={(e) => setSelectedRosterWeekIndex(e.target.value)}
                        className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                      >
                        {getWeeksOfMonth(currentCalendarYear, currentCalendarMonth).map((w) => (
                          <option key={w.weekIndex} value={w.weekIndex}>
                            📌 {w.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleApplyRosterToWeek(selectedRosterWeekIndex, rosterSyncEmployee)}
                      disabled={loading || employees.length === 0}
                      className="px-4 py-1.5 bg-slate-900 hover:bg-slate-850 text-white rounded-lg text-xs font-extrabold cursor-pointer transition shadow-xs flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                      {loading ? "Sincronizando..." : "Vincular Roster a Semana"}
                    </button>
                  </div>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1.5">
                  {/* Grid headers */}
                  {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((dayName) => (
                    <div key={dayName} className="text-center font-extrabold text-slate-400 text-[10px] uppercase py-1 tracking-wider">
                      {dayName}
                    </div>
                  ))}

                  {/* Empty cell gaps */}
                  {Array.from({ length: (day => day === 0 ? 6 : day - 1)(new Date(currentCalendarYear, currentCalendarMonth, 1).getDay()) }).map((_, idx) => (
                    <div key={`empty-${idx}`} className="bg-slate-50/20 rounded-2xl border border-slate-100/50 min-h-[90px] opacity-30"></div>
                  ))}

                  {/* Day cells */}
                  {Array.from({ length: new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate() }).map((_, idx) => {
                    const dayNum = idx + 1;
                    const paddedMonth = String(currentCalendarMonth + 1).padStart(2, "0");
                    const paddedDay = String(dayNum).padStart(2, "0");
                    const dateStr = `${currentCalendarYear}-${paddedMonth}-${paddedDay}`;
                    
                    const daySchedules = schedules.filter((s) => s.Fecha === dateStr);

                    return (
                      <div key={dayNum} className="bg-slate-50/40 hover:bg-slate-100/40 transition border border-slate-200/50 p-2 rounded-2xl min-h-[100px] flex flex-col justify-between group relative">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-extrabold text-slate-700 text-xs">{dayNum}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDayForSchedule(dateStr);
                              setSchedFormEmployee(employees[0] || "");
                              setSchedFormStore("Plaza");
                              setSchedFormHours("8");
                              setScheduleModalOpen(true);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-lg transition duration-200 cursor-pointer"
                            title="Programar Turno"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Shift List inside cell */}
                        <div className="flex-1 space-y-1 overflow-y-auto max-h-[70px] scrollbar-thin">
                          {daySchedules.length === 0 ? (
                            <span className="text-[9px] text-slate-400 italic block mt-1">Sin turnos</span>
                          ) : (
                            daySchedules.map((sched, sIdx) => {
                              // Custom store color helper
                              const getCol = (st: string) => {
                                switch (st) {
                                  case "Plaza": return "bg-emerald-50 text-emerald-700 border-emerald-100";
                                  case "Nobsa": return "bg-sky-50 text-sky-700 border-sky-100";
                                  case "Tibasosa": return "bg-indigo-50 text-indigo-700 border-indigo-100";
                                  case "Fira": return "bg-amber-50 text-amber-700 border-amber-100";
                                  case "Aquitania": return "bg-rose-50 text-rose-700 border-rose-100";
                                  case "Hansel": return "bg-purple-50 text-purple-700 border-purple-100";
                                  case "Descanso": return "bg-slate-100 text-slate-500 border-slate-200";
                                  default: return "bg-slate-50 text-slate-600 border-slate-200";
                                }
                              };

                              return (
                                <div key={sIdx} className="p-1 bg-white border border-slate-100 rounded-lg shadow-sm text-[9px] flex items-center justify-between group/item">
                                  <div className="truncate pr-1">
                                    <span className="font-extrabold text-slate-700">{sched.Empleado}</span>
                                    <span className={`ml-1 text-[8px] px-1 py-0.2 rounded border font-semibold ${getCol(sched.Sucursal)}`}>
                                      {sched.Sucursal}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCalendarSchedule(sched.Fecha, sched.Empleado)}
                                    className="opacity-0 group-item-hover:opacity-100 p-0.5 text-rose-500 hover:bg-rose-50 rounded transition cursor-pointer"
                                    title="Eliminar Turno"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Monthly Summary Statistics */}
                <div className="pt-5 border-t border-slate-200">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3">
                    <h5 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Resumen Horas Programadas en el Mes</h5>
                    <button
                      type="button"
                      onClick={handleExportMonthlyCalendarExcel}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Descargar Tabla Calendario (.xlsx)
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {employees.map((emp) => {
                      const monthSchedules = schedules.filter((s) => {
                        const targetPrefix = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, "0")}`;
                        return s.Fecha.startsWith(targetPrefix) && s.Empleado.toLowerCase() === emp.toLowerCase();
                      });
                      const totalDays = monthSchedules.length;
                      const totalHours = monthSchedules.reduce((sum, s) => sum + s.Horas_Trabajadas, 0);

                      return (
                        <div key={emp} className="p-3 bg-slate-50 border border-slate-200/50 rounded-2xl flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-800 text-xs block">{emp}</span>
                            <span className="text-[9px] text-slate-500">Días: <strong className="text-slate-700">{totalDays}</strong></span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-black text-emerald-600 font-mono block">{totalHours}h</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* WEEKLY ROSTER GRID/MATRIX */
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm overflow-x-auto">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h4 className="text-base font-bold text-slate-800">1. Cuadrante de Turnos Semanal (Roster Directo)</h4>
                    <p className="text-slate-400 text-xs mt-0.5">Planifique y asigne la tienda en la que trabaja cada empleado cada día para realizar el prorrateo de costos centro.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadScheduleHTML}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar Imagen (PNG)
                    </button>
                    <button
                      type="button"
                      onClick={handleExportScheduleXLSX}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Exportar Cronograma (.xlsx)
                    </button>
                  </div>
                </div>

                {/* 🔗 VINCULAR CON EL CALENDARIO BAR */}
                <div className="mb-6 p-4 bg-emerald-50/50 border border-emerald-200/50 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500 text-slate-950 text-[10px] font-black uppercase rounded-lg tracking-wider">
                      ⚡ VINCULAR CON EL CALENDARIO (SEMANA POR SEMANA)
                    </span>
                    <p className="text-[11px] text-slate-600 font-semibold">
                      Guarde y asigne la planilla actual del roster semanal a una semana específica del mes del calendario.
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Colaborador:</span>
                      <select
                        value={rosterSyncEmployee}
                        onChange={(e) => setRosterSyncEmployee(e.target.value)}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="ALL">👥 TODOS los colaboradores</option>
                        {employees.map((emp) => (
                          <option key={emp} value={emp}>👤 {emp}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Semana de Destino:</span>
                      <select
                        value={selectedRosterWeekIndex}
                        onChange={(e) => setSelectedRosterWeekIndex(e.target.value)}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {getWeeksOfMonth(currentCalendarYear, currentCalendarMonth).map((w) => (
                          <option key={w.weekIndex} value={w.weekIndex}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleApplyRosterToWeek(selectedRosterWeekIndex, rosterSyncEmployee)}
                      disabled={loading}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-850 text-white font-black text-xs rounded-xl transition shadow-xs cursor-pointer inline-flex items-center gap-1"
                    >
                      <span>Vincular Roster a Semana</span>
                    </button>
                  </div>
                </div>

                <table className="w-full text-left text-xs border-collapse min-w-[800px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider bg-slate-50/50">
                      <th className="py-3 px-3">Empleado</th>
                      {daysOfWeek.map((day) => (
                        <th key={day} className="py-3 px-2 text-center">{day}</th>
                      ))}
                      <th className="py-3 px-3 text-right">Fórmula Tarifa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp, empIdx) => (
                      <tr key={`${emp}-${empIdx}`} className="border-b border-slate-100 hover:bg-slate-50/20 transition">
                        <td className="py-4 px-3">
                          <div className="font-extrabold text-slate-800 text-sm">{emp}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">Tarifa Día: <span className="font-bold text-slate-600">{cop(getDailyRate(emp))}</span></div>
                          <button
                            type="button"
                            onClick={() => sendScheduleToWhatsApp(emp)}
                            title="Enviar horario de turnos por WhatsApp"
                            className="mt-2 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-lg transition inline-flex items-center gap-1 cursor-pointer border border-emerald-200/50"
                          >
                            <Smartphone className="w-3.5 h-3.5" /> Enviar Horario
                          </button>
                        </td>
                        {daysOfWeek.map((day) => {
                          const cell = weeklyRoster[emp]?.[day] || { sucursal: "Descanso", horas: 8, extras: 0 };
                          return (
                            <td key={day} className="py-4 px-2 text-center">
                              <div className="space-y-1 inline-block text-left w-28">
                                {/* Store Selection */}
                                <select
                                  value={cell.sucursal}
                                  onChange={(e) => handleRosterChange(emp, day, "sucursal", e.target.value)}
                                  className="w-full text-[10px] font-extrabold px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                >
                                  {availableStores.map((st) => (
                                    <option key={st} value={st}>{st}</option>
                                  ))}
                                </select>

                                {/* Hours Inputs */}
                                {cell.sucursal !== "Descanso" && (
                                  <div className="flex gap-1">
                                    <div className="w-1/2">
                                      <span className="text-[8px] text-slate-400 uppercase block font-semibold text-center">Norm</span>
                                      <input
                                        type="number"
                                        value={cell.horas}
                                        onChange={(e) => handleRosterChange(emp, day, "horas", e.target.value)}
                                        className="w-full text-[10px] text-center font-bold px-1 py-0.5 bg-slate-50 border border-slate-200 rounded focus:outline-none"
                                      />
                                    </div>
                                    <div className="w-1/2">
                                      <span className="text-[8px] text-slate-400 uppercase block font-semibold text-center">Extr</span>
                                      <input
                                        type="number"
                                        value={cell.extras}
                                        onChange={(e) => handleRosterChange(emp, day, "extras", e.target.value)}
                                        className="w-full text-[10px] text-center font-bold px-1 py-0.5 bg-slate-50 border border-slate-200 rounded focus:outline-none text-emerald-700"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="py-4 px-3 text-right">
                          <span className="font-mono font-bold text-slate-600 block text-[10px]">
                            Base: {cop(getDailyRate(emp))} / d
                          </span>
                          <span className="text-[9px] text-emerald-600 font-semibold block">
                            HE: {cop(getDailyRate(emp) / 8 * 1.25)} / h
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TWO-COLUMN GESTION: LOANS & INDIVIDUAL PAYROLL */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* COL 1: LOANS REGISTRY (4 cols) */}
              <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4">
                <h4 className="text-base font-bold text-slate-800">2. Registrar Préstamo / Adelanto</h4>
                <p className="text-slate-400 text-xs">Registre adelantos a descontar automáticamente en el próximo pago de nómina.</p>

                <form onSubmit={handleSaveLoan} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Empleado *</label>
                    <select
                      value={loanEmp}
                      onChange={(e) => setLoanEmp(e.target.value)}
                      required
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="">Seleccione empleado</option>
                      {employees.map((emp) => (
                        <option key={emp} value={emp}>{emp}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sucursal del Préstamo *</label>
                    <select
                      value={loanBranch}
                      onChange={(e) => setLoanBranch(e.target.value)}
                      required
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="Plaza">Plaza (Central)</option>
                      <option value="Nobsa">Nobsa</option>
                      <option value="Tibasosa">Tibasosa</option>
                      <option value="Fira">Fira</option>
                      <option value="Aquitania">Aquitania</option>
                      <option value="Hansel">Hansel</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Monto del Préstamo ($) *</label>
                    <input
                      type="number"
                      placeholder="Ej: 50000"
                      value={loanAmount}
                      onChange={(e) => setLoanAmount(e.target.value)}
                      required
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Motivo / Justificación</label>
                    <input
                      type="text"
                      placeholder="Ej: Pasajes, comida..."
                      value={loanReason}
                      onChange={(e) => setLoanReason(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer transition shadow-sm"
                  >
                    Guardar Préstamo
                  </button>
                </form>

                <div className="pt-4 border-t border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Historial de Adelantos</span>
                  {loans.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No hay préstamos registrados.</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                      {loans.map((l, idx) => (
                        <div key={idx} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/50 flex justify-between items-center text-[11px]">
                          <div>
                            <span className="font-extrabold text-slate-800 block">{l.Empleado}</span>
                            <span className="text-slate-400 text-[10px]">{l.Motivo || "Adelanto"} ({l.Fecha})</span>
                          </div>
                          <span className="font-extrabold text-rose-600 font-mono">-{cop(l.Monto)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* COL 2: INDIVIDUAL PAYROLL GENERATOR (8 cols) */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100 mb-6">
                    <div>
                      <h4 className="text-base font-bold text-slate-800">3. Liquidación de Nómina Individual</h4>
                      <p className="text-slate-400 text-xs mt-0.5">Sistemas de turnos individuales reales (Calendario día a día sin multiplicar por 4 semanas).</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 uppercase">Trabajador:</span>
                        <select
                          value={selectedPayrollEmployee}
                          onChange={(e) => setSelectedPayrollEmployee(e.target.value)}
                          className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-2xl text-sm font-extrabold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                        >
                          {employees.map((emp) => (
                            <option key={emp} value={emp}>{emp}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="mb-6 p-4 bg-emerald-50/50 border border-emerald-200/50 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="text-emerald-900 font-bold">
                        📅 Liquidación basada en Turnos de Asistencia Real del Calendario
                      </p>
                      <p className="text-emerald-700 text-[11px] mt-0.5">
                        Calculando días y horas reales registradas para el mes seleccionado en la pestaña de Calendario (Horarios individuales por día).
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-emerald-500 text-slate-950 font-black rounded-lg text-center uppercase tracking-wide shrink-0">
                      {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][currentCalendarMonth]} {currentCalendarYear}
                    </span>
                  </div>

                  {/* Computed result */}
                  {(() => {
                    const payrollResult = computeEmployeePayroll(selectedPayrollEmployee);
                    if (!payrollResult) {
                      return <p className="text-slate-400 italic text-xs py-8 text-center">No se pudieron computar los datos para este empleado.</p>;
                    }

                    const {
                      daysWorked,
                      totalDaysBase,
                      compDays,
                      compPay,
                      totalSueldoBaseComp,
                      standardHours,
                      overtimeHours,
                      finalOvertimeHours,
                      discountedExtraHours,
                      festiveHours,
                      festivePay,
                      dailyRate,
                      basePay,
                      extraPay,
                      transportAllowance,
                      grossPay,
                      healthDeduction,
                      pensionDeduction,
                      socialSecurityDeductions,
                      totalLoansDeducted,
                      totalNet,
                      storeSplits
                    } = payrollResult;

                    const receiptPreviewUrl = generateReceiptCanvasUrl(selectedPayrollEmployee, payrollResult);

                    return (
                      <div className="space-y-6">
                        <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-200/60 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <div>
                            <h4 className="text-xl font-black text-slate-800">{selectedPayrollEmployee}</h4>
                            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mt-1">
                              Días Trabajados: <span className="text-slate-700 font-extrabold">{daysWorked} d</span> ({standardHours} h ordinarias + {finalOvertimeHours} h extras netas)
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-400 text-[10px] font-bold block uppercase">Neto a Transferir</span>
                            <span className="text-2xl font-black text-emerald-700 block mt-0.5">
                              {cop(totalNet)}
                            </span>
                          </div>
                        </div>

                        {/* AJUSTES MANUALES DE NÓMINA CARD */}
                        <div className="bg-gradient-to-br from-amber-50/40 via-slate-50 to-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">⚙️</span>
                            <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Ajustes Manuales, Recargos y Compensación de Horas</h5>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-normal">
                            Modifique los días u horas calculados para corregir la planilla de este periodo, asigne horas festivas, días compensados o descuente horas extra compensadas. Deje vacío un campo para usar el cálculo automático recomendado.
                          </p>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2.5 pt-1">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1" title="Dejar vacío para cálculo automático">Días Trab. (Man.)</label>
                              <input
                                type="number"
                                step="0.5"
                                placeholder={daysWorked.toString()}
                                value={manualDaysWorked}
                                onChange={(e) => setManualDaysWorked(e.target.value)}
                                className="w-full text-xs font-bold px-2 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1" title="Dejar vacío para cálculo automático">Hrs Ord. (Man.)</label>
                              <input
                                type="number"
                                placeholder={standardHours.toString()}
                                value={manualStandardHours}
                                onChange={(e) => setManualStandardHours(e.target.value)}
                                className="w-full text-xs font-bold px-2 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1" title="Dejar vacío para cálculo automático">Hrs Ext. (Man.)</label>
                              <input
                                type="number"
                                placeholder={overtimeHours.toString()}
                                value={manualOvertimeHours}
                                onChange={(e) => setManualOvertimeHours(e.target.value)}
                                className="w-full text-xs font-bold px-2 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Hrs Rec. Festivo</label>
                              <input
                                type="number"
                                placeholder="0"
                                value={manualFestiveHours}
                                onChange={(e) => setManualFestiveHours(e.target.value)}
                                className="w-full text-xs font-black px-2 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-amber-600 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-amber-700 uppercase mb-1" title="Modificar manualmente el valor total del recargo festivo">Valor Fest. ($)</label>
                              <input
                                type="number"
                                placeholder={payrollResult.calculatedFestivePay ? payrollResult.calculatedFestivePay.toString() : "0"}
                                value={manualFestivePay}
                                onChange={(e) => setManualFestivePay(e.target.value)}
                                className="w-full text-xs font-black px-2 py-1.5 bg-white border border-amber-200 rounded-xl focus:outline-none focus:border-amber-400 text-amber-700 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-indigo-600 uppercase mb-1" title="Días compensados a pagar al colaborador">Días Comp.</label>
                              <input
                                type="number"
                                step="0.5"
                                placeholder="0"
                                value={manualCompDays}
                                onChange={(e) => setManualCompDays(e.target.value)}
                                className="w-full text-xs font-black px-2 py-1.5 bg-white border border-indigo-200 rounded-xl focus:outline-none focus:border-indigo-500 text-indigo-700 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1" title="Horas extra a descontar por días de descanso extra compensados">Hrs Compensadas</label>
                              <input
                                type="number"
                                step="0.5"
                                placeholder="0"
                                value={discountedExtraHours}
                                onChange={(e) => setDiscountedExtraHours(e.target.value)}
                                className="w-full text-xs font-black px-2 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-rose-600 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-emerald-700 uppercase mb-1" title="Modificar manualmente el Auxilio de Transporte">Aux. Trans. ($)</label>
                              <input
                                type="number"
                                placeholder={payrollResult.calculatedTransportAllowance ? payrollResult.calculatedTransportAllowance.toString() : "0"}
                                value={manualTransportAllowance}
                                onChange={(e) => setManualTransportAllowance(e.target.value)}
                                className="w-full text-xs font-black px-2 py-1.5 bg-white border border-emerald-200 rounded-xl focus:outline-none focus:border-emerald-400 text-emerald-700 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-rose-700 uppercase mb-1" title="Modificar manualmente deducciones de Salud + Pensión">Deducciones ($)</label>
                              <input
                                type="number"
                                placeholder={payrollResult.calculatedSocialDeductions ? payrollResult.calculatedSocialDeductions.toString() : "0"}
                                value={manualDeductions}
                                onChange={(e) => setManualDeductions(e.target.value)}
                                className="w-full text-xs font-black px-2 py-1.5 bg-white border border-rose-200 rounded-xl focus:outline-none focus:border-rose-400 text-rose-700 font-mono"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                          {/* LEFT COLUMN: NUMERIC BREAKDOWNS (7 cols) */}
                          <div className="lg:col-span-7 space-y-6">
                            {/* Breakdown cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2 text-xs bg-slate-50/30 p-3.5 rounded-2xl border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">Conceptos Devengados</span>
                                <div className="flex justify-between text-slate-600 py-1">
                                  <span>Sueldo Ord. y Comp. ({payrollResult.totalDaysBase || daysWorked} d):</span>
                                  <span className="font-semibold text-slate-800">{cop(payrollResult.totalSueldoBaseComp || (basePay + (compPay || 0)))}</span>
                                </div>
                                {payrollResult.finalOvertimeHours > 0 && (
                                  <div className="flex justify-between text-slate-600 py-1">
                                    <span>
                                      Horas Extras ({payrollResult.finalOvertimeHours} h) @ 1.25x:
                                    </span>
                                    <span className="font-semibold text-emerald-700">+{cop(extraPay)}</span>
                                  </div>
                                )}
                                {payrollResult.festivePay > 0 && (
                                  <div className="flex justify-between text-slate-600 py-1">
                                    <span>Recargo Festivo ({festiveHours} h):</span>
                                    <span className="font-semibold text-amber-600">+{cop(payrollResult.festivePay)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-slate-600 py-1 border-b border-slate-100 pb-2">
                                  <span>Auxilio de Transporte Legal:</span>
                                  <span className="font-semibold text-emerald-700">+{cop(transportAllowance)}</span>
                                </div>
                                <div className="flex justify-between font-bold text-slate-800 bg-emerald-50/30 p-2.5 rounded-xl">
                                  <span>Sueldo Bruto Devengado:</span>
                                  <span>{cop(grossPay)}</span>
                                </div>
                              </div>

                              <div className="space-y-2 text-xs bg-slate-50/30 p-3.5 rounded-2xl border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">Deducciones Aplicadas</span>
                                <div className="flex justify-between text-slate-600 py-1">
                                  <span>Aporte Salud Obligatorio (4%):</span>
                                  <span className="text-rose-600 font-medium">-{cop(healthDeduction)}</span>
                                </div>
                                <div className="flex justify-between text-slate-600 py-1">
                                  <span>Aporte Pensión Obligatorio (4%):</span>
                                  <span className="text-rose-600 font-medium">-{cop(pensionDeduction)}</span>
                                </div>
                                {totalLoansDeducted > 0 && (
                                  <div className="flex justify-between text-slate-600 py-1 border-b border-slate-100 pb-2">
                                    <span>Descuento de Préstamos:</span>
                                    <span className="text-rose-600 font-bold font-mono">-{cop(totalLoansDeducted)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between font-bold text-slate-800 bg-rose-50/20 p-2.5 rounded-xl">
                                  <span>Total Deducciones:</span>
                                  <span className="text-rose-600">-{cop(socialSecurityDeductions + totalLoansDeducted)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Cost-Center splits detail */}
                            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 p-5 rounded-3xl text-white space-y-4 shadow-md border border-slate-950">
                              <div>
                                <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest block">📊 Liquidación Detallada por Sucursal (Aparte del Recibo)</span>
                                <h5 className="text-xs text-indigo-100 mt-1 font-medium">Distribución exacta y proporcional del costo por cada centro de trabajo:</h5>
                              </div>
                              <div className="space-y-3.5">
                                {Object.entries(storeSplits).map(([store, info]: any) => (
                                  <div key={store} className="bg-slate-950/40 p-4 rounded-2xl border border-indigo-900/30 space-y-2 font-sans">
                                    <div className="flex justify-between items-center border-b border-indigo-900/20 pb-1.5">
                                      <span className="font-extrabold text-sm text-indigo-200">🏪 Sucursal {store}</span>
                                      <span className="bg-indigo-900/50 text-indigo-300 text-[10px] px-2.5 py-0.5 rounded-full font-black tracking-wider">
                                        📅 {info.daysInBranch} {info.daysInBranch === 1 ? "día" : "días"}
                                      </span>
                                    </div>
                                    <div className="space-y-1 text-xs text-slate-300 font-mono">
                                      <div className="flex justify-between">
                                        <span>(+) Sueldo Base + Extras ({info.daysInBranch} {info.daysInBranch === 1 ? "día" : "días"}):</span>
                                        <span className="text-emerald-400 font-bold">+{cop(info.salarialShare)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>(+) Auxilio Transporte (Equitativo/Fijo):</span>
                                        <span className="text-emerald-400">+{cop(info.transportShare)}</span>
                                      </div>
                                      {info.compShare > 0 && (
                                        <div className="flex justify-between">
                                          <span>(+) Días Comp. (Equitativo):</span>
                                          <span className="text-indigo-300 font-bold">+{cop(info.compShare)}</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between">
                                        <span>(-) Seguridad Social Proporcional (8%):</span>
                                        <span className="text-rose-400">-{cop(info.socialShare || 0)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>(-) Préstamos Realizados en {store}:</span>
                                        <span className="text-rose-400 font-bold">-{cop(info.loanShare)}</span>
                                      </div>
                                    </div>
                                    <div className="flex justify-between items-center pt-2 border-t border-indigo-900/40 font-mono">
                                      <span className="text-xs font-bold text-indigo-100 uppercase">Total Neto Correspondiente:</span>
                                      <span className="text-emerald-400 font-extrabold text-sm">{cop(info.totalShare)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <p className="text-[10px] text-indigo-200/60 leading-relaxed italic">
                                * Nota: El sueldo base y extras se distribuyen proporcionalmente según los días laborados. El Auxilio de Transporte ($249.095) y los Días Compensados se dividen equitativamente entre las sucursales laboradas (o 100% si laboró en solo una). Los préstamos se descuentan en la sucursal origen.
                              </p>
                            </div>

                            {/* Action triggers */}
                            <div className="pt-4 border-t border-slate-100">
                              <button
                                onClick={async () => {
                                  if (window.confirm(`¿Seguro que desea liquidar la nómina semanal para ${selectedPayrollEmployee} por valor de ${cop(totalNet)} en Caja Central?`)) {
                                    await handleSaveSmartPayroll(
                                      selectedPayrollEmployee, 
                                      totalNet, 
                                      basePay + festivePay, 
                                      extraPay, 
                                      totalLoansDeducted, 
                                      daysWorked, 
                                      standardHours + finalOvertimeHours + festiveHours, 
                                      storeSplits
                                    );
                                  }
                                }}
                                disabled={daysWorked === 0 || loading}
                                className={`w-full py-3 rounded-xl text-xs font-black transition flex justify-center items-center gap-1.5 cursor-pointer ${
                                  daysWorked > 0 
                                    ? "bg-slate-950 text-white hover:bg-slate-850 shadow-md" 
                                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                Registrar Nómina de {selectedPayrollEmployee} en Caja Central
                              </button>
                            </div>
                          </div>

                          {/* RIGHT COLUMN: RECEIPT TICKET PREVIEW & ACTION (5 cols) */}
                          <div className="lg:col-span-5 bg-slate-50 p-4 rounded-2xl border border-slate-200/60 flex flex-col items-center">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 block text-center">Vista Previa Recibo de Pago (PNG)</span>
                            <div className="w-full bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex justify-center items-center overflow-auto min-h-[350px]">
                              {receiptPreviewUrl ? (
                                <img 
                                  src={receiptPreviewUrl} 
                                  alt="Recibo Pago Al Paso" 
                                  className="max-h-[380px] object-contain border border-slate-100 rounded-lg shadow-sm"
                                />
                              ) : (
                                <p className="text-slate-400 italic text-xs text-center">Cargando vista previa del recibo...</p>
                              )}
                            </div>
                            <button
                              onClick={() => downloadPayrollReceipt(selectedPayrollEmployee, payrollResult)}
                              className="w-full mt-4 px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-xl text-xs font-black transition shadow-md flex justify-center items-center gap-2 cursor-pointer"
                            >
                              <Printer className="w-4 h-4" />
                              📥 Descargar Recibo (PNG)
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* VISTA CONSOLIDADA DE PRORRATEO Y DISTRIBUCIÓN POR SUCURSALES */}
              <div className="lg:col-span-12 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <span>📊</span> Distribución de Nómina Consolidada por Sucursal
                    </h4>
                    <p className="text-slate-400 text-xs mt-0.5">
                      Manejo exacto por días laborados en cada centro de trabajo y registro diario detallado tipo Excel.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setConsolidatedViewMode("summary")}
                        className={`px-3 py-1.5 rounded-lg cursor-pointer transition ${consolidatedViewMode === "summary" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
                      >
                        📊 Resumen por Sucursal y Días
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsolidatedViewMode("daily_excel")}
                        className={`px-3 py-1.5 rounded-lg cursor-pointer transition ${consolidatedViewMode === "daily_excel" ? "bg-white text-emerald-800 font-extrabold shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
                      >
                        📋 Registro Diario (Tabla Excel)
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportConsolidatedPayrollXLSX}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl cursor-pointer transition shadow-sm flex items-center gap-1.5"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Descargar Nómina Consolidada (.xlsx)
                    </button>
                  </div>
                </div>

                {consolidatedViewMode === "summary" ? (
                  <>
                    {/* Grid of branch-specific totals */}
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      {branches.concat(["Plaza"]).map((bName) => {
                        let totalBranchBase = 0;
                        let totalBranchSocial = 0;
                        let totalBranchLoans = 0;
                        let totalBranchNet = 0;
                        let totalBranchDays = 0;
                        let workersCount = 0;

                        employees.forEach((emp) => {
                          const res = computeEmployeePayroll(emp);
                          if (res && res.storeSplits[bName]) {
                            totalBranchBase += res.storeSplits[bName].baseShare;
                            totalBranchSocial += res.storeSplits[bName].socialShare;
                            totalBranchLoans += res.storeSplits[bName].loanShare;
                            totalBranchNet += res.storeSplits[bName].totalShare;
                            totalBranchDays += res.storeSplits[bName].daysInBranch || 0;
                            workersCount++;
                          }
                        });

                        return (
                          <div key={bName} className="p-4 bg-slate-50/50 border border-slate-150 rounded-2xl flex flex-col justify-between shadow-xs hover:border-slate-300 transition">
                            <div>
                              <div className="flex justify-between items-center border-b border-slate-100 pb-1.5 mb-2">
                                <span className="font-extrabold text-slate-800 text-sm">🏪 Sede {bName}</span>
                                <span className="bg-slate-200 text-slate-700 font-bold text-[9px] px-2 py-0.5 rounded-full">
                                  {workersCount} pers. | {totalBranchDays} d
                                </span>
                              </div>
                              <div className="space-y-1 text-[11px] text-slate-500 font-mono">
                                <div className="flex justify-between">
                                  <span>Devengados:</span>
                                  <span className="text-slate-700 font-semibold">{cop(totalBranchBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Seg. Social (-):</span>
                                  <span className="text-rose-600">-{cop(totalBranchSocial)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Préstamos (-):</span>
                                  <span className="text-rose-600">-{cop(totalBranchLoans)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="border-t border-slate-100 pt-2 mt-3 flex justify-between items-center">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">A PAGAR:</span>
                              <span className="text-xs font-black text-emerald-700 font-mono">{cop(totalBranchNet)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Table of detail per worker across all branches */}
                    <div className="bg-slate-50/30 rounded-2xl border border-slate-150 overflow-hidden">
                      <div className="p-4 bg-slate-100/50 border-b border-slate-150 flex justify-between items-center">
                        <h5 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">Planilla de Prorrateo Detallada por Días Laborados</h5>
                        <span className="text-[10px] text-slate-500 font-medium">* Se muestra el total de días laborados en cada sede en lugar de porcentajes</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-150 text-slate-400 font-bold uppercase tracking-wider text-[10px] bg-slate-50">
                              <th className="py-2.5 px-3">Colaborador</th>
                              <th className="py-2.5 px-3 text-right">Neto Total</th>
                              {branches.concat(["Plaza"]).map((b) => (
                                <th key={b} className="py-2.5 px-3 text-right">Sede {b} (Días / Monto)</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {employees.map((emp, empIdx) => {
                              const res = computeEmployeePayroll(emp);
                              if (!res) return null;
                              return (
                                <tr key={`${emp}-${empIdx}`} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                                  <td className="py-2.5 px-3">
                                    <div className="font-extrabold text-slate-800">{emp}</div>
                                    <div className="text-[9px] text-slate-400">Total Días: {res.daysWorked}d | Horas Extras: {res.finalOvertimeHours}h</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-extrabold text-slate-800 font-mono">{cop(res.totalNet)}</td>
                                  {branches.concat(["Plaza"]).map((b) => {
                                    const share = res.storeSplits[b];
                                    return (
                                      <td key={b} className="py-2.5 px-3 text-right font-mono">
                                        {share ? (
                                          <div className="leading-tight">
                                            <div className="font-bold text-emerald-700">{cop(share.totalShare)}</div>
                                            <div className="text-[10px] font-extrabold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded inline-block mt-0.5">
                                              📅 {share.daysInBranch} {share.daysInBranch === 1 ? "día" : "días"}
                                            </div>
                                          </div>
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  /* DAILY EXCEL TABLE VIEW */
                  <div className="bg-slate-50/50 rounded-2xl border border-slate-200 overflow-hidden space-y-4 p-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200/60">
                      <div>
                        <h5 className="text-xs font-black text-emerald-950 uppercase tracking-wider flex items-center gap-1.5">
                          <span>📋</span> Tabla Registro Diario de Turnos (Formato Excel)
                        </h5>
                        <p className="text-[11px] text-emerald-800 mt-0.5">
                          Listado diario desglosado día por día, con fecha, día de la semana, sucursal, horas trabajadas y horas extras.
                        </p>
                      </div>

                      {/* Filters */}
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={dailyExcelFilterStore}
                          onChange={(e) => setDailyExcelFilterStore(e.target.value)}
                          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="">Todas las Sucursales</option>
                          {branches.concat(["Plaza"]).map((b) => (
                            <option key={b} value={b}>Sucursal {b}</option>
                          ))}
                        </select>
                        <select
                          value={dailyExcelFilterWorker}
                          onChange={(e) => setDailyExcelFilterWorker(e.target.value)}
                          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                        >
                          <option value="">Todos los Trabajadores</option>
                          {employees.map((e) => (
                            <option key={e} value={e}>{e}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-emerald-200/80 bg-emerald-100/60 text-emerald-950 font-black uppercase text-[10px] tracking-wider">
                            <th className="py-2.5 px-3">FECHA</th>
                            <th className="py-2.5 px-3">MES</th>
                            <th className="py-2.5 px-3">DÍA</th>
                            <th className="py-2.5 px-3">SUCURSAL</th>
                            <th className="py-2.5 px-3">TRABAJADOR</th>
                            <th className="py-2.5 px-3 text-right">HORAS TRABAJADAS</th>
                            <th className="py-2.5 px-3 text-right">HORAS EXTRA</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono">
                          {(() => {
                            const targetPrefix = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, "0")}`;
                            const monthSchedulesSorted = schedules
                              .filter((s) => s.Fecha.startsWith(targetPrefix))
                              .filter((s) => !dailyExcelFilterStore || (s.Sucursal || "Plaza").toLowerCase() === dailyExcelFilterStore.toLowerCase())
                              .filter((s) => !dailyExcelFilterWorker || s.Empleado.toLowerCase() === dailyExcelFilterWorker.toLowerCase())
                              .sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.Empleado.localeCompare(b.Empleado));

                            if (monthSchedulesSorted.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={7} className="py-8 text-center text-slate-400 font-sans italic">
                                    No hay turnos o registros diarios guardados para el filtro o periodo seleccionado.
                                  </td>
                                </tr>
                              );
                            }

                            const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
                            const dayOfWeekNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

                            return monthSchedulesSorted.map((s, idx) => {
                              const dt = new Date(s.Fecha + "T12:00:00");
                              const dayNum = dt.getDate();
                              const monthStr = monthNames[dt.getMonth()];
                              const dayStr = dayOfWeekNames[dt.getDay()];
                              const extraHours = Math.max(0, s.Horas_Trabajadas - 7);

                              return (
                                <tr key={`${s.Fecha}-${s.Empleado}-${idx}`} className="hover:bg-emerald-50/30 transition">
                                  <td className="py-2 px-3 font-bold text-slate-700">{dayNum}-{monthStr}</td>
                                  <td className="py-2 px-3 text-slate-500">{monthStr}</td>
                                  <td className="py-2 px-3 capitalize font-semibold text-slate-600">{dayStr}</td>
                                  <td className="py-2 px-3 font-black text-emerald-800 uppercase">{s.Sucursal || "PLAZA"}</td>
                                  <td className="py-2 px-3 font-extrabold text-slate-800 font-sans">{s.Empleado}</td>
                                  <td className="py-2 px-3 text-right font-extrabold text-slate-800">{s.Horas_Trabajadas}</td>
                                  <td className="py-2 px-3 text-right font-extrabold text-amber-600">
                                    {extraHours > 0 ? extraHours.toFixed(2) : "0"}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 9. PACKAGING LEDGER */}
        {adminMode === "packaging_ledger" && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-850">Logística de Envases, Canastillas y Estivas</h3>
                <p className="text-slate-500 text-xs mt-1">Lleve el control contable estricto de canastillas de plástico y estivas de madera prestadas o debidas a mayoristas.</p>
              </div>

              {/* Strict Supplier filter */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500 uppercase">Filtrar por Proveedor:</span>
                <select
                  value={selectedSupplier}
                  onChange={(e) => setSelectedSupplier(e.target.value)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-2xl text-sm font-extrabold text-slate-800 focus:outline-none"
                >
                  <option value="">Seleccione Proveedor</option>
                  {providers.map((p, pIdx) => (
                    <option key={`${p.Proveedor}-${pIdx}`} value={p.Proveedor}>{p.Proveedor}</option>
                  ))}
                </select>
              </div>
            </div>

            {selectedSupplier === "" ? (
              <div className="text-center py-20 bg-white border border-slate-200/80 shadow-sm rounded-3xl">
                <Boxes className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h4 className="text-lg font-bold text-slate-700">Por favor, seleccione un proveedor</h4>
                <p className="text-slate-400 text-xs max-w-md mx-auto mt-1">Debe filtrar strictly por un mayorista para ver el estado del saldo y realizar nuevos registros de entrada o salida de activos.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* INVENTORY BALANCES CARD */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
                    <div className="pb-3 border-b border-slate-100">
                      <span className="text-slate-400 text-xs font-bold uppercase block tracking-wider">Balances Netos</span>
                      <h4 className="text-xl font-black text-slate-850 mt-1">{selectedSupplier}</h4>
                    </div>

                    {/* Plastic baskets balance */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60 flex justify-between items-center">
                      <div>
                        <span className="text-slate-500 text-xs block font-bold">Canastillas Plásticas</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Prestadas: {canastillasLoaned} | Devueltas: {canastillasReturned}</span>
                      </div>
                      <span className={`text-2xl font-black ${netCanastillas >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                        {netCanastillas > 0 ? "+" : ""}{netCanastillas}
                      </span>
                    </div>

                    {/* Wooden pallets balance */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60 flex justify-between items-center">
                      <div>
                        <span className="text-slate-500 text-xs block font-bold">Estivas de Madera/Plástico</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">Prestadas: {estivasLoaned} | Devueltas: {estivasReturned}</span>
                      </div>
                      <span className={`text-2xl font-black ${netEstivas >= 0 ? "text-blue-700" : "text-rose-600"}`}>
                        {netEstivas > 0 ? "+" : ""}{netEstivas}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 leading-relaxed italic bg-blue-50/20 p-3 rounded-xl border border-blue-200/20">
                      Un saldo positivo indica canastillas o estivas que el proveedor tiene bajo su posesión. Un saldo negativo indica envases que le debemos.
                    </div>
                  </div>

                  {/* LOG NEW MOVEMENT FOR THE SUPPLIER */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
                    <h4 className="text-base font-bold text-slate-800 mb-2">Registrar Movimiento de Activos</h4>
                    <p className="text-slate-400 text-xs mb-4">Ingrese entregas o retornos para {selectedSupplier}.</p>

                    <form onSubmit={handleCreatePackagingMovement} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tipo de Envase</label>
                        <select
                          value={packAssetType}
                          onChange={(e) => setPackAssetType(e.target.value as any)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:border-slate-400"
                        >
                          <option value="Canastilla">Canastilla de Plástico</option>
                          <option value="Estiva">Estiva de Madera</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Entregados (Prestado)</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={packQtyDelivered}
                            onChange={(e) => setPackQtyDelivered(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Devueltos (Retorno)</label>
                          <input
                            type="number"
                            placeholder="0"
                            value={packQtyReturned}
                            onChange={(e) => setPackQtyReturned(e.target.value)}
                            className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notas del Movimiento</label>
                        <input
                          type="text"
                          placeholder="Ej: Furgón de plaza de lunes"
                          value={packNotesText}
                          onChange={(e) => setPackNotesText(e.target.value)}
                          className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-extrabold cursor-pointer transition shadow"
                      >
                        {loading ? "Procesando..." : "Registrar Logística"}
                      </button>
                    </form>
                  </div>
                </div>

                {/* LOG TRANSACTION TABLE */}
                <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col">
                  <h4 className="text-base font-bold text-slate-800 mb-1">Historial de Envases de {selectedSupplier}</h4>
                  <p className="text-slate-400 text-xs mb-4">Listado de entregas y devoluciones registradas con este proveedor mayorista.</p>

                  <div className="overflow-x-auto flex-1">
                    {supplierPackagingLogs.length === 0 ? (
                      <p className="text-slate-400 text-xs italic text-center py-20 bg-slate-50 rounded-2xl border border-slate-100">No se registran movimientos de envases o canastillas para este proveedor mayorista.</p>
                    ) : (
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                            <th className="py-2.5 px-2">ID Mov.</th>
                            <th className="py-2.5 px-2">Fecha</th>
                            <th className="py-2.5 px-2">Tipo Activo</th>
                            <th className="py-2.5 px-2 text-center">Entregados</th>
                            <th className="py-2.5 px-2 text-center">Devueltos</th>
                            <th className="py-2.5 px-2">Notas / Comprobación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplierPackagingLogs.map((log) => (
                            <tr key={log.ID_Movimiento} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                              <td className="py-2.5 px-2 font-mono font-bold text-slate-400 text-[10px]">{log.ID_Movimiento}</td>
                              <td className="py-2.5 px-2 text-slate-600">{log.Fecha}</td>
                              <td className="py-2.5 px-2 text-slate-800 font-extrabold">{log.Tipo_Activo}</td>
                              <td className="py-2.5 px-2 text-center text-emerald-600 font-bold">+{log.Cantidad_Entregada}</td>
                              <td className="py-2.5 px-2 text-center text-rose-600 font-bold">-{log.Cantidad_Devuelta}</td>
                              <td className="py-2.5 px-2 text-slate-500 italic font-medium">{log.Notas || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 10. CLOSURES & RECEIPTS */}
        {adminMode === "closures_receipts" && (() => {
          // Filter closures
          const filteredClosuresList = closures.filter((c) => {
            const matchBranch = closuresFilterBranch === "all" || c.Sucursal.toLowerCase().trim() === closuresFilterBranch.toLowerCase().trim();
            const matchDate = !closuresFilterDate || c.Fecha === closuresFilterDate;
            const matchStart = !closuresFilterStartDate || c.Fecha >= closuresFilterStartDate;
            const matchEnd = !closuresFilterEndDate || c.Fecha <= closuresFilterEndDate;
            return matchBranch && matchDate && matchStart && matchEnd;
          }).sort((a, b) => {
            // Fecha en formato YYYY-MM-DD: comparar como texto ya da orden cronológico.
            // Si dos cierres son del mismo día, desempata el ID (lleva la hora de registro).
            const porFecha = (a.Fecha || "").localeCompare(b.Fecha || "");
            const cmp = porFecha !== 0 ? porFecha : (a.ID_Cierre || "").localeCompare(b.ID_Cierre || "");
            return ordenCierresAdmin === "reciente" ? -cmp : cmp;
          });

          // Export closures Excel (.xlsx)
          const handleExportClosuresXLSX = () => {
            const dataRows: any[] = [];

            filteredClosuresList.forEach((c) => {
              const excelDate = formatClosureDateForExcel(c.Fecha);
              
              // Parse individual expenses from Descripcion_Gastos
              const rawExpenses = c.Descripcion_Gastos ? c.Descripcion_Gastos.split(";") : [];
              const parsedExpenses = rawExpenses.map(part => {
                const p = part.trim();
                if (!p) return null;
                const match = p.match(/(.+)\s*\(\$?\s*([\d.,]+)\s*\)/);
                if (match) {
                  const desc = match[1].trim();
                  const priceStr = match[2].replace(/\./g, "").replace(/,/g, "");
                  const value = parseFloat(priceStr) || 0;
                  return { desc, value };
                }
                return { desc: p, value: 0 };
              }).filter(Boolean) as { desc: string; value: number }[];

              // Add rows for individual expenses
              parsedExpenses.forEach(exp => {
                dataRows.push({
                  "FECHA": excelDate,
                  "SUCURSAL": c.Sucursal,
                  "DESCRIPCION": exp.desc,
                  "VENTA TOTAL DIARIA": "",
                  "GASTOS": exp.value,
                  "VENTAS EN EFECTIVO": "ok"
                });
              });

              // Fallback if there are extra expenses but no parsed description matches
              if (parsedExpenses.length === 0 && c.Gastos_Extra > 0) {
                dataRows.push({
                  "FECHA": excelDate,
                  "SUCURSAL": c.Sucursal,
                  "DESCRIPCION": c.Descripcion_Gastos || "Gastos extra de caja menor",
                  "VENTA TOTAL DIARIA": "",
                  "GASTOS": c.Gastos_Extra,
                  "VENTAS EN EFECTIVO": "ok"
                });
              }

              // Add summary row
              const cashOnDay = c.Ventas_Totales - c.Gastos_Extra;
              dataRows.push({
                "FECHA": excelDate,
                "SUCURSAL": c.Sucursal,
                "DESCRIPCION": "Efectivo del dia",
                "VENTA TOTAL DIARIA": c.Ventas_Totales,
                "GASTOS": c.Gastos_Extra,
                "VENTAS EN EFECTIVO": cashOnDay
              });

              // Add an empty separator row
              dataRows.push({
                "FECHA": "",
                "SUCURSAL": "",
                "DESCRIPCION": "",
                "VENTA TOTAL DIARIA": "",
                "GASTOS": "",
                "VENTAS EN EFECTIVO": ""
              });
            });

            // Remove the trailing separator row if present
            if (dataRows.length > 0) {
              dataRows.pop();
            }

            const worksheet = XLSX.utils.json_to_sheet(dataRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Cierres Diarios");
            
            // Adjust column widths automatically
            const maxW = [12, 15, 35, 20, 15, 22];
            worksheet["!cols"] = maxW.map(w => ({ wch: w }));

            XLSX.writeFile(workbook, `Cierres_Diarios_Format_${new Date().toISOString().split("T")[0]}.xlsx`);
          };

          return (
            <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-6">
              <h3 className="text-xl font-bold text-slate-850">Registro de Cierres de Caja y Emisión de Recibos</h3>
              <p className="text-slate-500 text-xs mt-1">Visualice los cierres de caja diarios reportados por cada una de las sucursales y emita recibos de dinero físicos en formato ticket.</p>

              {/* FILTRATION & EXPORT BAR */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filtrar por Sucursal</label>
                    <select
                      value={closuresFilterBranch}
                      onChange={(e) => setClosuresFilterBranch(e.target.value)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-400"
                    >
                      <option value="all">Todas las Sucursales</option>
                      {branches.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filtrar por Fecha</label>
                    <input
                      type="date"
                      value={closuresFilterDate}
                      onChange={(e) => setClosuresFilterDate(e.target.value)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rango Fecha Inicio</label>
                    <input
                      type="date"
                      value={closuresFilterStartDate}
                      onChange={(e) => setClosuresFilterStartDate(e.target.value)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rango Fecha Fin</label>
                    <input
                      type="date"
                      value={closuresFilterEndDate}
                      onChange={(e) => setClosuresFilterEndDate(e.target.value)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-400"
                    />
                  </div>

                  {(closuresFilterBranch !== "all" || closuresFilterDate || closuresFilterStartDate || closuresFilterEndDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setClosuresFilterBranch("all");
                        setClosuresFilterDate("");
                        setClosuresFilterStartDate("");
                        setClosuresFilterEndDate("");
                      }}
                      className="text-xs text-rose-500 hover:underline font-bold mt-4 animate-pulse-once"
                    >
                      Limpiar Filtros
                    </button>
                  )}
                </div>

                <div className="self-end md:self-center">
                  <button
                    type="button"
                    onClick={handleExportClosuresXLSX}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 cursor-pointer transition shadow-xs"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Exportar Cierres a Excel (.xlsx)
                  </button>
                </div>
              </div>

              {/* CLOSURES TABLE CARD */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
                <h4 className="text-lg font-bold text-slate-800 mb-2">Historial de Cierres de Caja</h4>
                <p className="text-slate-400 text-xs mb-6">Listado consolidado de dinero reportado, gastos locales de caja menor y recolección física.</p>

                <div className="overflow-x-auto">
                  {filteredClosuresList.length === 0 ? (
                    <p className="text-slate-400 text-xs italic text-center py-20">No se registran cierres de caja con los filtros seleccionados.</p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-150 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                          <th
                            className="py-3 px-2 cursor-pointer select-none hover:text-slate-600 transition"
                            title="Clic para ordenar por fecha"
                            onClick={() => setOrdenCierresAdmin((o) => (o === "reciente" ? "antiguo" : "reciente"))}
                          >
                            <span className="inline-flex items-center gap-1">
                              Fecha
                              {ordenCierresAdmin === "reciente"
                                ? <ArrowDown className="w-3 h-3 text-emerald-600" />
                                : <ArrowUp className="w-3 h-3 text-emerald-600" />}
                            </span>
                          </th>
                          <th className="py-3 px-2">Sucursal</th>
                          <th className="py-3 px-2">Persona que va a recoger</th>
                          <th className="py-3 px-2 text-right">Ventas Totales</th>
                          <th className="py-3 px-2 text-right">Gastos de Caja Menor (-)</th>
                          <th className="py-3 px-2">Glosas de Gastos (Discriminado)</th>
                          <th className="py-3 px-2 text-right">Efectivo Neto Recibido</th>
                          <th className="py-3 px-2">Estado Recaudación</th>
                          <th className="py-3 px-2 text-center w-28">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredClosuresList.map((c, idx) => {
                          const neto = c.Ventas_Totales - c.Gastos_Extra;
                          return (
                            <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                              <td className="py-3 px-2 text-slate-500 font-semibold">{c.Fecha}</td>
                              <td className="py-3 px-2 font-bold text-slate-800 text-sm">{c.Sucursal}</td>
                              <td className="py-3 px-2 text-slate-600 font-medium">{c.Persona_Recogio}</td>
                              <td className="py-3 px-2 text-right font-mono font-bold text-slate-700">{cop(c.Ventas_Totales)}</td>
                              <td className="py-3 px-2 text-right font-mono text-rose-600">-{cop(c.Gastos_Extra)}</td>
                              <td className="py-3 px-2 text-slate-500 font-medium max-w-sm">
                                <div className="flex flex-col gap-1 w-full max-w-sm">
                                  {(() => {
                                    const rawExpenses = c.Descripcion_Gastos ? c.Descripcion_Gastos.split(";") : [];
                                    const parsed = rawExpenses.map(part => {
                                      const p = part.trim();
                                      if (!p) return null;
                                      const match = p.match(/(.+)\s*\(\$?\s*([\d.,]+)\s*\)/);
                                      if (match) {
                                        const desc = match[1].trim();
                                        const valueStr = match[2];
                                        return { desc, valueStr };
                                      }
                                      return { desc: p, valueStr: "" };
                                    }).filter(Boolean);

                                    if (parsed.length === 0) {
                                      return <span className="text-slate-400 italic">—</span>;
                                    }

                                    return (
                                      <div className="flex flex-wrap gap-1.5">
                                        {parsed.map((item, i) => (
                                          <div key={i} className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-1 rounded-lg border border-slate-200/80 text-[10px] font-bold shadow-xs">
                                            <span className="font-semibold text-slate-700">{item.desc}</span>
                                            {item.valueStr ? (
                                              <span className="font-mono text-[9px] text-rose-600 font-black bg-white px-1 py-0.5 rounded border border-slate-100">
                                                ${item.valueStr}
                                              </span>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}

                                  {c.Foto_Factura && (
                                    <div className="mt-1">
                                      <button
                                        type="button"
                                        onClick={() => setViewingPhotoUrl(c.Foto_Factura)}
                                        title="Ver Factura / Soporte"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-150 rounded-lg cursor-pointer transition shadow-xs text-[10px] font-bold"
                                      >
                                        <Camera className="w-3 h-3" />
                                        Soporte
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-2 text-right font-mono font-extrabold text-emerald-700 text-sm">{cop(neto)}</td>
                              <td className="py-3 px-2">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                  c.Recaudado_Fisico 
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                                    : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}>
                                  {c.Recaudado_Fisico ? "Recolectado Fiel" : "Pendiente de Recojo"}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => setActiveReceipt(c)}
                                    className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-extrabold rounded-lg flex items-center gap-1 cursor-pointer transition shadow-xs"
                                  >
                                    <Receipt className="w-3 h-3" />
                                    Recibo
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingClosure(c);
                                      setEditClosureVentas(formatNumberWithDots(c.Ventas_Totales));
                                      setEditClosureGastos(formatNumberWithDots(c.Gastos_Extra));
                                      setEditClosureDesc(c.Descripcion_Gastos);
                                      setEditClosureRecogio(c.Persona_Recogio);

                                      const rawExpenses = c.Descripcion_Gastos ? c.Descripcion_Gastos.split(";") : [];
                                      const parsed = rawExpenses.map(part => {
                                        const p = part.trim();
                                        if (!p) return null;
                                        const match = p.match(/(.+)\s*\(\$?\s*([\d.,]+)\s*\)/);
                                        if (match) {
                                          const desc = match[1].trim();
                                          const priceStr = match[2].replace(/\D/g, "");
                                          const value = parseFloat(priceStr) || 0;
                                          return { desc, value };
                                        }
                                        return { desc: p, value: 0 };
                                      }).filter(Boolean) as { desc: string; value: number }[];
                                      if (parsed.length === 0 && c.Gastos_Extra > 0) {
                                        parsed.push({ desc: c.Descripcion_Gastos || "Gastos", value: c.Gastos_Extra });
                                      }
                                      setEditClosureExpenseItems(parsed);
                                    }}
                                    className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-extrabold rounded-lg flex items-center gap-1 cursor-pointer transition shadow-xs"
                                  >
                                    <Edit className="w-3 h-3" />
                                    Modificar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* BRANCH MONEDERO HISTORY FOR ADMIN */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h4 className="text-lg font-bold text-slate-800">💰 Historial de Monederos por Sucursal</h4>
                    <p className="text-slate-400 text-xs">Monitoree los saldos acumulados de ventas no recogidas y los gastos directos pagados en cada tienda.</p>
                  </div>
                  <div>
                    <select
                      value={selectedBranchForWalletHistory}
                      onChange={(e) => setSelectedBranchForWalletHistory(e.target.value)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-400"
                    >
                      {branches.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                      {/* El monedero central consolida todas las sucursales, así que
                          no se ofrece a un administrador de una sola. */}
                      {!esAdminDeUnaSucursal && <option value="Central / Nequi">Central / Nequi</option>}
                    </select>
                  </div>
                </div>

                {/* Calculate Branch Balance */}
                {(() => {
                  const sucursalTxs = walletTxs.filter(
                    t => t.Sucursal.toLowerCase().trim() === selectedBranchForWalletHistory.toLowerCase().trim()
                  );

                  // Calculate chronologically sorted running balance
                  const sortedTxs = [...sucursalTxs].sort((a, b) => a.Fecha.localeCompare(b.Fecha));
                  let cumulative = 0;
                  const txsWithRunning = sortedTxs.map(t => {
                    cumulative += t.Tipo_Movimiento === "Ingreso" ? t.Valor : -t.Valor;
                    return { ...t, runningBalance: cumulative };
                  });
                  // Display newest first
                  const displayTxs = [...txsWithRunning].reverse();

                  const isCentral = selectedBranchForWalletHistory.toLowerCase().includes("central") || selectedBranchForWalletHistory.toLowerCase().includes("nequi");

                  const sucursalBalance = sucursalTxs.reduce((sum, t) => {
                    if (isCentral) {
                      return t.Tipo_Movimiento === "Ingreso" ? sum + t.Valor : sum - t.Valor;
                    } else {
                      if (t.Estado === "Pendiente" || !t.Estado) {
                        return t.Tipo_Movimiento === "Ingreso" ? sum + t.Valor : sum - t.Valor;
                      }
                      return sum;
                    }
                  }, 0);

                  return (
                    <div className="space-y-4">
                      <div className="bg-slate-50 p-4 rounded-2xl flex items-center justify-between border border-slate-150">
                        <div>
                          <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Saldo Monedero {selectedBranchForWalletHistory}</span>
                          <h5 className={`text-2xl font-black mt-1 ${sucursalBalance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {cop(sucursalBalance)}
                          </h5>
                        </div>
                        <div className="text-right text-xs text-slate-400 font-medium">
                          Total Movimientos: {sucursalTxs.length}
                        </div>
                      </div>

                      <div className="overflow-x-auto max-h-[300px]">
                        {displayTxs.length === 0 ? (
                          <p className="text-slate-400 text-xs italic text-center py-10">No se registran transacciones para esta sucursal.</p>
                        ) : (
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
                                <th className="py-2.5 px-2">Fecha</th>
                                <th className="py-2.5 px-2">Tipo</th>
                                <th className="py-2.5 px-2 text-right">Monto</th>
                                <th className="py-2.5 px-2 text-right">Saldo</th>
                                <th className="py-2.5 px-2">Descripción</th>
                                <th className="py-2.5 px-2">Responsable</th>
                                <th className="py-2.5 px-2">Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayTxs.map((t: any, idx) => (
                                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50 transition">
                                  <td className="py-2 px-2 text-slate-500 font-semibold">{t.Fecha}</td>
                                  <td className="py-2 px-2">
                                    <span className={`px-2 py-0.5 rounded-full font-bold text-[9px] ${
                                      t.Tipo_Movimiento === "Ingreso" 
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-150" 
                                        : "bg-rose-50 text-rose-700 border border-rose-150"
                                    }`}>
                                      {t.Tipo_Movimiento === "Ingreso" ? "Ingreso" : "Gasto"}
                                    </span>
                                  </td>
                                  <td className={`py-2 px-2 text-right font-mono font-bold ${
                                    t.Tipo_Movimiento === "Ingreso" ? "text-emerald-600" : "text-rose-600"
                                  }`}>
                                    {t.Tipo_Movimiento === "Ingreso" ? "+" : "-"}{cop(t.Valor)}
                                  </td>
                                  <td className="py-2 px-2 text-right font-mono font-bold text-slate-700">
                                    {cop(t.runningBalance)}
                                  </td>
                                  <td className="py-2 px-2 text-slate-600 font-medium max-w-xs truncate" title={t.Descripcion}>
                                    <div className="flex items-center gap-1.5">
                                      <span>{t.Descripcion}</span>
                                      {t.Foto_Factura && (
                                        <button
                                          type="button"
                                          onClick={() => setViewingPhotoUrl(t.Foto_Factura)}
                                          title="Ver Factura / Soporte"
                                          className="p-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-150 rounded-lg inline-flex items-center justify-center cursor-pointer transition shadow-xs"
                                        >
                                          <Camera className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-2 text-slate-500">{t.Responsable}</td>
                                  <td className="py-2 px-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                      t.Estado === "Reconciliado" 
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-150" 
                                        : "bg-amber-50 text-amber-700 border border-amber-150"
                                    }`}>
                                      {t.Estado === "Reconciliado" ? "Confirmado / Reconciliado" : "Pendiente de Recojo"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}

        {/* HISTORIAL DE MONEDEROS SEC */}
      </div>

      {/* VIEW PHOTO/INVOICE MODAL */}
      <AnimatePresence>
        {viewingPhotoUrl && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[150] p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-2xl w-full border border-slate-100 shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setViewingPhotoUrl(null)}
                className="absolute top-4 right-4 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-full cursor-pointer transition text-xs font-black shadow-sm"
              >
                ✕ Cerrar
              </button>
              <h4 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-1.5 uppercase tracking-wider">
                📸 Soporte de Pago / Factura Adjunta
              </h4>
              <div className="flex justify-center bg-slate-50 p-4 rounded-2xl border border-slate-100 overflow-hidden max-h-[70vh]">
                <img
                  src={viewingPhotoUrl}
                  alt="Factura o Comprobante"
                  className="max-h-[60vh] object-contain rounded-xl shadow-md"
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* POPUP SCHEDULE ASSIGNMENT MODAL */}
      <AnimatePresence>
        {scheduleModalOpen && selectedDayForSchedule && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl max-w-sm w-full space-y-4"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="font-extrabold text-slate-800 text-sm">Programar Turno de Trabajo</h4>
                  <p className="text-[10px] text-slate-500 font-bold">Fecha: {selectedDayForSchedule}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-xl transition text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Empleado</label>
                  <select
                    value={schedFormEmployee}
                    onChange={(e) => setSchedFormEmployee(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-extrabold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {employees.map((emp) => (
                      <option key={emp} value={emp}>{emp}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sucursal / Rol</label>
                  <select
                    value={schedFormStore}
                    onChange={(e) => {
                      const store = e.target.value;
                      setSchedFormStore(store);
                      // Automatically load standard hours based on the assigned branch
                      if (store === "Descanso") {
                        setSchedFormHours("0");
                      } else if (store === "Aquitania") {
                        setSchedFormHours("9.5");
                      } else {
                        setSchedFormHours("8");
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-extrabold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {availableStores.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Horas de Trabajo</label>
                    <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase border border-emerald-150">
                      Calculadora Activa
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.5"
                    value={schedFormHours}
                    onChange={(e) => setSchedFormHours(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-sm"
                  />
                  {parseFloat(schedFormHours) > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-lg font-extrabold">
                        Ordinarias: {Math.min(8, parseFloat(schedFormHours) || 0)}h
                      </span>
                      {parseFloat(schedFormHours) > 8 && (
                        <span className="bg-amber-100 text-amber-800 border border-amber-200/50 px-2.5 py-0.5 rounded-lg font-black animate-pulse">
                          Extras (+25%): {Math.max(0, (parseFloat(schedFormHours) || 0) - 8)}h
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await handleSaveCalendarSchedule(
                      selectedDayForSchedule,
                      schedFormEmployee,
                      schedFormStore,
                      parseFloat(schedFormHours) || 8
                    );
                    setScheduleModalOpen(false);
                  }}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-xl text-xs font-black transition cursor-pointer"
                >
                  Asignar Turno
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PRINTABLE RECEIPT MODAL OVERLAY */}
      <AnimatePresence>
        {activeReceipt && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-300 shadow-2xl flex flex-col justify-between"
            >
              {/* Receipt Ticket Box */}
              <div id="printable-ticket" className="p-4 border border-dashed border-slate-300 bg-slate-50/50 rounded-2xl font-mono text-slate-800 text-xs leading-relaxed space-y-4">
                
                {/* Isolated Corporate Branding - strictly isolated at the very top block with an unyielding 25px bottom margin */}
                <div style={{ textAlign: "center", marginBottom: "25px" }} className="border-b border-dashed border-slate-300 pb-3 flex flex-col items-center">
                  <img src="/logo_al_paso.png" className="max-h-12 w-auto mb-2 object-contain" alt="🍒 Al Paso" />
                  <h1 style={{ margin: "0 0 4px 0", fontSize: "18px", fontWeight: 800, color: "#1e293b", textTransform: "uppercase" }}>
                    Al Paso
                  </h1>
                  <h2 style={{ margin: "0", fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    MERCADO CAMPESINO
                  </h2>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold text-[10px] uppercase">Sucursal:</span>
                    <span className="font-bold text-slate-800">{activeReceipt.Sucursal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold text-[10px] uppercase">Fecha:</span>
                    <span className="font-semibold text-slate-700">{activeReceipt.Fecha}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold text-[10px] uppercase">Persona que va a recoger:</span>
                    <span className="font-semibold text-slate-700">{activeReceipt.Persona_Recogio}</span>
                  </div>
                </div>

                <div className="border-t border-dashed border-slate-300 pt-3 space-y-1.5">
                  <div className="flex justify-between text-slate-700">
                    <span>Ventas Declaradas:</span>
                    <span className="font-bold">{cop(activeReceipt.Ventas_Totales)}</span>
                  </div>
                  <div className="flex justify-between text-rose-600">
                    <span>Gastos de Caja Menor:</span>
                    <span className="font-bold">-{cop(activeReceipt.Gastos_Extra)}</span>
                  </div>
                  {activeReceipt.Descripcion_Gastos && (
                    <div className="text-[10px] text-slate-500 bg-slate-100 p-2 rounded-xl mt-1 leading-normal border border-slate-200">
                      <strong>Glosa Gastos:</strong> {activeReceipt.Descripcion_Gastos}
                    </div>
                  )}
                </div>

                <div className="border-t border-dashed border-slate-300 pt-3">
                  <div className="flex justify-between text-sm font-black text-slate-900 bg-emerald-50 p-2 rounded-xl border border-emerald-200">
                    <span className="text-emerald-800">EFECTIVO NETO:</span>
                    <span className="text-emerald-800 font-mono">{cop(activeReceipt.Ventas_Totales - activeReceipt.Gastos_Extra)}</span>
                  </div>
                </div>

                <div className="pt-8 space-y-6 text-center text-[10px]">
                  <div className="border-b border-slate-300 w-32 mx-auto" />
                  <span className="text-slate-400 block uppercase font-bold">Firma Autorizada Admin</span>

                  <div className="border-b border-slate-300 w-32 mx-auto pt-4" />
                  <span className="text-slate-400 block uppercase font-bold">Firma de Cajero/a Sucursal</span>

                  <div className="pt-4 text-center font-bold text-[11px] text-slate-600 border-t border-dashed border-slate-300 pt-3">
                    AL PASO - MERCADO CAMPESINO
                    <span className="block text-[8px] font-normal text-slate-400 mt-1">FRUVER ENGINE v9.0 MASTER EDITION</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 mt-5">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const printContents = document.getElementById("printable-ticket")?.innerHTML;
                      const originalContents = document.body.innerHTML;
                      if (printContents) {
                        const printWindow = window.open("", "_blank");
                        if (printWindow) {
                          printWindow.document.write(`
                            <html>
                              <head>
                                <title>Recibo Al Paso</title>
                                <style>
                                  body { font-family: monospace; color: #1e293b; padding: 20px; max-width: 300px; margin: 0 auto; }
                                  #ticket { border: 1px dashed #cbd5e1; padding: 15px; border-radius: 8px; }
                                  .text-slate-400 { color: #64748b; }
                                  .font-bold { font-weight: bold; }
                                  .font-mono { font-family: monospace; }
                                  .text-emerald-800 { color: #065f46; }
                                  .bg-emerald-50 { background-color: #ecfdf5; padding: 6px; border-radius: 6px; border: 1px solid #a7f3d0; }
                                  .flex { display: flex; justify-content: space-between; margin-bottom: 4px; }
                                  .border-t { border-top: 1px dashed #cbd5e1; margin-top: 10px; padding-top: 10px; }
                                  .border-b { border-bottom: 1px solid #94a3b8; }
                                  .pt-8 { padding-top: 30px; }
                                  .space-y-6 { margin-bottom: 15px; }
                                  .text-center { text-align: center; }
                                  .block { display: block; }
                                  .w-32 { width: 130px; }
                                  .mx-auto { margin-left: auto; margin-right: auto; }
                                </style>
                              </head>
                              <body>
                                <div id="ticket">${printContents}</div>
                                <script>
                                  window.onload = function() { window.print(); window.close(); }
                                </script>
                              </body>
                            </html>
                          `);
                          printWindow.document.close();
                        }
                      }
                    }}
                    className="w-1/2 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black rounded-xl flex justify-center items-center gap-1 cursor-pointer transition shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Imprimir Ticket
                  </button>
                  
                  <button
                    onClick={() => setActiveReceipt(null)}
                    className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-extrabold rounded-xl cursor-pointer transition"
                  >
                    Cerrar
                  </button>
                </div>

                <button
                  onClick={async () => {
                    const node = document.getElementById("printable-ticket");
                    if (node) {
                      try {
                        const dataUrl = await toPng(node, { backgroundColor: "#ffffff" });
                        const link = document.createElement("a");
                        link.download = `Cierre_Caja_${activeReceipt.Sucursal}_${activeReceipt.Fecha}.png`;
                        link.href = dataUrl;
                        link.click();
                      } catch (error) {
                        console.error("Error generating receipt PNG:", error);
                        alert("Error al exportar el ticket como imagen PNG.");
                      }
                    }
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl flex justify-center items-center gap-1.5 cursor-pointer transition shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar Ticket PNG
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* RECIBO DE PRECIOS NUEVOS PARA LAS SUCURSALES
          Solo lleva el precio de venta: la sucursal no debe conocer el costo de
          compra ni el porcentaje de ganancia. */}
      <AnimatePresence>
        {showPriceReceipt && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-sm my-8 overflow-hidden shadow-2xl"
            >
              {/* Esto es lo que se convierte en imagen */}
              <div id="recibo-precios" className="bg-white p-6">
                <div className="text-center border-b-2 border-dashed border-slate-300 pb-4 mb-4">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">AL PASO</h3>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                    Mercado Campesino
                  </p>
                  <div className="mt-3 inline-block bg-violet-100 text-violet-900 px-3 py-1 rounded-full">
                    <p className="text-[11px] font-black uppercase tracking-wide">Precios de venta actualizados</p>
                  </div>
                  <p className="text-[11px] font-bold text-slate-600 mt-2">{matrixDate}</p>
                </div>

                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-200">
                      <th className="pb-1.5">Producto</th>
                      <th className="pb-1.5 text-right">Antes</th>
                      <th className="pb-1.5 text-right">Ahora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosConPrecioNuevo.map((p) => {
                      const subio = p.ventaNueva > p.ventaAnterior;
                      return (
                        <tr key={p.Codigo} className="border-b border-slate-100">
                          <td className="py-1.5 pr-2">
                            <span className="font-bold text-slate-800 text-[12px] leading-tight block">
                              {p.Producto}
                            </span>
                            <span className="text-[9px] text-slate-400 font-semibold">{p.Medida}</span>
                          </td>
                          <td className="py-1.5 text-right text-slate-400 line-through font-semibold text-[11px] whitespace-nowrap">
                            {cop(p.ventaAnterior)}
                          </td>
                          <td
                            className={`py-1.5 text-right font-black text-[13px] whitespace-nowrap ${
                              subio ? "text-rose-600" : "text-emerald-600"
                            }`}
                          >
                            {cop(p.ventaNueva)}
                            <span className="ml-0.5 text-[9px]">{subio ? "▲" : "▼"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="border-t-2 border-dashed border-slate-300 mt-4 pt-3 text-center">
                  <p className="text-[11px] font-black text-slate-700">
                    {productosConPrecioNuevo.length} producto(s) con precio nuevo
                  </p>
                  <p className="text-[9px] text-slate-400 font-semibold mt-1">
                    Estos son los precios de venta al público. Aplican desde hoy.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 space-y-2">
                <button
                  onClick={async () => {
                    const node = document.getElementById("recibo-precios");
                    if (!node) return;
                    try {
                      const dataUrl = await toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2 });
                      const link = document.createElement("a");
                      link.download = `Precios_Nuevos_${matrixDate}.png`;
                      link.href = dataUrl;
                      link.click();
                      setSuccessMsg("Imagen de precios descargada. Ya puedes enviarla por WhatsApp.");
                    } catch (error) {
                      console.error("Error generando la imagen de precios:", error);
                      setErrorMsg("No se pudo generar la imagen. Intenta de nuevo.");
                    }
                  }}
                  className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-black rounded-xl flex justify-center items-center gap-1.5 cursor-pointer transition shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar imagen para enviar
                </button>
                <button
                  onClick={() => setShowPriceReceipt(false)}
                  className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-extrabold rounded-xl cursor-pointer transition"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PROVIDER PENDING ACCOUNTS RECEIPT MODAL OVERLAY */}
      <AnimatePresence>
        {activeProviderReceipt && (() => {
          // Helper to format decimal quantities as fractions
          const formatQuantityWithFractions = (val: number): string => {
            if (val <= 0) return "0";
            const integerPart = Math.floor(val);
            const decimalPart = val - integerPart;

            const eps = 0.015;

            let fractionStr = "";
            if (Math.abs(decimalPart) < eps) {
              fractionStr = "";
            } else if (Math.abs(decimalPart - 0.5) < eps) {
              fractionStr = "1/2";
            } else if (Math.abs(decimalPart - 0.25) < eps) {
              fractionStr = "1/4";
            } else if (Math.abs(decimalPart - 0.75) < eps) {
              fractionStr = "3/4";
            } else if (Math.abs(decimalPart - 0.3333) < eps || Math.abs(decimalPart - 0.33) < eps) {
              fractionStr = "1/3";
            } else if (Math.abs(decimalPart - 0.6666) < eps || Math.abs(decimalPart - 0.67) < eps) {
              fractionStr = "2/3";
            } else if (Math.abs(decimalPart - 0.125) < eps) {
              fractionStr = "1/8";
            } else if (Math.abs(decimalPart - 0.375) < eps) {
              fractionStr = "3/8";
            } else if (Math.abs(decimalPart - 0.625) < eps) {
              fractionStr = "5/8";
            } else if (Math.abs(decimalPart - 0.875) < eps) {
              fractionStr = "7/8";
            } else {
              const formattedDec = Number(decimalPart.toFixed(2));
              if (formattedDec > 0) {
                return val.toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1");
              }
            }

            if (integerPart > 0) {
              return fractionStr ? `${integerPart} ${fractionStr}` : `${integerPart}`;
            } else {
              return fractionStr || "0";
            }
          };

          // Helper to group and sum up product orders to pay consolidated
          const consolidateProducts = (orders: any[]) => {
            const consolidated: {
              [key: string]: {
                producto: string;
                medida: string;
                costo: number;
                cantidadComprada: number;
                cantidadEstimada: number;
                tieneComprados: boolean;
                tienePendientes: boolean;
              }
            } = {};

            orders.forEach((o) => {
              const prodName = o.Producto || "Sin Producto";
              const measure = o.Medida || "Kg";
              const cost = o.Costo_Momento || 0;
              const key = `${prodName.toLowerCase().trim()}||${cost}||${measure.toLowerCase().trim()}`;

              const qtyComprada = o.Cantidad_Comprada || 0;
              const qtyEstimada = parseQty(o.Cantidad) || 0;

              if (!consolidated[key]) {
                consolidated[key] = {
                  producto: prodName,
                  medida: measure,
                  costo: cost,
                  cantidadComprada: 0,
                  cantidadEstimada: 0,
                  tieneComprados: false,
                  tienePendientes: false,
                };
              }

              consolidated[key].cantidadComprada += qtyComprada;
              consolidated[key].cantidadEstimada += qtyEstimada;
              if (o.Estado === "Comprado" && qtyComprada > 0) {
                consolidated[key].tieneComprados = true;
              } else if (o.Estado === "Pendiente") {
                consolidated[key].tienePendientes = true;
              }
            });

            return Object.values(consolidated);
          };

          const compileWhatsAppTextForProviderReceipt = (receipt: any) => {
            if (!receipt) return "";
            let text = `*AL PASO - RECIBO DE CUENTA* 🧾\n`;
            text += `*Fecha:* ${accountsDate}\n`;
            text += `*Proveedor:* ${receipt.proveedor}\n`;
            text += `----------------------------------\n`;
            text += `*DETALLE DE COMPRAS COMPROMETIDAS:*\n\n`;

            const consolidated = consolidateProducts(receipt.orders);

            consolidated.forEach((item) => {
              const unit = item.costo;
              if (item.cantidadComprada > 0) {
                const total = item.cantidadComprada * unit;
                const qtyStr = formatQuantityWithFractions(item.cantidadComprada);
                text += `• *${item.producto}*: ${qtyStr} ${item.medida} x ${cop(unit)} = *${cop(total)}*\n`;
              } else if (item.tienePendientes && item.cantidadEstimada > 0) {
                const qtyStr = formatQuantityWithFractions(item.cantidadEstimada);
                text += `• *${item.producto}* (Pendiente): ${qtyStr} ${item.medida} x ${cop(unit)} (Por confirmar)\n`;
              }
            });

            text += `\n----------------------------------\n`;
            text += `💰 *TOTAL REAL HOY:* ${cop(receipt.totalReal)}\n`;
            if (receipt.totalEstimado > 0) {
              text += `⏳ *VALOR PENDIENTE POR REVISAR:* ${cop(receipt.totalEstimado)}\n`;
            }
            text += `\n¡Muchas gracias por su excelente servicio! 🙏🍏`;
            return text;
          };

          return (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-3xl p-6 max-w-md w-full border border-slate-300 shadow-2xl flex flex-col justify-between"
              >
                {/* Receipt Ticket Box */}
                <div 
                  id="provider-printable-ticket" 
                  className="p-6 border border-dashed border-slate-300 bg-slate-50/50 rounded-2xl font-mono text-slate-800 text-xs leading-relaxed space-y-4"
                >
                  {/* Isolated Corporate Branding */}
                  <div style={{ textAlign: "center", marginBottom: "20px" }} className="border-b border-dashed border-slate-300 pb-3 flex flex-col items-center">
                    <img src="/logo_al_paso.png" className="max-h-12 w-auto mb-2 object-contain" alt="🍒 Al Paso" />
                    <h1 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: 800, color: "#1e293b", textTransform: "uppercase" }}>
                      Al Paso
                    </h1>
                    <h2 style={{ margin: "0", fontSize: "10px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      MERCADO CAMPESINO
                    </h2>
                  </div>

                  {/* Provider Info */}
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold text-[10px] uppercase">Proveedor:</span>
                      <span className="font-bold text-slate-800 text-[13px]">{activeProviderReceipt.proveedor}</span>
                    </div>
                    {activeProviderReceipt.celular && (
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-bold text-[10px] uppercase">Teléfono:</span>
                        <span className="font-bold text-slate-800">{activeProviderReceipt.celular}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-bold text-[10px] uppercase">Fecha de Cuenta:</span>
                      <span className="font-semibold text-slate-700">{accountsDate}</span>
                    </div>
                  </div>

                  {/* Purchase Details */}
                  <div className="border-t border-dashed border-slate-300 pt-3 space-y-3">
                    <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Detalle de Productos Adquiridos:</span>
                    
                    {activeProviderReceipt.orders && activeProviderReceipt.orders.length > 0 ? (
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead>
                          <tr className="text-slate-400 border-b border-dashed border-slate-200">
                            <th className="font-semibold pb-1 text-left">Prod.</th>
                            <th className="font-semibold pb-1 text-right">Cant.</th>
                            <th className="font-semibold pb-1 text-right">Unit.</th>
                            <th className="font-semibold pb-1 text-right">Subt.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {consolidateProducts(activeProviderReceipt.orders).map((item, idx) => {
                            const unit = item.costo;
                            if (item.cantidadComprada > 0) {
                              const total = item.cantidadComprada * unit;
                              const qtyStr = formatQuantityWithFractions(item.cantidadComprada);
                              return (
                                <tr key={idx} className="text-slate-800 border-b border-dotted border-slate-100 last:border-0">
                                  <td className="py-1.5 font-bold">{item.producto}</td>
                                  <td className="py-1.5 text-right font-black text-slate-900">{qtyStr} {item.medida}</td>
                                  <td className="py-1.5 text-right text-slate-600">{cop(unit)}</td>
                                  <td className="py-1.5 text-right font-bold text-slate-900">{cop(total)}</td>
                                </tr>
                              );
                            } else if (item.tienePendientes && item.cantidadEstimada > 0) {
                              const qtyStr = formatQuantityWithFractions(item.cantidadEstimada);
                              return (
                                <tr key={idx} className="text-slate-400 italic border-b border-dotted border-slate-100 last:border-0">
                                  <td className="py-1.5">{item.producto} (Pendiente)</td>
                                  <td className="py-1.5 text-right">{qtyStr} {item.medida}</td>
                                  <td className="py-1.5 text-right">{cop(unit)}</td>
                                  <td className="py-1.5 text-right">—</td>
                                </tr>
                              );
                            }
                            return null;
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-[10px] text-slate-400 text-center py-2">
                        No hay ítems detallados para este proveedor hoy.
                      </div>
                    )}
                  </div>

                  {/* Subtotals & Totals Block */}
                  <div className="border-t border-dashed border-slate-300 pt-3 space-y-1.5">
                    <div className="flex justify-between text-slate-700">
                      <span>Subtotal de Compras Realizadas:</span>
                      <span className="font-bold">{cop(activeProviderReceipt.totalReal)}</span>
                    </div>
                    {activeProviderReceipt.totalEstimado > 0 && (
                      <div className="flex justify-between text-amber-600">
                        <span>Pendiente por Confirmar:</span>
                        <span className="font-bold">{cop(activeProviderReceipt.totalEstimado)}</span>
                      </div>
                    )}
                    
                    <div className="border-t border-dashed border-slate-300 pt-2 flex justify-between text-slate-900 font-extrabold text-[13px]">
                      <span className="uppercase tracking-wider">Total Cuenta:</span>
                      <span className="text-emerald-700">{cop(activeProviderReceipt.totalReal)}</span>
                    </div>
                  </div>

                  {/* Simulated Barcode for Aesthetic Detail */}
                  <div className="flex flex-col items-center pt-3 border-t border-dashed border-slate-200">
                    <div className="flex gap-0.5 h-6 bg-white w-full max-w-[200px] justify-center items-center opacity-70">
                      {[3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3, 2, 3, 8, 4].map((v, i) => (
                        <div 
                          key={i} 
                          className="bg-slate-900 h-full" 
                          style={{ width: `${(v % 3) + 1}px` }}
                        />
                      ))}
                    </div>
                    <span className="text-[8px] text-slate-400 tracking-widest mt-1">PROV-{activeProviderReceipt.proveedor.toUpperCase().substring(0, 5)}-{accountsDate}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-5 space-y-2">
                  <button
                    onClick={async () => {
                      const node = document.getElementById("provider-printable-ticket");
                      if (node) {
                        try {
                          const dataUrl = await toPng(node, { backgroundColor: "#ffffff" });
                          const link = document.createElement("a");
                          link.download = `Recibo_Al_Paso_${activeProviderReceipt.proveedor}_${accountsDate}.png`;
                          link.href = dataUrl;
                          link.click();
                        } catch (error) {
                          console.error("Error generating receipt PNG:", error);
                          alert("Error al exportar el ticket como imagen PNG.");
                        }
                      }
                    }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl flex justify-center items-center gap-1.5 cursor-pointer transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Descargar Recibo PNG (Imagen)
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const text = compileWhatsAppTextForProviderReceipt(activeProviderReceipt);
                        const formattedPhone = activeProviderReceipt.celular 
                          ? String(activeProviderReceipt.celular).replace(/\D/g, "") 
                          : "";
                        
                        const finalPhone = (formattedPhone.length === 10 && !formattedPhone.startsWith("57"))
                          ? "57" + formattedPhone
                          : formattedPhone;

                        const url = `https://wa.me/${finalPhone}?text=${encodeURIComponent(text)}`;
                        window.open(url, "_blank");
                      }}
                      className="w-1/2 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-xl flex justify-center items-center gap-1.5 cursor-pointer transition shadow-sm"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      Enviar a WhatsApp
                    </button>

                    <button
                      onClick={() => setActiveProviderReceipt(null)}
                      className="w-1/2 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-extrabold rounded-xl cursor-pointer transition"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* EDIT CLOSURE MODAL OVERLAY */}
      <AnimatePresence>
        {editingClosure && (
          <div className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full border border-slate-200 shadow-2xl space-y-4"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-1.5">
                    <span>✍️ Modificar Cierre de Caja</span>
                  </h3>
                  <p className="text-slate-400 text-xs mt-0.5">{editingClosure.Sucursal} — {editingClosure.Fecha}</p>
                </div>
                <button
                  onClick={() => setEditingClosure(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Ventas Totales ($)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editClosureVentas}
                    onChange={(e) => setEditClosureVentas(formatNumberWithDots(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 font-mono text-sm font-semibold text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Gastos de Caja Menor ($)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editClosureGastos}
                    onChange={(e) => setEditClosureGastos(formatNumberWithDots(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl focus:outline-none font-mono text-sm font-semibold text-slate-700"
                    placeholder="0"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Suma automática calculada a partir del desglose de gastos.</p>
                </div>

                {/* DESGLOSE DINÁMICO DE GASTOS */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/60 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Desglose de Gastos Individuales</span>
                    <button
                      type="button"
                      onClick={handleAddExpenseItem}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[9px] font-extrabold cursor-pointer transition flex items-center gap-1 shadow-xs"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      Añadir Gasto
                    </button>
                  </div>

                  {editClosureExpenseItems.length === 0 ? (
                    <div className="text-center py-4 bg-white rounded-xl border border-dashed border-slate-200">
                      <p className="text-slate-400 text-[11px] italic">No hay gastos individuales agregados.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {editClosureExpenseItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="Descripción (ej: Bombas)"
                            value={item.desc}
                            onChange={(e) => handleUpdateExpenseItem(idx, { ...item, desc: e.target.value })}
                            className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-slate-400"
                          />
                          <div className="relative w-28">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-[10px] font-bold">$</span>
                            <input
                              type="text"
                              placeholder="Valor"
                              value={formatNumberWithDots(item.value)}
                              onChange={(e) => {
                                const rawVal = parseFloat(e.target.value.replace(/\D/g, "")) || 0;
                                handleUpdateExpenseItem(idx, { ...item, value: rawVal });
                              }}
                              className="w-full pl-5 pr-2 py-1.5 bg-white border border-slate-200 rounded-xl font-mono text-[11px] text-right font-bold text-slate-700 focus:outline-none focus:border-slate-400"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveExpenseItem(idx)}
                            className="p-1.5 bg-white hover:bg-rose-50 text-rose-500 hover:text-rose-700 rounded-xl border border-slate-200 hover:border-rose-200 transition cursor-pointer"
                            title="Eliminar Gasto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Glosas de Gastos / Conceptos (Separados por ;)
                  </label>
                  <textarea
                    rows={2}
                    value={editClosureDesc}
                    onChange={(e) => setEditClosureDesc(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-xs font-semibold text-slate-700"
                    placeholder="Ej: Bombas ($5.000); Flete ($15.000)"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Persona que Recogió / Va a recoger
                  </label>
                  <input
                    type="text"
                    value={editClosureRecogio}
                    onChange={(e) => setEditClosureRecogio(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 font-semibold text-slate-700"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingClosure(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition text-center"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveClosureEdit}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-850 text-white rounded-xl text-xs font-bold cursor-pointer transition text-center"
                >
                  {loading ? "Guardando..." : "Guardar Cambios"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MANAGEMENT & RE-CONFIRMATION MODAL OVERLAY */}
      <AnimatePresence>
        {selectedBranchForReconcile && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-2xl w-full border border-slate-300 shadow-2xl flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-xl font-bold text-slate-850 flex items-center gap-1.5">
                      <span>🏪 Menú Re-confirmación: {selectedBranchForReconcile}</span>
                    </h3>
                    <p className="text-slate-400 text-xs mt-0.5">Gestione, cambie estados o re-confirme recibos de cierres diarios para esta sucursal de manera directa.</p>
                  </div>
                  <button 
                    onClick={() => setSelectedBranchForReconcile(null)}
                    className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Statistics banner */}
                <div className="grid grid-cols-2 gap-4 my-5 p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold">Total Pendiente en Tienda</span>
                    <span className="text-xl font-black text-amber-600">
                      {cop(calculateBranchUncollected(closures, walletTxs, selectedBranchForReconcile))}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold">Total Recaudado</span>
                    <span className="text-xl font-black text-emerald-600">
                      {cop(
                        calculateReconciledClosuresSum(
                          closures.filter(c => c.Sucursal.toLowerCase().trim() === selectedBranchForReconcile.toLowerCase().trim())
                        )
                      )}
                    </span>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Historial de Cierres Diarios Registrados</h4>
                  
                  {closures.filter(c => c.Sucursal.toLowerCase().trim() === selectedBranchForReconcile.toLowerCase().trim()).length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-6">No se registran cierres de caja para esta sucursal.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {closures
                        .filter(c => c.Sucursal.toLowerCase().trim() === selectedBranchForReconcile.toLowerCase().trim())
                        .sort((a, b) => b.Fecha.localeCompare(a.Fecha))
                        .map((c, idx) => {
                          const neto = c.Ventas_Totales - c.Gastos_Extra;
                          return (
                            <div key={idx} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-slate-300 transition">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-800">{c.Fecha}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                    c.Recaudado_Fisico 
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                      : "bg-amber-50 text-amber-700 border border-amber-100"
                                  }`}>
                                    {c.Recaudado_Fisico ? "Recibido / Caja Central" : "Pendiente en Tienda"}
                                  </span>
                                </div>
                                <div className="flex gap-4 text-[11px] text-slate-500">
                                  <span>Ventas: <strong className="text-slate-700">{cop(c.Ventas_Totales)}</strong></span>
                                  <span>Gastos: <strong className="text-rose-600">-{cop(c.Gastos_Extra)}</strong></span>
                                  <span>Neto: <strong className="text-slate-800">{cop(neto)}</strong></span>
                                </div>
                                {c.Descripcion_Gastos && (
                                  <div className="text-[10px] text-slate-400 italic bg-slate-50 px-2 py-0.5 rounded border border-slate-100 inline-block">
                                    Nota: {c.Descripcion_Gastos}
                                  </div>
                                )}
                              </div>

                              <button
                                onClick={() => handleToggleSingleClosureReconcile(c.Fecha, c.Sucursal, c.Recaudado_Fisico)}
                                disabled={reconcileModalLoading}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition cursor-pointer flex items-center gap-1 border ${
                                  c.Recaudado_Fisico
                                    ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                }`}
                              >
                                {c.Recaudado_Fisico ? (
                                  <>
                                    <X className="w-3 h-3" />
                                    Cambiar a Pendiente
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3 h-3" />
                                    Confirmar Recibo
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2.5 mt-6 pt-4 border-t border-slate-100 justify-end">
                {getBranchPendingCount(selectedBranchForReconcile) > 0 && (
                  <button
                    onClick={() => {
                      setCustomConfirm({
                        isOpen: true,
                        title: "Recaudar Cierres en Lote",
                        message: `¿Confirma que desea recibir TODOS los cierres pendientes de ${selectedBranchForReconcile} en lote?`,
                        onConfirm: async () => {
                          await handleBulkReconcile(selectedBranchForReconcile);
                          setSelectedBranchForReconcile(null);
                        }
                      });
                    }}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-sm transition flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Confirmar Todo lo Pendiente
                  </button>
                )}
                <button
                  onClick={() => setSelectedBranchForReconcile(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cerrar Ventana
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Off-screen elements for PNG generation */}
      <div ref={rosterCaptureRef} className="absolute -left-[9999px] top-[-9999px] bg-white p-10 w-[1080px] text-slate-800 flex flex-col items-center">
        <div className="flex flex-col items-center border-b-4 border-emerald-500 pb-5 w-full mb-6 text-center">
          <img src="/logo_al_paso.png" className="max-h-[85px] w-auto mb-3" alt="🍒 Al Paso Mercado Campesino" />
          <span className="text-slate-400 text-sm font-semibold tracking-wider uppercase">Horario y Distribución de Turnos Semanal</span>
          <h2 className="text-2xl font-black text-slate-800 uppercase mt-1">PROGRAMACIÓN DE PERSONAL (SIN HORAS)</h2>
        </div>
        
        <table className="w-full border-collapse border border-slate-200">
          <thead>
            <tr className="bg-slate-50">
              <th className="border border-slate-200 py-3 px-4 text-left font-bold text-xs uppercase tracking-wider text-slate-500 w-[180px]">Empleado</th>
              {daysOfWeek.map((day) => (
                <th key={day} className="border border-slate-200 py-3 px-4 text-center font-bold text-xs uppercase tracking-wider text-slate-500">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rates.map((r, rIdx) => {
              const emp = r.Empleado;
              const roster = weeklyRoster[emp] || {};
              return (
                <tr key={`${emp}-${rIdx}`} className="border-b border-slate-200 hover:bg-slate-50/20 transition">
                  <td className="border border-slate-200 py-4 px-4 font-extrabold text-slate-800 text-sm bg-slate-50">{emp}</td>
                  {daysOfWeek.map((day) => {
                    const cell = roster[day] || { sucursal: "Descanso" };
                    let bg = "bg-slate-100 text-slate-600 border-slate-200";
                    if (cell.sucursal === "Plaza") bg = "bg-emerald-50 text-emerald-700 border-emerald-200";
                    else if (cell.sucursal === "Nobsa") bg = "bg-blue-50 text-blue-700 border-blue-200";
                    else if (cell.sucursal === "Tibasosa") bg = "bg-pink-50 text-pink-700 border-pink-200";
                    else if (cell.sucursal === "Fira") bg = "bg-orange-50 text-orange-700 border-orange-200";
                    else if (cell.sucursal === "Aquitania") bg = "bg-purple-50 text-purple-700 border-purple-200";
                    else if (cell.sucursal === "Hansel") bg = "bg-red-50 text-red-700 border-red-200";
                    
                    return (
                      <td key={day} className="border border-slate-200 py-3 px-3 text-center">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${bg}`}>
                          {cell.sucursal}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        
        <div className="mt-8 text-center text-slate-400 text-xs font-semibold">
          🍒 AL PASO MERCADO CAMPESINO - Generado el {new Date().toLocaleDateString("es-CO")}
        </div>
      </div>

      {captureReceiptData && (
        <div ref={receiptCaptureRef} className="absolute -left-[9999px] top-[-9999px] bg-white p-8 w-[400px] text-slate-800 flex flex-col font-mono border border-slate-200">
          <div className="flex flex-col items-center mb-6 text-center">
            <img src="/logo_al_paso.png" className="max-w-[140px] h-auto mb-2" alt="🍒 AL PASO" />
            <h3 className="text-base font-bold text-slate-800 tracking-tight">Recibo Individual de Pago</h3>
          </div>
          
          <div className="border-b border-dashed border-slate-300 pb-3 mb-4 text-xs space-y-1">
            <div><strong>Colaborador:</strong> {captureReceiptData.emp}</div>
            <div><strong>Fecha Liquidación:</strong> {new Date().toLocaleDateString("es-CO")}</div>
            <div><strong>Días Liquidados:</strong> {captureReceiptData.result.daysWorked} días</div>
            <div><strong>Horas Ordinarias:</strong> {captureReceiptData.result.standardHours} h</div>
            <div><strong>Horas Extras:</strong> {captureReceiptData.result.overtimeHours} h</div>
          </div>
          
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span>Sueldo Ordinario ({captureReceiptData.result.daysWorked} d):</span>
              <span>{cop(captureReceiptData.result.basePay)}</span>
            </div>
            {captureReceiptData.result.overtimeHours > 0 && (
              <div className="flex justify-between">
                <span>Horas Extras ({captureReceiptData.result.overtimeHours} h):</span>
                <span>+{cop(captureReceiptData.result.extraPay)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Auxilio de Transporte:</span>
              <span>+{cop(captureReceiptData.result.transportAllowance)}</span>
            </div>
            <div className="flex justify-between font-bold border-t border-dashed border-slate-400 pt-2 mt-2">
              <span>Sueldo Bruto Devengado:</span>
              <span>{cop(captureReceiptData.result.grossPay)}</span>
            </div>
            
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pt-3 pb-1">Deducciones Legales y Adelantos</div>
            <div className="flex justify-between">
              <span>Salud (4%):</span>
              <span>-{cop(captureReceiptData.result.healthDeduction)}</span>
            </div>
            <div className="flex justify-between">
              <span>Pensión (4%):</span>
              <span>-{cop(captureReceiptData.result.pensionDeduction)}</span>
            </div>
            {captureReceiptData.result.totalLoansDeducted > 0 && (
              <div className="flex justify-between">
                <span>Descuento de Préstamos:</span>
                <span>-{cop(captureReceiptData.result.totalLoansDeducted)}</span>
              </div>
            )}
            
            <div className="flex justify-between font-black text-sm border-t-2 border-b-2 border-slate-800 py-2.5 mt-3 text-slate-950 bg-slate-50 px-1">
              <span>TOTAL NETO A PAGAR:</span>
              <span>{cop(captureReceiptData.result.totalNet)}</span>
            </div>
            
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pt-3 pb-1">Distribución Centros de Costo</div>
            {Object.entries(captureReceiptData.result.storeSplits).map(([store, info]: any) => (
              <div key={store} className="flex justify-between text-[10px] text-slate-600">
                <span>🏪 {store} ({info.daysInBranch || 0} d):</span>
                <span>{cop(info.totalShare)}</span>
              </div>
            ))}
          </div>
          
          <div className="mt-10 border-t border-slate-400 pt-4 text-center text-[10px] text-slate-500">
            Firma del Trabajador<br />
            C.C. ___________________
          </div>
        </div>
      )}

      {/* MODAL: ADD ORDER / PRODUCT */}
      <AnimatePresence>
        {showAddOrderModal && (
          <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-150 flex justify-between items-center bg-slate-50">
                <div>
                  <h3 className="text-lg font-bold text-slate-850 text-slate-900">Añadir Producto Adicional a Pedidos</h3>
                  <p className="text-slate-500 text-xs mt-0.5 font-bold">Fecha activa: <span className="font-extrabold text-indigo-600">{matrixDate}</span></p>
                </div>
                <button
                  onClick={() => setShowAddOrderModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-650 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-5 flex-1 scrollbar-thin">
                {/* 1. PRODUCT SELECTOR */}
                <div>
                  <label className="block text-xs font-black text-slate-600 uppercase tracking-wide mb-2">1. Seleccionar Producto del Catálogo</label>
                  
                  {!selectedProductForNewOrder ? (
                    <div className="space-y-3">
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                          <Search className="w-4 h-4 text-slate-500" />
                        </span>
                        <input
                          type="text"
                          placeholder="Buscar por nombre o código de producto..."
                          value={newOrderSearchQuery}
                          onChange={(e) => setNewOrderSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-750 focus:outline-none focus:border-indigo-500 transition text-slate-900 bg-white"
                        />
                      </div>

                      {/* Filter matches */}
                      <div className="border border-slate-150 rounded-2xl max-h-48 overflow-y-auto divide-y divide-slate-100 bg-slate-50 scrollbar-thin">
                        {(() => {
                          const q = newOrderSearchQuery.toLowerCase().trim();
                          const matches = products.filter(
                            (p) =>
                              p.Codigo.toLowerCase().includes(q) ||
                              p.Producto.toLowerCase().includes(q)
                          );

                          if (matches.length === 0) {
                            return <div className="p-4 text-center text-slate-400 text-xs italic">No se encontraron productos</div>;
                          }

                          return matches.map((p, idx) => (
                            <button
                              key={`${p.Codigo}-${p.Producto}-${idx}`}
                              type="button"
                              onClick={() => setSelectedProductForNewOrder(p)}
                              className="w-full text-left px-4 py-2 text-xs font-bold hover:bg-white text-slate-700 hover:text-slate-900 transition flex justify-between items-center cursor-pointer"
                            >
                              <span>
                                <span className="font-mono text-indigo-600 mr-2">[{p.Codigo}]</span>
                                {p.Producto}
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">Proveedor: {p.Proveedor || "Plaza"}</span>
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex justify-between items-center">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-indigo-700 block mb-0.5">[{selectedProductForNewOrder.Codigo}]</span>
                        <h4 className="text-sm font-black text-slate-800">{selectedProductForNewOrder.Producto}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">U. Medida: {selectedProductForNewOrder.Medida} | Costo Base: {cop(selectedProductForNewOrder.Costo_Proveedor)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedProductForNewOrder(null)}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-800 text-[11px] font-extrabold rounded-lg shadow-xs transition cursor-pointer"
                      >
                        Cambiar
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. QUANTITIES PER SUCURSAL */}
                {selectedProductForNewOrder && (
                  <div className="space-y-4 animate-fade-in">
                    <div>
                      <label className="block text-xs font-black text-slate-600 uppercase tracking-wide mb-2">2. Ingresar Cantidades por Sucursal ({selectedProductForNewOrder.Medida})</label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {sucursalesPermitidas.map((branchName) => (
                          <div key={branchName} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center">
                            <span className="text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider">{branchName}</span>
                            <input
                              type="text"
                              placeholder="0"
                              value={newOrderBranchQty[branchName]}
                              onChange={(e) => setNewOrderBranchQty({
                                ...newOrderBranchQty,
                                [branchName]: e.target.value
                              })}
                              className="w-full text-center px-2 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 3. NOTES */}
                    <div>
                      <label className="block text-xs font-black text-slate-600 uppercase tracking-wide mb-2">3. Observaciones / Notas (Opcional)</label>
                      <input
                        type="text"
                        placeholder="Ej. Calidad extra, maduro, etc."
                        value={newOrderNotes}
                        onChange={(e) => setNewOrderNotes(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-150 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddOrderModal(false)}
                  className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAddNewOrder}
                  disabled={loading || !selectedProductForNewOrder}
                  className={`px-4 py-2 font-extrabold text-xs rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer ${
                    selectedProductForNewOrder
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  {loading ? "Agregando..." : "Agregar a Pedidos"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* PROVIDER MANAGER / PHONE DIRECTORY MODAL */}
        {showProviderManagerModal && (
          <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-3xl w-full my-8 overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-6 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-400/30 text-indigo-300">
                    <Phone className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white">Directorio y Gestión de Proveedores</h3>
                    <p className="text-indigo-200 text-xs mt-0.5">
                      Agregue nuevos proveedores o modifique el número telefónico / WhatsApp de cualquier proveedor existente.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowProviderManagerModal(false);
                    setEditingProviderName(null);
                  }}
                  className="p-2 text-indigo-200 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6 overflow-y-auto flex-1 bg-slate-50/50">
                {/* Search & Add Bar */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Search box */}
                  <div className="md:col-span-7 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      placeholder="Buscar proveedor por nombre o teléfono..."
                      value={providerSearchQuery}
                      onChange={(e) => setProviderSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs"
                    />
                  </div>

                  {/* Count summary */}
                  <div className="md:col-span-5 flex items-center justify-end px-3 bg-indigo-50/60 border border-indigo-100 rounded-2xl text-indigo-900 text-xs font-bold">
                    <span className="text-[11px]">Total Registrados: <strong>{providers.length} Proveedores</strong></span>
                  </div>
                </div>

                {/* Form to create new provider */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Plus className="w-4 h-4 text-indigo-600" />
                    Agregar Nuevo Proveedor
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-6">
                      <input
                        type="text"
                        placeholder="Nombre de la empresa / Proveedor *"
                        value={newProvModalName}
                        onChange={(e) => setNewProvModalName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        placeholder="Número de Celular / WhatsApp"
                        value={newProvModalCell}
                        onChange={(e) => setNewProvModalCell(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={handleAddNewProviderModal}
                        disabled={loading || !newProvModalName.trim()}
                        className="w-full h-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-xs flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Guardar
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table of Providers */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="max-h-[380px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-100/80 sticky top-0 z-10 border-b border-slate-200 text-[10px] font-black text-slate-600 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3">Proveedor</th>
                          <th className="px-4 py-3">Número de Celular / WhatsApp</th>
                          <th className="px-4 py-3 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                        {providers
                          .filter((p) => {
                            if (!providerSearchQuery.trim()) return true;
                            const q = providerSearchQuery.toLowerCase();
                            return (
                              p.Proveedor.toLowerCase().includes(q) ||
                              (p.Celular && p.Celular.toLowerCase().includes(q))
                            );
                          })
                          .sort((a, b) => a.Proveedor.localeCompare(b.Proveedor, "es", { sensitivity: "base" }))
                          .map((prov) => {
                            const isEditing = editingProviderName === prov.Proveedor;
                            return (
                              <tr key={prov.Proveedor} className="hover:bg-slate-50/80 transition">
                                <td className="px-4 py-3 font-bold text-slate-900">
                                  {prov.Proveedor}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editingProviderCell}
                                      onChange={(e) => setEditingProviderCell(e.target.value)}
                                      placeholder="Ej. 3101234567"
                                      className="px-3 py-1.5 bg-white border-2 border-indigo-500 rounded-xl text-xs font-black text-slate-900 focus:outline-none w-full max-w-xs shadow-xs"
                                      autoFocus
                                    />
                                  ) : (
                                    <span className={`font-mono font-bold ${prov.Celular ? "text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 inline-block" : "text-slate-400 italic"}`}>
                                      {prov.Celular || "Sin número registrado"}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {isEditing ? (
                                    <div className="flex justify-end items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleSaveProviderPhone(prov.Proveedor, editingProviderCell)}
                                        disabled={loading}
                                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center gap-1 cursor-pointer"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                        Guardar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingProviderName(null)}
                                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold text-xs rounded-xl transition cursor-pointer"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingProviderName(prov.Proveedor);
                                        setEditingProviderCell(prov.Celular || "");
                                      }}
                                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs rounded-xl transition flex items-center gap-1.5 ml-auto border border-indigo-100 cursor-pointer"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                      Cambiar Número
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setShowProviderManagerModal(false)}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-sm"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* CUSTOM CONFIRMATION MODAL */}
        {customConfirm && customConfirm.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-black text-slate-800">{customConfirm.title}</h3>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{customConfirm.message}</p>
              </div>
              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCustomConfirm(null)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const onConfirm = customConfirm.onConfirm;
                    setCustomConfirm(null);
                    await onConfirm();
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-sm"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
