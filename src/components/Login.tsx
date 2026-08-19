import React, { useState } from "react";
import { KeyRound, User as UserIcon, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

interface LoginProps {
  onLoginSuccess: (user: { Usuario: string; Rol: "Admin" | "Comprador" | "Sucursal" }) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Por favor complete todos los campos");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Credenciales inválidas");
      }

      const user = await res.json();
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 relative overflow-hidden bg-[#FBF7EE]">
      {/* Textura orgánica de fondo, en los colores de la marca */}
      <div className="absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full bg-[#1F7A4D]/[0.07]" />
      <div className="absolute -bottom-32 -right-16 w-[480px] h-[480px] rounded-full bg-[#F2A93B]/[0.10]" />
      <div className="absolute top-1/3 right-[-10%] w-[280px] h-[280px] rounded-full bg-[#D63B2F]/[0.06]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative"
      >
        <div className="text-center mb-6">
          <img
            src="/logo_al_paso.png"
            alt="Al Paso Mercado Campesino"
            className="w-full max-w-[320px] mx-auto drop-shadow-sm"
          />
          <p className="text-[#5B6B5E] mt-1 text-sm font-medium tracking-wide">
            Logística &amp; Finanzas · Versión 9.0
          </p>
        </div>

        <div className="bg-white border border-[#E7DFCB] rounded-3xl p-8 shadow-xl shadow-[#1F7A4D]/[0.06]">
          <h2 className="text-lg font-bold mb-6 text-[#2A3B2E] flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[#1F7A4D]/10 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-[#1F7A4D]" />
            </span>
            Iniciar Sesión
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 bg-[#D63B2F]/[0.06] border border-[#D63B2F]/20 rounded-2xl flex items-start gap-3 text-[#B32A20] text-sm"
              >
                <AlertCircle className="w-5 h-5 text-[#D63B2F] shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#8A7F63] uppercase tracking-wider mb-2">
                Usuario
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[#9CA89E]">
                  <UserIcon className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  placeholder="Cris, Hamilton, Tibasosa..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#FBF7EE] border border-[#E7DFCB] rounded-2xl focus:border-[#1F7A4D] focus:ring-2 focus:ring-[#1F7A4D]/10 focus:outline-none text-[#2A3B2E] placeholder-[#B0A98D] transition text-sm font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#8A7F63] uppercase tracking-wider mb-2">
                Contraseña
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[#9CA89E]">
                  <KeyRound className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#FBF7EE] border border-[#E7DFCB] rounded-2xl focus:border-[#1F7A4D] focus:ring-2 focus:ring-[#1F7A4D]/10 focus:outline-none text-[#2A3B2E] placeholder-[#B0A98D] transition text-sm font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#1F7A4D] hover:bg-[#186640] active:scale-[0.98] transition font-bold rounded-2xl shadow-lg shadow-[#1F7A4D]/20 text-white flex justify-center items-center disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                "Ingresar al Sistema"
              )}
            </button>
          </form>
        </div>

        <div className="text-center mt-8 text-xs text-[#9CA89E]">
          Al Paso Mercado Campesino &copy; 2026
        </div>
      </motion.div>
    </div>
  );
}
