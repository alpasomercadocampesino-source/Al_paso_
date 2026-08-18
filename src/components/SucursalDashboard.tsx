import React, { useState, useEffect } from "react";
import { 
  ShoppingBag, Trash2, Send, Save, CreditCard, ClipboardCheck, History,
  Plus, Search, Info, AlertTriangle, CheckSquare, Square, Check, RefreshCw, Mic, Calculator, Camera, Image as ImageIcon, Sparkles
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Product, Order, DailyClosure, WalletTransaction, Shrinkage } from "../types";
import { saveCachedProducts, getCachedProducts, queuePendingOrder, getPendingOrders, removePendingOrder } from "../utils/indexedDb";
import { getColombiaDate } from "../utils/date";

interface SucursalDashboardProps {
  branchName: string;
  lastGlobalSync?: number;
}

const compressAndSetImage = (file: File, callback: (base64: string) => void) => {
  if (file.size > 20 * 1024 * 1024) {
    alert("La imagen es demasiado grande. Por favor seleccione una de menos de 20MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);
          callback(compressedBase64);
        } else {
          callback(event.target?.result as string);
        }
      } catch (err) {
        console.error("Error compressing image, falling back to original:", err);
        callback(event.target?.result as string);
      }
    };
    img.onerror = () => {
      callback(event.target?.result as string);
    };
    img.src = event.target?.result as string;
  };
  reader.readAsDataURL(file);
};

export default function SucursalDashboard({ branchName, lastGlobalSync }: SucursalDashboardProps) {
  const [activeTab, setActiveTab] = useState<"pedido" | "merma" | "cierre" | "monedero" | "rectificacion">("pedido");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<{ [code: string]: { qty: string; note: string } }>({});
  const [previousOrderItems, setPreviousOrderItems] = useState<{ [code: string]: string }>({});

  // Merma Form State
  const [mermaProd, setMermaProd] = useState("");
  const [mermaQty, setMermaQty] = useState("");
  const [mermaUnit, setMermaUnit] = useState<"Kg" | "Bultos" | "Canastillas">("Kg");
  const [mermaReason, setMermaReason] = useState("");
  const [mermaHistory, setMermaHistory] = useState<Shrinkage[]>([]);
  const [mermaFoto, setMermaFoto] = useState("");
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const getMermaCalculation = () => {
    if (!mermaProd || !mermaQty) return null;
    const prod = products.find((p) => p.Codigo === mermaProd);
    if (!prod) return null;

    const numericQty = parseQty(mermaQty);
    if (isNaN(numericQty) || numericQty <= 0) return null;

    let totalKilos = 0;
    let estimatedLoss = 0;

    if (mermaUnit === "Bultos") {
      const bultoWeight = prod.Factor_Bulto || 56;
      if (prod.Medida.toLowerCase().includes("bulto")) {
        estimatedLoss = Math.round(numericQty * prod.Precio_Venta_Actual);
        totalKilos = numericQty * bultoWeight;
      } else {
        totalKilos = numericQty * bultoWeight;
        estimatedLoss = Math.round(totalKilos * prod.Precio_Venta_Actual);
      }
    } else if (mermaUnit === "Canastillas") {
      const canWeight = prod.Factor_Canastilla || 22;
      if (prod.Medida.toLowerCase().includes("canastilla") || prod.Medida.toLowerCase().includes("guacal")) {
        estimatedLoss = Math.round(numericQty * prod.Precio_Venta_Actual);
        totalKilos = numericQty * canWeight;
      } else {
        totalKilos = numericQty * canWeight;
        estimatedLoss = Math.round(totalKilos * prod.Precio_Venta_Actual);
      }
    } else {
      // Kg
      if (prod.Medida.toLowerCase().includes("bulto")) {
        const bultoWeight = prod.Factor_Bulto || 56;
        totalKilos = numericQty;
        estimatedLoss = Math.round((numericQty / bultoWeight) * prod.Precio_Venta_Actual);
      } else {
        totalKilos = numericQty;
        estimatedLoss = Math.round(numericQty * prod.Precio_Venta_Actual);
      }
    }

    return {
      totalKilos,
      estimatedLoss,
      unitPrice: prod.Precio_Venta_Actual,
      productName: prod.Producto,
      productMedida: prod.Medida
    };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressAndSetImage(file, (compressedBase64) => {
        setMermaFoto(compressedBase64);
      });
    }
  };

  // Cierre Form State
  const [cashOnHand, setCashOnHand] = useState("");
  const [collectedBy, setCollectedBy] = useState("Hamilton");
  const [expenses, setExpenses] = useState<Array<{ value: string; desc: string }>>([
    { value: "", desc: "" }
  ]);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [closurePhoto, setClosurePhoto] = useState<string | null>(null);

  // Monedero Bodega State
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletHistory, setWalletHistory] = useState<WalletTransaction[]>([]);
  const [walletExpValue, setWalletExpValue] = useState("");
  const [walletExpDesc, setWalletExpDesc] = useState("");
  const [walletExpPhoto, setWalletExpPhoto] = useState<string | null>(null);

  // Rectification Checklist State
  const [rectDate, setRectDate] = useState(getColombiaDate());
  const [rectOrders, setRectOrders] = useState<Order[]>([]);
  const [checkedItems, setCheckedItems] = useState<{ [key: string]: boolean }>({});

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Conversions Calculator State
  const [calcProduct, setCalcProduct] = useState("");
  const [calcVal, setCalcVal] = useState("");
  const [calcType, setCalcType] = useState<"kg_to_bto" | "bto_to_kg" | "kg_to_cn" | "cn_to_kg">("kg_to_bto");
  const [calcResult, setCalcResult] = useState("");

  // Product specific weight converter modal states
  const [modalCalcProduct, setModalCalcProduct] = useState<Product | null>(null);
  const [modalCalcVal, setModalCalcVal] = useState("");
  const [modalCalcType, setModalCalcType] = useState<"kg_to_bto" | "bto_to_kg" | "kg_to_cn" | "cn_to_kg">("kg_to_bto");
  const [modalCalcResult, setModalCalcResult] = useState("");

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

  const runModalCalc = (valStr: string, prod: any, type: string) => {
    const numeric = parseQty(valStr);
    if (numeric <= 0) {
      setModalCalcResult("");
      return;
    }
    
    const btoWeight = prod.Factor_Bulto || 56;
    const canWeight = prod.Factor_Canastilla || 22;
    
    if (type === "kg_to_bto") {
      const res = numeric / btoWeight;
      setModalCalcResult(`${valStr} Kg equivale a ${res.toFixed(2)} Bultos (${formatQty(res)} Btos)`);
    } else if (type === "bto_to_kg") {
      const res = numeric * btoWeight;
      setModalCalcResult(`${valStr} Bultos equivale a ${res.toFixed(1)} Kilos`);
    } else if (type === "kg_to_cn") {
      const res = numeric / canWeight;
      setModalCalcResult(`${valStr} Kg equivale a ${res.toFixed(2)} Canastillas (${formatQty(res)} Cans)`);
    } else if (type === "cn_to_kg") {
      const res = numeric * canWeight;
      setModalCalcResult(`${valStr} Canastillas equivale a ${res.toFixed(1)} Kilos`);
    }
  };

  // Format currency
  const cop = (val: number) => {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(val);
  };

  useEffect(() => {
    fetchProducts();
    fetchWallet();
    fetchMermaHistory();
    fetchTodayOrders();
    fetchPreviousOrder();
  }, [branchName, lastGlobalSync]);

  useEffect(() => {
    const fetchMyBranchConfig = async () => {
      try {
        const res = await fetch("/api/admin/branch-configs");
        if (res.ok) {
          const configs = await res.json();
          const myConfig = configs[branchName];
          if (myConfig && myConfig.recolectorPredeterminado) {
            setCollectedBy(myConfig.recolectorPredeterminado);
          }
        }
      } catch (e) {
        console.error("Error loading branch config for sucursal:", e);
      }
    };
    fetchMyBranchConfig();
  }, [branchName]);

  const checkPendingQueue = async () => {
    try {
      const pending = await getPendingOrders();
      const branchPending = pending.filter((o) => o.sucursal === branchName);
      setPendingCount(branchPending.length);
    } catch (e) {
      console.error("Error reading offline queue:", e);
    }
  };

  useEffect(() => {
    checkPendingQueue();
  }, [branchName, activeTab]);

  const syncOfflineOrders = async () => {
    if (syncing) return;
    try {
      const pending = await getPendingOrders();
      const branchPending = pending.filter((o) => o.sucursal === branchName);
      if (branchPending.length === 0) return;

      setSyncing(true);
      setErrorMsg("");
      setSuccessMsg("Sincronizando pedidos guardados sin conexión...");

      let syncedCount = 0;
      for (const order of branchPending) {
        try {
          const res = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sucursal: order.sucursal,
              items: order.items,
              fecha: order.fecha
            })
          });
          if (res.ok) {
            if (order.id !== undefined) {
              await removePendingOrder(order.id);
              syncedCount++;
            }
          } else {
            console.warn("Failed to sync order, server returned error");
          }
        } catch (err) {
          console.error("Failed to sync order due to network/server:", err);
          break; // network still down, stop syncing loop
        }
      }

      if (syncedCount > 0) {
        setSuccessMsg(`¡Sincronización exitosa! Se enviaron ${syncedCount} pedido(s) acumulado(s) offline.`);
        fetchTodayOrders();
        fetchPreviousOrder();
      } else {
        setSuccessMsg("");
      }
    } catch (e) {
      console.error("Error during sync:", e);
    } finally {
      setSyncing(false);
      checkPendingQueue();
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      console.log("Device is online. Triggering sync...");
      syncOfflineOrders();
    };

    window.addEventListener("online", handleOnline);

    const interval = setInterval(() => {
      if (navigator.onLine) {
        syncOfflineOrders();
      }
    }, 15000); // Check every 15 seconds

    return () => {
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, [branchName, syncing]);

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
        await saveCachedProducts(data);
      } else {
        const cached = await getCachedProducts();
        if (cached && cached.length > 0) {
          setProducts(cached);
          setErrorMsg("Trabajando sin conexión. Cargando catálogo desde caché local.");
        }
      }
    } catch (e) {
      console.error("Fetch products failed, trying offline cache:", e);
      const cached = await getCachedProducts();
      if (cached && cached.length > 0) {
        setProducts(cached);
        setErrorMsg("Trabajando sin conexión. Cargando catálogo desde caché local.");
      } else {
        setErrorMsg("Sin conexión a internet y no hay catálogo guardado localmente.");
      }
    }
  };

  const fetchWallet = async () => {
    try {
      const res = await fetch(`/api/wallet/${branchName}`);
      if (res.ok) {
        const data = await res.json();
        setWalletBalance(data.balance);
        setWalletHistory(data.transactions);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMermaHistory = async () => {
    try {
      const res = await fetch(`/api/shrinkages?sucursal=${branchName}`);
      if (res.ok) {
        const data = await res.json();
        setMermaHistory(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTodayOrders = async () => {
    try {
      const res = await fetch(`/api/orders?sucursal=${branchName}&fecha=${rectDate}`);
      if (res.ok) {
        const data = await res.json();
        setRectOrders(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchTodayOrders();
  }, [rectDate]);

  const fetchPreviousOrder = async () => {
    try {
      const res = await fetch(`/api/orders?sucursal=${branchName}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const uniqueOrderIds = Array.from(new Set(data.map((o: any) => o.ID_Pedido)));
          if (uniqueOrderIds.length > 0) {
            uniqueOrderIds.sort();
            const latestOrderId = uniqueOrderIds[uniqueOrderIds.length - 1];
            const latestOrderItems = data.filter((o: any) => o.ID_Pedido === latestOrderId);
            const prevItemsMap: { [code: string]: string } = {};
            latestOrderItems.forEach((item: any) => {
              prevItemsMap[item.Codigo] = item.Cantidad;
            });
            setPreviousOrderItems(prevItemsMap);
          } else {
            setPreviousOrderItems({});
          }
        } else {
          setPreviousOrderItems({});
        }
      }
    } catch (e) {
      console.error("Error fetching previous orders:", e);
    }
  };

  // Submit order to plaza
  const handleSubmitOrder = async () => {
    const items = Object.entries(draft)
      .filter(([_, value]) => parseQty(value.qty) > 0)
      .map(([code, value]) => ({
        Codigo: code,
        Cantidad: value.qty,
        Notas: value.note
      }));

    if (items.length === 0) {
      setErrorMsg("El borrador de pedido está vacío");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sucursal: branchName,
          items,
          fecha: getColombiaDate()
        })
      });

      if (res.ok) {
        setSuccessMsg("¡Pedido enviado a plaza con éxito!");
        setDraft({});
        fetchTodayOrders();
        fetchPreviousOrder();
      } else {
        const data = await res.json();
        throw new Error(data.error || "No se pudo enviar el pedido");
      }
    } catch (err: any) {
      console.warn("Error enviando pedido. Guardando en caché local IndexedDB:", err);
      try {
        await queuePendingOrder({
          sucursal: branchName,
          items,
          fecha: getColombiaDate()
        });
        setDraft({});
        setSuccessMsg("⚠️ Sin conexión a internet. El pedido y sus observaciones se han guardado localmente y se sincronizarán al recuperar la red.");
        checkPendingQueue();
      } catch (dbErr: any) {
        setErrorMsg(`Error al guardar en el caché de IndexedDB: ${dbErr.message || dbErr}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Submit Merma
  const handleSubmitMerma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mermaProd || !mermaQty) {
      setErrorMsg("Por favor complete los campos obligatorios");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/shrinkages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Sucursal: branchName,
          Codigo: mermaProd,
          Cantidad: mermaQty,
          Unidad: mermaUnit,
          Motivo: mermaReason,
          Fecha: getColombiaDate(),
          Foto: mermaFoto || undefined
        })
      });

      if (res.ok) {
        setSuccessMsg("Merma registrada y descontada del inventario.");
        setMermaProd("");
        setMermaQty("");
        setMermaReason("");
        setMermaFoto("");
        fetchMermaHistory();
      } else {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Submit Daily Closure (Cierre)
  const handleSubmitCierre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectedBy) {
      setErrorMsg("El nombre de la persona que recogerá es obligatorio");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    const cashNum = parseFloat(String(cashOnHand).replace(/\D/g, "")) || 0;

    // Calculate total expenses
    const validExpenses = expenses.filter((exp) => (parseFloat(String(exp.value).replace(/\D/g, "")) || 0) > 0 && exp.desc.trim());
    const totalExpenses = validExpenses.reduce((sum, exp) => sum + (parseFloat(String(exp.value).replace(/\D/g, "")) || 0), 0);
    const joinedDesc = validExpenses.map((exp) => `${exp.desc} (${cop(parseFloat(String(exp.value).replace(/\D/g, "")) || 0)})`).join("; ");

    // Ventas Totales = cashNum + totalExpenses
    const salesTotal = cashNum + totalExpenses;

    try {
      const res = await fetch("/api/closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Sucursal: branchName,
          Fecha: getColombiaDate(),
          Ventas_Totales: salesTotal,
          Gastos_Extra: totalExpenses,
          Descripcion_Gastos: joinedDesc,
          Persona_Recogio: collectedBy,
          Foto_Factura: closurePhoto || undefined,
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSuccessMsg("¡Cierre de caja guardado con éxito!");
        setReceipt({
          fecha: data.Fecha,
          sucursal: data.Sucursal,
          dineroContado: cashNum,
          gastos: totalExpenses,
          descripcionGastos: joinedDesc,
          ventasTotales: salesTotal,
          recogio: collectedBy,
          fotoPago: closurePhoto,
        });
        setCashOnHand("");
        setCollectedBy("Hamilton");
        setExpenses([{ value: "", desc: "" }]);
        setClosurePhoto(null);
        fetchWallet();
      } else {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Submit Wallet Expense
  const handleSubmitWalletExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(String(walletExpValue).replace(/\D/g, "")) || 0;
    if (!val || val <= 0 || !walletExpDesc.trim()) {
      setErrorMsg("Escriba un valor mayor a cero y una descripción");
      return;
    }

    if (val > walletBalance) {
      setErrorMsg("Saldo insuficiente en el monedero de la bodega");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`/api/wallet/${branchName}/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Valor_Gasto: val,
          Descripcion_Gasto: walletExpDesc,
          Responsable: "Encargado de Tienda",
          Fecha: getColombiaDate(),
          Foto_Factura: walletExpPhoto || undefined
        })
      });

      if (res.ok) {
        setSuccessMsg("Gasto registrado y descontado del monedero");
        setWalletExpValue("");
        setWalletExpDesc("");
        setWalletExpPhoto(null);
        fetchWallet();
      } else {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Add dynamic expense input row in Cierre Form
  const addExpenseRow = () => {
    setExpenses([...expenses, { value: "", desc: "" }]);
  };

  const updateExpense = (index: number, key: "value" | "desc", val: any) => {
    const updated = [...expenses];
    if (key === "value") {
      const raw = String(val).replace(/\D/g, "");
      if (!raw) {
        updated[index].value = "";
      } else {
        updated[index].value = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(parseFloat(raw));
      }
    } else {
      updated[index].desc = val;
    }
    setExpenses(updated);
  };

  // Handle draft inputs
  const handleDraftChange = (code: string, field: "qty" | "note", val: string) => {
    const updated = { ...draft };
    if (!updated[code]) {
      updated[code] = { qty: "", note: "" };
    }
    updated[code][field] = val;
    if (!updated[code].qty && !updated[code].note) {
      delete updated[code];
    }
    setDraft(updated);
  };

  // Filter products by search query
  const filteredProducts = products.filter((p) =>
    p.Producto.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.Codigo.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-6 min-h-[calc(100vh-80px)]">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm shadow-slate-100">
        <div>
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-700 font-bold text-xs rounded-full uppercase tracking-wider">
            Sucursal Autorizada
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-800 mt-2 flex items-center gap-2">
            🏪 Tienda {branchName}
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Gestión Operativa de Tienda, Ventas, Cierre y Logística de Al Paso.
          </p>
          {pendingCount > 0 && (
            <div className="mt-3 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl text-xs text-amber-800 font-bold shadow-sm">
              <RefreshCw className={`w-3.5 h-3.5 text-amber-600 ${syncing ? "animate-spin" : ""}`} />
              <span>Hay {pendingCount} pedido(s) guardado(s) localmente por falta de internet.</span>
              <button
                onClick={syncOfflineOrders}
                disabled={syncing}
                className="ml-2 px-2.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] uppercase tracking-wide cursor-pointer disabled:opacity-50 font-extrabold transition-all active:scale-95 shadow-sm"
              >
                {syncing ? "Sincronizando..." : "Enviar ahora"}
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-1 scrollbar-thin">
          <button
            onClick={() => setActiveTab("pedido")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "pedido"
                ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            Comercial / Hacer Pedido
          </button>

          <button
            onClick={() => setActiveTab("merma")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "merma"
                ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <Trash2 className="w-4 h-4" />
            Registrar Merma
          </button>

          <button
            onClick={() => setActiveTab("cierre")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "cierre"
                ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <Save className="w-4 h-4" />
            Cierre de Caja
          </button>

          <button
            onClick={() => setActiveTab("monedero")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "monedero"
                ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Monedero Bodega
          </button>

          <button
            onClick={() => setActiveTab("rectificacion")}
            className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shrink-0 transition cursor-pointer ${
              activeTab === "rectificacion"
                ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600"
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Planilla de Control
          </button>
        </div>
      </header>

      {/* Notification banner */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 rounded-2xl mb-6 flex justify-between items-center text-sm font-medium"
          >
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4" /> {successMsg}
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
              <AlertTriangle className="w-4 h-4" /> {errorMsg}
            </span>
            <button onClick={() => setErrorMsg("")} className="text-rose-800 hover:underline text-xs">Cerrar</button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="grid grid-cols-1 gap-6">
        {/* TAB 1: HACER PEDIDO */}
        {activeTab === "pedido" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* LEFT COLUMN: Manual Catalog */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Products catalog card */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Catálogo de Productos</h3>
                  <p className="text-slate-400 text-xs mt-1">Escriba las cantidades y notas directamente en las filas.</p>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    placeholder="Buscar producto..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-slate-400 text-sm font-medium"
                  />
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-bold">
                      <th className="py-3 px-2">Código</th>
                      <th className="py-3 px-2">Producto</th>
                      <th className="py-3 px-2">Unidad</th>
                      <th className="py-3 px-2 text-center">Pedido Anterior</th>
                      <th className="py-3 px-2 w-28 text-center">Cantidad</th>
                      <th className="py-3 px-2">Notas / Observaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p, idx) => (
                      <tr key={`${p.Codigo}-${idx}`} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                        <td className="py-2 px-2 font-mono text-xs text-slate-500 font-semibold">{p.Codigo}</td>
                        <td className="py-2 px-2 text-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{p.Producto}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setModalCalcProduct(p);
                                setModalCalcVal("");
                                setModalCalcResult("");
                                if (p.Medida.toLowerCase().includes("canastilla") || p.Medida.toLowerCase().includes("guacal")) {
                                  setModalCalcType("cn_to_kg");
                                } else {
                                  setModalCalcType("bto_to_kg");
                                }
                              }}
                              className="p-1 hover:bg-indigo-50 text-indigo-500 hover:text-indigo-700 rounded-lg cursor-pointer transition"
                              title="Calculadora de peso"
                            >
                              <Calculator className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-xs text-slate-500 font-medium">
                          <div className="flex flex-col">
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-bold rounded-md w-max">
                              {p.Medida === "Kg" ? "Bultos" : p.Medida}
                            </span>
                            {p.Medida === "Kg" && (
                              <span className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                                1 Bto = {p.Factor_Bulto || 56} Kg
                              </span>
                            )}
                            {(p.Medida.toLowerCase().includes("canastilla") || p.Medida.toLowerCase().includes("guacal")) && (
                              <span className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">
                                1 Can = {p.Factor_Canastilla || 22} Kg
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center">
                          {previousOrderItems[p.Codigo] ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-50/80 text-emerald-700 px-2.5 py-1 rounded-xl text-xs font-bold border border-emerald-200/50">
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              {previousOrderItems[p.Codigo]}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2 px-2 flex justify-center">
                          <input
                            type="text"
                            placeholder="0"
                            value={draft[p.Codigo]?.qty || ""}
                            onChange={(e) => handleDraftChange(p.Codigo, "qty", e.target.value)}
                            className="w-20 px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-center font-bold text-slate-800"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            placeholder="Ej: Maduros, verdes..."
                            value={draft[p.Codigo]?.note || ""}
                            onChange={(e) => handleDraftChange(p.Codigo, "note", e.target.value)}
                            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-medium"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
 
          {/* Draft preview */}
            <div className="space-y-6">
              {/* Draft panel */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col min-h-[450px]">
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    🛒 Borrador de Pedido
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                      {Object.keys(draft).length} items
                    </span>
                  </h3>
                  {Object.keys(draft).length > 0 && (
                    <button
                      onClick={() => setDraft({})}
                      className="text-slate-400 hover:text-rose-500 text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Limpiar
                    </button>
                  )}
                </div>
 
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {Object.keys(draft).length === 0 ? (
                    <p className="text-slate-400 text-xs italic text-center py-12">
                      No hay productos en el borrador. Digite cantidades directamente en el catálogo de productos de la izquierda.
                    </p>
                  ) : (
                    Object.entries(draft).map(([code, value]) => {
                      const p = products.find((prod) => prod.Codigo === code);
                      if (!p) return null;
                      return (
                        <div key={code} className="p-2.5 bg-slate-50 border border-slate-100 rounded-2xl flex justify-between items-center text-xs">
                          <div>
                            <div className="font-bold text-slate-800">{p.Producto}</div>
                            <div className="text-slate-400 text-[10px]">
                              Cant: <span className="font-bold text-slate-700">{value.qty}</span> {p.Medida === "Kg" ? "Bultos" : p.Medida}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              const updated = { ...draft };
                              delete updated[code];
                              setDraft(updated);
                            }}
                            className="text-slate-300 hover:text-rose-500 shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {pendingCount > 0 && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200/80 rounded-2xl shadow-sm">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 text-amber-800 text-[11px] font-bold">
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                        <span>{pendingCount} pedido(s) sin sincronizar</span>
                      </div>
                      <button
                        onClick={syncOfflineOrders}
                        disabled={syncing}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[10px] rounded-lg transition disabled:opacity-50 cursor-pointer flex items-center gap-1 active:scale-95 shadow-sm"
                      >
                        <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
                        {syncing ? "Sincronizando..." : "Sincronizar"}
                      </button>
                    </div>
                  </div>
                )}
 
                <button
                  onClick={handleSubmitOrder}
                  disabled={loading || Object.keys(draft).length === 0}
                  className="w-full mt-4 py-3 bg-slate-900 hover:bg-slate-850 text-white rounded-2xl font-bold text-sm shadow-md flex justify-center items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {loading ? "Enviando..." : "💾 Enviar Pedido a Plaza"}
                </button>
              </div>

              {/* Conversiones Calculator */}
              <div className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 p-6 rounded-3xl border border-indigo-100 shadow-sm">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-indigo-200/50">
                  <div className="p-1.5 bg-indigo-500 rounded-xl text-white">
                    <Calculator className="w-4 h-4" />
                  </div>
                  <h4 className="font-extrabold text-indigo-950 text-sm">Calculadora de Conversión (Kg / Bto / Can)</h4>
                </div>
                
                <p className="text-[11px] text-indigo-600/85 mb-4 font-medium leading-relaxed">
                  Convierta rápidamente entre kilos y bultos o canastillas usando los pesos reales de cada producto del catálogo.
                </p>
                
                <div className="space-y-3">
                  {/* Product Select */}
                  <div>
                    <label className="block text-[10px] font-bold text-indigo-700/85 uppercase tracking-wider mb-1">
                      Producto
                    </label>
                    <select
                      value={calcProduct}
                      onChange={(e) => {
                        setCalcProduct(e.target.value);
                        const prodObj = products.find(p => p.Codigo === e.target.value);
                        if (prodObj && calcVal) {
                          runCalc(calcVal, prodObj, calcType);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white border border-indigo-200/60 rounded-xl focus:outline-none focus:border-indigo-400 text-xs font-bold text-indigo-950 shadow-sm"
                    >
                      <option value="">-- Seleccionar producto --</option>
                      {products.map((p) => (
                        <option key={p.Codigo} value={p.Codigo}>
                          {p.Codigo} - {p.Producto} ({p.Medida === "Kg" ? "Bto" : p.Medida}) [Bto: {p.Factor_Bulto}kg | Can: {p.Factor_Canastilla}kg]
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Type Select */}
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-indigo-700/85 uppercase tracking-wider mb-1">
                        Operación
                      </label>
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

                    {/* Input Value */}
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-indigo-700/85 uppercase tracking-wider mb-1">
                        Cantidad a Convertir
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: 50, 1.5, 1/2..."
                        value={calcVal}
                        onChange={(e) => {
                          setCalcVal(e.target.value);
                          const prodObj = products.find(p => p.Codigo === calcProduct);
                          if (prodObj) {
                            runCalc(e.target.value, prodObj, calcType);
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-indigo-200/60 rounded-xl focus:outline-none focus:border-indigo-400 text-xs font-bold text-indigo-950 shadow-sm text-center font-mono"
                      />
                    </div>
                  </div>

                  {/* Result area */}
                  {calcResult && (
                    <div className="bg-white/90 p-3 rounded-2xl border border-indigo-150 mt-2 flex flex-col items-center justify-center text-center shadow-inner">
                      <div className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">Resultado</div>
                      <div className="text-xs font-extrabold text-indigo-950 mt-1 leading-snug">{calcResult}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: REGISTRAR MERMA */}
        {activeTab === "merma" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm lg:col-span-1 space-y-4">
              <h3 className="text-lg font-bold text-slate-800">Registrar Merma</h3>
              <p className="text-slate-400 text-xs">Registre las pérdidas o descartes diarios para cuadrar el inventario de la tienda.</p>

              <form onSubmit={handleSubmitMerma} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Producto *
                  </label>
                  <select
                    value={mermaProd}
                    onChange={(e) => setMermaProd(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold"
                  >
                    <option value="">Seleccione un producto</option>
                    {products.map((p) => (
                      <option key={p.Codigo} value={p.Codigo}>
                        {p.Codigo} - {p.Producto} ({p.Medida})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Unidad de Medida (Kg / Bultos) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Unidad de Medida de la Merma *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setMermaUnit("Kg")}
                      className={`py-2 px-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1 transition cursor-pointer ${
                        mermaUnit === "Kg"
                          ? "bg-slate-900 text-white shadow-md ring-2 ring-slate-900"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      ⚖️ Kg (Kilos)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMermaUnit("Bultos")}
                      className={`py-2 px-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1 transition cursor-pointer ${
                        mermaUnit === "Bultos"
                          ? "bg-emerald-700 text-white shadow-md ring-2 ring-emerald-700"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      📦 Bultos
                    </button>
                    <button
                      type="button"
                      onClick={() => setMermaUnit("Canastillas")}
                      className={`py-2 px-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1 transition cursor-pointer ${
                        mermaUnit === "Canastillas"
                          ? "bg-indigo-700 text-white shadow-md ring-2 ring-indigo-700"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      🧺 Canastilla
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Cantidad Descartada ({mermaUnit === "Kg" ? "Kilos" : mermaUnit === "Bultos" ? "Bultos" : "Canastillas"}) *
                  </label>
                  <input
                    type="text"
                    placeholder={mermaUnit === "Kg" ? "Ej: 2.5 o 1/2" : "Ej: 1 o 2"}
                    value={mermaQty}
                    onChange={(e) => setMermaQty(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold"
                  />
                </div>

                {/* Real-time Loss Calculation Box */}
                {(() => {
                  const calc = getMermaCalculation();
                  if (!calc) return null;
                  return (
                    <div className="p-3.5 bg-rose-50/90 border border-rose-200/90 rounded-2xl space-y-1 shadow-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-black text-rose-900 uppercase tracking-wider flex items-center gap-1">
                          <Calculator className="w-3.5 h-3.5 text-rose-600" /> Pérdida Calculada:
                        </span>
                        <span className="text-sm font-black text-rose-700 font-mono">
                          {cop(calc.estimatedLoss)}
                        </span>
                      </div>
                      <div className="text-[11px] text-rose-800 font-semibold leading-relaxed">
                        {mermaUnit === "Bultos" && (
                          <span>
                            📦 <strong>{mermaQty} Bulto(s)</strong> = {calc.totalKilos} Kg aprox. ({cop(calc.unitPrice)}/Kg)
                          </span>
                        )}
                        {mermaUnit === "Canastillas" && (
                          <span>
                            🧺 <strong>{mermaQty} Canastilla(s)</strong> = {calc.totalKilos} Kg aprox. ({cop(calc.unitPrice)}/Kg)
                          </span>
                        )}
                        {mermaUnit === "Kg" && (
                          <span>
                            ⚖️ <strong>{mermaQty} Kg</strong> ({cop(calc.unitPrice)}/Kg)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> Evidencia Fotográfica (Opcional)
                  </label>
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileChange}
                      className="hidden"
                      id="merma-photo-upload"
                    />
                    <label
                      htmlFor="merma-photo-upload"
                      className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-xl p-4 cursor-pointer bg-slate-50/50 hover:bg-slate-50 transition"
                    >
                      {mermaFoto ? (
                        <div className="flex flex-col items-center gap-2">
                          <img src={mermaFoto} className="max-h-32 rounded-lg object-contain border border-slate-100 shadow-xs" />
                          <span className="text-[10px] text-emerald-600 font-bold">¡Foto cargada! Clic para cambiar</span>
                        </div>
                      ) : (
                        <div className="text-center py-2">
                          <Plus className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                          <span className="text-xs font-bold text-slate-500">Subir foto o Tomar captura</span>
                        </div>
                      )}
                    </label>
                    {mermaFoto && (
                      <button
                        type="button"
                        onClick={() => setMermaFoto("")}
                        className="text-[10px] text-rose-500 font-bold hover:underline self-center"
                      >
                        Eliminar Foto
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Motivo / Descripción
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ej: Dañado, maduro, sobremaduro..."
                    value={mermaReason}
                    onChange={(e) => setMermaReason(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold placeholder-slate-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold text-sm shadow-md flex justify-center items-center gap-1.5 cursor-pointer animate-pulse-once"
                >
                  <Trash2 className="w-4 h-4" />
                  {loading ? "Registrando..." : "Registrar Merma"}
                </button>
              </form>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm lg:col-span-2 flex flex-col">
              <h3 className="text-lg font-bold text-slate-800 mb-2">Historial de Mermas de {branchName}</h3>
              <p className="text-slate-400 text-xs mb-6">Mermas recientes enviadas a la central de plaza.</p>

              <div className="overflow-x-auto flex-1 max-h-[400px]">
                {mermaHistory.length === 0 ? (
                  <p className="text-slate-400 text-xs italic text-center py-20">
                    No se han registrado mermas en esta sucursal.
                  </p>
                ) : (
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold text-xs uppercase tracking-wider">
                        <th className="py-3 px-2">Fecha</th>
                        <th className="py-3 px-2">Código</th>
                        <th className="py-3 px-2">Producto</th>
                        <th className="py-3 px-2">Cantidad</th>
                        <th className="py-3 px-2">Pérdida Monetaria</th>
                        <th className="py-3 px-2">Evidencia</th>
                        <th className="py-3 px-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mermaHistory.map((m, idx) => (
                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                          <td className="py-2 px-2 text-slate-500 font-medium text-xs">{m.Fecha}</td>
                          <td className="py-2 px-2 font-mono text-xs text-slate-400">{m.Codigo}</td>
                          <td className="py-2 px-2 font-bold text-slate-800">{m.Producto}</td>
                          <td className="py-2 px-2 font-bold text-slate-600">{m.Cantidad}</td>
                          <td className="py-2 px-2 text-rose-600 font-bold">{cop(m.Perdida_Monetaria)}</td>
                          <td className="py-2 px-2">
                            {m.Foto ? (
                              <button
                                type="button"
                                onClick={() => setViewingPhoto(m.Foto!)}
                                className="flex items-center gap-1 text-[10px] text-emerald-600 font-extrabold hover:underline"
                              >
                                <ImageIcon className="w-3.5 h-3.5" /> Ver Foto
                              </button>
                            ) : (
                              <span className="text-slate-300 text-[10px]">Sin foto</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-slate-500 text-xs max-w-xs truncate">{m.Motivo || "Sin observaciones"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CIERRE DE CAJA */}
        {activeTab === "cierre" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-2">Cierre de Caja Diario</h3>
              <p className="text-slate-400 text-xs mb-6">Guarde las ventas finales del día y registre las salidas/gastos de caja.</p>

              <form onSubmit={handleSubmitCierre} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Dinero Contado al Final del Día ($) *
                    </label>
                    <input
                      type="text"
                      placeholder="Dinero físico en caja"
                      value={cashOnHand}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "");
                        if (!raw) {
                          setCashOnHand("");
                          return;
                        }
                        setCashOnHand(new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(parseFloat(raw)));
                      }}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Persona que va a recoger *
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Hamilton o Cris"
                      value={collectedBy}
                      onChange={(e) => setCollectedBy(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 text-sm font-semibold text-slate-700"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                      🧾 Gastos Extra / Salidas de Caja
                    </label>
                    <button
                      type="button"
                      onClick={addExpenseRow}
                      className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg flex items-center gap-1 font-bold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Añadir Gasto
                    </button>
                  </div>
                  <p className="text-slate-400 text-[10px] mb-3">Registros menores pagados en efectivo directo de caja.</p>

                  <div className="space-y-3">
                    {expenses.map((exp, idx) => (
                      <div key={idx} className="flex gap-3 items-center">
                        <input
                          type="text"
                          placeholder="Valor Gasto ($)"
                          value={exp.value}
                          onChange={(e) => updateExpense(idx, "value", e.target.value)}
                          className="w-1/3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-sm font-semibold text-slate-700"
                        />
                        <input
                          type="text"
                          placeholder="Descripción / Concepto del gasto"
                          value={exp.desc}
                          onChange={(e) => updateExpense(idx, "desc", e.target.value)}
                          className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-sm font-semibold text-slate-700"
                        />
                        {expenses.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setExpenses(expenses.filter((_, i) => i !== idx))}
                            className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Subir foto de comprobante/pagos */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    📸 Foto de los Pagos / Facturas de Soporte
                  </label>
                  <p className="text-[10px] text-slate-400">Suba una foto de las facturas de gastos o del efectivo físico como comprobante.</p>
                  
                  {closurePhoto ? (
                    <div className="relative w-max mx-auto border border-slate-200 rounded-2xl p-2 bg-white">
                      <img src={closurePhoto} className="max-h-36 rounded-xl object-contain shadow-xs" alt="Soporte Cierre" />
                      <button
                        type="button"
                        onClick={() => setClosurePhoto(null)}
                        className="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white p-1 rounded-full shadow-xs cursor-pointer text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-2xl p-4 bg-white text-center cursor-pointer relative hover:bg-slate-50/50 transition">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            compressAndSetImage(file, (compressedBase64) => {
                              setClosurePhoto(compressedBase64);
                            });
                          }
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Camera className="w-6 h-6 mx-auto text-slate-400 mb-1" />
                      <span className="text-xs font-bold text-slate-500 block">Subir foto de pagos / facturas</span>
                      <span className="text-[9px] text-slate-400 block mt-0.5">JPG, PNG o directo de la cámara</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-850 text-white rounded-2xl font-bold text-sm shadow-md flex justify-center items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  {loading ? "Guardando..." : "Guardar Cierre Diario"}
                </button>
              </form>
            </div>

            {/* Receipt Preview */}
            <div className="lg:col-span-1">
              <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col justify-between h-full">
                <div>
                  <h3 className="text-md font-bold text-slate-800 mb-4 flex items-center gap-2 pb-3 border-b border-slate-100">
                    🧾 Recibo Digital de Cierre
                  </h3>

                  {receipt ? (
                    <div className="p-5 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 font-mono text-xs text-slate-800 space-y-4">
                      <div className="text-center pb-3 border-b border-dashed border-slate-200">
                        <div className="text-sm font-extrabold text-slate-900">Al Paso</div>
                        <div className="text-[10px] text-slate-500">MERCADO CAMPESINO</div>
                        <div className="text-[10px] text-slate-400 mt-2">RECIBO DE CIERRE DE CAJA</div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span>Sucursal:</span>
                          <span className="font-bold">{receipt.sucursal.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Fecha:</span>
                          <span>{receipt.fecha}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Persona que va a recoger:</span>
                          <span className="font-bold">{receipt.recogio}</span>
                        </div>
                      </div>

                      <div className="border-t border-dashed border-slate-200 pt-3 space-y-1">
                        <div className="flex justify-between text-slate-900 font-extrabold">
                          <span>Efectivo en Caja:</span>
                          <span>{cop(receipt.dineroContado)}</span>
                        </div>
                      </div>

                      {receipt.descripcionGastos && (
                        <div className="text-[10px] text-slate-500 bg-slate-100 p-2 rounded-lg leading-relaxed">
                          Gastos discriminados: {receipt.descripcionGastos}
                        </div>
                      )}

                      {receipt.fotoPago && (
                        <div className="border-t border-dashed border-slate-200 pt-3 space-y-2">
                          <span className="text-[10px] text-slate-500 font-bold block text-center uppercase tracking-wider">
                            📸 Comprobante de Pagos / Soporte
                          </span>
                          <img
                            src={receipt.fotoPago}
                            className="max-h-48 mx-auto rounded-lg object-contain border border-slate-200 shadow-sm"
                            alt="Comprobante de pago"
                          />
                        </div>
                      )}

                      <div className="text-center text-[9px] text-slate-400 border-t border-dashed border-slate-200 pt-3">
                        Al Paso v9.0 · Cierre Tabular Exitoso
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-20 text-slate-400 text-xs italic">
                      Realice un cierre de caja para generar el recibo interactivo compartible.
                    </div>
                  )}
                </div>

                {receipt && (
                  <button
                    onClick={() => setReceipt(null)}
                    className="w-full mt-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Hacer Otro Cierre
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MONEDERO BODEGA */}
        {activeTab === "monedero" && (
          <div className="max-w-xl mx-auto space-y-6">
            {/* Saldo banner */}
            <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-6 rounded-3xl border border-indigo-950/80 shadow-md text-white space-y-2">
              <span className="text-xs font-bold text-indigo-300 uppercase tracking-widest">Saldo de lo que debe haber</span>
              <h2 className="text-3xl font-extrabold font-mono text-emerald-400">{cop(walletBalance)}</h2>
              <p className="text-[11px] text-indigo-200/80">Este saldo se calcula sumando los ingresos reportados de caja menos los gastos registrados aquí.</p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm space-y-4">
              <h3 className="text-lg font-extrabold text-slate-850">💸 Registrar Gasto Directo</h3>
              <p className="text-slate-400 text-xs">Registre los gastos directos pagados desde el monedero acumulado de la tienda.</p>

              <form onSubmit={handleSubmitWalletExpense} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Valor Gasto ($)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 15.000"
                    value={walletExpValue}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      if (!raw) {
                        setWalletExpValue("");
                        return;
                      }
                      setWalletExpValue(new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(parseFloat(raw)));
                    }}
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 text-sm font-semibold text-slate-700 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Descripción / Concepto
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ej: Pago bolsas, flete..."
                    value={walletExpDesc}
                    onChange={(e) => setWalletExpDesc(e.target.value)}
                    required
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 text-sm font-semibold text-slate-700 placeholder-slate-400"
                  />
                </div>

                {/* Subir foto de factura / soporte del gasto */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    📸 Foto de la Factura / Recibo de Pago
                  </label>
                  <p className="text-[10px] text-slate-400">Suba una foto de la factura recibida o del recibo como comprobante del gasto pagado.</p>
                  
                  {walletExpPhoto ? (
                    <div className="relative w-max mx-auto border border-slate-200 rounded-2xl p-2 bg-white">
                      <img src={walletExpPhoto} className="max-h-36 rounded-xl object-contain shadow-xs" alt="Factura Soporte" />
                      <button
                        type="button"
                        onClick={() => setWalletExpPhoto(null)}
                        className="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white p-1 rounded-full shadow-xs cursor-pointer text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-2xl p-4 bg-white text-center cursor-pointer relative hover:bg-slate-50/50 transition">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            compressAndSetImage(file, (compressedBase64) => {
                              setWalletExpPhoto(compressedBase64);
                            });
                          }
                        }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Camera className="w-6 h-6 mx-auto text-slate-400 mb-1" />
                      <span className="text-xs font-bold text-slate-500 block">Subir foto de factura / recibo</span>
                      <span className="text-[9px] text-slate-400 block mt-0.5">JPG, PNG o directo de la cámara</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 text-white rounded-xl font-bold text-sm shadow-md flex justify-center items-center gap-1.5 cursor-pointer"
                >
                  <CreditCard className="w-4 h-4" />
                  {loading ? "Registrando..." : "Guardar Gasto Directo"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 5: RECTIFICACION Y PLANILLA DE CONTROL */}
        {activeTab === "rectificacion" && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Planilla de Rectificación y Despacho</h3>
                <p className="text-slate-400 text-xs mt-1">Marque y verifique los productos que llegan de plaza a la sucursal.</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Fecha:</span>
                <input
                  type="date"
                  value={rectDate}
                  onChange={(e) => setRectDate(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-bold"
                />
              </div>
            </div>

            {rectOrders.length === 0 ? (
              <div className="text-center py-20 text-slate-400 text-sm italic">
                No hay pedidos registrados para el {rectDate} en {branchName}.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold">
                        <th className="py-3 px-3 w-16 text-center">Verificar</th>
                        <th className="py-3 px-2">Código</th>
                        <th className="py-3 px-2">Producto</th>
                        <th className="py-3 px-2">Medida</th>
                        <th className="py-3 px-2 text-center">Cant. Solicitada</th>
                        <th className="py-3 px-2 text-center">Cant. Comprada (Plaza)</th>
                        <th className="py-3 px-2">Notas</th>
                        <th className="py-3 px-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rectOrders.map((o) => {
                        const key = `${o.ID_Pedido}_${o.Codigo}`;
                        const isChecked = !!checkedItems[key];
                        return (
                          <tr key={key} className={`border-b border-slate-50 hover:bg-slate-50/50 transition ${
                            isChecked ? "bg-emerald-50/20" : ""
                          }`}>
                            <td className="py-3 px-3 text-center">
                              <button
                                onClick={() => {
                                  setCheckedItems({
                                    ...checkedItems,
                                    [key]: !isChecked
                                  });
                                }}
                                className="text-slate-400 hover:text-emerald-500 transition focus:outline-none cursor-pointer"
                              >
                                {isChecked ? (
                                  <CheckSquare className="w-5 h-5 text-emerald-500" />
                                ) : (
                                  <Square className="w-5 h-5" />
                                )}
                              </button>
                            </td>
                            <td className="py-3 px-2 font-mono text-xs text-slate-500 font-bold">{o.Codigo}</td>
                            <td className={`py-3 px-2 font-bold text-slate-800 ${isChecked ? "line-through text-slate-400" : ""}`}>
                              {o.Producto}
                            </td>
                            <td className="py-3 px-2 text-xs text-slate-500 font-semibold">{o.Medida === "Kg" ? "Bultos" : o.Medida}</td>
                            <td className="py-3 px-2 text-center font-bold text-slate-700">{o.Cantidad}</td>
                            <td className="py-3 px-2 text-center font-bold text-emerald-600">
                              {o.Cantidad_Comprada > 0 ? o.Cantidad_Comprada : "—"}
                            </td>
                            <td className="py-3 px-2 text-slate-500 text-xs italic">{o.Notas || "—"}</td>
                            <td className="py-3 px-2">
                              <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                o.Estado === "Comprado" 
                                  ? "bg-emerald-100 text-emerald-800" 
                                  : o.Estado === "Cancelado"
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}>
                                {o.Estado}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl text-xs text-slate-500 flex items-start gap-2.5 leading-relaxed">
                  <Info className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    <strong>Instrucción de despacho:</strong> Use esta planilla para marcar físicamente el pedido al desempacar la canastilla de despacho de plaza. Al verificar todos los productos marcados, su sucursal de {branchName} tendrá la seguridad del inventario exacto recibido.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* FULLSCREEN PHOTO VIEWER MODAL OVERLAY */}
      <AnimatePresence>
        {viewingPhoto && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-lg w-full border border-slate-300 shadow-2xl flex flex-col items-center relative"
            >
              <button
                type="button"
                onClick={() => setViewingPhoto(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full p-1.5 transition"
              >
                ✕
              </button>
              <h4 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wider">Evidencia de Merma</h4>
              <img src={viewingPhoto} className="max-h-[70vh] rounded-2xl object-contain border border-slate-200 shadow-sm" alt="Evidencia" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WEIGHT CONVERTER MODAL OVERLAY */}
      <AnimatePresence>
        {modalCalcProduct && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Calculator className="w-4 h-4 text-indigo-600" />
                    <span>Convertidor de Peso</span>
                  </h3>
                  <p className="text-slate-400 text-[11px] mt-0.5">{modalCalcProduct.Producto} ({modalCalcProduct.Codigo})</p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalCalcProduct(null)}
                  className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Operación
                  </label>
                  <select
                    value={modalCalcType}
                    onChange={(e: any) => {
                      setModalCalcType(e.target.value);
                      if (modalCalcVal) {
                        runModalCalc(modalCalcVal, modalCalcProduct, e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 font-bold text-slate-700"
                  >
                    <option value="kg_to_bto">Kilos ➔ Bultos</option>
                    <option value="bto_to_kg">Bultos ➔ Kilos</option>
                    <option value="kg_to_cn">Kilos ➔ Canastillas</option>
                    <option value="cn_to_kg">Canastillas ➔ Kilos</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Cantidad a Convertir
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 50, 1.5, 2..."
                    value={modalCalcVal}
                    onChange={(e) => {
                      setModalCalcVal(e.target.value);
                      runModalCalc(e.target.value, modalCalcProduct, modalCalcType);
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 font-bold font-mono text-center text-slate-800"
                  />
                </div>

                {modalCalcResult && (
                  <div className="bg-indigo-50/50 p-3 rounded-2xl border border-indigo-100 text-center space-y-1 animate-fade-in">
                    <span className="text-[9px] font-bold text-indigo-500 uppercase">Resultado</span>
                    <p className="text-xs font-extrabold text-indigo-950 leading-snug">{modalCalcResult}</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalCalcProduct(null)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition text-center"
                >
                  Cerrar
                </button>
                {modalCalcResult && (
                  <button
                    type="button"
                    onClick={() => {
                      let valToApply = "";
                      const numeric = parseQty(modalCalcVal);
                      if (modalCalcType === "kg_to_bto") {
                        const btoWeight = modalCalcProduct.Factor_Bulto || 56;
                        valToApply = (numeric / btoWeight).toFixed(2);
                      } else if (modalCalcType === "bto_to_kg") {
                        valToApply = modalCalcVal;
                      } else if (modalCalcType === "kg_to_cn") {
                        const canWeight = modalCalcProduct.Factor_Canastilla || 22;
                        valToApply = (numeric / canWeight).toFixed(2);
                      } else if (modalCalcType === "cn_to_kg") {
                        valToApply = modalCalcVal;
                      }
                      
                      if (valToApply) {
                        handleDraftChange(modalCalcProduct.Codigo, "qty", valToApply);
                      }
                      setModalCalcProduct(null);
                    }}
                    className="flex-1 py-2 bg-slate-900 hover:bg-slate-850 text-white rounded-xl text-xs font-bold transition text-center"
                  >
                    Copiar al Pedido
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
