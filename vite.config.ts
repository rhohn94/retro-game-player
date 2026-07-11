import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { auraAliases } from "./vite/aura-aliases";

// Vite config for the Retro Game Player frontend. The Tauri dev server expects
// a fixed port; the build emits a static bundle the Rust shell loads.
const TAURI_DEV_PORT = 1420;

// The Aura runtime (vendor/aura/dist/aura.js) is a self-registering IIFE bundle.
// Its core IIFE calls `Aura.ready(injectSprite)` BEFORE it assigns `Aura.icons`
// further down the same synchronous function. `Aura.ready` runs its callback
// immediately whenever `document.readyState !== "loading"` — which is always the
// case for a deferred ES module (`import "@aura/runtime"` ran after parse). That
// fired `injectSprite()` before `Aura.icons` existed → `Cannot read properties
// of undefined (reading 'names')`, which aborted the AuraProvider module and
// left React unmounted (blank app, only the CSS aurora backdrop painting).
//
// Fix: load the runtime as a CLASSIC, render-blocking <head> script instead, so
// it executes DURING parsing (readyState === "loading"). Then `Aura.ready`
// correctly defers to DOMContentLoaded, by which point the whole IIFE — and
// `Aura.icons` — is defined. Inlining is safe: the bundle contains no
// `</script>` token, and it runs in dev + build + the Tauri custom protocol with
// no extra request or path resolution. AuraProvider drops the module import.
function auraRuntimeClassicScript(): Plugin {
  return {
    name: "aura-runtime-classic-script",
    transformIndexHtml() {
      const runtimePath = fileURLToPath(
        new URL("./vendor/aura/dist/aura.js", import.meta.url),
      );
      return [
        {
          tag: "script",
          children: readFileSync(runtimePath, "utf8"),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), auraRuntimeClassicScript()],
  // Tauri serves the app over a fixed port in dev; clearScreen off keeps
  // Rust compiler output visible.
  clearScreen: false,
  // Aura is vendored via the Dependency Channel (vendor.toml [deps.aura],
  // v3.541.0 asset bundle). design-language#858 (asset omitted bindings/react)
  // is fixed, which unblocked the migration off the former git submodule; the
  // committed vendor/aura tree sits at the same path, so these aliases let app
  // code import Aura by stable names, unchanged. The alias map itself is
  // single-sourced in vite/aura-aliases.ts (shared with vitest.config.ts).
  // See docs/design/ux/design-language.md §2.3.
  resolve: {
    alias: auraAliases,
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
