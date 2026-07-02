# Third-Party Notices

Harmony bundles third-party software in its distributable. This file lists each
bundled component, its license, and a pointer to its corresponding source, as
required by those licenses (notably the **GNU GPL v3.0** of EmulatorJS).

Harmony's own source code is licensed under **GPL-3.0-only** — see
[`LICENSE`](LICENSE) at the repository root. (Resolved in v0.23; see
[Resolved maintainer decisions](#resolved-maintainer-decisions) at the bottom.)

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

### libunrar.js — REMOVED in v0.23

- **What it was:** An Emscripten/WebAssembly port of RARLab's UnRAR library
  (`compression/libunrar.js` / `.wasm`), previously embedded because
  `include_dir!` swept the whole `vendor/emulatorjs` tree.
- **Status:** **Excluded from the vendored tree and the distributed binary**
  as of v0.23. The restrictive UnRAR license is GPL-incompatible, and
  Harmony's flows never invoke RAR extraction (`.rar` content is not
  supported). If RAR support is ever wanted, a GPL-compatible extractor must
  be used instead.
- **Historical upstream:** https://github.com/tnikolai2/libunrar-js
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

## Resolved maintainer decisions

Both former open questions were resolved in v0.23 (issue
[#26](https://github.com/rhohn94/harmony/issues/26)):

1. **Harmony's own combined-work license → GPL-3.0-only.** Harmony bundles
   GPL-3.0 software (EmulatorJS) into a single distributed binary, so the
   combined work is conveyed under GPL-3.0. `LICENSE` at the repo root carries
   the license text; `package.json` and `src-tauri/Cargo.toml` declare
   `GPL-3.0-only`.

2. **UnRAR blob → removed.** `compression/libunrar.js` / `.wasm` are excluded
   from the vendored EmulatorJS tree (see the component entry above), so no
   GPL-incompatible code ships in the binary. Harmony does not support `.rar`
   content.
