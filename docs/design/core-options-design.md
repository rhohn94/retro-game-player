# Per-core settings — libretro core options GUI

> **Up:** [↑ Design docs](README.md) · **Sib:** [core-management-design.md](core-management-design.md), [core-discovery-design.md](core-discovery-design.md)

> **Status:** design-first (blocks implementation). Owns v0.29 **W282**.

## Motivation

User directive (2026-07-03, verbatim): *"Emulation Configuration: Add GUI
for adjusting per-core settings."*

## Ground truth: three separate core-integration models (resolved by research)

Harmony has **no single "the core" abstraction** — three independent
integration models coexist, none of them vendoring RetroArch itself:

1. **External RetroArch subprocess** (`src-tauri/src/core/launch/`) — a
   user-installed RetroArch app, spawned as a child process. Its core
   options live in RetroArch's own `retroarch.cfg` / per-core override
   files, entirely outside Harmony's control today.
2. **Native FFI-hosted cores** (`src-tauri/src/core/cores/`,
   `src-tauri/src/play/native/`) — downloaded `.dylib` cores Harmony loads
   and drives in-process (currently `fceumm` NES). The environment callback
   (`callbacks.rs`) handles only a fixed subset today
   (`GET_CAN_DUPE`/`GET_OVERSCAN`/`SET_PIXEL_FORMAT`/`SET_MESSAGE`/
   `SHUTDOWN`) — **no `SET_VARIABLES`/`GET_VARIABLE` handling exists**, so a
   core's declared options never reach Rust, let alone the UI.
3. **EmulatorJS WASM cores** (`src-tauri/src/play/ejs_cores.rs`) — EmulatorJS
   manages its own option surface inside its iframe, unrelated to the other
   two.

**Decision:** v1 targets **model 2 only** (native FFI-hosted cores). Models
1 and 3 already have their own settings surfaces; intermediating them is a
different, larger integration problem than "add a GUI," and is out of scope.

## Scope (v0.29)

**In scope:**
- Implement `RETRO_ENVIRONMENT_GET_VARIABLE` and
  `RETRO_ENVIRONMENT_SET_VARIABLES` in `callbacks.rs` so a hosted core's
  declared option list (key, description, allowed values, default) surfaces
  to Rust at init.
- New IPC commands: `list_core_options`, `get_core_option`,
  `set_core_option` (mirroring the shape of the existing `cores.ts` wrapper).
- Persistence keyed `(system, core, option_key)` — reuse the existing
  settings/db persistence pattern (see `persistence-design.md`), not a new
  storage mechanism.
- A new screen (reachable from the Cores area, alongside `CoresPane.tsx`)
  listing the active core's options with the appropriate control per
  declared type (bool toggle, enum/select, numeric range), writing through
  to the new IPC commands.
- Options apply **on next boot** — no hot-reload requirement for v1.

**Out of scope (recorded follow-ups):**
- RetroArch-external-launch cores — users configure these via RetroArch's
  own UI; Harmony does not read/write `retroarch.cfg`.
- EmulatorJS cores — already have their own in-iframe settings surface.
- Hot-reloading an option mid-session without a core restart.
- Broadening the native-hosted core catalog beyond `fceumm` (tracked
  separately by `native-emulation-design.md`'s own follow-ups) — this
  feature works with whatever native cores exist at the time, present or
  future, without assuming a specific one.

## Acceptance

- For the native-hosted NES core, its declared libretro options are listed
  in the new screen, editable, and persisted across app restarts.
- A core with declared options that Harmony has never persisted a value for
  falls back to the core's own declared default (no crash, no blank value).
- RetroArch-launched and EmulatorJS games are unaffected — no core-options
  entry point is shown for systems that don't route through the native
  FFI host.
- `cargo test` covers the new environment-callback branch (unit-testable
  the same way the existing fixed-subset callbacks are) and the persistence
  round-trip; all gates + `recipe.py smoke` green; `core-management-design.md`
  gains a cross-reference to this doc.
