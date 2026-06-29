// Rebuilds the EmulatorJS single production bundle that the in-page player loads
// (v0.15). Concatenates the vendored src/ scripts in loader.js's exact order and
// minifies them with terser into emulator.min.js — the same artifact the upstream
// EmulatorJS release ships (our output matches it byte-for-byte). Also copies the
// stylesheet to emulator.min.css.
//
// No network: this only transforms files already vendored under
// src-tauri/vendor/emulatorjs/src. Re-run it after re-vendoring EmulatorJS:
//   node scripts/build-ejs-bundle.mjs
//
// terser is provided transitively by the toolchain (node_modules/.bin/terser).
// `mangle` is left at terser's default (toplevel: false), so the scripts' global
// declarations — which the modules reference across file boundaries — are kept.

import { execFileSync } from "node:child_process";
import { copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src-tauri/vendor/emulatorjs");
const terser = join(root, "node_modules/.bin/terser");

// MUST match the `scripts` array in vendor/emulatorjs/loader.js.
const order = [
  "emulator.js",
  "nipplejs.js",
  "shaders.js",
  "storage.js",
  "gamepad.js",
  "GameManager.js",
  "socket.io.min.js",
  "compression.js",
];

const inputs = order.map((f) => join(dir, "src", f));
const outJs = join(dir, "emulator.min.js");

execFileSync(terser, [...inputs, "-o", outJs, "-c", "-m"], { stdio: "inherit" });
copyFileSync(join(dir, "emulator.css"), join(dir, "emulator.min.css"));

console.log(`built emulator.min.js (${statSync(outJs).size} bytes) + emulator.min.css`);
