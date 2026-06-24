// Vite entry point: mounts <App/> into #root.
// W2 installs the anti-FOUC Aura theme bootstrap here (master contract §1.1);
// the import seam is kept clean for that — no theme wiring yet.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Harmony: #root element not found in index.html");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
