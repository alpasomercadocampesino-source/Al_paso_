import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Manejo global para ignorar excepciones unhandled de cuotas de Firestore en segundo plano
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const isQuota =
      reason?.code === "resource-exhausted" ||
      reason?.message?.includes("RESOURCE_EXHAUSTED") ||
      String(reason).includes("Quota exceeded");

    if (isQuota) {
      event.preventDefault();
      console.warn("[Firestore Quota] Excepción de cuota capturada globalmente. La aplicación continúa funcionando con datos locales en IndexedDB.");
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

