import { fileURLToPath, URL } from "node:url";
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
  // Aura is vendored as a git submodule (vendor/aura) pinned to the v3.20
  // channel — the release ASSET omits bindings/react (design-language#858), so
  // the source tree is the only way to get the typed React adapter. These
  // aliases let app code import Aura from the submodule tree by stable names.
  // See docs/design/ux/design-language.md §2.3.
  resolve: {
    alias: {
      "@aura/react": fileURLToPath(
        new URL("./vendor/aura/bindings/react/aura-react.js", import.meta.url),
      ),
      "@aura/css": fileURLToPath(
        new URL("./vendor/aura/css", import.meta.url),
      ),
      "@aura/runtime": fileURLToPath(
        new URL("./vendor/aura/dist/aura.js", import.meta.url),
      ),
    },
  },
  server: {
    port: TAURI_DEV_PORT,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
