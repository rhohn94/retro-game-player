# Release Planning — v0.21 "Bedrock"

> status: agreed
> Companion to `version-history.md`. Captures the scope, pass structure, and
> implementation ledger for v0.21. Archive into `version-history.md` when the
> release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.21` |
| **Previous** | v0.20 "Atlas" (first-class add-provider experience: curated catalog, guided dialog, detect-from-URL, live validator) |
| **Theme** | "Bedrock" — host the `fceumm` NES core natively instead of in EmulatorJS/WASM, to fix the Web Audio cold-start garble ([#15](https://github.com/rhohn94/harmony/issues/15)) and cut load time at the root, behind a flag, with EmulatorJS retained as the fallback for every other system. |

### Scope decisions (user-directed)

- Confirmed via AskUserQuestion: **lock the full 8-item scope** (not a
  Phase-1-only release, not a pre-release spike) — executed internally as two
  phases (core+audio first, then UI wiring) so a dead end is caught before the
  full token spend, but both phases ship together in v0.21.
- This release **takes the v0.21 slot** that was previously roadmapped for the
  "JS-render fetch tier" — that carryover rolls to v0.22 (see §4).

---

## 2. Major Features

### W210 — FFI core lifecycle

`src-tauri/src/play/native/core.rs`. `libloading`-based `dlopen` of the
installed `fceumm_libretro.dylib`; hand-rolled FFI struct/function bindings for
the ~13-function libretro API surface (`retro_api_version`, `retro_init`,
`retro_deinit`, `retro_get_system_info`, `retro_get_system_av_info`,
`retro_set_environment`, `retro_set_video_refresh`,
`retro_set_audio_sample_batch`, `retro_set_input_poll`,
`retro_set_input_state`, `retro_load_game`, `retro_run`, `retro_unload_game`).
`LibretroCore` owns the lifecycle (load → init → load_game → run\* → unload →
deinit).

- **Acceptance:** a core loads from a real installed `.dylib` path and
  responds to `retro_get_system_info`/`retro_get_system_av_info`; lifecycle
  tests run headlessly against a mock/stub core (no real hardware needed).
- Branch: `feat/w210-ffi-core-lifecycle`.
- Design: [native-emulation-design.md](design/native-emulation-design.md) §1.

### W211 — Callback wiring

`src-tauri/src/play/native/callbacks.rs`. `extern "C"` callbacks the core
invokes — video refresh (pixel format negotiation + conversion), audio sample
batch, input poll/state, environment queries — each pushing into channels the
runtime loop drains; never blocks on UI work.

- **Acceptance:** callbacks correctly marshal data across the FFI boundary
  (tested with synthetic callback invocations, no real core required).
- Branch: `feat/w211-callback-wiring`.
- Design: native-emulation-design.md §1.

### W212 — Runtime loop + cpal audio

`src-tauri/src/play/native/runtime.rs`. Owns the per-frame core tick, a
latest-frame-wins video buffer, and an audio ring buffer fed by the
`audio_sample_batch` callback and drained by a `cpal`/CoreAudio output stream.
First cut is a fixed-rate feed; dynamic rate control (nudging output rate by a
few hundredths of a percent against ring-buffer fill, the standard
libretro/RetroArch mitigation for clock drift) lands once basic playback is
confirmed audible.

- **Acceptance:** ring buffer fill/drain logic is unit-tested without real
  audio hardware; `cpal` output stream construction is exercised in the real
  app (not headlessly — no audio device in CI).
- Branch: `feat/w212-runtime-cpal-audio`.
- Design: native-emulation-design.md §2.

### W213 — Core-path resolution

Resolve the installed `(nes, fceumm)` row via the **existing**
`CoresRepo.installed_path` (`core/cores/install.rs`, v0.7 "Forge") — no new
download/bundling pipeline. If not yet installed, surface the existing Cores
install flow rather than auto-installing silently.

- **Acceptance:** native player path resolves a real installed core path; a
  missing core surfaces the existing install prompt instead of failing
  silently.
- Branch: `feat/w213-core-path-resolution`.
- Design: native-emulation-design.md, "Open questions" (resolved during
  planning).

### W214 — Frame delivery

A Tauri IPC channel pushes decoded RGBA frames to a new `NativePlayer.tsx`
React component that paints them onto a `<canvas>` via `putImageData`. NSView
native overlay compositing is explicitly deferred (see §4).

- **Acceptance:** frames render in the canvas at a visually smooth rate for
  NES resolution/frame rate; verified in the real running app.
- Branch: `feat/w214-frame-delivery`.
- Design: native-emulation-design.md §3.

### W215 — Feature flag + fallback switch

A settings toggle (off by default) selects the native path for NES; the
runtime switch in `src/features/play/` falls back to the existing
`InPagePlayer.tsx` (EmulatorJS) automatically if native init fails for any
reason — never a blank/broken screen.

- **Acceptance:** flag off ⇒ unchanged EmulatorJS behavior; flag on + native
  init failure ⇒ silent fallback to EmulatorJS, not an error state.
- Branch: `feat/w215-flag-fallback-switch`.
- Design: native-emulation-design.md §4.

### W216 — Input mapping

Reuses `src/features/controller/` keyboard/gamepad state; an IPC surface
pushes input state into the Rust runtime each poll, feeding
`retro_set_input_state`.

- **Acceptance:** the same controller/keyboard bindings that drive the
  EmulatorJS player drive the native one.
- Branch: `feat/w216-input-mapping`.
- Design: native-emulation-design.md §1 (callbacks).

### W217 — Tests, docs, release ritual

Headless CI coverage for everything mockable (FFI lifecycle against a stub
core, ring-buffer logic); design doc Acceptance section verified; roadmap +
this plan's ledger updated; version bump (4 files); standard release ritual
(`merge:` → `release:` → tag → push, human-gated).

- **Acceptance:** `cargo test`, `pnpm test`, `clippy -D warnings`, typecheck,
  eslint, build all green; **real-app verification required** for
  audio-cleanliness and frame-rendering correctness — cannot be claimed from
  gates alone (same blind spot the four prior audio-fix attempts hit).
- Branch: `feat/w217-tests-docs-release`.

---

## 3. Parallel Implementation Strategy

Two internal passes, sequential (not parallel) — each work item in Pass 1
depends on the FFI surface the previous one establishes, and Pass 2 depends on
Pass 1 being provably correct before UI work is wired to it.

**Pass 1 — prove the core-hosting + audio approach** (W210 → W211 → W212 →
W213, in that order; ~300K tokens). Stop-and-reassess point: if native audio
is *not* clean by the end of W212, that's the signal to revisit before
spending Pass 2's ~165K on UI wiring around a runtime that didn't fix the
actual defect.

**Pass 2 — wire it into the app** (W214, W215, W216 in parallel — they touch
disjoint files: `NativePlayer.tsx`/IPC, the settings + runtime-switch wiring,
and the controller IPC surface respectively — then W217 last, after all are
merged).

Conflict map: W214/W215/W216 are frontend-and-IPC-only and don't touch each
other's Rust modules from Pass 1, so they're safe to run concurrently once
Pass 1 is merged into `version/0.21`.

---

## 4. Out of Scope for v0.21

- **JS-render fetch tier** (rolls to v0.22) — offscreen WebView render-then-
  scrape to unlock itch.io/GameJolt/GOG generically. This is the carryover
  that previously held the v0.21 slot before this epic was redirected here.
- **Open-web provider discovery** — standing boundary, unchanged.
- **Per-provider API adapters** — rolls with the JS-render tier.
- **Cores beyond NES** — native hosting proves out on `fceumm` only; broadening
  the catalog is a follow-up once this lands.
- **Native NSView/Metal overlay frame delivery** — v1 uses canvas/IPC; the
  overlay is the documented escalation if canvas paint proves to be a
  bottleneck (native-emulation-design.md §3).
- **Save states, rewind, shaders, netplay** for the native path — parity with
  EmulatorJS deferred.
- **Preview-then-play attract mode** — this release proves the plumbing that
  makes it possible; building the library-UI feature itself is a follow-up.
- **Cheaper interim mitigation for the EmulatorJS path** (keep the player
  mounted across navigation, noted in #15) — only revisited if native rollout
  stalls and a stopgap is needed in the meantime.

No `Grimoire-Requirement`-tagged open issues exist (checked during planning:
zero results) — nothing scope-trimmed under that rule.

---

## 5. Status Ledger

### Pass 1 — core hosting + audio (sequential)

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.21 |
|---|---|---|---|---|
| `feat/w210-ffi-core-lifecycle` (W210) | ☑ | ☑ | ☐ | ☑ |
| `feat/w211-callback-wiring` (W211) | ☑ | ☑ | ☐ | ☑ |
| `feat/w212-runtime-cpal-audio` (W212) | ☑ | ☑ | ☐ | ☑ |
| `feat/w213-core-path-resolution` (W213) | ☑ | ☑ | ☐ | ☑ |

### Pass 2 — UI wiring (parallel once Pass 1 merges)

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.21 |
|---|---|---|---|---|
| `feat/w214-frame-delivery` (W214) | ☑ | ☑ | ☐ | ☑ |
| `feat/w215-flag-fallback-switch` (W215) | ☑ | ☑ | ☐ | ☑ |
| `feat/w216-input-mapping` (W216) | ☑ | ☑ | ☐ | ☑ |
| `feat/w217-tests-docs-release` (W217) | n/a | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- **W212 real-device audio check still pending.** No installed `fceumm`
  `.dylib` or `.nes` ROM exists in this dev environment, so the
  stop-and-reassess "is native audio actually clean?" question (the whole
  reason for #15) has not yet been empirically answered — only the
  ring-buffer logic is unit-tested. A `#[ignore]`d manual test
  (`play::native::runtime::manual::manual_play_produces_audible_output`,
  gated on `HARMONY_MANUAL_AUDIO_CORE`/`HARMONY_MANUAL_AUDIO_ROM` env vars)
  is the mechanism to run this check once real assets are available — by the
  user, or in a later session with a legally-owned ROM and an installed core.
  Proceeding to Pass 2 on the assumption the implementation is sound, per the
  user's explicit "lock full scope" decision acknowledging this exact blind
  spot; this is the first thing to verify before calling v0.21 done.
