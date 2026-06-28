import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Harmony frontend. The Tauri dev server expects a fixed
// port; the build emits a static bundle the Rust shell loads.
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
