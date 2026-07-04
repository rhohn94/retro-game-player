# Emulation performance tooling — FPS counter + profiling

> **Up:** [↑ Design docs](README.md) · **Sib:** [native-emulation-design.md](native-emulation-design.md), [in-page-play-design.md](in-page-play-design.md)

> **Status:** design-first (blocks implementation). Owns v0.29 **W281**.

## Motivation

User directive (2026-07-03, verbatim): *"Emulation Playback: Add optional
FPS counter. Add tools for profiling emulation performance, recording it in
an easily-accessible file for you to review later, and to review in the RGP
GUI."*

## Ground truth: what already exists (resolved by research)

`native-perf.log` (native path only, W270/W274) is written every 10 s by
`perf_file.rs`, fed from `runtime.rs`'s poll loop. It currently captures:
effective FPS, audio ring fill (ms), underrun/overrun sample deltas — audio
health, not video/CPU detail. It does **not** capture frame-time
jitter/percentiles, a dropped-video-frame counter, CPU utilization, or
anything at all for the EJS path (which has no Rust-side runtime loop — the
core runs inside the iframe's own WASM/JS).

## Scope (v0.29)

**In scope:**
- **FPS counter** (optional, on-screen, both paths): computed **client-side
  per path**, not routed through a single shared IPC field — native path
  derives it from its own paint-loop deltas (`NativePlayer.tsx`, same tick
  that already drives `putImageData`/the new W280 WebGL paint); EJS path
  derives it from a lightweight `requestAnimationFrame` sampling loop
  against the iframe's rendered output cadence (or EmulatorJS's own
  reported rate via `postMessage`, if the vendored build exposes one —
  agent verifies against the current vendored `player.html`).
- **Richer native-path logging**: extend `perf_file.rs` / `runtime.rs` with
  frame-time percentiles (p50/p95/p99) and a dropped-video-frame counter,
  additive fields on the existing one-line-per-interval format (don't break
  existing log parsers/tests).
- **A lightweight EJS-path log**: a new small Tauri IPC command that accepts
  periodic `postMessage`-reported stats from `player.html` (FPS + a coarse
  timing signal EmulatorJS already tracks internally) and appends them to a
  sibling log file — honestly lighter than the native log (no audio-ring
  internals to report), not a forced parity claim.
- **An in-app GUI panel** (new screen, e.g. under Settings → Performance)
  that reads the log file(s) via IPC and renders recent sessions as a
  simple table + sparkline (reuse the existing inline-SVG pattern from
  `MenuHoldIndicator.tsx` rather than adding a charting dependency).

**Out of scope (recorded follow-ups):**
- Cross-session aggregate analytics or trend dashboards.
- Automatic performance-regression alerting.
- CPU flamegraphs / sampling profilers — out of reach without a new
  profiler dependency; this feature stays within the app's own telemetry.

## Acceptance

- Toggling the FPS counter shows a live, updating number on both play
  paths without materially affecting frame pacing itself.
- `native-perf.log` gains the new fields without breaking any existing
  consumer/test of the current format.
- A new sibling log captures EJS-path sessions at a coarser granularity.
- The GUI panel lists recent log entries (both paths, clearly labeled) from
  a real running instance — a `recipe.py smoke`/visual-inspect check reads
  the panel after a short play session and asserts it's non-empty.
- All gates green; `native-emulation-design.md` gains a cross-reference to
  this doc for the native-path log format change.
