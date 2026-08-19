import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Truck, CreditCard, Save, Calendar, Search,
  CheckCircle2, AlertCircle, ShoppingCart, DollarSign, History,
  Plus, UserCheck, Check, FileText, X,
  ArrowUpDown, ArrowUp, ArrowDown, Upload, MessageSquare, Copy, FileSpreadsheet,
  Image as ImageIcon, Download, Camera
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
} from "recharts";
import { Order, DailyClosure, PackagingMovement, Provider, Product, WalletTransaction } from "../types";
import { getColombiaDate } from "../utils/date";
import {
  calculateBranchUncollected,
  getBranchPendingCount as getBranchPendingCountUtil,
} from "../utils/financialCalculations";

interface CompradorDashboardProps {
  username: string;
  isAdminView?: boolean;
  lastGlobalSync?: number;
}

export default function CompradorDashboard({ username, isAdminView = false, lastGlobalSync }: CompradorDashboardProps) {
  const [activeTab, setActiveTab] = useState<"plaza" | "closures" | "packaging" | "ledger" | "history">("plaza");
  const [date, setDate] = useState(getColombiaDate());
  const [orders, setOrders] = useState<Order[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Extra features for orders & history
  const [allOrderDates, setAllOrderDates] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"consolidated" | "by_branch" | "by_provider">("consolidated");
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [csvInputText, setCsvInputText] = useState("");
  const [csvInputDate, setCsvInputDate] = useState(getColombiaDate());
  const [importingCsv, setImportingCsv] = useState(false);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [, setSelectedProductHistory] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);

  // Price history modal states
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);
  const [historyProductData, setHistoryProductData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Image modal states for Provider WhatsApp orders
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageModalData, setImageModalData] = useState<{
    provider: string;
    phone: string;
    imageUrl: string;
    blob: Blob | null;
  } | null>(null);
  const [generatingImage, setGeneratingImage] = useState<string | null>(null);

  // Plaza Matrix state edits (keyed by product code)
  const [matrixEdits, setMatrixEdits] = useState<{
    [code: string]: {
      Costo_Momento?: number;
      Precio_Venta_Momento?: number;
      Proveedor?: string;
      Estado?: "Pendiente" | "Comprado" | "Cancelado";
    };
  }>({});

  // Ledger / Cash Book states
  const [ledgerTransactions, setLedgerTransactions] = useState<WalletTransaction[]>([]);
  const [ledgerDate, setLedgerDate] = useState(getColombiaDate());
  const [ledgerDesc, setLedgerDesc] = useState("");
  const [ledgerType, setLedgerType] = useState<"Ingreso" | "Gasto">("Gasto");
  const [ledgerValue, setLedgerValue] = useState("");
  const [ledgerResp] = useState("Hamilton");

  const [valorTotalPedidos, setValorTotalPedidos] = useState(() => {
    return parseFloat(localStorage.getItem("valor_total_pedidos") || "0") || 0;
  });
  const [valorRealRecogido, setValorRealRecogido] = useState(() => {
    return parseFloat(localStorage.getItem("valor_real_recogido") || "0") || 0;
  });

  const handleUpdateValorTotalPedidos = (val: number) => {
    setValorTotalPedidos(val);
    localStorage.setItem("valor_total_pedidos", String(val));
  };

  const handleUpdateValorRealRecogido = (val: number) => {
    setValorRealRecogido(val);
    localStorage.setItem("valor_real_recogido", String(val));
  };

  // Closures state
  const [closures, setClosures] = useState<DailyClosure[]>([]);
  const [pendingClosures, setPendingClosures] = useState<DailyClosure[]>([]);
  const [walletTxs, setWalletTxs] = useState<WalletTransaction[]>([]);
  const [searchLedger, setSearchLedger] = useState("");

  // Price history tab states
  const [historySearchTermTab, setHistorySearchTermTab] = useState("");
  const [historyShowSuggestionsTab, setHistoryShowSuggestionsTab] = useState(false);
  const [historySelectedProductTab, setHistorySelectedProductTab] = useState<string>("all");

  // Table sorting states
  const [compSortField, setCompSortField] = useState<string>("Producto");
  const [compSortDir, setCompSortDir] = useState<"asc" | "desc">("asc");

  const toggleCompSort = (field: string) => {
    if (compSortField === field) {
      setCompSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setCompSortField(field);
      setCompSortDir("asc");
    }
  };

  // Packaging logistics
  const [packagingLogs, setPackagingLogs] = useState<PackagingMovement[]>([]);
  const [packProvider, setPackProvider] = useState("");
  const [packType, setPackType] = useState<"Canastilla" | "Estiva">("Canastilla");
  const [packDelivered, setPackDelivered] = useState("");
  const [packReturned, setPackReturned] = useState("");
  const [packNotes, setPackNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Cash Distribution Algorithm (auto_distribute_cash)
  const [showCashDistributor, setShowCashDistributor] = useState(false);
  const [disperseAmount, setDisperseAmount] = useState("");
  const [dispersePreview, setDispersePreview] = useState<any[]>([]);

  // Add Order Modal states
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [selectedProductForNewOrder, setSelectedProductForNewOrder] = useState<Product | null>(() => {
    try {
      const cached = localStorage.getItem("alpaso_draft_selected_product");
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [newOrderSearchQuery, setNewOrderSearchQuery] = useState("");
  const [newOrderBranchQty, setNewOrderBranchQty] = useState<{ [branch: string]: string }>(() => {
    try {
      const cached = localStorage.getItem("alpaso_draft_branch_qty");
      return cached ? JSON.parse(cached) : {
        Tibasosa: "",
        Nobsa: "",
        Fira: "",
        Aquitania: "",
        Hansel: ""
      };
    } catch {
      return {
        Tibasosa: "",
        Nobsa: "",
        Fira: "",
        Aquitania: "",
        Hansel: ""
      };
    }
  });
  const [newOrderNotes, setNewOrderNotes] = useState(() => {
    return localStorage.getItem("alpaso_draft_notes") || "";
  });

  useEffect(() => {
    if (selectedProductForNewOrder) {
      localStorage.setItem("alpaso_draft_selected_product", JSON.stringify(selectedProductForNewOrder));
    } else {
      localStorage.removeItem("alpaso_draft_selected_product");
    }
  }, [selectedProductForNewOrder]);

  useEffect(() => {
    localStorage.setItem("alpaso_draft_branch_qty", JSON.stringify(newOrderBranchQty));
  }, [newOrderBranchQty]);

  useEffect(() => {
    localStorage.setItem("alpaso_draft_notes", newOrderNotes);
  }, [newOrderNotes]);

  // Custom confirmation modal state to replace window.confirm inside iframe
  const [customConfirm, setCustomConfirm] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Modal to allow custom collection amounts for branch cash collections
  const [pickupModal, setPickupModal] = useState<{
    isOpen: boolean;
    branchName: string;
    totalAmount: number;
  } | null>(null);
  const [pickupAmount, setPickupAmount] = useState<string>("");

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
            fecha: date,
            items: [
              {
                Codigo: selectedProductForNewOrder.Codigo,
                Cantidad: qty,
                Notas: newOrderNotes
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
      fetchOrders();
    } catch (err: any) {
      setErrorMsg(err.message || "Error al agregar pedido");
    } finally {
      setLoading(false);
    }
  };

  const generateProviderOrderCanvas = (
    provName: string,
    phone: string,
    orderDate: string,
    rows: any[],
    totalCost: number
  ): Promise<{ url: string; blob: Blob }> => {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo obtener el contexto 2D"));

        const width = 980;
        const rowHeight = 38;
        const headerHeight = 160;
        const footerHeight = 110;
        const tableHeaderHeight = 42;
        const totalRows = rows.length;
        const height = headerHeight + tableHeaderHeight + totalRows * rowHeight + footerHeight;

        canvas.width = width * 2;
        canvas.height = height * 2;
        ctx.scale(2, 2);

        // Background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);

        // Header Banner
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, "#064e3b");
        grad.addColorStop(1, "#0f172a");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, headerHeight);

        // Company title
        ctx.fillStyle = "#34d399";
        ctx.font = "bold 13px system-ui, sans-serif";
        ctx.fillText("SURTIFRUVER / MERCADO CAMPESINO", 30, 35);

        ctx.fillStyle = "#ffffff";
        ctx.font = "900 22px system-ui, sans-serif";
        ctx.fillText(`ORDEN DE COMPRA: ${provName.toUpperCase()}`, 30, 68);

        ctx.fillStyle = "#cbd5e1";
        ctx.font = "600 13px system-ui, sans-serif";
        ctx.fillText(`Fecha: ${orderDate}   |   Celular: ${phone || "Sin Registrar"}   |   Productos: ${totalRows}`, 30, 98);

        ctx.fillStyle = "#a7f3d0";
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.fillText("DESGLOSE OFICIAL DE PEDIDO POR SUCURSALES - LISTO PARA REPARTO", 30, 126);

        // Table Header Background
        const yTable = headerHeight;
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, yTable, width, tableHeaderHeight);

        // Table Header Text
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px system-ui, sans-serif";

        ctx.textAlign = "left";
        ctx.fillText("PRODUCTO", 30, yTable + 26);

        ctx.textAlign = "center";
        ctx.fillText("TIBASOSA", 300, yTable + 26);
        ctx.fillText("NOBSA", 380, yTable + 26);
        ctx.fillText("FIRA", 460, yTable + 26);
        ctx.fillText("AQUITANIA", 540, yTable + 26);
        ctx.fillText("HANSEL", 620, yTable + 26);
        ctx.fillText("REQUERIDO TOTAL", 730, yTable + 26);

        ctx.textAlign = "right";
        ctx.fillText("COSTO", 850, yTable + 26);
        ctx.fillText("SUBTOTAL", 950, yTable + 26);

        // Table Rows
        let currY = yTable + tableHeaderHeight;
        rows.forEach((row, i) => {
          ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#f8fafc";
          ctx.fillRect(0, currY, width, rowHeight);

          ctx.strokeStyle = "#e2e8f0";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, currY + rowHeight);
          ctx.lineTo(width, currY + rowHeight);
          ctx.stroke();

          // Producto
          ctx.textAlign = "left";
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 12px system-ui, sans-serif";
          const pName = row.Producto.length > 28 ? row.Producto.substring(0, 28) + "..." : row.Producto;
          ctx.fillText(pName, 30, currY + 23);

          // Branches
          const qTib = parseQty(row.Tibasosa);
          const qNob = parseQty(row.Nobsa);
          const qFir = parseQty(row.Fira);
          const qAqu = parseQty(row.Aquitania);
          const qHan = parseQty(row.Hansel);

          const branchValues = [
            { q: qTib, val: row.Tibasosa, x: 300 },
            { q: qNob, val: row.Nobsa, x: 380 },
            { q: qFir, val: row.Fira, x: 460 },
            { q: qAqu, val: row.Aquitania, x: 540 },
            { q: qHan, val: row.Hansel, x: 620 }
          ];

          ctx.textAlign = "center";
          branchValues.forEach(b => {
            if (b.q > 0) {
              ctx.fillStyle = "#0f172a";
              ctx.font = "bold 12px system-ui, sans-serif";
              ctx.fillText(String(b.val), b.x, currY + 23);
            } else {
              ctx.fillStyle = "#cbd5e1";
              ctx.font = "12px system-ui, sans-serif";
              ctx.fillText("-", b.x, currY + 23);
            }
          });

          // Total Requerido
          ctx.textAlign = "center";
          ctx.fillStyle = "#047857";
          ctx.font = "bold 12px system-ui, sans-serif";
          ctx.fillText(`${formatQty(row.Requerido)} ${row.Medida}`, 730, currY + 23);

          // Cost
          ctx.textAlign = "right";
          ctx.fillStyle = "#475569";
          ctx.font = "11px monospace";
          ctx.fillText(cop(row.Precio_Compra), 850, currY + 23);

          // Subtotal
          ctx.textAlign = "right";
          ctx.fillStyle = "#047857";
          ctx.font = "bold 12px monospace";
          ctx.fillText(cop(row.Total), 950, currY + 23);

          currY += rowHeight;
        });

        // Footer
        const yFooter = currY + 10;
        ctx.fillStyle = "#064e3b";
        ctx.fillRect(0, yFooter, width, footerHeight);

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.font = "bold 13px system-ui, sans-serif";
        ctx.fillText(`VALOR TOTAL DEL PEDIDO - PROVEEDOR (${provName}):`, 30, yFooter + 38);

        ctx.fillStyle = "#34d399";
        ctx.font = "900 22px monospace";
        ctx.fillText(cop(totalCost), 30, yFooter + 70);

        ctx.textAlign = "right";
        ctx.fillStyle = "#a7f3d0";
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText("Favor confirmar despacho y horario de entrega.", width - 30, yFooter + 38);
        ctx.fillText("Generado automáticamente por Fruver Engine Suite", width - 30, yFooter + 65);

        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error("No se pudo generar la imagen del pedido"));
          const url = URL.createObjectURL(blob);
          resolve({ url, blob });
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    });
  };

  const handleGenerateImageForProvider = async (providerName: string, phone: string, rows: any[], total: number) => {
    setGeneratingImage(providerName);
    setErrorMsg("");
    try {
      const { url, blob } = await generateProviderOrderCanvas(providerName, phone, date, rows, total);
      setImageModalData({
        provider: providerName,
        phone,
        imageUrl: url,
        blob
      });
      setShowImageModal(true);

      // Attempt automatic copy of image to clipboard
      if (navigator.clipboard && window.ClipboardItem && blob) {
        try {
          const item = new ClipboardItem({ "image/png": blob });
          await navigator.clipboard.write([item]);
          setSuccessMsg(`¡Imagen de pedido para ${providerName} generada y copiada al portapapeles! Lista para pegar (Ctrl+V) en WhatsApp.`);
          setTimeout(() => setSuccessMsg(""), 5000);
        } catch (clipErr) {
          console.warn("Clipboard write failed:", clipErr);
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("No se pudo generar la imagen del pedido.");
    } finally {
      setGeneratingImage(null);
    }
  };

  const handleImportCsvOrders = async () => {
    if (!csvInputText || !csvInputText.trim()) {
      setErrorMsg("Debe seleccionar un archivo CSV o pegar su texto con el contenido de los pedidos.");
      return;
    }

    setImportingCsv(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/admin/import-csv-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText: csvInputText,
          fecha: csvInputDate || date
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al importar el archivo CSV.");
      }

      setSuccessMsg(`¡Éxito! Se importaron ${data.count || 0} ítems de pedidos para la fecha ${data.date || csvInputDate}.`);
      setShowCsvImportModal(false);
      setCsvInputText("");
      if (data.date) setDate(data.date);
      await fetchOrders();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "No se pudo realizar la importación del CSV.");
    } finally {
      setImportingCsv(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCsvInputText(content);
        setSuccessMsg(`Archivo "${file.name}" cargado correctamente en el lector.`);
        setTimeout(() => setSuccessMsg(""), 3500);
      }
    };
    reader.onerror = () => {
      setErrorMsg("No se pudo leer el archivo seleccionado.");
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleAutoDistributeCash = () => {
    const amount = parseFloat(disperseAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMsg("Ingrese un monto de efectivo válido mayor a 0 para dispersar.");
      return;
    }

    setErrorMsg("");
    // Group active unpaid bought orders on selected date by provider
    const supplierDebts: { [prov: string]: { totalOwed: number; orders: Order[] } } = {};
    
    orders.forEach((o) => {
      if (o.Estado_Pago !== "Pagado" && o.Estado === "Comprado") {
        const owed = (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0);
        if (owed > 0) {
          if (!supplierDebts[o.Proveedor]) {
            supplierDebts[o.Proveedor] = { totalOwed: 0, orders: [] };
          }
          supplierDebts[o.Proveedor].totalOwed += owed;
          supplierDebts[o.Proveedor].orders.push(o);
        }
      }
    });

    const totalDebt = Object.values(supplierDebts).reduce((acc, curr) => acc + curr.totalOwed, 0);
    if (totalDebt === 0) {
      setErrorMsg("No hay deudas pendientes con proveedores para la fecha seleccionada.");
      setDispersePreview([]);
      return;
    }

    // Allocate cash proportionally
    const preview = Object.entries(supplierDebts).map(([supplier, data]) => {
      const proportion = data.totalOwed / totalDebt;
      const allocated = Math.min(data.totalOwed, Math.round(amount * proportion));
      return {
        supplier,
        totalOwed: data.totalOwed,
        allocated,
        remaining: data.totalOwed - allocated,
        orders: data.orders
      };
    });

    setDispersePreview(preview);
  };

  const handleApplyDisperse = async () => {
    if (dispersePreview.length === 0) return;
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const updates: any[] = [];
    let paidOrdersCount = 0;
    
    dispersePreview.forEach((item) => {
      let remainingCash = item.allocated;
      // Sort orders by cost to pay off cheaper orders first (optimization)
      const sortedOrders = [...item.orders].sort((a, b) => {
        const costA = (a.Cantidad_Comprada || 0) * (a.Costo_Momento || 0);
        const costB = (b.Cantidad_Comprada || 0) * (b.Costo_Momento || 0);
        return costA - costB;
      });

      sortedOrders.forEach((o: Order) => {
        const cost = (o.Cantidad_Comprada || 0) * (o.Costo_Momento || 0);
        if (remainingCash >= cost && cost > 0) {
          updates.push({
            ID_Pedido: o.ID_Pedido,
            Codigo: o.Codigo,
            fields: { Estado_Pago: "Pagado" }
          });
          remainingCash -= cost;
          paidOrdersCount++;
        }
      });
    });

    if (updates.length === 0) {
      setErrorMsg("El monto asignado no alcanza a liquidar completamente ningún pedido en base a la prioridad FIFO. Por favor, asigne un monto mayor.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/orders/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates })
      });

      if (res.ok) {
        setSuccessMsg(`¡Dispersión de efectivo ejecutada con éxito! Se liquidaron ${paidOrdersCount} pedidos de proveedores.`);
        setDisperseAmount("");
        setDispersePreview([]);
        setShowCashDistributor(false);
        fetchOrders();
      } else {
        throw new Error("No se pudo procesar la actualización masiva de pagos.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error al aplicar dispersión.");
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
    const fetchAllOrderDates = async () => {
      try {
        const res = await fetch("/api/orders");
        if (res.ok) {
          const allOrders = await res.json();
          const datesSet = new Set<string>(allOrders.map((o: any) => o.Fecha));
          const sortedDates = Array.from(datesSet).sort((a, b) => b.localeCompare(a));
          setAllOrderDates(sortedDates);
        }
      } catch (e) {
        console.error("Error fetching all order dates:", e);
      }
    };
    fetchAllOrderDates();
  }, [orders]); // Refresh unique dates if orders are updated/saved!

  useEffect(() => {
    fetchOrders();
    fetchProviders();
    fetchProducts();
    fetchClosures();
    fetchWalletTxs();
    fetchPackaging();
    fetchLedgerTransactions();

    const interval = setInterval(() => {
      fetchClosures();
      fetchWalletTxs();
    }, 12000);
    return () => clearInterval(interval);
  }, [date, lastGlobalSync]);

  const fetchWalletTxs = async () => {
    try {
      const res = await fetch("/api/wallet-transactions");
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) setWalletTxs(data);
        } catch (e) {
          console.warn("Could not parse wallet-transactions JSON", e);
        }
      }
    } catch (e) {
      console.error("Error fetching wallet txs:", e);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await fetch(`/api/orders?fecha=${date}`);
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) {
            setOrders(data);
            setMatrixEdits({});
          }
        } catch (e) {
          console.warn("Could not parse orders JSON", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) setProviders(data);
        } catch (e) {
          console.warn("Could not parse providers JSON", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) setProducts(data);
        } catch (e) {
          console.warn("Could not parse products JSON", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClosures = async () => {
    try {
      const res = await fetch("/api/closures");
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) {
            setClosures(data);
            setPendingClosures(data.filter((c: DailyClosure) => !c.Recaudado_Fisico));
          }
        } catch (e) {
          console.warn("Could not parse closures JSON", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPackaging = async () => {
    try {
      const res = await fetch("/api/packaging");
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) setPackagingLogs(data);
        } catch (e) {
          console.warn("Could not parse packaging JSON", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLedgerTransactions = async () => {
    try {
      const res = await fetch("/api/wallet/Central %2F Nequi");
      if (res.ok) {
        try {
          const data = await res.json();
          if (data && typeof data === "object") {
            setLedgerTransactions(data.transactions || []);
          }
        } catch (e) {
          console.warn("Could not parse ledger transactions JSON", e);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPriceHistoryAll = async () => {
    try {
      setHistoryLoading(true);
      const res = await fetch("/api/price-history");
      if (res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) setPriceHistory(data);
        } catch (e) {
          console.warn("Could not parse price-history JSON", e);
        }
      }
    } catch (e) {
      console.error("Error loading all price history:", e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleExportToXLSX = () => {
    // Chronological ascending calculate cumulative balance
    const sortedTxs = [...ledgerTransactions].sort((a, b) => a.Fecha.localeCompare(b.Fecha));
    let runningBalance = 0;
    const txsWithBalance = sortedTxs.map((tx) => {
      const entradas = tx.Tipo_Movimiento === "Ingreso" ? tx.Valor : 0;
      const salidas = tx.Tipo_Movimiento === "Gasto" ? tx.Valor : 0;
      runningBalance = runningBalance + entradas - salidas;
      return { ...tx, runningBalance, entradas, salidas };
    });

    const filteredTxs = txsWithBalance.filter(tx => 
      (tx.Descripcion || "").toLowerCase().includes((searchLedger || "").toLowerCase())
    );

    // Build Excel data
    const dataRows = filteredTxs.map(tx => ({
      "Fecha": tx.Fecha,
      "Entradas (Ingresos)": tx.entradas > 0 ? tx.entradas : 0,
      "Salidas (Egresos)": tx.salidas > 0 ? tx.salidas : 0,
      "Saldo Acumulado": tx.runningBalance,
      "Descripción / Concepto": tx.Descripcion,
      "Responsable": tx.Responsable || "Sistema"
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Libro Diario");

    // Adjust column widths automatically
    const maxW = [12, 20, 20, 20, 40, 15];
    worksheet["!cols"] = maxW.map(w => ({ wch: w }));

    XLSX.writeFile(workbook, `Libro_Diario_Flujo_Caja_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const handleSaveLedgerTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ledgerValue || !ledgerDesc) {
      setErrorMsg("Monto y descripción requeridos.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/wallet/Central %2F Nequi/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: ledgerDate,
          Tipo_Movimiento: ledgerType,
          Valor: parseFloat(ledgerValue),
          Descripcion: ledgerDesc,
          Responsable: username || ledgerResp,
        }),
      });

      if (res.ok) {
        setSuccessMsg("Transacción del Libro Diario registrada con éxito.");
        setLedgerValue("");
        setLedgerDesc("");
        fetchLedgerTransactions();
      } else {
        throw new Error("No se pudo guardar la transacción.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error al registrar movimiento.");
    } finally {
      setLoading(false);
    }
  };

  // Matrix edit logger (keyed by product code)
  const handleMatrixEdit = (code: string, field: string, value: any) => {
    const currentEdit = matrixEdits[code] || {};
    let updatedEdit = {
      ...currentEdit,
      [field]: value
    };

    // If Hamilton edited "Costo_Momento" (PRECIO COMPRA), auto-calculate "Precio_Venta_Momento" ($ VENTA KL)
    if (field === "Costo_Momento") {
      const prod = products.find(p => p.Codigo === code);
      const utility = prod?.Utilidad !== undefined ? prod.Utilidad : 0.3;
      
      let currentME = 1;
      if (prod) {
        const medLower = (prod.Medida || "").toLowerCase();
        if (medLower.includes("bulto")) {
          currentME = prod.Factor_Bulto || 1;
        } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
          currentME = prod.Factor_Canastilla || 1;
        }
      }
      
      const mermaVal = prod?.Merma !== undefined ? prod.Merma : 0;
      const shrinkageFactor = (1 - mermaVal);
      const divisor = currentME * (shrinkageFactor > 0 ? shrinkageFactor : 1);
      
      updatedEdit.Precio_Venta_Momento = Math.round((value / divisor) * (1 + utility));
    }

    setMatrixEdits({
      ...matrixEdits,
      [code]: updatedEdit
    });
  };

  // Bulk save Plaza Purchases Matrix and Master Catalog
  const handleSavePlazaMatrix = async () => {
    if (Object.keys(matrixEdits).length === 0) {
      setErrorMsg("No hay cambios pendientes por guardar");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const updates: any[] = [];
    const productCatalogUpdates: { code: string; cost: number; venta: number; supplier: string }[] = [];
    const newBranchOrdersMap: { [branch: string]: any[] } = {};

    Object.entries(matrixEdits).forEach(([code, fields]) => {
      // Find all orders on the active date for this product code
      const productOrders = orders.filter((o) => o.Codigo === code);
      const prodObj = products.find((p) => p.Codigo === code);

      // 1. Process existing orders for this product
      productOrders.forEach((o) => {
        const branch = o.Sucursal.trim(); // Tibasosa, Nobsa, Fira, Aquitania, Hansel
        const qtyKey = `${branch}_Qty`;
        const obsKey = `${branch}_Obs`;

        const updatedQtyStr = fields[qtyKey] !== undefined ? String(fields[qtyKey]).trim() : String(o.Cantidad);
        const updatedNotes = fields[obsKey] !== undefined ? fields[obsKey] : o.Notas;

        updates.push({
          ID_Pedido: o.ID_Pedido,
          Codigo: o.Codigo,
          fields: {
            Cantidad: updatedQtyStr,
            Cantidad_Comprada: parseQty(updatedQtyStr),
            Notas: updatedNotes,
            Costo_Momento: fields.Costo_Momento !== undefined ? fields.Costo_Momento : o.Costo_Momento,
            Precio_Venta_Momento: fields.Precio_Venta_Momento !== undefined ? fields.Precio_Venta_Momento : o.Precio_Venta_Momento,
            Proveedor: fields.Proveedor !== undefined ? fields.Proveedor : o.Proveedor,
            Estado: "Comprado" // Auto-mark as purchased since price has been negotiated/entered!
          }
        });
      });

      // 2. Identify and create brand-new branch orders if quantity was edited but no order existed
      const branchesList = ["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"];
      branchesList.forEach((bName) => {
        const bLower = (bName || "").toLowerCase();
        const qtyKey = `${bName}_Qty`;
        const obsKey = `${bName}_Obs`;

        const hasOrder = productOrders.some((o) => (o.Sucursal || "").trim().toLowerCase() === bLower);
        const editedQtyStr = fields[qtyKey];
        const editedObsStr = fields[obsKey];

        if (!hasOrder && editedQtyStr !== undefined) {
          const parsedQtyVal = parseQty(editedQtyStr);
          if (parsedQtyVal > 0) {
            if (!newBranchOrdersMap[bName]) {
              newBranchOrdersMap[bName] = [];
            }
            newBranchOrdersMap[bName].push({
              Codigo: code,
              Cantidad: String(editedQtyStr).trim(),
              Notas: editedObsStr || ""
            });
          }
        }
      });

      // Gather catalog updates
      if (prodObj && (fields.Costo_Momento !== undefined || fields.Proveedor !== undefined)) {
        productCatalogUpdates.push({
          code,
          cost: fields.Costo_Momento !== undefined ? fields.Costo_Momento : prodObj.Costo_Proveedor,
          venta: fields.Precio_Venta_Momento !== undefined ? fields.Precio_Venta_Momento : prodObj.Precio_Venta_Actual,
          supplier: fields.Proveedor !== undefined ? fields.Proveedor : prodObj.Proveedor
        });
      }
    });

    try {
      // 1. Bulk update the existing orders database
      if (updates.length > 0) {
        const res = await fetch("/api/orders/bulk-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates })
        });

        if (!res.ok) {
          throw new Error("No se pudo guardar la planilla de compras");
        }
      }

      // 2. Create new orders for branches that didn't have one initially but now have a quantity
      if (Object.keys(newBranchOrdersMap).length > 0) {
        await Promise.all(
          Object.entries(newBranchOrdersMap).map(async ([sucursalName, items]) => {
            const res = await fetch("/api/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sucursal: sucursalName,
                fecha: date,
                items
              })
            });
            if (!res.ok) {
              console.error(`Failed to dynamically create orders for branch ${sucursalName}`);
            }
          })
        );
      }

      // 3. Parallel update the master product database for persistent prices
      await Promise.all(
        productCatalogUpdates.map(async (u) => {
          await fetch(`/api/products/${u.code}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              Costo_Proveedor: u.cost,
              Precio_Venta_Actual: u.venta,
              Proveedor: u.supplier,
              user: username
            })
          });
        })
      );

      setSuccessMsg("¡Planilla de Compras de Plaza y Catálogo Maestro actualizados con éxito!");
      setMatrixEdits({});
      fetchOrders();
      fetchProducts(); // refresh products list
    } catch (err: any) {
      setErrorMsg(err.message || "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  // Load and display specific product's price history log
  const handleViewProductHistory = async (code: string, productName: string) => {
    try {
      setSelectedProductHistory(code);
      setSelectedProductCode(code);
      setSelectedProductName(productName);
      setHistoryModalOpen(true);
      setHistoryLoading(true);
      setHistoryProductData([]); // clear old
      const res = await fetch("/api/price-history");
      if (res.ok) {
        const data = await res.json();
        const filtered = data.filter((h: any) => h.Codigo.toUpperCase().trim() === code.toUpperCase().trim());
        const sorted = filtered.sort((a: any, b: any) => b.Fecha_Hora.localeCompare(a.Fecha_Hora));
        setPriceHistory(sorted);
        setHistoryProductData(sorted);
      }
    } catch (e) {
      console.error("Error loading price history:", e);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Helper functions for cash reconciliation and wallet tracking per branch (unified single source of truth)
  const getBranchUncollected = (branchName: string) => calculateBranchUncollected(closures, walletTxs, branchName);
  const getBranchPendingCount = (branchName: string) => getBranchPendingCountUtil(closures, branchName);

  const handleBulkReconcile = async (branchName: string, customAmount?: number) => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/closures/bulk-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          Sucursal: branchName,
          Monto_Recogido: customAmount
        })
      });
      if (res.ok) {
        const data = await res.json();
        const successText = data.msg || `¡Recolección de efectivo de la sucursal ${branchName} exitosamente registrada en Caja Central!`;
        setSuccessMsg(successText);
        fetchClosures();
        fetchWalletTxs();
        fetchLedgerTransactions(); // refresh central ledger transactions
      } else {
        const err = await res.json();
        const errorText = err.error || "Error al reconciliar el efectivo.";
        setErrorMsg(errorText);
      }
    } catch (e) {
      setErrorMsg("Ocurrió un error de red al intentar registrar la recolección.");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptHamiltonCollection = async (c: DailyClosure) => {
    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      // 1. Reconcile the closure
      const reconRes = await fetch("/api/closures/reconcile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: c.Fecha,
          Sucursal: c.Sucursal,
          Recaudado_Fisico: true
        })
      });

      if (!reconRes.ok) {
        throw new Error("No se pudo conciliar el cierre.");
      }

      // 2. Add an "Ingreso" transaction in Central / Nequi wallet representing this pickup
      const neto = c.Ventas_Totales - c.Gastos_Extra;
      const ledgerRes = await fetch("/api/wallet/Central %2F Nequi/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: c.Fecha,
          Tipo_Movimiento: "Ingreso",
          Valor: neto,
          Descripcion: `Recaudo Cierre Aceptado - ${c.Sucursal} (${c.Fecha})`,
          Responsable: "Hamilton"
        }),
      });

      if (ledgerRes.ok) {
        setSuccessMsg(`¡Efectivo de ${c.Sucursal} por ${cop(neto)} aceptado e ingresado al Libro Diario con éxito!`);
        fetchClosures();
        fetchWalletTxs();
        fetchLedgerTransactions();
      } else {
        throw new Error("No se pudo registrar la transacción en el Libro Diario.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Error al aceptar recolección");
    } finally {
      setLoading(false);
    }
  };

  // Approve and Reconcile Physical Cash from Branches
  const handleApproveClosure = async (closure: DailyClosure) => {
    setLoading(true);
    try {
      const res = await fetch("/api/closures/reconcile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Fecha: closure.Fecha,
          Sucursal: closure.Sucursal,
          Recaudado_Fisico: true
        })
      });

      if (res.ok) {
        setSuccessMsg(`Recaudo físico de ${closure.Sucursal} aprobado y sumado a Caja Central.`);
        fetchClosures();
      } else {
        throw new Error("No se pudo registrar la recaudación física");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Save Packaging basket log
  const handleSavePackaging = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packProvider) {
      setErrorMsg("Debe seleccionar un proveedor");
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
          Fecha: getColombiaDate(),
          Proveedor: packProvider,
          Tipo_Activo: packType,
          Cantidad_Entregada: packDelivered,
          Cantidad_Devuelta: packReturned,
          Notas: packNotes
        })
      });

      if (res.ok) {
        setSuccessMsg("Registro de Canastillas guardado con éxito.");
        setPackDelivered("");
        setPackReturned("");
        setPackNotes("");
        fetchPackaging();
      } else {
        throw new Error("Error registrando movimiento de canastillas");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculate Net Basket Balances per supplier
  // Balance = sum(Delivered) - sum(Returned)
  const calculateBasketBalances = () => {
    const balances: { [prov: string]: { canastillas: number; estivas: number } } = {};
    
    // Seed
    providers.forEach((p) => {
      balances[p.Proveedor] = { canastillas: 0, estivas: 0 };
    });

    packagingLogs.forEach((mov) => {
      const p = mov.Proveedor;
      if (!balances[p]) {
        balances[p] = { canastillas: 0, estivas: 0 };
      }

      const diff = mov.Cantidad_Entregada - mov.Cantidad_Devuelta;
      if (mov.Tipo_Activo === "Canastilla") {
        balances[p].canastillas += diff;
      } else {
        balances[p].estivas += diff;
      }
    });

    return Object.entries(balances).filter(([_, bal]) => bal.canastillas !== 0 || bal.estivas !== 0);
  };

  const basketBalances = calculateBasketBalances();

  // Helper to parse strings with fractional values (e.g. "1/2", "3", "1 1/2")
  const parseQty = (q: any): number => {
    if (q === undefined || q === null || q === "") return 0;
    if (typeof q === "number") return q;
    const strVal = String(q);
    const cleaned = strVal.trim().replace(",", ".").replace(/\s+/g, " ");
    if (cleaned === "" || cleaned === "-") return 0;
    
    // Mixed fraction match e.g. "1 1/2" or "1-1/2"
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

  // Helper to format float quantities to beautiful commercial fraction expressions as mixed fractions
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

  // Set of known codes belonging to category P (Plaza)
  const PLAZA_CODES = new Set([
    "A16", "A13", "za13", "A12", "ZA12", "A03", "A06", "A04", "A15", "A37", "A14", "A05", "ZA28", "A28", "A02", "A08", "A32", "A07", "ZA07", "A10", "ZA10", "A09", "B02", "B01", "B12", "B13", "B03", "C02", "C01", "C23", "C04", "c06", "C07", "ZC04", "C05", "ZC05", "C19", "C18", "C10", "ZC10", "C11", "C13", "zc13", "D01", "ZD01", "D03", "ZD02", "F01", "zf01", "ZF03", "ZF02", "F04", "G01", "ZG01", "G02", "G04", "G05", "ZG05", "H01", "H02", "H03", "H04", "J01", "K01", "T08", "L02", "L03", "ZL03", "L04", "ZL04", "M03", "M02", "zm02", "M04", "zm04", "M05", "ZM07", "M06", "ZM06", "M07", "M56", "M10", "M08", "M15", "ZM15", "M14", "zm14", "M16", "zm16", "B10", "B09", "ZB09", "M20", "zm20", "M21", "ZM21", "M23", "N01", "ZN03", "N03", "N04", "ZN04", "P01", "ZP01", "P03", "ZP03", "P06", "p15", "zp06", "P07", "P08", "p18", "P10", "P11", "ZP11", "P13", "P14", "ZP14", "P16", "ZP16", "P04", "zp04", "P05", "P17", "zp17", "P20", "P23", "ZP23", "P22", "P19", "R01", "R03", "R04", "ZR04", "R05", "R07", "R02", "s01", "A19", "A20", "A21", "T06", "ZT06", "T02", "ZT02", "T03", "ZT03", "T10", "T07", "T04", "U01", "U05", "U09", "U03", "U08", "Y01", "zy01", "Z01", "ZZ01", "Z03", "Z04", "zz07", "z06"
  ].map(c => c.toUpperCase()));

  // Process and aggregate orders for the general Plaza matrix
  const getPlazaMatrixData = () => {
    const groupedRowsMap: { [code: string]: any } = {};

    orders.forEach((o) => {
      const code = o.Codigo;
      const prod = products.find((p) => p.Codigo === code);

      if (!groupedRowsMap[code]) {
        const prevCosto = prod?.Precio_Anterior || prod?.Costo_Proveedor || o.Precio_Anterior || 0;
        const prevVenta = prod?.Venta_Anterior || prod?.Precio_Venta_Actual || 0;
        const util = prod?.Utilidad !== undefined ? prod.Utilidad : (o.Porcentaje_Ganancia || 0.3);

        const edit = matrixEdits[code] || {};
        const costoMomento = edit.Costo_Momento !== undefined ? edit.Costo_Momento : (o.Costo_Momento || prod?.Costo_Proveedor || 0);
        const proveedorName = edit.Proveedor !== undefined ? edit.Proveedor : (o.Proveedor || prod?.Proveedor || "Sin Proveedor");

        let currentME = 1;
        const factorBulto = prod?.Factor_Bulto || 56;
        const factorCanastilla = prod?.Factor_Canastilla || 22;
        if (prod) {
          const medLower = (prod.Medida || "").toLowerCase();
          if (medLower.includes("bulto")) {
            currentME = factorBulto;
          } else if (medLower.includes("canastilla") || medLower.includes("guacal")) {
            currentME = factorCanastilla;
          }
        }
        const mermaVal = prod?.Merma !== undefined ? prod.Merma : 0;
        const shrinkageFactor = (1 - mermaVal);
        const divisor = currentME * (shrinkageFactor > 0 ? shrinkageFactor : 1);
        const calculatedVenta = Math.round((costoMomento / divisor) * (1 + util));

        groupedRowsMap[code] = {
          Fecha: date,
          Codigo: code,
          Producto: o.Producto,
          Tibasosa: "-",
          Nobsa: "-",
          Fira: "-",
          Aquitania: "-",
          Hansel: "-",
          Tibasosa_Obs: "",
          Nobsa_Obs: "",
          Fira_Obs: "",
          Aquitania_Obs: "",
          Hansel_Obs: "",
          Proveedor: proveedorName,
          Precio_Compra: costoMomento,
          Requerido: 0,
          Observacion: "",
          Tibasosa_Pag: 0,
          Nobsa_Pag: 0,
          Fira_Pag: 0,
          Aquitania_Pag: 0,
          Hansel_Pag: 0,
          Total: 0,
          Precio_Anterior: prevCosto,
          Cambio: 0,
          Me_1: String(currentME),
          Factor_Bulto: factorBulto,
          Factor_Canastilla: factorCanastilla,
          me_2: `${(mermaVal * 100).toFixed(0)}%`,
          Utilidad: util,
          Precio_Venta_Ant: prevVenta,
          Venta_Kl: edit.Precio_Venta_Momento !== undefined ? edit.Precio_Venta_Momento : calculatedVenta,
          Producto2: o.Producto
        };
      }

      const branch = (o.Sucursal || "").trim().toLowerCase();
      const edit = matrixEdits[code] || {};

      let currentQty = o.Cantidad;
      if (branch === "tibasosa" && edit.Tibasosa_Qty !== undefined) {
        currentQty = parseQty(edit.Tibasosa_Qty);
      } else if (branch === "nobsa" && edit.Nobsa_Qty !== undefined) {
        currentQty = parseQty(edit.Nobsa_Qty);
      } else if (branch === "fira" && edit.Fira_Qty !== undefined) {
        currentQty = parseQty(edit.Fira_Qty);
      } else if (branch === "aquitania" && edit.Aquitania_Qty !== undefined) {
        currentQty = parseQty(edit.Aquitania_Qty);
      } else if (branch === "hansel" && edit.Hansel_Qty !== undefined) {
        currentQty = parseQty(edit.Hansel_Qty);
      }

      if (branch === "tibasosa") groupedRowsMap[code].Tibasosa = currentQty;
      else if (branch === "nobsa") groupedRowsMap[code].Nobsa = currentQty;
      else if (branch === "fira") groupedRowsMap[code].Fira = currentQty;
      else if (branch === "aquitania") groupedRowsMap[code].Aquitania = currentQty;
      else if (branch === "hansel") groupedRowsMap[code].Hansel = currentQty;

      let currentObs = o.Notas || "";
      if (branch === "tibasosa" && edit.Tibasosa_Obs !== undefined) currentObs = edit.Tibasosa_Obs;
      else if (branch === "nobsa" && edit.Nobsa_Obs !== undefined) currentObs = edit.Nobsa_Obs;
      else if (branch === "fira" && edit.Fira_Obs !== undefined) currentObs = edit.Fira_Obs;
      else if (branch === "aquitania" && edit.Aquitania_Obs !== undefined) currentObs = edit.Aquitania_Obs;
      else if (branch === "hansel" && edit.Hansel_Obs !== undefined) currentObs = edit.Hansel_Obs;

      if (branch === "tibasosa") groupedRowsMap[code].Tibasosa_Obs = currentObs;
      else if (branch === "nobsa") groupedRowsMap[code].Nobsa_Obs = currentObs;
      else if (branch === "fira") groupedRowsMap[code].Fira_Obs = currentObs;
      else if (branch === "aquitania") groupedRowsMap[code].Aquitania_Obs = currentObs;
      else if (branch === "hansel") groupedRowsMap[code].Hansel_Obs = currentObs;

      if (currentObs && currentObs.trim() !== "") {
        if (groupedRowsMap[code].Observacion) {
          groupedRowsMap[code].Observacion += " | ";
        }
        groupedRowsMap[code].Observacion += `${o.Sucursal}: ${currentObs}`;
      }
    });

    const list = Object.values(groupedRowsMap).map((row) => {
      const qtyTibasosa = parseQty(row.Tibasosa);
      const qtyNobsa = parseQty(row.Nobsa);
      const qtyFira = parseQty(row.Fira);
      const qtyAquitania = parseQty(row.Aquitania);
      const qtyHansel = parseQty(row.Hansel);

      const requerido = qtyTibasosa + qtyNobsa + qtyFira + qtyAquitania + qtyHansel;

      const tibasosaPag = qtyTibasosa * row.Precio_Compra;
      const nobsaPag = qtyNobsa * row.Precio_Compra;
      const firaPag = qtyFira * row.Precio_Compra;
      const aquitaniaPag = qtyAquitania * row.Precio_Compra;
      const hanselPag = qtyHansel * row.Precio_Compra;

      const total = requerido * row.Precio_Compra;
      const cambio = row.Precio_Compra - row.Precio_Anterior;

      return {
        ...row,
        Requerido: requerido,
        Tibasosa_Pag: tibasosaPag,
        Nobsa_Pag: nobsaPag,
        Fira_Pag: firaPag,
        Aquitania_Pag: aquitaniaPag,
        Hansel_Pag: hanselPag,
        Total: total,
        Cambio: cambio
      };
    });

    return list.sort((a, b) => {
      let cmp = 0;
      if (compSortField === "Producto") {
        cmp = a.Producto.localeCompare(b.Producto, "es", { sensitivity: "base" });
      } else if (compSortField === "Proveedor") {
        cmp = (a.Proveedor || "").localeCompare(b.Proveedor || "", "es", { sensitivity: "base" });
      } else if (compSortField === "Codigo") {
        cmp = a.Codigo.localeCompare(b.Codigo, undefined, { numeric: true });
      } else if (compSortField === "Precio_Compra") {
        cmp = a.Precio_Compra - b.Precio_Compra;
      } else if (compSortField === "Requerido") {
        cmp = a.Requerido - b.Requerido;
      } else if (compSortField === "Total") {
        cmp = a.Total - b.Total;
      } else {
        const aIsPlaza = PLAZA_CODES.has(a.Codigo.toUpperCase());
        const bIsPlaza = PLAZA_CODES.has(b.Codigo.toUpperCase());
        if (aIsPlaza && !bIsPlaza) return -1;
        if (!aIsPlaza && bIsPlaza) return 1;
        cmp = a.Codigo.localeCompare(b.Codigo);
      }
      return compSortDir === "asc" ? cmp : -cmp;
    });
  };

  const plazaMatrixData = getPlazaMatrixData();

  // Aggregate costs by provider for the financial summary
  const getProviderSummaries = () => {
    const summary: { [prov: string]: number } = {};
    plazaMatrixData.forEach((row) => {
      const prov = row.Proveedor || "Sin Proveedor";
      summary[prov] = (summary[prov] || 0) + row.Total;
    });

    return Object.entries(summary)
      .map(([provider, total]) => ({ provider, total }))
      .sort((a, b) => b.total - a.total);
  };

  const providerSummaries = getProviderSummaries();
  const grandTotalMarket = plazaMatrixData.reduce((acc, curr) => acc + curr.Total, 0);

  // Generate WhatsApp text for a provider's consolidated order
  const compileWhatsAppTextForProvider = (provName: string) => {
    const providerRows = plazaMatrixData.filter(row => row.Proveedor === provName && row.Requerido > 0);
    if (providerRows.length === 0) return "";

    let text = `*Fruver Engine Suite v9.0 - Módulo de Compras (Plaza)*\n`;
    text += `*Fecha:* ${date}\n`;
    text += `*Proveedor:* ${provName}\n\n`;
    text += `*Lista de Pedido Consolidado:*\n`;

    providerRows.forEach(row => {
      const branchDetails: string[] = [];
      if (parseQty(row.Tibasosa) > 0) branchDetails.push(`Tibasosa: ${row.Tibasosa}`);
      if (parseQty(row.Nobsa) > 0) branchDetails.push(`Nobsa: ${row.Nobsa}`);
      if (parseQty(row.Fira) > 0) branchDetails.push(`Fira: ${row.Fira}`);
      if (parseQty(row.Aquitania) > 0) branchDetails.push(`Aquitania: ${row.Aquitania}`);
      if (parseQty(row.Hansel) > 0) branchDetails.push(`Hansel: ${row.Hansel}`);

      const detailsStr = branchDetails.length > 0 ? ` [${branchDetails.join(", ")}]` : "";
      text += `• *${formatQty(row.Requerido)} ${row.Medida}* - ${row.Producto}${detailsStr}\n`;
    });

    text += `\n_Por favor confirmar recibo y preparar despacho._`;
    return text;
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-6 min-h-[calc(100vh-80px)]">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div>
          <span className="px-3 py-1 bg-blue-500/10 text-blue-700 font-bold text-xs rounded-full uppercase tracking-wider">
            {isAdminView ? "Consola Administrativa" : "Módulo de Plaza"}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-800 mt-2 flex items-center gap-2">
            🚚 Panel de Compras y Plaza
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Gestión de compras, reconciliación de monederos sucursales, canastillas de proveedores y nómina.
          </p>
        </div>

        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 scrollbar-thin">
          <button
            onClick={() => setActiveTab("plaza")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "plaza"
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            Planilla de Compras (Plaza)
          </button>

          <button
            onClick={() => setActiveTab("closures")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "closures"
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Recaudación de Cierres
            {pendingClosures.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-rose-500 text-white text-[10px] rounded-full">
                {pendingClosures.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("packaging")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "packaging"
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <Truck className="w-4 h-4" />
            Control de Canastillas
          </button>

          <button
            onClick={() => setActiveTab("ledger")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "ledger"
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <History className="w-4 h-4" />
            Libro Diario (Caja)
          </button>

          <button
            onClick={() => {
              setActiveTab("history");
              fetchPriceHistoryAll();
            }}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "history"
                ? "bg-slate-900 text-white shadow-md"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <History className="w-4 h-4 text-emerald-600" />
            Historial de Precios
          </button>
        </div>
      </header>

      {/* Message alerts */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 rounded-2xl mb-6 flex justify-between items-center text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {successMsg}
            </span>
            <button onClick={() => setSuccessMsg("")} className="text-emerald-800 hover:underline text-xs">Cerrar</button>
          </motion.div>
        )}

        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-800 rounded-2xl mb-6 flex justify-between items-center text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {errorMsg}
            </span>
            <button onClick={() => setErrorMsg("")} className="text-rose-800 hover:underline text-xs">Cerrar</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NOTIFICACIÓN DE CIERRES PENDIENTES DE ACEPTACIÓN POR HAMILTON */}
      {(() => {
        const pendingHamiltonCollections = closures.filter((c) => {
          // El mensaje le llega cuando el dinero ya fue recogido físicamente (Recaudado_Fisico === true)
          // pero aún no ha sido ingresado/reconciliado en el Libro Diario Central
          const isPhysicallyReceived = c.Recaudado_Fisico;
          const isHamilton = c.Persona_Recogio?.toLowerCase().trim() === "hamilton";
          if (!isPhysicallyReceived || !isHamilton) return false;

          // Verificar si ya existe transacción de ingreso correspondiente en el Libro Diario
          const isAccepted = walletTxs.some(tx => 
            tx.Tipo_Movimiento === "Ingreso" && 
            tx.Descripcion.includes(`Recaudo Cierre Aceptado - ${c.Sucursal} (${c.Fecha})`)
          );
          return !isAccepted;
        });
        if (pendingHamiltonCollections.length === 0) return null;

        return (
          <div className="bg-amber-50 border border-amber-200/80 rounded-3xl p-5 mb-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🔔</span>
              <h4 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider">
                Ingresos de Caja Pendientes de Aceptación (Hamilton)
              </h4>
              <span className="ml-2 px-2.5 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full animate-bounce">
                {pendingHamiltonCollections.length} reportes
              </span>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Se ha confirmado la recolección física del efectivo de las siguientes sedes. Por favor, confirme que ha recibido físicamente este dinero para aceptarlo e ingresarlo oficialmente a su Caja Central / Libro Diario:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingHamiltonCollections.map((c, idx) => {
                const neto = c.Ventas_Totales - c.Gastos_Extra;
                return (
                  <div key={idx} className="bg-white border border-slate-150 rounded-2xl p-4 flex flex-col justify-between shadow-xs hover:border-amber-300 transition">
                    <div>
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="font-bold text-slate-800 text-sm">🏪 {c.Sucursal}</span>
                        <span className="text-[10px] font-mono text-slate-500">{c.Fecha}</span>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Efectivo Declarado:</span>
                          <span className="font-semibold text-slate-700">{cop(c.Ventas_Totales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Gastos Menores (-):</span>
                          <span className="font-semibold text-rose-600">-{cop(c.Gastos_Extra)}</span>
                        </div>
                        <div className="flex justify-between pt-1.5 border-t border-slate-100 font-bold">
                          <span className="text-slate-800">Valor Neto Recibido:</span>
                          <span className="text-emerald-700 font-extrabold">{cop(neto)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomConfirm({
                            isOpen: true,
                            title: "Aceptar Ingreso de Caja",
                            message: `¿Confirma que acepta el ingreso de ${cop(neto)} proveniente de ${c.Sucursal} (${c.Fecha}) a su caja central?`,
                            onConfirm: async () => {
                              await handleAcceptHamiltonCollection(c);
                            }
                          });
                        }}
                        disabled={loading}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] rounded-xl cursor-pointer transition shadow-xs flex items-center justify-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Aceptar e Ingresar a Caja
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <main className="grid grid-cols-1 gap-6">
        {/* TAB 1: PLAZA MATRIX */}
        {activeTab === "plaza" && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
            <div className="flex flex-col gap-4 mb-6 pb-4 border-b border-slate-100">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Planilla de Compras de Plaza</h3>
                  <p className="text-slate-400 text-xs mt-1">Consolide y edite cantidades compradas, costos y observaciones por sucursal.</p>
                </div>

                <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
                  {/* View Mode Toggle */}
                  <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1">
                    <button
                      onClick={() => setViewMode("consolidated")}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                        viewMode === "consolidated"
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-850"
                      }`}
                    >
                      Vista Matriz
                    </button>
                    <button
                      onClick={() => setViewMode("by_branch")}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                        viewMode === "by_branch"
                          ? "bg-white text-slate-800 shadow-sm"
                          : "text-slate-500 hover:text-slate-850"
                      }`}
                    >
                      Vista por Sucursal
                    </button>
                    <button
                      onClick={() => setViewMode("by_provider")}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                        viewMode === "by_provider"
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-slate-500 hover:text-slate-850"
                      }`}
                    >
                      📲 Proveedores (WhatsApp)
                    </button>
                  </div>

                  {/* Day Navigation */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        const [yr, mo, dy] = date.split("-").map(Number);
                        const d = new Date(yr, mo - 1, dy);
                        d.setDate(d.getDate() - 1);
                        const nYr = d.getFullYear();
                        const nMo = String(d.getMonth() + 1).padStart(2, "0");
                        const nDy = String(d.getDate()).padStart(2, "0");
                        setDate(`${nYr}-${nMo}-${nDy}`);
                      }}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition text-xs font-bold"
                      title="Día Anterior"
                    >
                      &larr; Ant
                    </button>
                    
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="bg-transparent focus:outline-none text-xs font-bold text-slate-700 w-28"
                      />
                    </div>

                    <button
                      onClick={() => {
                        const [yr, mo, dy] = date.split("-").map(Number);
                        const d = new Date(yr, mo - 1, dy);
                        d.setDate(d.getDate() + 1);
                        const nYr = d.getFullYear();
                        const nMo = String(d.getMonth() + 1).padStart(2, "0");
                        const nDy = String(d.getDate()).padStart(2, "0");
                        setDate(`${nYr}-${nMo}-${nDy}`);
                      }}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition text-xs font-bold"
                      title="Día Siguiente"
                    >
                      Sig &rarr;
                    </button>
                  </div>

                  <button
                    onClick={() => setShowCashDistributor(!showCashDistributor)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shrink-0 ${
                      showCashDistributor
                        ? "bg-slate-900 text-white"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 border border-emerald-200"
                    }`}
                    title="Algoritmo de dispersión de efectivo a proveedores"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    Dispersar Efectivo
                  </button>

                  <button
                    onClick={() => {
                      setCsvInputDate(date);
                      setShowCsvImportModal(true);
                    }}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shrink-0"
                    title="Cargar o subir un archivo CSV de pedidos"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Cargar Pedido CSV
                  </button>

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
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shrink-0"
                    title="Añadir un producto adicional a los pedidos de hoy"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Añadir Pedido
                  </button>

                  {Object.keys(matrixEdits).length > 0 && (
                    <button
                      onClick={handleSavePlazaMatrix}
                      disabled={loading}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-extrabold rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/10 cursor-pointer shrink-0"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {loading ? "Guardando..." : "Guardar Matrix"}
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Jump Badges for previous dates with orders */}
              {allOrderDates.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-xs pt-1">
                  <span className="text-slate-400 font-semibold">Saltar a Pedido Anterior:</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {allOrderDates.slice(0, 5).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDate(d)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold transition cursor-pointer ${
                          date === d
                            ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                            : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-100"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {showCashDistributor && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-slate-900 text-white p-6 rounded-3xl border border-slate-800/80 shadow-md mb-6 overflow-hidden"
              >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
                  <div>
                    <h4 className="text-md font-extrabold text-emerald-400 flex items-center gap-2">
                      💰 Algoritmo de Dispersión de Efectivo (auto_distribute_cash)
                    </h4>
                    <p className="text-slate-400 text-xs mt-1">
                      Distribuya proporcionalmente el efectivo recaudado en Caja Central para abonar o liquidar deudas de proveedores de hoy.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowCashDistributor(false);
                      setDispersePreview([]);
                    }}
                    className="text-slate-400 hover:text-white text-xs font-bold"
                  >
                    Ocultar
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                        Efectivo disponible para dispersar ($)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-2 text-slate-500 font-bold text-sm">$</span>
                        <input
                          type="number"
                          placeholder="Ej: 1500000"
                          value={disperseAmount}
                          onChange={(e) => setDisperseAmount(e.target.value)}
                          className="w-full pl-8 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-emerald-500 text-xs font-bold text-white placeholder-slate-700"
                        />
                      </div>
                    </div>

                    <button
                      onClick={handleAutoDistributeCash}
                      className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-900 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      Calcular Dispersión Proporcional
                    </button>
                  </div>

                  {dispersePreview.length > 0 ? (
                    <div className="md:col-span-2 space-y-4">
                      <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Propuesta de Distribución Proporcional
                          </span>
                          <span className="text-xs font-bold text-emerald-400">
                            Total: {cop(dispersePreview.reduce((acc, curr) => acc + curr.allocated, 0))}
                          </span>
                        </div>
                        <div className="max-h-[200px] overflow-y-auto divide-y divide-slate-900">
                          {dispersePreview.map((item) => (
                            <div key={item.supplier} className="p-3 flex justify-between items-center hover:bg-slate-900/50">
                              <div>
                                <div className="text-xs font-extrabold text-slate-200">{item.supplier}</div>
                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                  Deuda total hoy: {cop(item.totalOwed)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-bold text-emerald-400">+{cop(item.allocated)}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  Resta: {cop(item.remaining)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => setDispersePreview([])}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          Limpiar Simulación
                        </button>
                        <button
                          onClick={handleApplyDisperse}
                          disabled={loading}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-900 rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-md shadow-emerald-500/10 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {loading ? "Aplicando..." : "Confirmar Dispersión y Pagar (FIFO)"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="md:col-span-2 border border-dashed border-slate-800 rounded-2xl flex flex-col justify-center items-center p-6 text-slate-500 text-center">
                      <p className="text-xs font-medium">No hay simulaciones de dispersión activas.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Ingrese un monto de efectivo y haga clic en Calcular para ver la propuesta.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {plazaMatrixData.length === 0 ? (
              <div className="text-center py-20 text-slate-400 text-sm italic">
                No hay pedidos ingresados para la fecha seleccionada ({date}).
              </div>
            ) : (
              <div>
                {viewMode === "by_provider" ? (
                  /* 3. BY-PROVIDER VIEW (TABLA Y WHATSAPP PARA PROVEEDORES) */
                  <div className="space-y-6">
                    <div className="bg-slate-900 text-white p-4 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-3 border border-slate-800 shadow-sm">
                      <div>
                        <h4 className="text-sm font-extrabold text-emerald-400 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-emerald-400" />
                          📲 Pedidos por Proveedor (Tabla y Envío a WhatsApp)
                        </h4>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Consulte la tabla consolidada por proveedor desglosada por sucursal. Copie o envíe directamente el pedido por WhatsApp.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const allText = providerSummaries
                              .map(p => compileWhatsAppTextForProvider(p.provider))
                              .filter(Boolean)
                              .join("\n\n------------------------------\n\n");
                            if (allText) {
                              navigator.clipboard.writeText(allText);
                              setSuccessMsg("¡Todos los pedidos de proveedores fueron copiados al portapapeles!");
                              setTimeout(() => setSuccessMsg(""), 3500);
                            }
                          }}
                          className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copiar Todos los Pedidos
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      {providerSummaries.map(({ provider, total }) => {
                        const rows = plazaMatrixData.filter(r => (r.Proveedor || "Sin Proveedor") === provider && r.Requerido > 0);
                        if (rows.length === 0) return null;

                        const providerInfo = providers.find(p => p.Proveedor.toLowerCase().trim() === provider.toLowerCase().trim());
                        const phone = providerInfo?.Celular || "";

                        return (
                          <div key={provider} className="bg-slate-50/90 border border-slate-200 rounded-3xl p-5 shadow-xs hover:shadow-md transition">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-slate-200">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-emerald-500/10 text-emerald-700 rounded-2xl">
                                  <Truck className="w-5 h-5" />
                                </div>
                                <div>
                                  <h4 className="text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                                    {provider}
                                    {phone && <span className="text-xs font-semibold text-slate-500 font-mono">({phone})</span>}
                                  </h4>
                                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                                    {rows.length} producto{rows.length !== 1 ? "s" : ""} solicitado{rows.length !== 1 ? "s" : ""}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                                <div className="text-right mr-2">
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Proveedor</span>
                                  <span className="text-sm font-black text-emerald-700 font-mono">{cop(total)}</span>
                                </div>

                                <button
                                  type="button"
                                  disabled={generatingImage === provider}
                                  onClick={() => handleGenerateImageForProvider(provider, phone, rows, total)}
                                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                                  title="Generar tarjeta de imagen del pedido para WhatsApp"
                                >
                                  <Camera className="w-3.5 h-3.5" />
                                  {generatingImage === provider ? "Generando..." : "📸 Generar Imagen"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    const text = compileWhatsAppTextForProvider(provider);
                                    if (text) {
                                      navigator.clipboard.writeText(text);
                                      setSuccessMsg(`¡Pedido de ${provider} copiado al portapapeles!`);
                                      setTimeout(() => setSuccessMsg(""), 3500);
                                    }
                                  }}
                                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                                  title="Copiar texto formateado de pedido para WhatsApp"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  Copiar Texto
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    const text = compileWhatsAppTextForProvider(provider);
                                    if (text) {
                                      const cleanPhone = phone.replace(/\D/g, "");
                                      const waUrl = cleanPhone 
                                        ? `https://wa.me/57${cleanPhone}?text=${encodeURIComponent(text)}`
                                        : `https://wa.me/?text=${encodeURIComponent(text)}`;
                                      window.open(waUrl, "_blank");
                                    }
                                  }}
                                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                                  title="Enviar texto por WhatsApp"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  Enviar WhatsApp
                                </button>
                              </div>
                            </div>

                            {/* TABLA DESGLOSADA POR SUCURSALES DEL PROVEEDOR */}
                            <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-xs">
                              <table className="w-full text-left text-xs whitespace-nowrap">
                                <thead>
                                  <tr className="bg-slate-100/90 text-slate-600 font-extrabold border-b border-slate-200 text-[10px] uppercase tracking-wider">
                                    <th className="py-2.5 px-3">PRODUCTO</th>
                                    <th className="py-2.5 px-3 text-center bg-blue-50/60 text-blue-900 font-black">TIBASOSA</th>
                                    <th className="py-2.5 px-3 text-center bg-indigo-50/60 text-indigo-900 font-black">NOBSA</th>
                                    <th className="py-2.5 px-3 text-center bg-purple-50/60 text-purple-900 font-black">FIRA</th>
                                    <th className="py-2.5 px-3 text-center bg-amber-50/60 text-amber-900 font-black">AQUITANIA</th>
                                    <th className="py-2.5 px-3 text-center bg-emerald-50/60 text-emerald-900 font-black">HANSEL</th>
                                    <th className="py-2.5 px-3 text-center bg-slate-200 text-slate-900 font-black">REQUERIDO TOTAL</th>
                                    <th className="py-2.5 px-3 text-right">COSTO UNIT</th>
                                    <th className="py-2.5 px-3 text-right font-black text-slate-900">SUBTOTAL</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                  {rows.map((row, idx) => {
                                    const qTib = parseQty(row.Tibasosa);
                                    const qNob = parseQty(row.Nobsa);
                                    const qFir = parseQty(row.Fira);
                                    const qAqu = parseQty(row.Aquitania);
                                    const qHan = parseQty(row.Hansel);

                                    return (
                                      <tr key={`${row.Codigo}-${idx}`} className="hover:bg-slate-50 transition font-medium">
                                        <td className="py-2.5 px-3 font-bold text-slate-900">{row.Producto}</td>
                                        <td className="py-2.5 px-3 text-center font-bold bg-blue-50/20 text-blue-950">{qTib > 0 ? row.Tibasosa : "-"}</td>
                                        <td className="py-2.5 px-3 text-center font-bold bg-indigo-50/20 text-indigo-950">{qNob > 0 ? row.Nobsa : "-"}</td>
                                        <td className="py-2.5 px-3 text-center font-bold bg-purple-50/20 text-purple-950">{qFir > 0 ? row.Fira : "-"}</td>
                                        <td className="py-2.5 px-3 text-center font-bold bg-amber-50/20 text-amber-950">{qAqu > 0 ? row.Aquitania : "-"}</td>
                                        <td className="py-2.5 px-3 text-center font-bold bg-emerald-50/20 text-emerald-950">{qHan > 0 ? row.Hansel : "-"}</td>
                                        <td className="py-2.5 px-3 text-center font-black text-slate-900 bg-slate-100 rounded-md">
                                          {formatQty(row.Requerido)} {row.Medida}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">{cop(row.Precio_Compra)}</td>
                                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">{cop(row.Total)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : viewMode === "by_branch" ? (
                  /* 2. BY-BRANCH VIEW */
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"].map((branchName) => {
                      const branchItems = plazaMatrixData.filter((row) => {
                        const bVal = row[branchName];
                        return parseQty(bVal) > 0;
                      });

                      const branchSubtotal = branchItems.reduce((acc, row) => {
                        const bVal = row[branchName];
                        const qty = parseQty(bVal);
                        return acc + (qty * row.Precio_Compra);
                      }, 0);

                      return (
                        <div key={branchName} className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-5 hover:shadow-md transition">
                          <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full bg-indigo-500"></span>
                              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">{branchName}</h4>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-450 block font-bold uppercase tracking-wider">Subtotal Compra</span>
                              <span className="text-xs font-extrabold text-indigo-700 font-mono">{cop(branchSubtotal)}</span>
                            </div>
                          </div>

                          {branchItems.length === 0 ? (
                            <p className="text-xs text-slate-400 italic py-6 text-center">No hay productos solicitados para esta sede hoy.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs whitespace-nowrap">
                                <thead>
                                  <tr className="text-slate-400 font-bold border-b border-slate-200 text-[9px] uppercase tracking-wider">
                                    <th className="pb-2">Cód</th>
                                    <th className="pb-2">Producto</th>
                                    <th className="pb-2 text-center w-14">Cant</th>
                                    <th className="pb-2 text-right">Costo Unit</th>
                                    <th className="pb-2 text-right">Total</th>
                                    <th className="pb-2 pl-4">Obs Sede</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {branchItems.map((row, idx) => {
                                    const bVal = row[branchName];
                                    const qty = parseQty(bVal);
                                    const obsKey = `${branchName}_Obs`;
                                    const currentObsVal = matrixEdits[row.Codigo]?.[obsKey] !== undefined 
                                      ? matrixEdits[row.Codigo][obsKey] 
                                      : row[`${branchName}_Obs`] || "";

                                    return (
                                      <tr key={`${row.Codigo}-${idx}`} className="hover:bg-white transition text-slate-700">
                                        <td className="py-2 font-mono font-bold text-slate-400 text-[10px]">{row.Codigo}</td>
                                        <td className="py-2 font-semibold text-slate-800 text-xs truncate max-w-[120px]" title={row.Producto}>{row.Producto}</td>
                                        <td className="py-2 text-center font-extrabold text-slate-950 bg-indigo-50/40 rounded-md px-1 w-14">
                                          <input
                                            type="text"
                                            value={matrixEdits[row.Codigo]?.[`${branchName}_Qty`] !== undefined ? matrixEdits[row.Codigo][`${branchName}_Qty`] : (bVal === "-" ? "" : (typeof bVal === "number" ? formatQty(bVal) : bVal))}
                                            onChange={(e) => handleMatrixEdit(row.Codigo, `${branchName}_Qty`, e.target.value)}
                                            className="w-10 bg-transparent text-center font-extrabold focus:outline-none focus:ring-0 p-0 text-xs"
                                          />
                                        </td>
                                        <td className="py-2 text-right font-mono text-slate-600 text-[11px]">{cop(row.Precio_Compra)}</td>
                                        <td className="py-2 text-right font-mono font-bold text-slate-900 text-[11px]">{cop(qty * row.Precio_Compra)}</td>
                                        <td className="py-2 pl-4 max-w-[150px]">
                                          <input
                                            type="text"
                                            placeholder="Agregar nota..."
                                            value={currentObsVal}
                                            onChange={(e) => handleMatrixEdit(row.Codigo, obsKey, e.target.value)}
                                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-700 focus:outline-none focus:border-indigo-500"
                                          />
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* 1. CONSOLIDATED MATRIZ TABLE */
                  <div className="space-y-4">
                    {/* Quick Sorting Toolbar for Comprador */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900 text-white rounded-2xl border border-slate-800 shadow">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 mr-1">
                          <ArrowUpDown className="w-4 h-4" />
                          Ordenar Tabla Por:
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCompSort("Producto")}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                            compSortField === "Producto"
                              ? "bg-emerald-500 text-slate-950 font-black shadow"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          🔤 Producto {compSortField === "Producto" ? (compSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCompSort("Proveedor")}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                            compSortField === "Proveedor"
                              ? "bg-emerald-500 text-slate-950 font-black shadow"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          🏢 Proveedor {compSortField === "Proveedor" ? (compSortDir === "asc" ? "▲ A-Z" : "▼ Z-A") : ""}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCompSort("Codigo")}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                            compSortField === "Codigo"
                              ? "bg-emerald-500 text-slate-950 font-black shadow"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          🔢 Código {compSortField === "Codigo" ? (compSortDir === "asc" ? "▲" : "▼") : ""}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCompSort("Precio_Compra")}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                            compSortField === "Precio_Compra"
                              ? "bg-emerald-500 text-slate-950 font-black shadow"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          💰 Precio Compra {compSortField === "Precio_Compra" ? (compSortDir === "asc" ? "▲" : "▼") : ""}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCompSort("Requerido")}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                            compSortField === "Requerido"
                              ? "bg-emerald-500 text-slate-950 font-black shadow"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          📦 Cant. Requerida {compSortField === "Requerido" ? (compSortDir === "asc" ? "▲" : "▼") : ""}
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCompSort("Total")}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                            compSortField === "Total"
                              ? "bg-emerald-500 text-slate-950 font-black shadow"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          💵 Total Valor {compSortField === "Total" ? (compSortDir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-inner max-h-[600px]">
                    <table className="w-full text-left text-xs border-collapse whitespace-nowrap">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[10px] sticky top-0 z-10 select-none">
                          <th className="py-3 px-3 border-r border-slate-200 sticky left-0 top-0 bg-slate-50 z-30 w-[85px] min-w-[85px] max-w-[85px] shadow-[1px_0_0_0_rgba(226,232,240,1)]">FECHA</th>
                          <th 
                            onClick={() => toggleCompSort("Codigo")}
                            className="py-3 px-3 border-r border-slate-200 sticky left-[85px] top-0 bg-slate-50 z-30 w-[70px] min-w-[70px] max-w-[70px] shadow-[1px_0_0_0_rgba(226,232,240,1)] cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center gap-1">
                              <span>CODIGO</span>
                              {compSortField === "Codigo" && (compSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                            </div>
                          </th>
                          <th 
                            onClick={() => toggleCompSort("Producto")}
                            className="py-3 px-3 border-r border-slate-200 sticky left-[155px] top-0 bg-slate-50 z-30 w-[220px] min-w-[220px] max-w-[220px] shadow-[1px_0_0_0_rgba(226,232,240,1)] cursor-pointer hover:bg-slate-200 transition text-slate-900 font-black"
                          >
                            <div className="flex items-center gap-1">
                              <span>PRODUCTO</span>
                              {compSortField === "Producto" ? (compSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                            </div>
                          </th>
                          <th className="py-3 px-3 text-center border-r border-slate-200 w-20">TIBASOSA</th>
                          <th className="py-3 px-3 text-center border-r border-slate-200 w-20">NOBSA</th>
                          <th className="py-3 px-3 text-center border-r border-slate-200 w-20">FIRA</th>
                          <th className="py-3 px-3 text-center border-r border-slate-200 w-20">AQUITANIA</th>
                          <th className="py-3 px-3 text-center border-r border-slate-200 w-20">HANSEL</th>
                          <th 
                            onClick={() => toggleCompSort("Proveedor")}
                            className="py-3 px-3 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition text-slate-900 font-black"
                          >
                            <div className="flex items-center gap-1">
                              <span>PROVEEDOR</span>
                              {compSortField === "Proveedor" ? (compSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />) : <ArrowUpDown className="w-3 h-3 text-slate-400" />}
                            </div>
                          </th>
                          <th 
                            onClick={() => toggleCompSort("Precio_Compra")}
                            className="py-3 px-3 text-right bg-amber-50/50 text-amber-900 border-r border-slate-200 cursor-pointer hover:bg-amber-100 transition"
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>PRECIO COMPRA</span>
                              {compSortField === "Precio_Compra" && (compSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-amber-700" /> : <ArrowDown className="w-3 h-3 text-amber-700" />)}
                            </div>
                          </th>
                          <th 
                            onClick={() => toggleCompSort("Requerido")}
                            className="py-3 px-3 text-center font-bold border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span>REQUERIDO</span>
                              {compSortField === "Requerido" && (compSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                            </div>
                          </th>
                          <th className="py-3 px-3 border-r border-slate-200 min-w-[200px]">OBSERVACION</th>
                          <th className="py-3 px-3 text-right border-r border-slate-200">TIBASOSA_PAG</th>
                          <th className="py-3 px-3 text-right border-r border-slate-200">NOBSA_PAG</th>
                          <th className="py-3 px-3 text-right border-r border-slate-200">FIRA_PAG</th>
                          <th className="py-3 px-3 text-right border-r border-slate-200">AQUITANIA_PAG</th>
                          <th className="py-3 px-3 text-right border-r border-slate-200">HANSEL_PAG</th>
                          <th 
                            onClick={() => toggleCompSort("Total")}
                            className="py-3 px-3 text-right font-bold text-slate-800 border-r border-slate-200 cursor-pointer hover:bg-slate-200 transition"
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>TOTAL</span>
                              {compSortField === "Total" && (compSortDir === "asc" ? <ArrowUp className="w-3 h-3 text-emerald-600" /> : <ArrowDown className="w-3 h-3 text-emerald-600" />)}
                            </div>
                          </th>
                        <th className="py-3 px-3 text-right border-r border-slate-200">Precio Unitario</th>
                        <th className="py-3 px-3 text-right text-slate-400 border-r border-slate-200">PRECIO ANTERIOR</th>
                        <th className="py-3 px-3">CAMBIO $</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {plazaMatrixData.map((row, idx) => {
                        const isPlaza = PLAZA_CODES.has(row.Codigo.toUpperCase());

                        return (
                          <tr
                            key={`${row.Codigo}-${idx}`}
                            className={`hover:bg-slate-50 transition text-slate-800 ${
                              isPlaza ? "bg-emerald-50/10 font-medium" : ""
                            }`}
                          >
                            {/* FECHA */}
                            <td className={`py-2.5 px-3 font-mono font-bold text-[11px] border-r border-slate-100 sticky left-0 z-10 w-[85px] min-w-[85px] max-w-[85px] shadow-[1px_0_0_0_rgba(226,232,240,0.8)] ${isPlaza ? "bg-emerald-50/95" : "bg-white"}`}>{row.Fecha}</td>
                            
                            {/* CODIGO */}
                            <td className={`py-2.5 px-3 font-mono font-bold text-[11px] text-slate-500 border-r border-slate-100 sticky left-[85px] z-10 w-[70px] min-w-[70px] max-w-[70px] shadow-[1px_0_0_0_rgba(226,232,240,0.8)] ${isPlaza ? "bg-emerald-50/95" : "bg-white"}`}>
                              {row.Codigo}
                              {isPlaza && (
                                <span className="ml-1 px-1 py-0.2 bg-emerald-100 text-emerald-800 text-[8px] font-black rounded-sm uppercase">P</span>
                              )}
                            </td>
                            
                            {/* PRODUCTO */}
                            <td className={`py-2.5 px-3 font-bold text-slate-900 border-r border-slate-100 text-sm sticky left-[155px] z-10 w-[220px] min-w-[220px] max-w-[220px] shadow-[1px_0_0_0_rgba(226,232,240,0.8)] ${isPlaza ? "bg-emerald-50/95" : "bg-white"}`}>
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="truncate max-w-[160px]" title={row.Producto}>{row.Producto}</span>
                                <button
                                  onClick={() => handleViewProductHistory(row.Codigo, row.Producto)}
                                  className="p-1 text-slate-400 hover:text-indigo-650 hover:bg-slate-150/80 rounded-lg transition shrink-0 cursor-pointer"
                                  title="Ver historial de variación de precios"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            
                            {/* TIBASOSA (Editable inline) */}
                            <td className="py-1 px-1.5 text-center border-r border-slate-100 w-20 bg-indigo-50/5">
                              <input
                                type="text"
                                value={matrixEdits[row.Codigo]?.Tibasosa_Qty !== undefined ? matrixEdits[row.Codigo].Tibasosa_Qty : (row.Tibasosa === "-" ? "" : (typeof row.Tibasosa === "number" ? formatQty(row.Tibasosa) : row.Tibasosa))}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Tibasosa_Qty", e.target.value)}
                                placeholder="-"
                                className="w-16 px-1 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-extrabold text-slate-850 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-xs transition"
                              />
                            </td>
                            
                            {/* NOBSA (Editable inline) */}
                            <td className="py-1 px-1.5 text-center border-r border-slate-100 w-20 bg-indigo-50/5">
                              <input
                                type="text"
                                value={matrixEdits[row.Codigo]?.Nobsa_Qty !== undefined ? matrixEdits[row.Codigo].Nobsa_Qty : (row.Nobsa === "-" ? "" : (typeof row.Nobsa === "number" ? formatQty(row.Nobsa) : row.Nobsa))}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Nobsa_Qty", e.target.value)}
                                placeholder="-"
                                className="w-16 px-1 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-extrabold text-slate-850 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-xs transition"
                              />
                            </td>
                            
                            {/* FIRA (Editable inline) */}
                            <td className="py-1 px-1.5 text-center border-r border-slate-100 w-20 bg-indigo-50/5">
                              <input
                                type="text"
                                value={matrixEdits[row.Codigo]?.Fira_Qty !== undefined ? matrixEdits[row.Codigo].Fira_Qty : (row.Fira === "-" ? "" : (typeof row.Fira === "number" ? formatQty(row.Fira) : row.Fira))}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Fira_Qty", e.target.value)}
                                placeholder="-"
                                className="w-16 px-1 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-extrabold text-slate-850 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-xs transition"
                              />
                            </td>
                            
                            {/* AQUITANIA (Editable inline) */}
                            <td className="py-1 px-1.5 text-center border-r border-slate-100 w-20 bg-indigo-50/5">
                              <input
                                type="text"
                                value={matrixEdits[row.Codigo]?.Aquitania_Qty !== undefined ? matrixEdits[row.Codigo].Aquitania_Qty : (row.Aquitania === "-" ? "" : (typeof row.Aquitania === "number" ? formatQty(row.Aquitania) : row.Aquitania))}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Aquitania_Qty", e.target.value)}
                                placeholder="-"
                                className="w-16 px-1 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-extrabold text-slate-850 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-xs transition"
                              />
                            </td>
                            
                            {/* HANSEL (Editable inline) */}
                            <td className="py-1 px-1.5 text-center border-r border-slate-100 w-20 bg-indigo-50/5">
                              <input
                                type="text"
                                value={matrixEdits[row.Codigo]?.Hansel_Qty !== undefined ? matrixEdits[row.Codigo].Hansel_Qty : (row.Hansel === "-" ? "" : (typeof row.Hansel === "number" ? formatQty(row.Hansel) : row.Hansel))}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Hansel_Qty", e.target.value)}
                                placeholder="-"
                                className="w-16 px-1 py-1 bg-slate-50 border border-slate-200 rounded-lg text-center font-extrabold text-slate-850 focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-xs transition"
                              />
                            </td>
                            
                            {/* PROVEEDOR */}
                            <td className="py-2.5 px-3 border-r border-slate-100">
                              <select
                                value={row.Proveedor}
                                onChange={(e) => handleMatrixEdit(row.Codigo, "Proveedor", e.target.value)}
                                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-slate-400"
                              >
                                <option value="Sin Proveedor">Sin Proveedor</option>
                                {providers.map((p) => (
                                  <option key={p.Proveedor} value={p.Proveedor}>
                                    {p.Proveedor}
                                  </option>
                                ))}
                              </select>
                            </td>
                            
                            {/* PRECIO COMPRA (Hamilton's input) */}
                            <td className={`py-2.5 px-3 text-right border-r border-slate-100 transition-colors ${
                              row.Precio_Compra > row.Precio_Anterior 
                                ? "bg-rose-50/80" 
                                : row.Precio_Compra < row.Precio_Anterior 
                                  ? "bg-emerald-50/80" 
                                  : ""
                            }`}>
                              <div className="relative inline-block">
                                <input
                                  type="number"
                                  value={row.Precio_Compra || ""}
                                  onChange={(e) => handleMatrixEdit(row.Codigo, "Costo_Momento", parseFloat(e.target.value) || 0)}
                                  className={`w-24 px-2 py-1 border rounded-lg font-mono text-center font-extrabold focus:outline-none focus:ring-1 transition-all ${
                                    row.Precio_Compra > row.Precio_Anterior
                                      ? "border-rose-300 bg-rose-100 text-rose-950 focus:ring-rose-400"
                                      : row.Precio_Compra < row.Precio_Anterior
                                        ? "border-emerald-300 bg-emerald-100 text-emerald-950 focus:ring-emerald-400"
                                        : "border-slate-200 bg-slate-50 text-slate-900 focus:ring-slate-400"
                                  }`}
                                />
                                {row.Precio_Compra !== row.Precio_Anterior && (
                                  <span className="absolute -top-1.5 -right-1.5 flex h-2.5 w-2.5">
                                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                      row.Precio_Compra > row.Precio_Anterior ? "bg-rose-400" : "bg-emerald-400"
                                    }`}></span>
                                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                                      row.Precio_Compra > row.Precio_Anterior ? "bg-rose-500" : "bg-emerald-500"
                                    }`}></span>
                                  </span>
                                )}
                              </div>
                            </td>
                            
                            {/* REQUERIDO */}
                            <td className="py-2.5 px-3 text-center font-extrabold text-slate-900 text-sm border-r border-slate-100">
                              {formatQty(row.Requerido)}
                            </td>
                            
                            {/* OBSERVACION (Interactive sub-inputs per active branch) */}
                            <td className="py-1.5 px-2 border-r border-slate-100 text-slate-650 min-w-[200px]">
                              <div className="flex flex-col gap-1">
                                {["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"].map((branchName) => {
                                  const bVal = row[branchName];
                                  const qty = parseQty(bVal);
                                  const keyObs = `${branchName}_Obs`;
                                  const currentObsVal = matrixEdits[row.Codigo]?.[keyObs] !== undefined 
                                    ? matrixEdits[row.Codigo][keyObs] 
                                    : row[`${branchName}_Obs`] || "";

                                  if (qty <= 0 && !currentObsVal) return null;

                                  return (
                                    <div key={branchName} className="flex items-center gap-1.5 text-[10px]">
                                      <span className="font-extrabold text-[9px] px-1 py-0.2 bg-slate-100 rounded text-slate-650 w-11 text-center uppercase shrink-0">
                                        {branchName.slice(0, 4)}
                                      </span>
                                      <input
                                        type="text"
                                        placeholder="Añadir nota de sede..."
                                        value={currentObsVal}
                                        onChange={(e) => handleMatrixEdit(row.Codigo, keyObs, e.target.value)}
                                        className="w-full px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-700 focus:bg-white focus:outline-none focus:border-slate-400"
                                      />
                                    </div>
                                  );
                                })}
                                {!["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"].some(b => parseQty(row[b]) > 0 || (matrixEdits[row.Codigo]?.[`${b}_Obs`] !== undefined ? matrixEdits[row.Codigo][`${b}_Obs`] : row[`${b}_Obs`])) && (
                                  <span className="text-slate-400 italic text-[10px]">Sin pedidos</span>
                                )}
                              </div>
                            </td>
                            
                            {/* TIBASOSA_PAG */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">{cop(row.Tibasosa_Pag)}</td>
                            
                            {/* NOBSA_PAG */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">{cop(row.Nobsa_Pag)}</td>
                            
                            {/* FIRA_PAG */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">{cop(row.Fira_Pag)}</td>
                            
                            {/* AQUITANIA_PAG */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">{cop(row.Aquitania_Pag)}</td>
                            
                            {/* HANSEL_PAG */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">{cop(row.Hansel_Pag)}</td>
                            
                            {/* TOTAL */}
                            <td className="py-2.5 px-3 text-right font-mono font-extrabold text-slate-950 border-r border-slate-100 text-sm bg-slate-50/30">
                              {cop(row.Total)}
                            </td>
                            
                            {/* Precio Unitario */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 border-r border-slate-100">{cop(row.Precio_Compra)}</td>
                            
                            {/* PRECIO ANTERIOR */}
                            <td className="py-2.5 px-3 text-right font-mono text-slate-400 border-r border-slate-100">{cop(row.Precio_Anterior)}</td>
                            
                            {/* CAMBIO $ */}
                            <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                              row.Cambio > 0 ? "text-rose-600" : row.Cambio < 0 ? "text-emerald-600" : "text-slate-400"
                            }`}>
                              {row.Cambio > 0 ? `+${cop(row.Cambio)}` : row.Cambio < 0 ? cop(row.Cambio) : "$ 0"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

                {/* RESUMEN DE COMPRAS POR PROVEEDOR & LOGISTICA DISPATCH */}
                <div className="mt-8 border-t border-slate-100 pt-6">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="text-md font-bold text-slate-800">Resumen de Compras por Proveedor</h4>
                    <span className="text-xs text-slate-400 font-medium">Consolida el total de compras por comerciante y despacha por WhatsApp de forma directa.</span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    {providerSummaries.map((s) => {
                      const provObj = providers.find((p) => p.Proveedor === s.provider);
                      const phone = provObj?.Celular !== undefined && provObj?.Celular !== null ? String(provObj.Celular) : "";
                      const waText = compileWhatsAppTextForProvider(s.provider);
                      const cleanPhone = phone.replace(/[^0-9]/g, "");
                      // Auto prefix Colombian standard if mobile format
                      const finalPhone = cleanPhone.startsWith("57") ? cleanPhone : (cleanPhone ? "57" + cleanPhone : "");
                      const waUrl = finalPhone ? `https://wa.me/${finalPhone}?text=${encodeURIComponent(waText)}` : "";

                      return (
                        <div key={s.provider} className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PROVEEDOR</span>
                            <div className="text-sm font-extrabold text-slate-800 mt-0.5">{s.provider}</div>
                            <div className="text-lg font-black text-slate-900 mt-2">{cop(s.total)}</div>
                          </div>
                          
                          <div className="mt-4 pt-3 border-t border-slate-200/50 flex justify-between items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-bold truncate">Tel: {phone || "Sin Registrar"}</span>
                            {waUrl && s.total > 0 ? (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 bg-emerald-500 text-slate-950 hover:bg-emerald-600 border border-emerald-500 rounded-xl text-xs font-black transition flex items-center gap-1 cursor-pointer shadow-sm"
                                title="Enviar consolidado de compras a WhatsApp del proveedor"
                              >
                                Logística WA
                              </a>
                            ) : (
                              <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-1 rounded-md">Sin WA Link</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* GRAND TOTAL BUDGET BANNER */}
                  <div className="mt-6 bg-[#facc15] text-slate-950 px-6 py-4 rounded-2xl border border-[#eab308] flex justify-between items-center shadow-sm">
                    <span className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-950" /> TOTAL CONSOLIDADO DE COMPRAS DE HOY
                    </span>
                    <span className="text-lg font-black font-mono">
                      Total general = {cop(grandTotalMarket)}
                    </span>
                  </div>
                </div>

                {/* PRICE HISTORY MODAL */}
                <AnimatePresence>
                  {historyModalOpen && selectedProductCode && (
                    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex justify-center items-center p-4">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white rounded-3xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden"
                      >
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                          <div>
                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">HISTORIAL DE VARIACIÓN</span>
                            <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">{selectedProductName || "Producto"}</h3>
                            <p className="text-[10px] text-slate-450 font-mono mt-0.5">Código: {selectedProductCode}</p>
                          </div>
                          <button
                            onClick={() => {
                              setHistoryModalOpen(false);
                              setHistoryProductData([]);
                            }}
                            className="p-2 hover:bg-slate-200/80 rounded-full text-slate-450 hover:text-slate-650 transition cursor-pointer"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        <div className="p-6 max-h-[400px] overflow-y-auto">
                          {historyLoading ? (
                            <div className="flex flex-col items-center justify-center py-12">
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 animate-infinite"></div>
                              <span className="text-xs text-slate-450 mt-2">Buscando variaciones históricas...</span>
                            </div>
                          ) : historyProductData.length === 0 ? (
                            <div className="text-center py-12 text-slate-450 text-xs italic">
                              No hay registros de variaciones de precios de compra guardados para este producto.
                            </div>
                          ) : (
                            <>
                              {historyProductData.length > 1 && (
                                <div className="h-[180px] w-full bg-slate-50 p-3 rounded-2xl border border-slate-100/80 mb-6">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart
                                      data={[...historyProductData]
                                        .sort((a, b) => a.Fecha_Hora.localeCompare(b.Fecha_Hora))
                                        .map((item) => ({
                                          fecha: new Date(item.Fecha_Hora).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" }),
                                          precio: item.Costo_Nuevo,
                                        }))}
                                      margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                                    >
                                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                      <XAxis dataKey="fecha" stroke="#94a3b8" fontSize={9} tickLine={false} />
                                      <YAxis stroke="#94a3b8" fontSize={9} tickLine={false} width={60} />
                                      <ChartTooltip
                                        formatter={(value: any) => [cop(Number(value)), "Costo de Compra"]}
                                        contentStyle={{ backgroundColor: "#1e293b", borderRadius: "12px", border: "none", color: "#fff", fontSize: "11px" }}
                                      />
                                      <Line type="monotone" dataKey="precio" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Costo de Compra" />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              )}
                              <div className="relative border-l border-indigo-100 pl-4 space-y-6">
                              {historyProductData.map((item, index) => {
                                const isHighest = index === 0;
                                return (
                                  <div key={index} className="relative">
                                    <span className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full border-2 border-white ${
                                      isHighest ? "bg-indigo-500 ring-4 ring-indigo-50" : "bg-slate-300"
                                    }`} />
                                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/40">
                                      <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-mono text-slate-450 uppercase">{new Date(item.Fecha_Hora).toLocaleString("es-CO")}</span>
                                        <span className="text-xs font-black text-slate-800 font-mono">{cop(item.Costo_Nuevo)}</span>
                                      </div>
                                      <div className="flex justify-between items-center text-[10px]">
                                        <span className="text-slate-400">Registrado por: <strong className="text-slate-650">{item.Usuario || "N/A"}</strong></span>
                                        {item.Costo_Anterior !== undefined && item.Costo_Anterior !== item.Costo_Nuevo ? (
                                          <span className={item.Costo_Nuevo > item.Costo_Anterior ? "text-rose-500 font-bold" : "text-emerald-500 font-bold"}>
                                            {item.Costo_Nuevo > item.Costo_Anterior ? "▲" : "▼"} {cop(Math.abs(item.Costo_Nuevo - item.Costo_Anterior))}
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                              </div>
                            </>
                          )}
                        </div>

                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                          <button
                            onClick={() => {
                              setHistoryModalOpen(false);
                              setHistoryProductData([]);
                            }}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                          >
                            Cerrar Ventana
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RECAUDACION DE CIERRES */}
        {activeTab === "closures" && (
          <div className="space-y-6">
            {/* 1. Branch Wallets Status Grid */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-2">💰 Saldo Acumulado a Recoger (Historial de Monederos)</h3>
              <p className="text-slate-400 text-xs mb-6">Consulte el saldo neto actual en el monedero de cada sucursal que debe ser recogido físicamente por el transportador o comprador.</p>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {["Nobsa", "Tibasosa", "Fira", "Aquitania", "Hansel"].map((bName) => {
                  const uncollected = getBranchUncollected(bName);
                  const count = getBranchPendingCount(bName);
                  return (
                    <div key={bName} className="p-4 border border-slate-200 rounded-2xl bg-slate-50 flex flex-col justify-between shadow-xs hover:border-slate-300 transition">
                      <div>
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-slate-800 text-sm">Sede {bName}</span>
                          {uncollected > 0 && (
                            <span className="animate-pulse w-2.5 h-2.5 rounded-full bg-amber-500" />
                          )}
                        </div>
                        <div className="mt-3">
                          <span className="text-slate-400 text-[10px] uppercase block tracking-wider font-semibold">Saldo a Recoger</span>
                          <span className="text-lg font-black text-slate-800 font-mono">{cop(uncollected)}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-1">{count} cierres sin recaudar</span>
                      </div>

                      <div className="mt-4">
                        <button
                          onClick={() => {
                            if (count === 0) {
                              setErrorMsg(`La sede ${bName} no tiene saldo o cierres pendientes por recoger.`);
                              return;
                            }
                            setPickupModal({
                              isOpen: true,
                              branchName: bName,
                              totalAmount: uncollected
                            });
                            setPickupAmount(String(uncollected));
                          }}
                          disabled={loading || count === 0}
                          className={`w-full py-2.5 text-[11px] font-extrabold rounded-xl transition flex justify-center items-center gap-1 cursor-pointer ${
                            count > 0 
                              ? "bg-slate-900 text-white hover:bg-slate-800 shadow-sm" 
                              : "bg-slate-100 text-slate-400 cursor-not-allowed"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          {loading ? "Sincronizando..." : count > 0 ? "Confirmar Recibo" : "Sin pendientes"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. Individual Pending Closures List */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-2">📋 Detalle de Cierres Individuales</h3>
              <p className="text-slate-400 text-xs mb-6">Historial detallado de reportes diarios de caja pendientes de conciliación física.</p>

              {pendingClosures.length === 0 ? (
                <div className="text-center py-16 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-center items-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                  <p className="text-slate-800 font-bold">¡Todo Reconciliado!</p>
                  <p className="text-slate-400 text-xs mt-1">No hay cierres de caja pendientes de recolección de efectivo.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pendingClosures.map((c, idx) => {
                    const neto = c.Ventas_Totales - c.Gastos_Extra;
                    return (
                      <div key={idx} className="p-5 border border-slate-200 rounded-3xl bg-slate-50 hover:bg-slate-100/50 transition flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                            <span className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
                              🏪 Tienda {c.Sucursal}
                            </span>
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-700 font-bold text-[9px] rounded-full uppercase tracking-wider">
                              Pendiente
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs leading-relaxed">
                            <div>
                              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[9px]">Fecha Cierre</span>
                              <span className="font-bold text-slate-700">{c.Fecha}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[9px]">Persona que va a recoger</span>
                              <span className="font-bold text-slate-700">{c.Persona_Recogio}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[9px]">Ventas Declaradas</span>
                              <span className="font-bold text-slate-700">{cop(c.Ventas_Totales)}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[9px]">Gastos Extra (-)</span>
                              <span className="font-bold text-rose-600">-{cop(c.Gastos_Extra)}</span>
                            </div>
                          </div>

                          {c.Descripcion_Gastos && (
                            <div className="text-[10px] text-slate-500 bg-slate-100 p-2.5 rounded-xl border border-slate-200/50">
                              <strong>Conceptos de Gastos:</strong> {c.Descripcion_Gastos}
                            </div>
                          )}

                          <div className="pt-3 border-t border-slate-200/80 flex justify-between items-center">
                            <span className="text-slate-500 font-bold text-xs uppercase tracking-wider">Efectivo Neto a Recibir</span>
                            <span className="text-lg font-extrabold text-emerald-600 font-mono">{cop(neto)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setCustomConfirm({
                              isOpen: true,
                              title: "Confirmar Recibo Físico de Dinero",
                              message: `¿Confirma que ha recibido físicamente el valor neto de ${cop(neto)} proveniente de la sucursal ${c.Sucursal} (${c.Fecha})?`,
                              onConfirm: async () => {
                                await handleApproveClosure(c);
                              }
                            });
                          }}
                          disabled={loading}
                          className="w-full mt-5 py-2.5 bg-slate-900 hover:bg-slate-850 text-white rounded-2xl font-bold text-xs flex justify-center items-center gap-1.5 cursor-pointer"
                        >
                          <UserCheck className="w-4 h-4" />
                          {loading ? "Confirmando..." : "Confirmar Recibo Físico de Dinero"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CONTROL DE CANASTILLAS */}
        {activeTab === "packaging" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm lg:col-span-1">
              <h3 className="text-lg font-bold text-slate-800 mb-2">Registro de Movimiento</h3>
              <p className="text-slate-400 text-xs mb-6">Registre las canastillas o estibas entregadas o recibidas de los proveedores.</p>

              <form onSubmit={handleSavePackaging} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Proveedor *
                  </label>
                  <select
                    value={packProvider}
                    onChange={(e) => setPackProvider(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold"
                  >
                    <option value="">Seleccione proveedor</option>
                    {providers.map((p) => (
                      <option key={p.Proveedor} value={p.Proveedor}>
                        {p.Proveedor}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Tipo de Activo *
                  </label>
                  <select
                    value={packType}
                    onChange={(e) => setPackType(e.target.value as any)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold"
                  >
                    <option value="Canastilla">Canastilla de Plástico</option>
                    <option value="Estiva">Estiva de Madera/Plástico</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Entran (Entregado)
                    </label>
                    <input
                      type="number"
                      placeholder="0"
                      value={packDelivered}
                      onChange={(e) => setPackDelivered(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Salen (Devuelto)
                    </label>
                    <input
                      type="number"
                      placeholder="0"
                      value={packReturned}
                      onChange={(e) => setPackReturned(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Notas / Observaciones
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ej: Canastillas rotas, devolución flete..."
                    value={packNotes}
                    onChange={(e) => setPackNotes(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold placeholder-slate-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 text-white rounded-xl font-bold text-sm shadow-md flex justify-center items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  {loading ? "Registrando..." : "Guardar Registro"}
                </button>
              </form>
            </div>

            {/* Balances & Logs */}
            <div className="lg:col-span-2 space-y-6">
              {/* Balances */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
                <h3 className="text-lg font-bold text-slate-800 mb-2">Saldos Netos de Envases con Proveedores</h3>
                <p className="text-slate-400 text-xs mb-4">Balance neto de canastillas y estibas pendientes de devolución (Positivo = Proveedor nos debe / Negativo = Debemos al proveedor).</p>

                {basketBalances.length === 0 ? (
                  <p className="text-slate-400 text-xs italic text-center py-8">No hay saldos pendientes registrados.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {basketBalances.map(([prov, bal]: any) => (
                      <div key={prov} className="p-4 border border-slate-200 rounded-2xl bg-slate-50 flex justify-between items-center text-xs">
                        <div>
                          <div className="font-extrabold text-slate-800 text-sm">{prov}</div>
                          <div className="text-slate-400 mt-1">Saldos de empaque</div>
                        </div>
                        <div className="text-right font-mono font-bold space-y-1">
                          {bal.canastillas !== 0 && (
                            <div className={bal.canastillas > 0 ? "text-emerald-600" : "text-rose-600"}>
                              Canastillas: {bal.canastillas > 0 ? "+" : ""}{bal.canastillas}
                            </div>
                          )}
                          {bal.estivas !== 0 && (
                            <div className={bal.estivas > 0 ? "text-blue-600" : "text-rose-600"}>
                              Estivas: {bal.estivas > 0 ? "+" : ""}{bal.estivas}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* logs */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col">
                <h3 className="text-lg font-bold text-slate-800 mb-2">Historial de Movimiento de Activos</h3>
                <p className="text-slate-400 text-xs mb-4">Registro reciente de logística de envases.</p>

                <div className="overflow-x-auto max-h-[300px]">
                  {packagingLogs.length === 0 ? (
                    <p className="text-slate-400 text-xs italic text-center py-10">No hay movimientos registrados.</p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                          <th className="py-2.5 px-2">Fecha</th>
                          <th className="py-2.5 px-2">Proveedor</th>
                          <th className="py-2.5 px-2">Tipo Activo</th>
                          <th className="py-2.5 px-2 text-center">Entregados</th>
                          <th className="py-2.5 px-2 text-center">Devueltos</th>
                          <th className="py-2.5 px-2">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {packagingLogs.map((log) => (
                          <tr key={log.ID_Movimiento} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                            <td className="py-2 px-2 text-slate-500 font-medium">{log.Fecha}</td>
                            <td className="py-2 px-2 font-bold text-slate-800">{log.Proveedor}</td>
                            <td className="py-2 px-2 text-slate-600 font-semibold">{log.Tipo_Activo}</td>
                            <td className="py-2 px-2 text-center text-emerald-600 font-bold">+{log.Cantidad_Entregada}</td>
                            <td className="py-2 px-2 text-center text-rose-600 font-bold">-{log.Cantidad_Devuelta}</td>
                            <td className="py-2 px-2 text-slate-400 italic max-w-xs truncate">{log.Notas || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}



        {/* TAB 5: LIBRO DIARIO DE FLUJO DE CAJA */}
        {activeTab === "ledger" && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Libro Diario de Flujo de Caja</h3>
                <p className="text-slate-400 text-xs mt-1">Consolidado central del flujo de caja (Caja Central / Monedero Nequi).</p>
              </div>
              
              {/* Reconciliation Fields */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row gap-4 items-center shrink-0 w-full sm:w-auto">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Valor Total de Pedidos ($)
                  </label>
                  <input
                    type="number"
                    value={valorTotalPedidos || ""}
                    onChange={(e) => handleUpdateValorTotalPedidos(parseFloat(e.target.value) || 0)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none text-xs font-bold text-slate-800 w-44"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Valor Real Recogido en Mercado ($)
                  </label>
                  <input
                    type="number"
                    value={valorRealRecogido || ""}
                    onChange={(e) => handleUpdateValorRealRecogido(parseFloat(e.target.value) || 0)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none text-xs font-bold text-slate-800 w-44"
                  />
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Diferencia Conciliación</div>
                  <div className={`text-sm font-extrabold mt-1 ${valorRealRecogido - valorTotalPedidos < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {cop(valorRealRecogido - valorTotalPedidos)}
                  </div>
                </div>
              </div>
            </div>

            {/* Form to add transaction */}
            <form onSubmit={handleSaveLedgerTransaction} className="bg-slate-50 p-6 rounded-2xl border border-slate-200/80 mb-6">
              <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-slate-500" /> Registrar Movimiento en Caja Central
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Fecha</label>
                  <input
                    type="date"
                    value={ledgerDate}
                    onChange={(e) => setLedgerDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tipo</label>
                  <select
                    value={ledgerType}
                    onChange={(e) => setLedgerType(e.target.value as "Ingreso" | "Gasto")}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  >
                    <option value="Gasto">Salida (Gasto)</option>
                    <option value="Ingreso">Entrada (Ingreso)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Valor ($)</label>
                  <input
                    type="number"
                    value={ledgerValue}
                    onChange={(e) => setLedgerValue(e.target.value)}
                    placeholder="Monto"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Descripción</label>
                  <input
                    type="text"
                    value={ledgerDesc}
                    onChange={(e) => setLedgerDesc(e.target.value)}
                    placeholder="Ej: Pago mercado ADRIAN o Retiro administrativo"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer transition"
                  >
                    {loading ? "Guardando..." : "Registrar Transacción"}
                  </button>
                </div>
              </div>
            </form>

            {/* Ledger Controls (Search & Export) */}
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-md">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="Filtrar libro diario por descripción..."
                  value={searchLedger}
                  onChange={(e) => setSearchLedger(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-400 focus:bg-white transition"
                />
              </div>
              <button
                type="button"
                onClick={handleExportToXLSX}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-2 cursor-pointer border border-slate-950"
              >
                <FileText className="w-4 h-4" />
                Exportar a Excel (.xlsx)
              </button>
            </div>

            {/* Ledger Table */}
            {ledgerTransactions.length === 0 ? (
              <div className="text-center py-20 text-slate-400 text-sm italic">
                No hay registros en el libro diario. Registre su primera transacción arriba.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4 text-emerald-600">Entradas (Ingresos)</th>
                      <th className="py-3 px-4 text-rose-600">Salidas (Egresos)</th>
                      <th className="py-3 px-4 font-extrabold text-slate-700">Saldo</th>
                      <th className="py-3 px-4">Descripción / Concepto</th>
                      <th className="py-3 px-4">Responsable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Chronological ascending calculate cumulative balance first
                      const sortedTxs = [...ledgerTransactions].sort((a, b) => a.Fecha.localeCompare(b.Fecha));
                      let runningBalance = 0;
                      
                      const txsWithBalance = sortedTxs.map((tx) => {
                        const entradas = tx.Tipo_Movimiento === "Ingreso" ? tx.Valor : 0;
                        const salidas = tx.Tipo_Movimiento === "Gasto" ? tx.Valor : 0;
                        runningBalance = runningBalance + entradas - salidas;
                        return { ...tx, runningBalance, entradas, salidas };
                      });

                      // Apply filter
                      const filteredTxs = txsWithBalance.filter(tx => 
                        (tx.Descripcion || "").toLowerCase().includes((searchLedger || "").toLowerCase())
                      );

                      if (filteredTxs.length === 0) {
                        return (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-slate-400 italic">
                              No se encontraron transacciones que coincidan con "{searchLedger}"
                            </td>
                          </tr>
                        );
                      }

                      // Reverse for displaying newest transactions at the top
                      return [...filteredTxs].reverse().map((tx, idx) => {
                        const descLower = (tx.Descripcion || "").toLowerCase();
                        const isPagoMercado = descLower.includes("pago mercado") || 
                                              descLower.includes("mercado") || 
                                              descLower.includes("proveedor");

                        const isRetiroAdmin = descLower.includes("retiro") || 
                                              descLower.includes("admin") || 
                                              descLower.includes("nómina") || 
                                              descLower.includes("sueldo") ||
                                              descLower.includes("nomina");

                        let rowStyle = "hover:bg-slate-50 border-b border-slate-100";
                        if (isPagoMercado) {
                          rowStyle = "bg-[#fef08a] font-bold text-slate-900 border-b border-slate-200";
                        } else if (isRetiroAdmin) {
                          rowStyle = "bg-[#dbeafe] text-slate-900 border-b border-slate-200";
                        }

                        return (
                          <tr key={idx} className={`${rowStyle} transition text-slate-800`}>
                            <td className="py-3 px-4 font-semibold">{tx.Fecha}</td>
                            <td className={`py-3 px-4 font-bold ${tx.entradas > 0 && !isPagoMercado && !isRetiroAdmin ? "text-emerald-600" : ""}`}>
                              {tx.entradas > 0 ? cop(tx.entradas) : "-"}
                            </td>
                            <td className={`py-3 px-4 font-bold ${tx.salidas > 0 && !isPagoMercado && !isRetiroAdmin ? "text-rose-600" : ""}`}>
                              {tx.salidas > 0 ? cop(tx.salidas) : "-"}
                            </td>
                            <td className="py-3 px-4 font-extrabold">{cop(tx.runningBalance)}</td>
                            <td className="py-3 px-4 italic font-medium">{tx.Descripcion}</td>
                            <td className="py-3 px-4 font-medium text-slate-500">{tx.Responsable}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: HISTORIAL DE CAMBIO DE PRECIOS */}
        {activeTab === "history" && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-600" />
                  Historial de Cambio de Precios por Producto
                </h3>
                <p className="text-slate-400 text-xs mt-1">Busque un producto para ver el historial detallado de variaciones de precios y costos registrados.</p>
              </div>

              {/* Product Selector with Autocomplete */}
              <div className="relative flex items-center gap-2 z-30">
                <span className="text-[11px] font-black text-slate-500 uppercase hidden sm:inline">Seleccionar Producto:</span>
                <div className="relative w-64 sm:w-72">
                  <input
                    type="text"
                    placeholder="🔍 Buscar por nombre o código..."
                    value={historySearchTermTab}
                    onFocus={() => setHistoryShowSuggestionsTab(true)}
                    onBlur={() => {
                      setTimeout(() => {
                        setHistoryShowSuggestionsTab(false);
                      }, 250);
                    }}
                    onChange={(e) => {
                      setHistorySearchTermTab(e.target.value);
                      setHistoryShowSuggestionsTab(true);
                    }}
                    className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 pr-8 transition-all"
                  />
                  {historySearchTermTab && (
                    <button
                      type="button"
                      onClick={() => {
                        setHistorySearchTermTab("");
                        setHistorySelectedProductTab("all");
                        setHistoryShowSuggestionsTab(false);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                    >
                      ✕
                    </button>
                  )}

                  {historyShowSuggestionsTab && (
                    <div className="absolute right-0 top-full mt-1.5 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl z-[999] p-2 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setHistorySelectedProductTab("all");
                          setHistorySearchTermTab("Todos los Productos");
                          setHistoryShowSuggestionsTab(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all truncate flex items-center justify-between ${
                          historySelectedProductTab === "all" ? "bg-emerald-500 text-white" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span>[Ver Todos los Cambios]</span>
                      </button>

                      {(() => {
                        // Gather unique products from priceHistory
                        const uniqueHistoryProductsTab = Array.from(
                          new Set(priceHistory.map((h) => JSON.stringify({ Codigo: h.Codigo, Producto: h.Producto })))
                        ).map((str) => JSON.parse(str) as { Codigo: string; Producto: string })
                         .sort((a, b) => a.Producto.localeCompare(b.Producto));

                        const filtered = uniqueHistoryProductsTab.filter(
                          (p) =>
                            p.Producto.toLowerCase().includes(historySearchTermTab.toLowerCase()) ||
                            p.Codigo.toLowerCase().includes(historySearchTermTab.toLowerCase())
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
                            key={`${p.Codigo}-${idx}`}
                            type="button"
                            onClick={() => {
                              setHistorySelectedProductTab(p.Codigo);
                              setHistorySearchTermTab(p.Producto);
                              setHistoryShowSuggestionsTab(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all truncate flex items-center justify-between ${
                              historySelectedProductTab === p.Codigo
                                ? "bg-emerald-500 text-white"
                                : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span className="truncate">{p.Producto}</span>
                            <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ml-2 ${
                              historySelectedProductTab === p.Codigo ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
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

            {historyLoading ? (
              <div className="py-20 text-center text-slate-500 italic flex flex-col items-center justify-center gap-2">
                <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                Cargando historial de cambios...
              </div>
            ) : (
              <div className="space-y-6">
                {/* Changes List */}
                {(() => {
                  const filteredRecords = priceHistory.filter((h) => {
                    if (historySelectedProductTab === "all" || !historySelectedProductTab) return true;
                    return h.Codigo.toUpperCase().trim() === historySelectedProductTab.toUpperCase().trim();
                  }).sort((a, b) => b.Fecha_Hora.localeCompare(a.Fecha_Hora));

                  if (filteredRecords.length === 0) {
                    return (
                      <div className="text-center py-16 text-slate-400 italic text-sm">
                        No hay cambios de precios registrados {historySelectedProductTab !== "all" ? "para este producto." : "en la base de datos."}
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      {/* Metric widgets */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl">
                          <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Ajustes Encontrados</span>
                          <p className="text-2xl font-black text-slate-800 mt-1">{filteredRecords.length}</p>
                          <p className="text-[10px] text-slate-450 mt-1">Registros de variación en el filtro actual</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl">
                          <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Última Modificación</span>
                          <p className="text-sm font-black text-slate-800 mt-1.5 truncate">
                            {filteredRecords[0]?.Producto || "-"}
                          </p>
                          <p className="text-[10px] text-slate-450 mt-1">
                            {filteredRecords[0] ? new Date(filteredRecords[0].Fecha_Hora).toLocaleString() : ""}
                          </p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl">
                          <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Usuario Más Activo</span>
                          <p className="text-lg font-black text-emerald-700 mt-1">
                            {(() => {
                              const counts: { [u: string]: number } = {};
                              filteredRecords.forEach((r) => {
                                counts[r.Usuario] = (counts[r.Usuario] || 0) + 1;
                              });
                              const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                              return sorted[0] ? `${sorted[0][0]} (${sorted[0][1]} camb.)` : "-";
                            })()}
                          </p>
                          <p className="text-[10px] text-slate-450 mt-1">Responsable con más auditorías de precios</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 max-h-[500px]">
                        <table className="w-full text-left text-xs border-collapse bg-white whitespace-nowrap">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[9px] sticky top-0">
                              <th className="py-3 px-4">Fecha y Hora</th>
                              <th className="py-3 px-2">Código</th>
                              <th className="py-3 px-2">Producto</th>
                              <th className="py-3 px-2 text-right">Costo Ant.</th>
                              <th className="py-3 px-2 text-right">Costo Nuevo</th>
                              <th className="py-3 px-2 text-right">Venta Ant.</th>
                              <th className="py-3 px-2 text-right">Venta Nueva</th>
                              <th className="py-3 px-2 text-center">Var. Costo</th>
                              <th className="py-3 px-2 text-center">Var. Venta</th>
                              <th className="py-3 px-4">Responsable</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredRecords.map((h, idx) => {
                              const rowCostDiff = h.Costo_Nuevo - h.Costo_Anterior;
                              const rowVentaDiff = h.Venta_Nueva - h.Venta_Anterior;
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50 transition">
                                  <td className="py-2.5 px-4 text-slate-500 font-medium">{new Date(h.Fecha_Hora).toLocaleString()}</td>
                                  <td className="py-2.5 px-2 font-mono font-bold text-slate-400">{h.Codigo}</td>
                                  <td className="py-2.5 px-2 font-bold text-slate-800 max-w-[150px] truncate" title={h.Producto}>{h.Producto}</td>
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
                                  <td className="py-2.5 px-4 font-medium text-slate-600">{h.Usuario}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </main>

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
                  <h3 className="text-lg font-bold text-slate-800">Añadir Producto Adicional a Pedidos</h3>
                  <p className="text-slate-500 text-xs mt-0.5">Fecha activa: <span className="font-extrabold text-indigo-600">{date}</span></p>
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
                          <Search className="w-4 h-4" />
                        </span>
                        <input
                          type="text"
                          placeholder="Buscar por nombre o código de producto..."
                          value={newOrderSearchQuery}
                          onChange={(e) => setNewOrderSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 transition"
                        />
                      </div>

                      {/* Filter matches */}
                      <div className="border border-slate-150 rounded-2xl max-h-48 overflow-y-auto divide-y divide-slate-100 bg-slate-50 scrollbar-thin">
                        {(() => {
                          const q = (newOrderSearchQuery || "").toLowerCase().trim();
                          const matches = products.filter(
                            (p) =>
                              (p.Codigo || "").toLowerCase().includes(q) ||
                              (p.Producto || "").toLowerCase().includes(q)
                          );

                          if (matches.length === 0) {
                            return <div className="p-4 text-center text-slate-400 text-xs italic">No se encontraron productos</div>;
                          }

                          return matches.map((p, idx) => (
                            <button
                              key={`${p.Codigo}-${idx}`}
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
                        {["Tibasosa", "Nobsa", "Fira", "Aquitania", "Hansel"].map((branchName) => (
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
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
                    <AlertCircle className="w-5 h-5" />
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

        {/* PICKUP MODAL WITH CUSTOM AMOUNT */}
        {pickupModal && pickupModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-black text-slate-800">
                    💰 Registrar Recolección - Sede {pickupModal.branchName}
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-bold">Saldo total a recoger:</span>
                    <span className="text-sm font-black text-slate-800 font-mono">{cop(pickupModal.totalAmount)}</span>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Monto Recogido ($ COP)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-sm font-bold">$</span>
                      <input
                        type="number"
                        value={pickupAmount}
                        onChange={(e) => setPickupAmount(e.target.value)}
                        className="w-full pl-7 pr-24 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition"
                        placeholder="Ingrese el valor recogido"
                      />
                      <button
                        type="button"
                        onClick={() => setPickupAmount(String(pickupModal.totalAmount))}
                        className="absolute right-2 top-1.5 px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[10px] rounded-lg transition cursor-pointer"
                      >
                        Recoger Todo
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {Number(pickupAmount) < pickupModal.totalAmount ? (
                      <span className="text-amber-600 font-bold block">
                        ⚠️ Al recoger un monto menor, quedará una diferencia de {cop(pickupModal.totalAmount - Number(pickupAmount))} pendiente de cobro.
                      </span>
                    ) : (
                      "Se registrará la recaudación completa del saldo acumulado."
                    )}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPickupModal(null)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const amt = Number(pickupAmount);
                    if (isNaN(amt) || amt <= 0) {
                      setErrorMsg("Por favor ingrese un valor válido mayor a 0.");
                      setPickupModal(null);
                      return;
                    }
                    const branch = pickupModal.branchName;
                    setPickupModal(null);
                    await handleBulkReconcile(branch, amt);
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-sm"
                >
                  Confirmar Recibo
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* CSV IMPORT MODAL */}
        {showCsvImportModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">
                      📄 Cargar / Importar Pedido CSV
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Suba un archivo .csv/.txt o pegue el contenido de la matriz de pedido.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCsvImportModal(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto flex-1">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      📅 Fecha del Pedido a Importar
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Los pedidos se asociarán a esta fecha en la base de datos.
                    </p>
                  </div>
                  <input
                    type="date"
                    value={csvInputDate}
                    onChange={(e) => setCsvInputDate(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                {/* FILE SELECTION */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    1. Seleccionar archivo desde la computadora (.csv / .txt)
                  </label>
                  <div className="border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/20 rounded-2xl p-6 text-center transition cursor-pointer relative">
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <FileSpreadsheet className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-700">
                      Haga clic aquí o arrastre su archivo CSV
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Formato separado por punto y coma (;) o coma (,)
                    </p>
                  </div>
                </div>

                {/* DIRECT TEXT PASTE */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      2. O pegue directamente el texto del CSV
                    </label>
                    {csvInputText && (
                      <button
                        onClick={() => setCsvInputText("")}
                        className="text-[11px] text-rose-600 font-bold hover:underline cursor-pointer"
                      >
                        Limpiar Texto
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={csvInputText}
                    onChange={(e) => setCsvInputText(e.target.value)}
                    placeholder="PRODUCTO;TIBASOSA;NOBSA;FIRA;AQUITANIA;Hansel;PROVEEDOR;PRECIO COMPRA&#10;Papa Pastusa;3;1;0;3;2;ADRIAN;2500"
                    className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-300 rounded-2xl text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition"
                  />
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-amber-900 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Estructura esperada:</strong> Columnas con <i>PRODUCTO; TIBASOSA; NOBSA; FIRA; AQUITANIA; Hansel; PROVEEDOR; PRECIO COMPRA</i>. Si el producto o proveedor no existe, se creará automáticamente.
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCsvImportModal(false)}
                  className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleImportCsvOrders}
                  disabled={importingCsv || !csvInputText.trim()}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {importingCsv ? "Procesando Importación..." : "🚀 Importar Pedidos"}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* PROVEDOR ORDER IMAGE MODAL */}
        {showImageModal && imageModalData && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col my-8 max-h-[92vh]"
            >
              <div className="p-5 bg-slate-900 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-2xl">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      📸 Imagen Oficial del Pedido - {imageModalData.provider}
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Vista previa de la tabla del pedido. Puede copiarla, descargarla o enviarla directamente a WhatsApp.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowImageModal(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 overflow-y-auto flex-1 bg-slate-100/70">
                {/* INSTRUCTION BOX FOR WHATSAPP */}
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-900 text-xs space-y-1.5 shadow-xs">
                  <div className="font-extrabold flex items-center gap-1.5 text-emerald-800 text-sm">
                    <MessageSquare className="w-4 h-4 text-emerald-600" />
                    ¿Cómo enviar esta imagen por WhatsApp Web o Celular?
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-700 font-medium leading-relaxed pl-1">
                    <li>Haga clic en <strong>"📋 Copiar Imagen al Portapapeles"</strong>.</li>
                    <li>Haga clic en <strong>"📲 Abrir WhatsApp del Proveedor"</strong> para ir al chat.</li>
                    <li>En la ventana de WhatsApp, presione <strong>Ctrl + V (o Pegar)</strong> para enviar la imagen como foto.</li>
                  </ol>
                </div>

                {/* IMAGE PREVIEW */}
                <div className="border border-slate-300 rounded-2xl overflow-hidden bg-white shadow-md p-2 flex justify-center">
                  <img
                    src={imageModalData.imageUrl}
                    alt={`Pedido ${imageModalData.provider}`}
                    className="max-w-full h-auto object-contain rounded-xl max-h-[58vh]"
                  />
                </div>
              </div>

              <div className="bg-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowImageModal(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition cursor-pointer"
                >
                  Cerrar
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (imageModalData.blob && navigator.clipboard && window.ClipboardItem) {
                        try {
                          const item = new ClipboardItem({ "image/png": imageModalData.blob });
                          await navigator.clipboard.write([item]);
                          setSuccessMsg("¡Imagen del pedido copiada al portapapeles! Lista para pegar en WhatsApp.");
                          setTimeout(() => setSuccessMsg(""), 4000);
                        } catch (e) {
                          alert("No se pudo copiar directamente. Por favor use el botón 'Descargar Imagen'.");
                        }
                      } else {
                        alert("Su navegador no soporta copiado directo de imágenes. Use 'Descargar Imagen'.");
                      }
                    }}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-xs flex items-center gap-1.5"
                  >
                    <Copy className="w-4 h-4 text-emerald-400" />
                    Copiar Imagen
                  </button>

                  <a
                    href={imageModalData.imageUrl}
                    download={`Pedido_${imageModalData.provider}_${date}.png`}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-xs flex items-center gap-1.5 text-decoration-none"
                  >
                    <Download className="w-4 h-4" />
                    Descargar PNG
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      const cleanPhone = imageModalData.phone.replace(/\D/g, "");
                      const text = `Hola *${imageModalData.provider}*, adjunto la imagen oficial con el pedido del día *${date}*. Favor confirmar recepción.`;
                      const waUrl = cleanPhone 
                        ? `https://wa.me/57${cleanPhone}?text=${encodeURIComponent(text)}`
                        : `https://wa.me/?text=${encodeURIComponent(text)}`;
                      window.open(waUrl, "_blank");
                    }}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl transition cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Abrir WhatsApp
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
