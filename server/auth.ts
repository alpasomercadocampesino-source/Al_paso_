import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export type Rol = "Admin" | "Comprador" | "Sucursal";

export interface SesionToken {
  u: string; // usuario
  r: Rol;    // rol
  exp: number; // vencimiento (epoch ms)
}

const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

/**
 * Secreto para firmar las sesiones. En producción DEBE venir de AUTH_SECRET.
 * Si falta, se genera uno aleatorio en memoria: la app sigue funcionando, pero
 * las sesiones se invalidan en cada reinicio (falla de forma segura, no abierta).
 */
function obtenerSecreto(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (!(globalThis as any).__alpasoSecretoTemporal) {
    (globalThis as any).__alpasoSecretoTemporal = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[Auth] No se configuró AUTH_SECRET. Se usa un secreto temporal: las sesiones " +
      "se cerrarán en cada reinicio del servidor. Configúralo en las variables de entorno."
    );
  }
  return (globalThis as any).__alpasoSecretoTemporal;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function firmar(payloadB64: string): string {
  return crypto.createHmac("sha256", obtenerSecreto()).update(payloadB64).digest("base64url");
}

export function crearToken(usuario: string, rol: Rol): string {
  const payload: SesionToken = { u: usuario, r: rol, exp: Date.now() + DURACION_SESION_MS };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${firmar(payloadB64)}`;
}

export function verificarToken(token: string): SesionToken | null {
  if (!token || typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;

  const [payloadB64, firmaRecibida] = partes;
  const firmaEsperada = firmar(payloadB64);

  // Comparación de tiempo constante: evita filtrar la firma por diferencias de tiempo.
  const a = Buffer.from(firmaRecibida);
  const b = Buffer.from(firmaEsperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as SesionToken;
    if (!payload?.u || !payload?.r) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      auth?: SesionToken;
    }
  }
}

function extraerToken(req: Request): string {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();

  // Excepción acotada: al abrir un enlace de descarga directamente en el navegador
  // no hay forma de mandar cabeceras. Se acepta ?token= solo para descargar un
  // respaldo (GET), nunca para leer datos ni para operaciones que modifican algo.
  const esDescargaDeRespaldo = req.method === "GET" && /^\/admin\/backups\/\d+\/download$/.test(req.path);
  if (esDescargaDeRespaldo && typeof req.query.token === "string") {
    return req.query.token.trim();
  }

  return "";
}

/** Exige una sesión válida. Adjunta req.auth con el usuario y su rol. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sesion = verificarToken(extraerToken(req));
  if (!sesion) {
    return res.status(401).json({ error: "Sesión inválida o vencida. Vuelve a iniciar sesión." });
  }
  req.auth = sesion;
  next();
}

/** Exige que la sesión tenga uno de los roles indicados. */
export function requireRole(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const sesion = verificarToken(extraerToken(req));
    if (!sesion) {
      return res.status(401).json({ error: "Sesión inválida o vencida. Vuelve a iniciar sesión." });
    }
    if (!roles.includes(sesion.r)) {
      return res.status(403).json({ error: "No tienes permiso para realizar esta operación." });
    }
    req.auth = sesion;
    next();
  };
}
