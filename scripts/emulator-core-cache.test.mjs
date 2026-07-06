// Guards the page-side half of the W374 (#31) pre-extracted-core-cache patch
// in `src-tauri/vendor/emulatorjs/src/emulator.js` — `downloadGameCore`'s
// `fetchPreExtracted` / `useCoreFiles` wiring. Every other W374 test
// (src-tauri/src/play/server.rs, src-tauri/src/play/core_extract.rs) exercises
// the Rust side (manifest building, disk cache, served routes); none of them
// touch this file, and `recipe.py smoke` (scripts/visual-inspect.mjs) uses
// mock IPC and never boots EmulatorJS in-page. Without a test here, a bug in
// the page-side patch — `useCoreFiles` never invoked, a manifest/JSON parse
// failure, or the `this.debug` gate misbehaving — would not be caught by any
// suite in this repo, even though the acceptance criterion ("second boot
// skips the 7z worker") is specifically about this file's behavior.
//
// Rather than reimplementing the patch's logic, this test loads the REAL
// vendored source and invokes its unmodified `downloadGameCore` method
// (via `Function` + a minimal fake `this`) so a regression in the actual
// shipped file fails here.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EMULATOR_JS_PATH = fileURLToPath(
  new URL("../src-tauri/vendor/emulatorjs/src/emulator.js", import.meta.url),
);

/** Loads the real `EmulatorJS` class from the vendored source into an
 * isolated `window`-less scope and returns the constructor, so tests exercise
 * the exact file the server ships rather than a copy. */
function loadEmulatorJsClass() {
  const source = readFileSync(EMULATOR_JS_PATH, "utf8");
  // The vendored file is a plain `class ... {}` followed by
  // `window.EmulatorJS = EmulatorJS;` — evaluate it in a function scope that
  // supplies a stub `window` and hands back the class itself, so this test
  // never depends on a real DOM/browser global.
  const factory = new Function("window", `${source}\nreturn EmulatorJS;`);
  return factory({});
}

// The real class is only used for its prototype methods (`getCores`,
// `getCore`, `requiresThreads`, `requiresWebGL2`, `downloadGameCore`) — a
// tiny memoized accessor keeps every test from re-parsing the source file.
let cachedClass;
function EmulatorJsClass() {
  if (!cachedClass) {
    cachedClass = loadEmulatorJsClass();
  }
  return cachedClass;
}

/** A minimal, always-valid `core.json` payload — `save` is truthy so
 * `useCoreFiles`'s save-file-extension branch (DOM `elements.bottomBar`
 * access, irrelevant to the cache wiring under test) is never taken. */
function coreJsonBytes() {
  const json = JSON.stringify({
    extensions: ["nes"],
    name: "fceumm",
    repo: "libretro",
    options: { supportsMouse: false },
    retroarchOpts: {},
    save: ".sav",
  });
  return new TextEncoder().encode(json).buffer;
}

/** Builds a minimal fake `this` sufficient to run `downloadGameCore` for the
 * "nes" system without touching the DOM, WebGL, or a real network — only the
 * handful of properties/methods `downloadGameCore` and the methods it calls
 * synchronously (`getCore`, `requiresThreads`, `requiresWebGL2`) actually
 * read. `downloadFile` is the one seam under test: it stands in for the real
 * HTTP layer and its call log proves which path (pre-extracted manifest vs.
 * 7z-archive-then-decompress) `downloadGameCore` took. */
function makeFakeInstance({ downloadFile, checkCompression, debug = false }) {
  const proto = EmulatorJsClass().prototype;
  const calls = { initGameCore: null, checkCompression: 0 };
  return {
    calls,
    config: { system: "nes", threads: false },
    debug,
    supportsWebgl2: true,
    webgl2Enabled: true,
    textElem: { innerText: "" },
    storage: { core: { get: async () => null, put: () => {} } },
    getCores: proto.getCores,
    getCore(generic) {
      return proto.getCore.call(this, generic);
    },
    requiresThreads: proto.requiresThreads,
    requiresWebGL2: proto.requiresWebGL2,
    preGetSetting: () => undefined,
    localization: (text) => text,
    startGameError: (msg) => {
      throw new Error(`startGameError called unexpectedly: ${msg}`);
    },
    downloadFile,
    checkCompression: (...args) => {
      calls.checkCompression += 1;
      return checkCompression(...args);
    },
    initGameCore(js, wasm, thread) {
      calls.initGameCore = { js, wasm, thread };
    },
  };
}

/** `downloadGameCore` kicks off a chain of `.then`/`await` continuations it
 * does not hand back to the caller (the method itself returns before the
 * network calls resolve), so tests must poll for the eventual effect rather
 * than await a single promise. */
async function waitFor(predicate) {
  await vi.waitFor(() => {
    if (!predicate()) {
      throw new Error("condition not met yet");
    }
  });
}

describe("emulator.js pre-extracted core cache (W374, #31)", () => {
  it("second boot: a resolving manifest skips checkCompression (the 7z Worker) entirely", async () => {
    const manifestUrl = "cores/extracted/fceumm-wasm.data.json";
    const manifest = {
      "core.json": "cores/extracted/deadbeef/core.json",
      "fceumm_libretro.js": "cores/extracted/deadbeef/fceumm_libretro.js",
      "fceumm_libretro.wasm": "cores/extracted/deadbeef/fceumm_libretro.wasm",
    };
    const requested = [];
    const downloadFile = async (path) => {
      requested.push(path);
      if (path === manifestUrl) {
        // The real `downloadFile` JSON-parses a text response before handing
        // it back (see `downloadFile`'s `try { res = JSON.parse(res) }`), so
        // the fake mirrors that: `data` is already the parsed manifest object.
        return { data: manifest };
      }
      if (path === "cores/reports/fceumm.json") {
        return { data: { buildStart: 42 } };
      }
      if (path === manifest["core.json"]) {
        return { data: coreJsonBytes() };
      }
      if (path === manifest["fceumm_libretro.js"]) {
        return { data: new TextEncoder().encode("// js").buffer };
      }
      if (path === manifest["fceumm_libretro.wasm"]) {
        return { data: new Uint8Array([0, 1, 2, 3]).buffer };
      }
      throw new Error(`unexpected downloadFile call: ${path}`);
    };
    const checkCompression = () => {
      throw new Error("checkCompression (7z Worker path) must not run on a pre-extracted cache hit");
    };
    const instance = makeFakeInstance({ downloadFile, checkCompression });

    EmulatorJsClass().prototype.downloadGameCore.call(instance);
    await waitFor(() => instance.calls.initGameCore !== null);

    expect(instance.calls.checkCompression).toBe(0);
    expect(requested).toContain(manifestUrl);
    expect(instance.calls.initGameCore.wasm).toEqual(new Uint8Array([0, 1, 2, 3]));
  });

  it("first boot (no pre-extracted manifest yet): falls through to the original download-then-decompress path unchanged", async () => {
    const manifestUrl = "cores/extracted/fceumm-wasm.data.json";
    const requested = [];
    const downloadFile = async (path) => {
      requested.push(path);
      if (path === manifestUrl) {
        return -1; // 404: server too old / not cached yet
      }
      if (path === "cores/reports/fceumm.json") {
        return { data: { buildStart: 42 } };
      }
      if (path === "cores/fceumm-wasm.data") {
        return { data: new Uint8Array([9, 9, 9]).buffer };
      }
      throw new Error(`unexpected downloadFile call: ${path}`);
    };
    const checkCompression = () => Promise.resolve({ "core.json": coreJsonBytes() });
    const instance = makeFakeInstance({ downloadFile, checkCompression });

    EmulatorJsClass().prototype.downloadGameCore.call(instance);
    await waitFor(() => instance.calls.initGameCore !== null);

    expect(requested).toContain(manifestUrl);
    expect(requested).toContain("cores/fceumm-wasm.data");
    expect(instance.calls.checkCompression).toBe(1);
  });

  it("debug mode bypasses the pre-extracted-cache lookup entirely (unchanged upstream behavior)", async () => {
    const requested = [];
    const downloadFile = async (path) => {
      requested.push(path);
      if (path === "cores/reports/fceumm.json") {
        return { data: { buildStart: 42 } };
      }
      if (path === "cores/fceumm-wasm.data") {
        return { data: new Uint8Array([1]).buffer };
      }
      throw new Error(`unexpected downloadFile call: ${path}`);
    };
    const checkCompression = () => Promise.resolve({ "core.json": coreJsonBytes() });
    const instance = makeFakeInstance({ downloadFile, checkCompression, debug: true });

    EmulatorJsClass().prototype.downloadGameCore.call(instance);
    await waitFor(() => instance.calls.initGameCore !== null);

    expect(requested).not.toContain("cores/extracted/fceumm-wasm.data.json");
    expect(instance.calls.checkCompression).toBe(1);
  });
});
