import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Harmony frontend. The Tauri dev server expects a fixed
// port; the build emits a static bundle the Rust shell loads.
const TAURI_DEV_PORT = 1420;

export default defineConfig({
  plugins: [react()],
  // Tauri serves the app over a fixed port in dev; clearScreen off keeps
  // Rust compiler output visible.
  clearScreen: false,
  server: {
    port: TAURI_DEV_PORT,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
