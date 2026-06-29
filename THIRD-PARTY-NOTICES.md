# Third-Party Notices

Harmony bundles third-party software in its distributable. This file lists each
bundled component, its license, and a pointer to its corresponding source, as
required by those licenses (notably the **GNU GPL v3.0** of EmulatorJS).

Harmony's own source code is **not** covered by this file — its licensing has
not yet been declared by the maintainer. See the
[Open question for maintainer](#-open-question-for-maintainer) at the bottom.

Harmony ships **no game content** of any kind. The in-page player only serves
ROM files the user has imported into their own local library.

---

## Bundled components

All components below are embedded into the macOS application binary at compile
time (Rust `include_dir!` over `src-tauri/vendor/emulatorjs`, and `include_str!`
for `src-tauri/vendor/player.html`) and are therefore conveyed as part of the
distributed application.

### EmulatorJS

- **What it is:** The in-page WebAssembly emulator runtime (loader, player
  scripts, styles, localization, and compression helpers) used by Harmony's
  v0.15 "in-page play" feature.
- **Bundled at:** `src-tauri/vendor/emulatorjs/` (`emulator.min.js`,
  `emulator.min.css`, `emulator.css`, `loader.js`, `src/*.js`, `localization/`,
  `compression/`, `version.json`).
- **Version:** `4.2.3` (per `src-tauri/vendor/emulatorjs/version.json`).
- **License:** **GPL-3.0** — see [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt).
- **Upstream / corresponding source:**
  https://github.com/EmulatorJS/EmulatorJS (release tag `v4.2.3`).

### fceumm (libretro NES core)

- **What it is:** The Nintendo Entertainment System / Famicom emulator core that
  EmulatorJS loads to run NES titles in-page. This is the **only** emulator core
  currently bundled in the binary.
- **Bundled at:** `src-tauri/vendor/emulatorjs/cores/fceumm-wasm.data`
  (EmulatorJS cores package `@emulatorjs/cores` version `4.2.3`; build report
  `src-tauri/vendor/emulatorjs/cores/reports/fceumm.json`, built 2025-06-14).
- **License:** **GPL-2.0-or-later** (FCEUmm / FCEUX lineage).
- **Upstream / corresponding source:**
  https://github.com/libretro/libretro-fceumm
  (packaged for the web via https://github.com/EmulatorJS/build).

> Note: the EmulatorJS cores manifest (`cores/package.json`) declares many other
> cores as upstream dependencies, but only `fceumm-wasm.data` is actually
> vendored and shipped in this build. If additional `<core>-wasm.data` files are
> bundled later, add each one here with its own libretro upstream and license
> (libretro cores are typically GPLv2/GPLv3, with a few non-commercial
> exceptions — verify per core).

### nipplejs

- **What it is:** A virtual on-screen joystick library, included as part of the
  EmulatorJS runtime (`src/nipplejs.js`, concatenated into `emulator.min.js`).
- **Bundled at:** `src-tauri/vendor/emulatorjs/src/nipplejs.js`.
- **License:** **MIT**.
- **Upstream / corresponding source:** https://github.com/yoannmoinet/nipplejs

### libunrar.js

- **What it is:** An Emscripten/WebAssembly port of RARLab's UnRAR library, used
  by EmulatorJS to extract RAR-packed content.
- **Bundled at:** `src-tauri/vendor/emulatorjs/compression/libunrar.js`,
  `src-tauri/vendor/emulatorjs/compression/libunrar.wasm`.
- **License:** Derived from the **UnRAR license** (RARLab). The UnRAR license
  permits use and redistribution but **forbids using the source to develop a
  RAR (de)compressor** and carries other restrictions; it is *not* an OSI-approved
  open-source license. See the [Open question for maintainer](#-open-question-for-maintainer).
- **Upstream / corresponding source:** https://github.com/tnikolai2/libunrar-js
  (UnRAR source: https://www.rarlab.com/rar_add.htm).

---

## Written offer for corresponding source (GPL §6)

For the GPL-3.0 component (EmulatorJS) and the GPL-2.0-or-later component
(the fceumm core), the **complete corresponding source code** is the upstream
material at the repositories and version/tags listed above:

- EmulatorJS `v4.2.3` — https://github.com/EmulatorJS/EmulatorJS
- fceumm — https://github.com/libretro/libretro-fceumm
  (web build pipeline: https://github.com/EmulatorJS/build)

These public repositories at the stated versions constitute the corresponding
source and satisfy the GPL's source-availability requirement. The vendored
copies under `src-tauri/vendor/emulatorjs/` are the unmodified upstream release
artifacts (the local `emulator.min.js` is rebuilt from the vendored `src/` by
`scripts/build-ejs-bundle.mjs` and is byte-identical to the upstream bundle).

The full GPL-3.0 license text is reproduced verbatim in
[`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt).

---

## ⚠️ Open question for maintainer

The following items require a maintainer decision and have **not** been acted on
in this attribution work:

1. **Harmony's own combined-work license.** Harmony bundles GPL-3.0 software
   (EmulatorJS) directly into a single distributed binary. GPL-3.0 is a strong
   copyleft license, and combining it into one conveyed work generally requires
   the **entire combined work** to be licensed under GPL-3.0-compatible terms.
   Harmony has not declared a license for its own code. A maintainer needs to
   decide how to license Harmony's own code (e.g. adopt GPL-3.0, restructure so
   EmulatorJS is not a derived/combined work, or seek another arrangement). This
   file deliberately does **not** add a project `LICENSE`, since that is the
   maintainer's call.

2. **UnRAR license compatibility.** The bundled `libunrar.js` / `libunrar.wasm`
   carry the restrictive **UnRAR license**, which is generally considered
   **incompatible with the GPL** and is not an open-source license. Because
   `include_dir!` embeds the whole `vendor/emulatorjs` tree, these files ship in
   the binary even though Harmony's NES-only flow may not invoke RAR extraction.
   The maintainer should decide whether to (a) keep and separately comply with
   the UnRAR terms, or (b) exclude the `compression/libunrar.*` files from the
   embedded vendor set if RAR support is not needed.
