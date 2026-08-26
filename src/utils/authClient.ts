/**
 * Sesión del lado del navegador.
 *
 * El servidor ahora valida un token firmado en cada operación. En vez de tocar
 * las decenas de llamadas `fetch` repartidas por los tres paneles, se envuelve
 * `fetch` una sola vez: cualquier petición a `/api/...` lleva la sesión sola.
 */

const CLAVE_TOKEN = "alpaso_token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(CLAVE_TOKEN, token);
  } catch {
    /* almacenamiento bloqueado: la sesión durará solo mientras la página esté abierta */
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    /* nada que limpiar */
  }
}

/** Se emite cuando el servidor rechaza la sesión, para que la app pida iniciar sesión de nuevo. */
export const EVENTO_SESION_VENCIDA = "alpaso:sesion-vencida";

let instalado = false;

export function installAuthFetch(): void {
  if (instalado) return;
  instalado = true;

  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input :
      input instanceof URL ? input.toString() :
      input.url;

    // Solo se adjunta la sesión a la propia API, nunca a dominios externos.
    const esApiPropia = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
    const token = getAuthToken();

    if (esApiPropia && token) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      init = { ...init, headers };
    }

    const res = await fetchOriginal(input as any, init);

    // Sesión vencida o inválida: se avisa a la app para volver al login.
    if (esApiPropia && res.status === 401) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent(EVENTO_SESION_VENCIDA));
    }

    return res;
  };
}
