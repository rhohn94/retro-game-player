# Native emulation — host a libretro core directly, NES-first behind a flag

> **Up:** [↑ Design docs](README.md)

## Motivation

The embedded-WASM player ([in-page-play-design.md](in-page-play-design.md)) plays
games via EmulatorJS in a loopback-origin iframe. It works, but two costs are
structural to running a WASM emulator inside a webview, not configuration bugs:

1. **Cold-start audio garble.** Every fresh `AudioContext` in WKWebView produces
   ~2–3 s of garbled samples while its render thread, JIT, and the core's resampler
   converge — wrong samples, not jitter, so buffering can't fix it. It is
   page-scoped (survives an in-emulator restart, returns on a full page re-init).
   Four mitigations were tried and abandoned (mask, big buffer, warm-then-reset,
   pre-warm-then-adopt) — see
   [issue #15](https://github.com/rhohn94/harmony/issues/15) for the full
   post-mortem. None fix the *cause*; they all fight the *output* of a cold Web
   Audio context.
2. **Slow, non-tunable first boot.** EmulatorJS re-runs 7z core decompression and
   WASM compilation on every boot (only the compressed bytes are cached) — see
   in-page-play-design.md §2. There is no config lever left to pull.

Both costs trace to the same root: the emulator runs inside the webview's
JS/WASM/WebAudio sandbox. **Hosting the libretro core natively in the Rust
backend** sidesteps both at the source — a native core has no WASM compile step
and no Web Audio cold start (audio goes straight to CoreAudio via `cpal`). It also
unlocks a **preview-then-play** mode: render frames before the user has clicked
in (e.g. an attract-mode preview on hover/focus), since input only needs to be
captured once the surface has focus — not possible with an iframe-owned
EmulatorJS instance.

## Scope

**In scope (v0.21):**
- Host **one** native libretro core — **`fceumm` (NES)** — via hand-rolled FFI,
  loaded with `libloading`.
- A Rust-side emulation runtime: load core, load ROM, run the core loop, expose
  video frames + audio samples + accept input, behind a feature flag.
- Frame delivery to the existing UI via a `<canvas>`-based IPC pipe (see
  [§3](#3-frame-delivery)) — not a native NSView overlay (deferred, see
  Follow-ups).
- Audio via `cpal` → CoreAudio, fed from the core's `audio_sample_batch`
  callback through a ring buffer.
- Keyboard input mapped the same way the in-page player already does (no new
  controller-mapping work; reuse `src/features/controller/`).
- **EmulatorJS remains the path for every other system and is the runtime
  fallback** if the native core fails to load (missing/incompatible `.dylib`,
  init failure) — never a dead end.
- A feature flag (`HARMONY_NATIVE_NES` or a settings toggle) so this ships
  dark-by-default until it's proven in real use.

**Explicit non-goals (this release):**
- Other systems/cores (SNES, N64, etc.) — NES is the proof; broadening the
  core catalog is a follow-up once the hosting layer is validated.
- A native NSView/Metal overlay for frame delivery (see Follow-ups) — v1 uses
  the simpler canvas/IPC path.
- Save states, rewind, shaders, netplay — anything EmulatorJS already provides
  that isn't required to prove out the native path.
- Replacing the external-RetroArch launch path
  ([emulation-launch-design.md](emulation-launch-design.md)), which stays for
  systems with no bundled in-page core.
- The preview-then-play attract mode itself — this release proves the
  *plumbing* (native core → frame/audio output) that makes it possible; wiring
  it into the library UI is a follow-up.

## Design

### 1. No viable "host a core" crate — hand-roll the FFI

Researched before committing to this design (full notes in the v0.21 release
plan). Conclusion: every relevant Rust libretro crate (`libretro-rs`,
`rust-libretro`, `libretro-backend`) is for **writing** a core (the
`RetroCore` trait → compiles to a `.dylib` consumed by a frontend like
RetroArch) — the opposite direction from what Harmony needs. The one
hosting-side project found (`danielwolbach/rust-libretro-frontend`) is an
unmaintained, self-described "minimal learning exercise" — not a dependency
to build on.

The realistic path is a small, hand-rolled FFI layer using `libloading` to
`dlopen` the core `.dylib` and call its C ABI directly. This is bounded, not
risky: the libretro API surface needed is ~13 well-documented, ABI-stable
functions that haven't changed in years (`retro_api_version`, `retro_init`,
`retro_deinit`, `retro_get_system_info`, `retro_get_system_av_info`,
`retro_set_environment`, `retro_set_video_refresh`,
`retro_set_audio_sample_batch`, `retro_set_input_poll`,
`retro_set_input_state`, `retro_load_game`, `retro_run`, `retro_unload_game`).
A community walkthrough
([retroreversing.com](https://www.retroreversing.com/CreateALibRetroFrontEndInRust))
builds a complete frontend this way — `libloading` for the `.dylib`/`.dll`/`.so`
load, manual FFI struct defs, pixel-format conversion in the video callback,
a channel handoff to a dedicated audio thread, input mapping, even
RetroArch-config compatibility — confirming the approach is tractable as a
multi-day subsystem, not a multi-week one, and that macOS is a first-class
target (the tutorial explicitly handles `.dylib` + macOS paths). The libretro
API headers themselves (`libretro.h`) are a permissively-licensed spec,
distinct from the GPL cores that implement it — only the cores we bundle
(fceumm, GPL-2.0-or-later, already documented in
[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)) carry copyleft
obligations.

New module: `src-tauri/src/play/native/` —
- `core.rs` — `LibretroCore` wraps the `libloading::Library` + the loaded
  symbol table; owns `init`/`load_game`/`run`/`unload`/`deinit` lifecycle.
- `callbacks.rs` — the `extern "C"` callback functions libretro calls into
  (video refresh, audio sample batch, input poll/state, environment); these
  push into channels read by the runtime loop, never block on UI work.
- `runtime.rs` — owns the run loop (one core tick per frame tick), the video
  frame buffer (latest-frame-wins), and the audio ring buffer.

### 2. Audio — `cpal` + a ring buffer + dynamic rate control

`cpal`'s CoreAudio backend is a reasonable target: it reports
`StreamError::BufferUnderrun`, and macOS CoreAudio gives consistent
~512-frame buffers, which pairs cleanly with a ring buffer fed by
`audio_sample_batch` (44.1/48 kHz interleaved i16 from the core) and drained
by `cpal`'s output callback (which runs on its own OS thread — `cpal::Stream`
is not `Send`/`Sync`, so the handoff is channel/ring-buffer based, matching
the pattern in §1's reference tutorial). `cpal` has no API to query device
latency directly (only a pipeline-delay timestamp), which is fine since
Harmony owns both ends of the buffer and isn't trying to sync to external
clocks.

The known risk is **clock drift**: the core's internal timing (NES runs at an
exact ~60.0988 Hz) will not exactly match the host audio device's clock, so a
naive fixed-rate feed will eventually under- or overrun the ring buffer. The
standard libretro/RetroArch mitigation is **dynamic rate control** — nudge the
core's effective output sample rate by a few hundredths of a percent based on
how full the ring buffer is, rather than letting it drift to empty/full. This
is a known, well-documented technique (not novel to this design) and is the
first thing to implement once basic playback is audible — get correctness
first, then add the trim once drift is observed in practice.

### 3. Frame delivery

Two real options surfaced, both viable on Tauri 2 / macOS:

- **Native NSView/Metal overlay** — `tauri::WebviewWindow` exposes `ns_view()`
  (added in Tauri 2) for direct access to the native view hierarchy. The
  webview can be made to not paint its own background and a native rendering
  surface (a `CALayer`/Metal view) placed behind it in the same NSView stack,
  so the game frame shows through the transparent gap. This is the
  lowest-latency option (no IPC, no webview-pipeline) and the better long-term
  answer, but it's a real compositing subsystem of its own — z-ordering,
  surface lifecycle, resize handling — that has nothing to do with proving out
  the libretro hosting layer.
- **Canvas/IPC piping (chosen for v1)** — push each decoded RGBA frame to the
  frontend (Tauri IPC channel) and `putImageData` it onto a `<canvas>`. NES
  resolution is small (256×240 @ 60fps ≈ 14.7 MB/s uncompressed) — modest
  bandwidth for Tauri 2's binary IPC channels. This keeps the player a normal
  React component (same shape as today's `InPagePlayer.tsx`), with **zero**
  native windowing/compositing work, at the cost of still routing frames
  through the webview's paint pipeline (not fully "native end-to-end" — but
  audio, which is where the actual user-facing defect lives, is fully native
  regardless of which frame path is chosen).

v1 ships the canvas/IPC path. The NSView overlay is the documented escalation
if canvas paint proves to be a bottleneck in practice (see Follow-ups) — no
need to pay that complexity cost until proven necessary.

### 4. Coexistence with EmulatorJS

`src/features/play/` gains a runtime switch: NES games behind the feature flag
use the new native player; everything else (and NES with the flag off, or if
native init fails) renders the existing `InPagePlayer.tsx` iframe unchanged.
No change to [in-page-play-design.md](in-page-play-design.md)'s loopback-server
architecture — it keeps serving every other system.

## Acceptance

- A native `fceumm` NES core loads, runs, and plays a ROM with **no Web Audio
  cold-start garble** (audio is clean from the first frame — the defect
  [#15](https://github.com/rhohn94/harmony/issues/15) targets).
- First-boot-to-playable time is visibly faster than the EmulatorJS path for
  the same ROM (no WASM compile/decompress step).
- Falls back to the existing EmulatorJS player automatically if the native
  core fails to load or init — never a blank/broken screen.
- Ships behind a flag, off by default.
- `cargo test` covers the FFI lifecycle (load/init/run/unload) against a
  bundled test core or a mock, and the ring-buffer fill/drain logic, without
  requiring real audio hardware in CI/headless runs.
- Controller/keyboard input drives the native-hosted game the same way it
  already drives the EmulatorJS one (reuses `src/features/controller/`).

## Open questions

- **Combined-work license question** (already open, not created by this
  feature): bundling a GPL-2.0-or-later core natively doesn't change the
  existing unresolved question of Harmony's own declared license — flagged
  here so it isn't reopened as if new.

**Resolved while sizing the release plan:** sourcing the native `.dylib` is
**not** new work — `core/cores/install.rs` ([core-discovery-design.md](core-discovery-design.md),
v0.7 "Forge") already downloads, arch-verifies (arm64-only), and persists the
native libretro `fceumm` core for the existing external-RetroArch launch path
(`system_map.rs` lists `fceumm` under `nes`). The native hosting layer reuses
`CoresRepo`'s `installed_path` for an installed `(nes, fceumm)` row — same
artifact, same install flow, no new bundling/build pipeline. If the core isn't
installed yet, the existing Cores UI install flow covers it; the native player
should surface that prompt rather than auto-installing silently.

## Follow-ups

- Broaden the native core catalog beyond NES once the hosting layer is proven.
- Native NSView/Metal overlay frame delivery, if canvas/IPC paint proves to be
  a bottleneck (lower latency, true end-to-end native path).
- Preview-then-play attract mode in the library UI, built on top of this
  plumbing.
- Save states / rewind / shaders for the native path (parity with what
  EmulatorJS already offers).
- Revisit the cheaper interim mitigation noted in #15 (keep the EmulatorJS
  player mounted across navigation instead of unmounting) if native rollout is
  slower than expected and the return-visit re-garble needs a stopgap in the
  meantime.
