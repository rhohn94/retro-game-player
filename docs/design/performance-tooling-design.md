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

## Implementation record (v0.29, W281)

**FPS counter, native path.** `NativePlayer.tsx`'s existing raw-bytes frame
poll (`paintNextFrame`, W239) is the timing signal — it already runs on a
rAF tick and already short-circuits to "nothing new" on an unchanged
sequence number, so `fpsCounter.ts`'s `FpsCounter.tick()` is only called
when a genuinely new frame was decoded and painted (through either the W280
`CrtWebglRenderer` or the `putImageData` fallback), never on an empty poll.
This is deliberately **downstream of the W280 paint step, not a new hook
into it** — no change was needed to `crtWebglRenderer.ts`/`crtShader.ts`
per the release-plan constraint, since the poll loop already exposes the
right signal.

**FPS counter, EJS path.** The vendored `player.html` was checked directly
(as instructed) before assuming a contract: EmulatorJS's public
`EJS_emulator` JS API exposes no reported frame rate. Rather than fabricate
a `postMessage` contract EmulatorJS doesn't support, `player.html` runs its
own small `requestAnimationFrame` sampling loop (independent of
EmulatorJS's internals) and reports `{fps, frameTimeMs}` to the parent every
~1 s via a new `harmony-perf-stats` postMessage. **Known limitation:** this
measures the iframe's own rAF/paint cadence, which is a proxy for "is the
game visibly updating," not the core's true internal tick rate the way the
native path's frame-time percentiles are — an honest EJS-side ceiling
(display-refresh-capped), not a defect. Recorded here rather than filed as a
separate follow-up since it's an inherent property of the chosen (safe,
non-invasive) signal.

**Toggle.** `AppConfig::show_fps_counter` (off by default), IPC
`get_show_fps_counter`/`set_show_fps_counter`, `useShowFpsCounter.ts`. Lives
in Settings → Playback, next to the existing pause-on-blur toggle per the
release plan's placement instruction.

**Native log additive fields.** `PerfLog` (runtime.rs) gained a
`FrameTimeWindow` (new `perf_stats.rs`, pure nearest-rank percentile math,
unit-tested in isolation) fed by one wall-clock sample per core tick, and a
`dropped_video_frames` counter on `PerfCounters` (audio.rs) incremented by
`drain_video` whenever more than one frame was queued between polls (the
core outpacing the frontend's poll cadence). Both are appended to the END
of the existing `[rgp-native] perf: ...` line — the original prefix is
byte-for-byte unchanged — as `, frame-time p50/p95/p99 X/Y/Z ms,
dropped-video +N`. Covered by `perf_log_line_is_additive_over_the_pre_w281_format`
and `perf_log_reports_frame_time_na_when_no_samples_recorded`
(runtime.rs), plus `perf_stats.rs`'s own percentile unit tests.

**EJS sibling log.** New IPC `report_ejs_perf_stats` (commands/perf_tools.rs)
appends a `[rgp-ejs] perf: game {id} — {fps} fps, {ms} ms/frame mean` line to
`logs/ejs-perf.log` (new `Paths::ejs_perf_log_file`) every time `player.html`
reports. Deliberately lighter than the native log (no audio-ring internals to
report, no percentiles — EJS has no Rust-side runtime loop to sample from) —
not a forced-parity claim, per the design's own scope note.

**GUI panel.** New Settings → Performance section (`PerformancePane.tsx`)
reads both logs via `read_native_perf_log`/`read_ejs_perf_log` (capped at the
50 most recent non-empty lines server-side) and renders each path's recent
fps series as an inline-SVG sparkline (`PerfSparkline.tsx`, reusing
`MenuHoldIndicator.tsx`'s "recompute geometry live from data, no CSS
animation, no charting dependency" convention) plus a scrollable raw-line
table underneath.

**Verification-scope note (honest, not overclaimed — mirrors W280's #35
pattern).** A genuinely populated panel needs a real play session (native
audio/GPU, or an EmulatorJS WASM boot) that the headless, no-display CI
harness (`scripts/visual-inspect.mjs`) cannot produce in this implementation
environment. The added `settings-performance` route instead proves the
strongest CI-safe claim available: it supplies `mockOverrides` with
real-shaped log entries (the exact DTO shape the backend commands return from
an actual on-disk log) and asserts the panel renders them as populated
sparkline + table rows — isolating "the read→render path works" from the
separate, not-yet-verified "does a real on-device session actually populate
the files" claim. On-device verification of both logs from a real play
session is a recorded follow-up (see release-planning-v0.29.md §5).

**Pre-existing gap fixed in passing.** Running the smoke/visual-inspect gate
against `version/0.29` (pre-W281) surfaced a latent bug from W280:
`get_crt_filter` had no `scripts/mock-ipc.mjs` fixture, so any route driving
a real interaction deep enough to mount a player or the CRT Filter pane
failed the gate. Confirmed via `git stash` that this predates this branch's
changes. Fixed with a one-line additive fixture (mirroring the `Off` preset)
since it silently blocked the smoke gate for every future branch, not just
this one.

## Implementation record (v0.38, W381) — Frame-path measurements: real GPU draw-cost

The renderer half of this release's frame-path perf work (the Rust half —
lock/allocation hygiene in `runtime/video.rs`/`frame.rs` plus new perf
counters in the existing native perf-stats surface — is a separate release
item, W380, `native-emulation-design.md`). This item closes issue #35 by
replacing `crt-filter-design.md`'s v0.29 analytical shader-cost budget with a
real measurement, and reduces `CrtWebglRenderer`'s own per-frame GPU work:

- **Allocate-once texture upload.** `CrtWebglRenderer.draw()` previously
  called `texImage2D` (re-specifying/reallocating GPU storage) on every
  single frame. It now allocates once via `texImage2D` on the first draw (or
  whenever the incoming frame's dimensions differ from the last-allocated
  size — a genuine geometry change) and uses `texSubImage2D` for every
  same-size draw in between, which only writes pixels into already-allocated
  storage. Covered by `crtWebglRenderer.test.ts`'s stub, which was upgraded
  to actually track allocated size and throw if `texSubImage2D` is ever
  called before an allocating `texImage2D` or with a mismatched region — a
  vacuous "was some texture call made" mock would not have caught a
  regression back to per-frame `texImage2D` (the W301 test-quality lesson
  this release's conflict map explicitly calls out).
- **Real GPU draw-cost timing.** Feature-detects
  `EXT_disjoint_timer_query_webgl2` once at construction; when present, each
  draw is bracketed by a timer query, the previous draw's query is polled
  non-blockingly, and a resolved, non-disjoint result is published in
  milliseconds via `lastDrawCostMs`. Completely inert (no query objects ever
  created) when the extension is absent — tested both ways. Full writeup:
  `crt-filter-design.md` §measurement.
- **Where the numbers surface.** `drawCostSampler.ts`'s `DrawCostSampler`
  (new file, `fpsCounter.ts`-shaped rolling mean) is fed from
  `NativePlayer.tsx`'s existing paint-loop rAF tick and shown as a second line
  on the on-screen FPS counter overlay (`FpsCounterOverlay`) — see
  `crt-filter-design.md` §measurement for why this stays a client-side-only
  surface rather than a new field on the Rust-owned `native-perf.log` (the
  IPC frame contract with this release's W380 is frozen, and the log file
  itself has no frontend-writable path).
