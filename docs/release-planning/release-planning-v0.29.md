# Release Planning — v0.29 "Craft"

> status: draft
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.29. Archive
> into `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.29.0` |
| **Previous** | v0.28.0 (Living Room — TV shelf aesthetics + system menu + gameplay-menu fix) |
| **Theme** | "Craft" — authentic retro presentation and engineering depth. Four user directives (2026-07-03, delivered together): **(a)** *"Add optional FPS counter. Add tools for profiling emulation performance, recording it in an easily-accessible file for you to review later, and to review in the RGP GUI."* **(b)** *"Add GUI for adjusting per-core settings."* **(c)** *"State-of-the-art CRT filter. Include scanlines, screen curvature, color bleed, etc. Make it highly configurable."* Plus two roadmap-committed carryovers from v0.28's Out-of-Scope §4: keyboard accessibility ([#29](https://github.com/rhohn94/harmony/issues/29)) and play-path integration tests ([#28](https://github.com/rhohn94/harmony/issues/28)). |

**Grimoire-Requirement tracker check:** `issue_tracker.py list --state open
--labels Grimoire-Requirement` returned zero results — no framework-required
items to fold in.

---

## 2. Major Features

### W280 — CRT filter (state-of-the-art, highly configurable)

Full design: [`crt-filter-design.md`](../design/crt-filter-design.md).

**Ground truth (resolved by research before this plan locked):** the native
path (`NativePlayer.tsx`) is plain Canvas2D/`putImageData` — a shader pass
is a frontend-only change, zero Rust involved. The EJS path
(`InPagePlayer.tsx`) is a genuine cross-origin iframe; EmulatorJS owns its
own WebGL2 canvas inside it, unreachable from the parent for true per-pixel
effects without patching the vendored runtime. **Decision:** v1 accepts an
intentional quality asymmetry — real WebGL2 shader (scanlines + barrel
curvature + color-bleed + vignette) on the native path, CSS-only
approximation (overlay div + filters) on the EJS path — rather than block
the release on an EmulatorJS-runtime patch (recorded follow-up).

**Contract:** one shared config (per-effect intensity 0–100 + four presets:
Off / Classic CRT / Arcade Cabinet / Sharp) persisted through the existing
settings layer, with a live-preview panel; applies identically regardless
of which path a given game uses.

**Acceptance:** settings panel with sliders + presets and live preview;
native path renders through the new WebGL2 pipeline with a documented,
justified shader-cost budget (no material FPS regression per
`native-perf.log`); EJS path shows the CSS approximation at consistent
slider values; no interaction with `prefers-reduced-motion` (static filter,
no motion); all gates + `recipe.py smoke` green; `crt-filter-design.md`
updated with any decisions made during implementation. — **Branch:**
`feat/w280-crt-filter`

### W281 — Emulation performance tooling: FPS counter + profiling

Full design: [`performance-tooling-design.md`](../design/performance-tooling-design.md).

**Ground truth:** `native-perf.log` (W270/W274) already captures FPS + audio
ring health for the native path only — no frame-time percentiles, no
dropped-frame counter, no EJS coverage at all (EJS has no Rust-side runtime
loop).

**Contract:** optional on-screen FPS counter computed client-side per path
(no shared IPC field); native `perf_file.rs`/`runtime.rs` gain additive
frame-time percentile + dropped-frame fields (existing format/tests must
keep passing); a new lightweight EJS-side stat channel
(`postMessage` → new IPC command → sibling log file), honestly lighter than
the native log, not a forced-parity claim; a new in-app GUI panel (Settings
→ Performance) reading both logs, rendered with the existing inline-SVG
pattern (no new charting dependency).

**Acceptance:** FPS counter toggle works on both paths without materially
affecting frame pacing; `native-perf.log` format is additive-only; a new
EJS-path sibling log exists; the GUI panel shows real recent entries from a
running instance (visual-inspect/smoke check); all gates green;
`native-emulation-design.md` gains a cross-reference. — **Branch:**
`feat/w281-perf-tooling`

### W282 — Per-core settings GUI

Full design: [`core-options-design.md`](../design/core-options-design.md).

**Ground truth:** three separate core-integration models exist (external
RetroArch subprocess, native FFI-hosted cores, EmulatorJS WASM cores); only
the native FFI host is in Harmony's control today, and its environment
callback (`callbacks.rs`) has no `GET_VARIABLE`/`SET_VARIABLES` handling —
core-declared options never reach Rust today.

**Contract:** implement the two environment-callback cases; new IPC
commands (`list_core_options`/`get_core_option`/`set_core_option`);
persistence keyed `(system, core, option_key)` via the existing
settings/db pattern; new screen off the Cores area listing the active
core's declared options with the right control per type, applying on next
boot (no hot-reload requirement). RetroArch-external and EmulatorJS cores
are explicitly out of scope — they already have their own settings
surfaces.

**Acceptance:** native-hosted NES core's declared options are listed,
editable, and persist across restarts; an option with no persisted value
falls back to the core's own default; no core-options entry point appears
for systems that don't route through the native FFI host;
`cargo test` covers the new callback branch + persistence round-trip; all
gates + `recipe.py smoke` green; `core-management-design.md` cross-links
this doc. — **Branch:** `feat/w282-core-options`

### W283 — Keyboard accessibility (#29)

**The ask:** focus-visible styling and full keyboard operability for
non-controller users, across every screen and mode (including TV mode's
system menu and embedded screens from v0.28, and the gameplay menu-hold
affordance from W279).

**Contract:** every interactive control reachable and operable via
Tab/Shift-Tab/Enter/Space/Arrow keys with a visible focus ring (central
motion/focus tokens, no ad-hoc per-component styling); no change to
controller/gamepad semantics — this is an additive input modality, not a
rebind. Extends `controller-input-design.md` (keyboard as an input method)
and `interaction-wiring-design.md` (focus-visible styling contract) with
new sections documenting what's covered.

**Acceptance:** keyboard-only pass reaches every `HARMONY_ROUTES`
destination, the TV system menu (W278) and embedded screens, and can
open/close the gameplay menu overlay, with a visible focus indicator at
every step; no regression to existing controller/mouse interaction; all
gates + `recipe.py smoke` green. — **Branch:** `feat/w283-keyboard-a11y`

### W284 — Play-path integration tests (#28)

**The ask:** integration coverage for the play paths and IPC surface so a
broken player fails CI, not manual QA.

**Contract:** cover both play paths end-to-end (boot → frame delivery →
input → pause/resume → exit) at the IPC-surface level, plus the new W280
(CRT config)/W281 (perf logging)/W282 (core options) IPC commands added
earlier in this same release, so the suite reflects the final v0.29 play
surface rather than a stale pre-release snapshot. Extends
`runtime-verification-design.md` with the new coverage.

**Acceptance:** CI-runnable integration tests exist for both play paths and
the play-adjacent IPC surface (native frame polling, EJS loopback
handshake, CRT config get/set, perf-log read, core-options get/set); a
deliberately broken player/IPC path fails the suite (spot-checked by the
agent); all gates green. — **Branch:** `fix/w284-play-path-integration-tests`

---

## 3. Parallel Implementation Strategy

Conflict map: W280 and W281 both heavily touch `NativePlayer.tsx` and
`InPagePlayer.tsx` (rendering pipeline vs. telemetry) — sequential to avoid
merge friction. W282 (Rust core-callback + new isolated screen) and W283
(cross-cutting but purely additive markup/focus, not rendering internals)
don't overlap either other item's files — safe to parallelize. W284 runs
last by design, so its integration coverage reflects the complete,
post-W280/W281/W282 play surface rather than going stale immediately.

### Pass 1 (parallel)

- `feat/w282-core-options` (W282)
- `feat/w283-keyboard-a11y` (W283)

### Pass 2 (sequential — both touch the player components)

1. `feat/w280-crt-filter` (W280) — lands first; the more invasive rendering
   change.
2. `feat/w281-perf-tooling` (W281) — lands after, so its FPS counter/perf
   budget reflects the final (post-CRT-shader) rendering pipeline.

### Pass 3

- `fix/w284-play-path-integration-tests` (W284) — after every other pass,
  so coverage targets the final v0.29 play-path surface.

---

## 4. Out of Scope for v0.29

- Patching the vendored EmulatorJS `player.html` runtime to expose its
  internal canvas for a true per-pixel CRT shader on the EJS path (would
  close the native/EJS fidelity gap in W280) — recorded follow-up.
- Per-game/per-core automatic CRT presets.
- RetroArch-external-launch and EmulatorJS core options (W282 targets only
  the native FFI-hosted core model) — recorded follow-up if Harmony ever
  intermediates RetroArch's own config.
- Hot-reloading a core option mid-session without a restart.
- Cross-session performance analytics/dashboards or automatic regression
  alerting (W281) — recorded follow-up.
- CPU flamegraphs/sampling profilers (W281) — out of reach without a new
  profiler dependency.
- Controller remap UI changes, TV-native per-screen redesigns beyond the
  v0.28 uniform scale-up, and routing embedded TV launches through the
  takeover — none of these were tagged `v0.29` by the v0.28 plan's §4 and
  stay un-scheduled roadmap backlog.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.29 |
|---|---|---|---|---|
| `feat/w282-core-options` (W282) | ☐ | ☐ | ☐ | ☐ |
| `feat/w283-keyboard-a11y` (W283) | ☐ | ☐ | ☐ | ☐ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.29 |
|---|---|---|---|---|
| `feat/w280-crt-filter` (W280) | ☐ | ☐ | ☐ | ☐ |
| `feat/w281-perf-tooling` (W281) | ☐ | ☐ | ☐ | ☐ |

### Pass 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.29 |
|---|---|---|---|---|
| `fix/w284-play-path-integration-tests` (W284) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- None yet.
