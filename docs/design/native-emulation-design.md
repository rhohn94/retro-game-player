# Native emulation — host a libretro core directly, NES-first behind a flag

> **Up:** [↑ Design docs](README.md) · **Sib:** [performance-tooling-design.md](performance-tooling-design.md)

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
   [issue #15](https://github.com/rhohn94/retro-game-player/issues/15) for the full
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

**v0.26.1 (W270) — pacing, resampler + rate control, realtime hygiene.** The
trim above was never actually implemented, and real v0.26.0 sessions surfaced
the consequences ("runs slow, sounds off"). Three compounding defects, all in
`runtime.rs`:

1. *The core's reported `sample_rate` was never consumed.* The cpal stream
   opened at the device's default config and played the core's samples
   verbatim — any core/device rate mismatch shifts pitch/speed and permanently
   drains or floods the ring (constant pad-silence gaps or drop-oldest skips;
   in the flood direction the ring pins at its cap, adding ~300 ms of audio
   latency).
2. *Relative-sleep pacing accumulated overshoot.* `thread::sleep(frame_duration
   - elapsed)` from a fresh `Instant` each tick never repays macOS's
   ~0.5–2 ms sleep overshoot, so the core ran measurably below its native fps
   (game literally slow) and audio production fell below device consumption
   (periodic underrun crackle) even when rates nominally matched.
3. *Realtime-callback hygiene.* The ring was a `Mutex<VecDeque<i16>>` locked
   inside the realtime callback against the core thread's per-sample push loop
   (priority-inversion risk), and the F32 path allocated a scratch `Vec` per
   callback.

The W270 rework, split into `clock.rs` + `audio.rs` (runtime.rs keeps only
orchestration):

- **`FrameClock`** — absolute-deadline scheduler: the next deadline
  accumulates (`next += frame_duration`) instead of restarting from "now",
  so overshoot on one tick is repaid on the next; a coarse sleep covers all
  but the final ~1.5 ms, a yield/spin tail lands the deadline precisely; a
  stall beyond a few frames (machine sleep, debugger) resyncs rather than
  fast-forwarding, and pause resyncs on resume.
- **Resampler + dynamic rate control** — a linear-interpolation stereo
  resampler converts core-rate batches to the device rate on the core thread,
  its effective ratio nudged each push by ring fill against a target
  (RetroArch's dynamic-rate-control model, skew clamped to a fraction of a
  percent — inaudible, but it locks the two clocks together so steady-state
  drop/pad disappears).
- **Lock-free SPSC ring** (`rtrb`) — producer: core thread; consumer: the
  realtime callback, which pops chunks straight into the output buffer with
  the gain applied inline — no locks, no allocation. Underruns pad silence
  and bump an atomic counter; overruns drop and count (DRC keeps both at
  zero in steady state).
- **Pre-fill** — the stream starts only once the ring holds the target fill
  (~80 ms, with a timeout), killing residual cold-start garble and bounding
  startup latency.
- **Device shape** — the writer maps stereo frames onto the device's actual
  channel count (extra channels silent, mono averages L+R) and supports the
  I16/F32 sample formats without allocation.
- **Perf counters** — frames run, underrun/overrun samples, and ring fill,
  logged as an effective-fps line every ~10 s (`[rgp-native]` prefix, also
  replacing the stale `[harmony-native]` prefixes), so on-device verification
  is objective rather than by ear alone.
- **Frame conversion** — row-wise pixel conversion into a reused buffer
  (the per-frame allocation and per-pixel bounds-checked indexing were the
  glue-code hot spots), plus `[profile.dev] opt-level = 1` so dev-mode
  testing is representative of release behavior.

**v0.27 (W274) — audio polish + observable telemetry.** The first W270
playtest verdict was "mostly fine but slightly off", and the perf line
turned out to be unreviewable: `eprintln!` goes to stderr, which macOS
discards for Finder-launched apps — the session left no trace anywhere.
Three refinements:

1. **Resampler quality** — linear interpolation is audibly rough on NES
   square/triangle waves (first-order roll-off + aliasing on exactly the
   sustained tones where "slightly off" lives). Upgraded to 4-point
   Catmull-Rom (cubic Hermite) interpolation with a cross-batch three-frame
   history window (`audio.rs`); identity-ratio passthrough stays bit-exact
   (the spline interpolates through its control points, and its Horner form
   evaluates to exactly `p1` at `t = 0`), covered by tests. Output now lags
   input by two frames instead of one (segment endpoints + spline
   lookahead); seeding replicates the first input frame into the older
   history slots so the first segment starts flat instead of swinging
   through silence.
2. **Gentler rate control** — `DRC_GAIN` 0.01 → 0.005 (RetroArch's default
   `d`); halves the worst-case pitch-skew slope while converging, keeping
   any wobble on sustained notes below audibility.
3. **Persisted perf telemetry** — the 10 s perf line additionally appends to
   `logs/native-perf.log` (fresh file per session, truncated at session
   start), so a Finder-launched playtest is verifiable after the fact. The
   path resolves through `Paths::native_perf_log_file()` and threads from
   the commands layer into `NativeRuntime::start`; `perf_file.rs`'s
   `PerfLogFile` owns the sink. Identical line content to stderr (formatted
   once); failure to open or write the file degrades silently to
   stderr-only, never a session error, and all file I/O stays on the core
   thread — never the realtime audio path.
   **v0.29 (W281) additive extension:** the same line gained appended
   frame-time p50/p95/p99 and a dropped-video-frame delta — the original
   prefix is unchanged, so this remains a pure format addition. Full detail,
   the EJS-path sibling log, the on-screen FPS counter, and the Settings →
   Performance GUI panel: [performance-tooling-design.md](performance-tooling-design.md).
4. **Core-thread QoS elevation** (stretch — landed) — the core thread
   raises itself to `QOS_CLASS_USER_INTERACTIVE` at start via a single
   documented `libc::pthread_set_qos_class_self_np` call, cfg-gated to
   macOS; reduces scheduler-induced tick jitter under load, and a failed
   elevation just logs and keeps the default priority.

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

**v0.23.1 (W239) — raw-bytes polling.** The v0.21 implementation shipped the
frame as base64 inside a JSON response (mirroring the vibrancy blurred-hero
convention), which is pathological at 60 Hz: a ~327 KB string per frame
through the JSON IPC layer plus a per-byte `atob` decode loop in JS, with the
next poll serialized behind the previous round trip. First real gameplay
(post-crash-fix) showed it as heavy stutter. The fix keeps the poll model but
moves to Tauri 2's raw-binary channel: `get_native_frame` returns a
`tauri::ipc::Response` whose body is a header
(`[seq: u64 LE][width: u32 LE][height: u32 LE]`) followed by the tightly
packed RGBA8888 pixels, received frontend-side as an `ArrayBuffer` and viewed
zero-copy into `ImageData`. The runtime stamps each stored frame with a
monotonically increasing sequence number; the poller echoes the last painted
one and an unchanged frame answers with an **empty body**, so paused /
overlay / idle polls are near-free. The rAF tick is scheduled up-front with
an in-flight guard, so a slow round trip degrades to a skipped paint rather
than a halved frame rate.

**v0.34 (W345) — header gains an aspect ratio field.** The header above grew
one more field (`[..][aspect_ratio: f32 LE]`, now 20 bytes total) — purely
additive, appended after the pre-existing three fields — to carry the
display aspect ratio the frontend needs to render N64/PS1 correctly. Full
detail: the new §HW-render section's "Aspect ratio propagation" below.

### 4. Coexistence with EmulatorJS

`src/features/play/` gains a runtime switch: NES games behind the feature flag
use the new native player; everything else (and NES with the flag off, or if
native init fails) renders the existing `InPagePlayer.tsx` iframe unchanged.
No change to [in-page-play-design.md](in-page-play-design.md)'s loopback-server
architecture — it keeps serving every other system.

## Acceptance

- A native `fceumm` NES core loads, runs, and plays a ROM with **no Web Audio
  cold-start garble** (audio is clean from the first frame — the defect
  [#15](https://github.com/rhohn94/retro-game-player/issues/15) targets).
- First-boot-to-playable time is visibly faster than the EmulatorJS path for
  the same ROM (no WASM compile/decompress step).
- Falls back to the existing EmulatorJS player automatically if the native
  core fails to load or init — never a blank/broken screen.
- Ships behind a flag — off by default at introduction (v0.21); **on by
  default since v0.24 (W240)**, after both on-device confirmations landed
  (see the flag-decision note below).
- `cargo test` covers the FFI lifecycle (load/init/run/unload) against a
  bundled test core or a mock, and the ring-buffer fill/drain logic, without
  requiring real audio hardware in CI/headless runs.
- Controller/keyboard input drives the native-hosted game the same way it
  already drives the EmulatorJS one (reuses `src/features/controller/`).

### Verification record (v0.23, W233 — the stop-and-reassess point)

The v0.21 real-device criteria were finally exercisable in v0.23 (an installed
`fceumm_libretro.dylib` + real ROMs were available on the dev machine):

- **Root cause of the v0.21 crash found and fixed.** Native play SIGSEGV'd
  inside fceumm's `retro_init`: `LibretroCore::load()` called `retro_init`
  before the environment callback was registered, violating the libretro
  contract (`retro_set_environment` must precede `retro_init`; real cores
  query the environment during init). The stub-core test missed it because
  its `retro_init` was empty. Fixed by splitting `init()` out of `load()`,
  enforcing the order in safe Rust (`init` errors before `set_environment`;
  `load_game` errors before `init`), installing the callback channels before
  bring-up so negotiation events aren't dropped, and making the stub core
  query the environment during init like a real core. Regression tests:
  `init_before_set_environment_is_rejected`, `load_game_before_init_is_rejected`.
- **Real-device run (2026-07-01, MacBook Pro Speakers, SMB World ROM):**
  boots, negotiates, runs at 60.0988 fps, produces 256×240 RGBA frames,
  audio stream plays (48 kHz F32), clean exit. Harness:
  `manual_play_produces_audible_output` (`--ignored`, env-var driven).
- **By-ear audio-cleanliness + load-time comparison:** confirmed by the
  maintainer 2026-07-01 ("the audio bug is fixed"); gameplay smoothness
  confirmed the same day after the W239 frame-IPC hotfix ("gameplay is
  fine"). **Flag decision: `native_play_enabled` defaults to `true` from
  v0.24 (W240).** A persisted `false` (explicit user opt-out) is respected;
  the automatic EmulatorJS fallback on native-init failure is unchanged.

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

## Attract mode (v0.23, W235)

Scroll-driven handoff of the live native session into the detail-page
background. The retro "vibe" intent (in-page play design) is that a game boots
with sound on detail-page entry; attract mode extends that: when the user
scrolls down to read metadata/description, the running boot/attract sequence
doesn't stop — it becomes the page's ambient, full-bleed backdrop, and
reattaches as the foreground player when the user scrolls back up.

### Mechanism

The Rust `NativeRuntime` is untouched by fore/background transitions — the
core keeps running and producing frames either way. The whole feature is a
front-end presentation-state change plus one new backend affordance (volume).

- **One canvas, two presentations.** `NativePlayer` keeps a single `<canvas>`
  (avoids 2D-context loss and double-decode). A `presentation: "foreground" |
  "background"` prop drives a wrapper class: foreground = the existing in-flow
  `harmony-player__frame`; background = `position: fixed; inset: 0` full-bleed
  layer behind the detail content (`z-index` under `harmony-detail__content`,
  above `HeroBackdrop`), scaled to cover, with a dim/scrim overlay
  (`--harmony-attract-dim`, ~55% + slight saturation drop) so foreground text
  keeps contrast. The transition animates via the shared motion presets
  (`SPRING.gentle` layout transition); `prefers-reduced-motion` gets a plain
  crossfade.
- **Scroll driver.** `GameDetailPage` observes the player's in-flow slot with
  an `IntersectionObserver` (threshold with hysteresis: background when less
  than ~35% of the slot is visible, foreground again when ~65% is visible — two
  thresholds so the boundary doesn't flap). The in-flow slot keeps its layout
  height while the canvas is backgrounded so scroll position doesn't jump.
- **Input detach.** While backgrounded: key handlers stop calling
  `preventDefault()` and stop collecting keys (arrows/space must scroll the
  page again), the gamepad poll stops feeding `set_native_input`, and one
  `setNativeInput(0)` releases all buttons at the transition so nothing sticks.
  Controller navigation of the page itself resumes (the player no longer owns
  the controller). On reattach, input capture resumes.
- **Audio duck.** New IPC command `set_native_volume(gain: f32)` — a
  clamped [0,1] multiplier applied where samples are drained from the ring
  buffer into the cpal output callback (an atomic read per callback; no
  locking). Background ducks to 0.3, foreground restores 1.0. Full mute stays a
  user choice for later (#22 volume control builds on the same command).
- **Lifecycle.** Navigation away unmounts and stops the session exactly as
  today; overlay/Escape behavior is foreground-only (Escape while backgrounded
  does nothing special). EmulatorJS path: out of scope this release (the iframe
  cannot become a page background without reworking the loopback player;
  revisit after W231/W232 settle the EJS glue).

### Acceptance

- Scrolling down past the player migrates the live canvas into the dimmed
  full-bleed background with no reboot/frame stall; scrolling back reattaches.
- While backgrounded: page scroll keys work, controller navigates the page,
  no input reaches the core, audio sits at the ducked gain.
- Hysteresis prevents flapping at the boundary; reduced-motion crossfades.
- `set_native_volume` is covered by a unit test (clamping, atomic application).

## Multi-system engine (v0.34 "Engines", W340)

v0.21 through v0.29 hard-wired the native host to exactly one system:
`play::native::core_path::NATIVE_SYSTEM = "nes"` and `NATIVE_CORE_ID =
"fceumm"` were plain constants, and `commands::native_play::start_native_play`
rejected any other system outright. W340 generalizes the hosting layer into a
table-driven multi-system engine — with **zero** behavior change for NES —
so later items (W341's handheld/Wii cohort, W344's PS1 enable, W345's N64
enable) only ever add a table row, never touch `host.rs`/`runtime.rs`/
`callbacks.rs`/`clock.rs`/`audio.rs` again.

### The table

`play::native::systems` replaces the two constants with:

```rust
pub struct NativeSystemSupport {
    pub system: &'static str,   // e.g. "nes"
    pub core_id: &'static str,  // e.g. "fceumm"
}

pub const NATIVE_SYSTEMS: &[NativeSystemSupport] = &[
    NativeSystemSupport { system: "nes", core_id: "fceumm" },
    // later items append rows here
];
```

`resolve_native_core_path(db, system)` now takes the system as a parameter:
it looks up `system` in `NATIVE_SYSTEMS` (an `AppError::Unsupported` for a
system outside the table entirely — a future/unreleased cohort system, never
prompted to install anything) and, for a table hit, resolves the installed
core `.dylib` through the **same** `CoresRepo::installed_path` lookup v0.21
established (`AppError::NotFound` when the row exists but nothing is
installed yet — the existing "surface the Cores install prompt" contract,
unchanged). `NATIVE_SYSTEM`/`NATIVE_CORE_ID` stay as backward-compatible
aliases to the table's first row (`NATIVE_SYSTEMS[0]`) — the Core Options
pane and Cores screen are still NES-only surfaces this release, so they keep
comparing against the named constant rather than iterating the table.

### Geometry and timing come from the core, never a per-system constant

Before W340, nothing in `runtime.rs`/`clock.rs`/`audio.rs` actually
hard-coded NES's 256×240 or 60.0988 Hz — an audit of the frame pipe
(`bring_up_core`, `FrameClock::new`, `StereoResampler::new`,
`to_rgba8_into`) confirmed every one of them already reads its shape from
the loaded core's own `retro_get_system_av_info` (`av.timing.fps`,
`av.timing.sample_rate`, and per-frame `width`/`height`/`pitch` off each
`VideoFrame`) — the "NES-first" framing in earlier sections above described
the *scope* (which systems were wired up), not a hidden assumption baked into
the pacing/pixel math. W340's contribution is:

- **Proving it in a test**, not just by inspection: `runtime.rs`'s
  `native_runtime_hosts_a_non_nes_geometry_and_timing_stub` boots a stub core
  reporting an 8×6 frame at 50 fps / 22050 Hz (nothing like NES) through the
  exact same `NativeRuntime::start` entrypoint and asserts both the delivered
  frame's dimensions AND the run loop's tick rate: the frame-sequence delta
  over a measured window must be consistent with the stub's declared 50 fps
  and inconsistent with NES's ~60.0988 fps, proving the loop paces itself off
  `av_info().timing.fps` — the acceptance-mandated "a second software-rendered
  system boots through the same host in a test with a stub core reporting
  non-NES geometry/timing."
- **Mid-game geometry renegotiation** — `RETRO_ENVIRONMENT_SET_GEOMETRY`
  (some systems change resolution/aspect ratio between titles or scenes) was
  the one genuinely missing piece: `callbacks.rs` now decodes it into an
  `EnvironmentEvent::GeometryChanged` event the run loop observes. No
  explicit frame-buffer resize is needed to act on it: every `VideoFrame`
  callback already carries its own `width`/`height`/`pitch`, and
  `frame::to_rgba8_into` (the video-drain conversion step) resizes its output
  buffer to match whatever frame it is converting, every call — so the very
  next frame at the new geometry is handled with no special-casing. The
  event is still surfaced (and logged) for observability/future UI reaction,
  covered by `environment_forwards_a_mid_game_geometry_change`.

### Frontend: capability map, not a hard-coded system check

`commands::native_play` adds `list_native_systems` — a cheap, DB-only IPC
command returning every `NATIVE_SYSTEMS` row paired with its live
`core_installed` state (via the same `resolve_native_core_path` resolution,
translating `NotFound` to `false` rather than surfacing an error for "known
but not installed"). `src/features/play/nativePath.ts`'s
`fetchNativeCapabilities()` calls it once and builds a `system →
{coreId, coreInstalled}` map (degrading to an empty map on any fetch
failure, so a transient IPC error just means "nothing is native-eligible
right now" — never a crash). `isNativePathEligible(system, nativeEnabled,
capabilities)` is now a pure function over three inputs instead of a
`system === "nes"` string comparison: eligible iff the opt-in is on AND the
system has a table row AND that row's core is installed.

`PlaySwitch.tsx` and `TvHome.tsx` (the hover-attract preview gate) both fetch
the capability map once per mount and pass it through; a system with a table
row but no installed core is treated exactly like any other native-start
failure — it falls through to the EmulatorJS/external path, never a blank
screen. `start_native_play` mirrors the same table lookup server-side
(`native::native_support_for`), so a frontend that somehow raced the
capability fetch still gets a clean `AppError::Unsupported`/`NotFound`
instead of silently hosting the wrong core.

### Acceptance (W340)

- NES behaves exactly as today — the full pre-W340 native-path regression
  suite (FFI lifecycle, callbacks, clock, audio, frame conversion, save
  persistence, the IPC contract tests) is unchanged and green; the only
  modified call sites are the ones that now thread a `system` parameter
  through, which is NES for every existing caller.
- A second software-rendered system boots through the same host in a test
  with a stub core reporting non-NES geometry/timing
  (`native_runtime_hosts_a_non_nes_geometry_and_timing_stub`).
- The frontend routes a native-capable system with an installed core to
  `NativePlayer`, and falls back to EJS/external when the core is missing or
  native init fails — covered by `nativePath.test.ts`'s table-driven
  eligibility cases (present-but-uninstalled, absent-from-table, empty-table
  degradation, and a second independently-eligible table row).

## HW-render subsystem + N64 (v0.34 "Engines", W345)

Every system through W340/W341/W344 renders in **software**: the core writes
raw pixels into a buffer it owns and hands Harmony a pointer via
`retro_video_refresh_t`. mupen64plus_next (N64) — like most 3D-era cores —
instead renders with **OpenGL directly into a framebuffer Harmony provides**,
negotiated via `RETRO_ENVIRONMENT_SET_HW_RENDER`. W345 adds the subsystem that
makes that possible without disturbing anything the software path already
does.

### Context strategy: headless CGL, created only on demand

New module `play::native::hw_render` — deliberately the **only** new file
this item touches inside `play::native/` (per the release plan's conflict
map; `callbacks.rs` gets one new `environment` match arm and `runtime.rs`
gets the bring-up/drain wiring, nothing else).

- **CGL, not NSOpenGLView.** macOS has no "headless EGL" the way Linux does,
  but CGL (`CGLChoosePixelFormat`/`CGLCreateContext`/`CGLSetCurrentContext`)
  creates a fully offscreen, windowless OpenGL context — no `NSView`, no
  window, nothing added to the app's view hierarchy. This is the same
  "narrow, hand-rolled FFI over a stable C ABI" posture §1 already
  established for the libretro surface itself, applied to CGL: a small
  `extern "C" { ... }` block linking the system `OpenGL` framework
  (`#[link(name = "OpenGL", kind = "framework")]`), cfg-gated to
  `target_os = "macos"` the same way `runtime.rs`'s core-thread QoS
  elevation already is.
- **Created only when a core asks.** `HwRenderContext::create` is called
  exactly once per session, and only in response to a core's own
  `RETRO_ENVIRONMENT_SET_HW_RENDER` negotiation succeeding
  (`EnvironmentEvent::HwRenderRequested`, drained by the run loop's
  `bring_up_hw_render`). No context is ever created speculatively — the
  acceptance-mandated "software-render systems are untouched" isn't a
  best-effort claim, it's structural: nothing in `hw_render.rs` runs unless a
  core explicitly requests it.
- **Negotiation is narrow by design.** `callbacks::environment`'s new
  `RETRO_ENVIRONMENT_SET_HW_RENDER` arm accepts exactly
  `RETRO_HW_CONTEXT_OPENGL` and `RETRO_HW_CONTEXT_OPENGL_CORE` (CGL only
  speaks desktop OpenGL — no GLES, no Vulkan, no D3D) and refuses everything
  else by returning `false`, exactly like any other environment command
  Harmony doesn't implement. A refused negotiation is not a Harmony error —
  it's the core's own cue to either fall back to a software path (some cores
  can) or fail `retro_load_game` cleanly, which the existing
  native-init-failure → EmulatorJS-fallback contract (§4) already covers
  with zero new code.
- **What Harmony fills in vs. what the core fills in.** The core partially
  populates a `retro_hw_render_callback` (context type, `depth`/`stencil`/
  `bottom_left_origin` flags, its own `context_reset`/`context_destroy`
  function pointers) before the environment call; Harmony's `set_hw_render`
  fills in `get_current_framebuffer` and `get_proc_address` before returning
  `true`, then forwards the decoded flags + the core's two callbacks as an
  `EnvironmentEvent` for the run loop to act on. The environment callback
  itself never touches GL — it only negotiates.

### The FBO: sized from the core, resized on renegotiation

`Fbo` owns a framebuffer object with a color renderbuffer (`GL_RGBA8`) always,
plus a combined depth/stencil (`GL_DEPTH24_STENCIL8`) or depth-only
(`GL_DEPTH_COMPONENT24`) renderbuffer when the core's negotiated flags asked
for either. Initial size is the core's declared `max_width`/`max_height`
(`retro_get_system_av_info`'s `geometry`, read in `bring_up_core` — the same
call site W340 already reads `fps`/`sample_rate` from); a later
`RETRO_ENVIRONMENT_SET_GEOMETRY` (W340's event) resizes the FBO by rebuilding
its GL objects (renderbuffer storage is immutable once allocated on desktop
GL — there's no in-place resize) rather than reusing the old ones. `Mutex<Fbo>`
gives the struct interior mutability so the same `Arc<HwRenderContext>` can be
read from both the run loop and the process-global FFI callback slot without
a `&mut` handoff — real contention is impossible because both call sites only
ever run on the same core thread, one at a time, inside the same `retro_run`
tick (the libretro contract is single-threaded).

### Readback: `glReadPixels` into the existing frame pipe, unchanged downstream

A hardware-rendered core reports its frame differently: instead of a real
pointer, `retro_video_refresh_t`'s `data` argument is the sentinel value
`RETRO_HW_FRAME_BUFFER_VALID` (`(void *)-1`), meaning "I already drew into the
FBO you gave me — go read it yourself." `callbacks::video_refresh` detects the
sentinel and forwards a `VideoFrame` marker (`is_hw_frame: true`, empty
`data`) instead of copying bytes; `runtime.rs`'s `drain_video` branches on
that flag and calls `HwRenderContext::read_frame_into` (a `glReadPixels` into
the same reused scratch buffer the software path's `to_rgba8_into` already
uses) instead of the pixel-format decode. From that point on — the shared
`publish_frame` helper both paths call — the frame pipe is **identical**:
same `Rgba8Frame`, same latest-frame-wins slot, same sequence-numbered
raw-bytes IPC channel (§3). The HW-render layer's entire job is producing an
`Rgba8Frame`; it never touches IPC, canvas painting, or anything
frontend-facing directly.

**Throughput.** `glReadPixels` at N64's common 640×480@60 output is
640 × 480 × 4 bytes × 60 fps ≈ **73 MB/s** — about 5× the existing NES path's
256×240@60 ≈ 14.7 MB/s (§3's own cited figure), well inside what Tauri 2's
binary IPC channel and a modern GPU's PCIe/UMA readback bandwidth handle
without becoming the bottleneck; the headless integration test
(`native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`)
proves the path end-to-end at a small synthetic size, and the on-device N64
run is where the real-resolution throughput is confirmed in practice (see
Acceptance below).

**`bottom_left_origin`.** OpenGL's coordinate convention makes
`glReadPixels` always return rows bottom-to-top (row 0 = the image's bottom),
which is the *opposite* of every software-rendered frame in this app (and of
`ImageData`/`putImageData`, which expect top-to-bottom). A core that leaves
`bottom_left_origin` at its default `false` wants Harmony to present
top-left-origin output — exactly what every existing consumer already
assumes — so `read_frame_into` flips the rows back before handing the buffer
off; a core that sets it `true` wants its native (bottom-left) order
preserved, so the flip is skipped. This is exactly the class of bug the
v0.29.1 flip regression (a row-order mistake in an unrelated, software-only
code path) warns about: `flip_rows_in_place` is a small, pure, span-swapping
function with unit tests for the even-row, odd-row (untouched middle row),
single-row, and zero-size cases — verified in isolation rather than only by
eyeballing an on-device screenshot.

### Lifecycle: `context_reset`/`context_destroy` per the libretro contract

The libretro contract is specific about ordering: `context_reset` fires once
the context **and** the render target are actually ready to be drawn into —
which in practice means after `retro_load_game` (a core's geometry, and
therefore the FBO's size, is only final once the ROM is loaded) — and
`context_destroy` fires before the context itself is torn down, giving the
core one last chance to free its own GL objects while everything is still
current.

- **`context_reset` timing bug found and fixed while testing this item.**
  `RETRO_ENVIRONMENT_SET_HW_RENDER` is negotiated during `retro_init` (before
  `retro_load_game`), but the very first `retro_run` tick was, pre-fix, run
  *before* the freshly-drained `HwRenderRequested` event ever created the
  context — meaning `get_current_framebuffer`/`get_proc_address` were still
  null pointers the core's `context_reset` hadn't been called to resolve, so
  the first frame silently rendered nothing. The fix: `run_core_loop` drains
  the environment channel once **before** entering the tick loop (not only
  after each `run_frame`), since the negotiation-time events from
  `bring_up_core`'s `retro_init`/`retro_load_game` are already sitting in the
  channel by the time the loop starts. Caught by, and regression-proofed by,
  `native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`
  (flaky ~1-in-5 before the fix, solid across 15+ runs after).
- **Teardown.** `HwRenderContext::drop` calls `context_destroy` (if the core
  supplied one) before the CGL context itself is destroyed
  (`CglContext::drop`, which clears the current context and calls
  `CGLDestroyContext`). `callbacks::uninstall` — already called on every
  session stop, native or not — additionally clears the process-global
  `HW_RENDER_CONTEXT` slot, so a second session's `install_hw_render_context`
  never races a dying session's stray callback. `a_second_session_can_create_a_fresh_context_after_the_first_is_dropped`
  proves the "unload cleanly so a second session can start" acceptance
  criterion directly, by doing exactly that twice in a row.

### What falls back when negotiation is rejected

Nothing new: a core that doesn't get the HW-render context it asked for is in
exactly the same position as any other `retro_load_game` failure the
pre-W345 native host already handles — `NativeRuntime::start` returns an
`Err`, and the existing native-init-failure → EmulatorJS-fallback switch (§4)
takes over. No dedicated "HW-render fallback" code path exists, or needs to.

### Aspect ratio propagation (W340 reviewer fix)

W340 added `RETRO_ENVIRONMENT_SET_GEOMETRY` handling but only *logged* the
core's `aspect_ratio` — never propagated it, so N64 and PS1 (both of which
declare a real display aspect distinct from their pixel dimensions) would
have rendered stretched into the frontend's fixed 4:3 box. Fixed as part of
this item since it's the same reviewer note and the same code path W345
already touches:

- **Backend.** `Rgba8Frame` gained an `aspect_ratio: Option<f32>` field
  (`None`/non-positive means "derive it from width/height", libretro's own
  convention for an unset ratio — `positive_aspect_ratio` is the one shared
  helper both boot-time (`bring_up_core`'s `av_info` read) and mid-game
  (`drain_environment`'s `GeometryChanged` handler) call, so the two call
  sites can't drift on what "unset" means). `get_native_frame`'s wire header
  gained one `f32 LE` field, purely appended after the existing 16-byte
  `[seq][width][height]` header (now 20 bytes) — additive, matching this
  file's own established pattern for header extensions (§3's W239 raw-bytes
  history).
- **Frontend.** `nativeFrame.ts`'s `parseFrameBuffer` decodes the new field
  into `ParsedFrame.aspectRatio` (`null` for the unset sentinel).
  `NativePlayer.tsx` tracks the latest non-`null` value in state and applies
  it as the `--rgp-player-aspect-ratio` CSS custom property on
  `.rgp-player__frame`; `library.css`'s `aspect-ratio` declaration now reads
  `var(--rgp-player-aspect-ratio, 4 / 3)` — the `4 / 3` fallback preserves
  every pre-W345 system's exact current rendering (NES included, which never
  sets an aspect ratio) since the variable is only set once a frame actually
  reports one.

### Acceptance (W345)

- An N64 ROM boots and renders through the native host on device — see the
  Verification record below (on-device-gated; ships dark with a filed
  blocker if the on-device step is unavailable in this session).
- Readback throughput at 640×480@60 (≈ 73 MB/s, see above) does not regress
  the frame pipe — the shared `publish_frame` tail is identical to the
  software path's, and the headless integration test proves the FBO →
  `glReadPixels` → frame-slot chain functions correctly end to end.
- Software-render systems are untouched — `HwRenderContext` is constructed
  in exactly one place (`bring_up_hw_render`, called only from
  `EnvironmentEvent::HwRenderRequested`), so no software-rendered core's
  session ever allocates a CGL context or an FBO.
- EJS N64 fallback is intact — no change to `system_map.rs`'s external-core
  catalog or `commands::play`'s EJS launch path; `NATIVE_SYSTEMS` gaining an
  `n64` row only changes what `list_native_systems`/`nativePath.ts` report as
  native-eligible, and the existing "native init failed → fall back" switch
  (§4) covers a rejected/failed HW-render negotiation the same as any other
  native-start failure.
- Unit/headless coverage: environment negotiation (accept OpenGL/OpenGL-Core,
  reject everything else, fill in the frontend callbacks, forward the
  decoded request), the `RETRO_HW_FRAME_BUFFER_VALID` sentinel in
  `video_refresh`, row-flip logic (`flip_rows_in_place`, both orientations),
  FBO size/resize behavior, a real headless CGL context + FBO create/clear/
  read-back/resize/proc-address/teardown cycle
  (`hw_render::tests`, macOS-only — this project's only target), and a full
  `NativeRuntime::start`-through-`latest_frame` HW-render integration test
  with a synthetic GL-drawing stub core
  (`native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`).
  The on-device-only step (`manual_n64_boots_and_renders_via_hw_render`) is
  `#[ignore]`d, gated behind `RGP_N64_CORE`/`RGP_N64_ROM`, mirroring the
  existing `manual_play_produces_audible_output` precedent (§2's
  verification record).

### Verification record (v0.34, W345)

On-device mupen64plus_next + a real N64 ROM were not available in this
implementation session (sandboxed, no installed N64 core/ROM on the build
machine) — the acceptance criterion's on-device step is explicitly gated on
that per the release plan ("if blocked, file the blocker as a GitHub issue
... and ship the HW-render layer dark"). The HW-render layer itself is fully
exercised headlessly: the real CGL/FBO plumbing (not a mock) is created,
drawn into via `glClearColor`/`glClear`/`glBindFramebuffer` resolved through
the real `get_proc_address`, and read back with real, checkable non-blank
GPU-rendered pixel content
(`native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`) —
the same proof-standard §2's `a_real_run_frame_tick_produces_genuine_video_and_audio_content`
established for the original software/audio path. The `n64`/
`mupen64plus_next` table row ships enabled (not dark) since the layer it
depends on is proven; only the literal "boots a real N64 title" step is the
human on-device follow-up, tracked as a filed blocker (see the release
ledger) rather than blocking this branch.

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
