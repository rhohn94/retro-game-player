# Per-core settings — libretro core options GUI

> **Up:** [↑ Design docs](README.md) · **Sib:** [core-management-design.md](core-management-design.md), [core-discovery-design.md](core-discovery-design.md)

> **Status:** implemented (W282, v0.29 "Craft"). Owns v0.29 **W282**.

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

## Implementation notes (W282)

### `callbacks.rs`: `GET_VARIABLE` / `SET_VARIABLES`

- `RETRO_ENVIRONMENT_SET_VARIABLES` (id `16`) decodes the core's
  null-terminated `retro_variable` array into `CoreVariable { key,
  description, choices }`, parsing each `retro_variable.value` string
  (`"Description; default|choice1|choice2|..."`) via a small pure helper
  (`parse_variable_value`) and forwarding the whole list as one
  `EnvironmentEvent::VariablesDeclared(Vec<CoreVariable>)` — mirroring how
  `SET_PIXEL_FORMAT` already forwards through the same channel. A malformed
  entry (no `;` separator, or zero choices after it) is skipped rather than
  failing the whole declaration. `choices[0]` is always the core's own
  declared default (`CoreVariable::default_value`).
- `RETRO_ENVIRONMENT_GET_VARIABLE` (id `15`) reads a process-global
  `CORE_VARIABLES: Mutex<Option<HashMap<String, String>>>`, seeded by the new
  `set_core_variables` before a core boots. A query for an unknown key, or a
  query before anything has been seeded, reports unhandled (`false`) —
  exactly what a real frontend does for a variable it doesn't recognize.
  `uninstall` clears the seeded map so a stray query after a session ends
  never answers with a prior session's values.
- The `retro_variable.value` answer pointer needs same-process backing
  storage that outlives the callback return; a single-slot
  `GET_VARIABLE_ANSWER: Mutex<Option<CString>>` holds the most recent answer
  (replaced each query — libretro cores read the pointer immediately, never
  across frames, so nothing needs to accumulate).

### Headless declared-options probe (`core::core_options::probe`)

The declared option list only exists as the *side effect* of a real
`retro_init` call — there's no separate "ask the core its schema" libretro
entrypoint. `list_core_options` therefore needs a real (but ROM-less) boot to
learn what a core declares: `probe_declared_options` drives `LibretroCore`
through `load` → `set_environment` → `init` (never `load_game`), captures the
`VariablesDeclared` event off the environment channel with a bounded
(500 ms) wait, then unloads. This is the same process-global callback
plumbing (`install`/`environment`/`uninstall`) a live play session uses, so a
`PROBE_LOCK` serializes concurrent probe calls; the test suites for both
`callbacks.rs` and `probe.rs` additionally share one `lock_tests()` guard
(exposed `pub(crate)` from `callbacks.rs`) since both drive the same
process-global FFI state and would otherwise race under `cargo test`'s
parallel test execution.

### Persistence (`core::core_options::persistence`)

Reuses the existing generic `settings` key/value table (no new table, no
migration) — the `(system, core, option_key)` triple is encoded into one
namespaced key, `core_option::<system>::<core>::<option_key>`, and the value
is JSON-scalar-encoded the same way every other settings row is. `settings.rs`
itself is untouched.

### Effective-value resolution and session seeding

`core::core_options::resolve_effective_options` (used by `list_core_options`)
and `resolve_session_variables` (used by `start_native_play`) both apply the
same fallback: the persisted value for `(system, core, key)` if one exists,
else the core's own declared default (`CoreVariable::default_value`) — never
a blank or crashing value, satisfying the acceptance criterion directly.
`start_native_play` (in `commands::native_play`) probes the core's declared
options and seeds the resolved values via `set_core_variables` *before* the
real session boots, so the core's own `GET_VARIABLE` queries during its
`retro_init` see exactly what's persisted. This costs one extra (ROM-less)
core load per game start; a probe failure degrades to booting with no seeded
variables (the pre-W282 behavior — `GET_VARIABLE` simply reports unhandled)
rather than blocking the session.

### IPC surface

| Command | Args | Returns |
|---|---|---|
| `list_core_options` | `{ system }` | `CoreOptionDto[]` |
| `get_core_option` | `{ system, optionKey }` | `string \| null` |
| `set_core_option` | `{ system, optionKey, value }` | `void` |

Every command rejects (`AppError::Unsupported`) for any `system` other than
`play::native::NATIVE_SYSTEM` — the single gate that keeps RetroArch-external
and EmulatorJS systems from ever reaching the probe or the persisted-value
lookup, satisfying "no core-options entry point" for those systems at the
backend layer (the frontend also never mounts a native-only entry point for
them, belt-and-suspenders).

### Frontend

`src/features/settings/panes/CoreOptionsPane.tsx` is a new Settings section
(`SettingsPage.tsx`'s section list), always listed but rendering an
explanatory note (not controls) when `useCoreOptions` resolves `unsupported`
— i.e., whenever there's no active native-hosted core to configure yet.
`CoresPane.tsx` also gained a "Configure options" button on the native
system's row specifically (`NATIVE_SYSTEM` from `features/play/nativePath`),
satisfying "reachable from the Cores area, alongside `CoresPane.tsx`"
literally, as well as via the Settings nav.

The three control archetypes are chosen by a small pure classifier
(`features/core-options/controlKind.ts`, unit-tested): a recognized two-way
pair (`enabled`/`disabled`, `on`/`off`, `true`/`false`, `yes`/`no`) renders a
toggle button; an all-numeric choice list renders a `type="range"` slider
snapped to the sorted discrete choice values; everything else (including a
single-choice option) renders a `<select>` — always correct for any declared
choice list, so no combination of core-declared options can produce a blank
or crashing control.
