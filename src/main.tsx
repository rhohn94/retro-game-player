// Vite entry point: mounts <App/> into #root, wrapped in the AuraProvider (loads
// the Aura CSS barrel + runtime + the Retro Game Player theme, and owns the
// live theme / persistence) and a HashRouter (a Tauri SPA loads from a custom
// protocol, so a hash router avoids server-side route resolution). The
// anti-FOUC theme class is applied before first paint by the synchronous head
// script in index.html (architecture §1.1, design-language.md §4);
// AuraProvider keeps it in sync.
//
// layer-order.css MUST be the first CSS import so Vite establishes the full
// cascade layer order before any feature CSS (library.css, cores.css) declares
// @layer rgp-theme. rgp-theme is last in that list → highest priority →
// the app's overrides always win over Aura's layers (see design-language.md §7.5).
import "./styles/layer-order.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuraProvider } from "./theme/AuraProvider";
import { installGlobalErrorHandlers } from "./telemetry/errorTelemetry";
import "./styles/global.css";

// W360 (error-telemetry-design.md): install the window-level error sink
// before anything renders, so the earliest possible boot errors are covered.
installGlobalErrorHandlers();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Retro Game Player: #root element not found in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuraProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuraProvider>
  </React.StrictMode>,
);
