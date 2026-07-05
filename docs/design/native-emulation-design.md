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
`tauri::ipc::Response` whose body is a 16-byte header
(`[seq: u64 LE][width: u32 LE][height: u32 LE]`) followed by the tightly
packed RGBA8888 pixels, received frontend-side as an `ArrayBuffer` and viewed
zero-copy into `ImageData`. The runtime stamps each stored frame with a
monotonically increasing sequence number; the poller echoes the last painted
one and an unchanged frame answers with an **empty body**, so paused /
overlay / idle polls are near-free. The rAF tick is scheduled up-front with
an in-flight guard, so a slow round trip degrades to a skipped paint rather
than a halved frame rate.

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
  frame's dimensions AND the run loop's real-time pacing match the stub's
  numbers, not NES's — the acceptance-mandated "a second software-rendered
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
