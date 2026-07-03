# Release Planning — v0.26.1

> status: agreed
> Hotfix release — single-item lane, abbreviated ritual. Captures the scope
> and ledger for v0.26.1. Archive into `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.26.1` |
| **Previous** | v0.26 (Theater — TV mode epic, Retro Game Player rename, controller completion) |
| **Theme** | Hotfix — native-play A/V clock. First v0.26.0 sessions on-device confirmed the game runs measurably slow and audio "sounds off" (user-reported same day). Code audit found three compounding backend defects: the core's reported sample rate is never consumed (no resampler — wrong pitch/speed on any core/device rate mismatch, permanent ring drain/flood), relative-sleep frame pacing accumulates macOS sleep overshoot (core runs below native fps → slow game + audio underrun crackle), and the audio ring is a `Mutex<VecDeque>` locked inside the realtime callback with a per-callback allocation on the F32 path. No dynamic rate control exists — drop-oldest/pad-silence are the only mechanisms, exactly the drift failure `native-emulation-design.md` §2 predicted and deferred. |

A GitHub issue for the defect was **not** filed (the auto-mode classifier
requires issue-creation to be user-initiated); this document is the defect
record. File retroactively if wanted.

---

## 2. Major Features

### W270 — Native A/V clock rework

Rework the native-play audio/video timing core (`src-tauri/src/play/native/`)
per `native-emulation-design.md` §2 "v0.26.1 (W270)":

- `FrameClock` (new `clock.rs`): absolute-deadline frame scheduler — deadlines
  accumulate instead of restarting from "now", coarse sleep + yield/spin tail,
  stall/pause resync. Kills the cumulative-overshoot slowdown.
- Audio chain (new `audio.rs`): linear-interpolation stereo resampler
  (core rate → device rate) with RetroArch-style dynamic rate control driven
  by ring fill; lock-free SPSC ring (`rtrb`); realtime callback pops chunks
  with inline gain — no locks/allocs; pre-fill (~80 ms) before stream start;
  stereo→device channel mapping (mono mix-down, extra channels silent);
  I16/F32 formats; atomic underrun/overrun/frames-run counters with a
  periodic effective-fps log line (`[rgp-native]`, replacing stale
  `[harmony-native]` prefixes).
- `frame.rs`: row-wise conversion into a reused buffer.
- `Cargo.toml`: add `rtrb`; `[profile.dev] opt-level = 1` so dev-mode testing
  is representative.

- **Acceptance:** all gates green (vitest, cargo test, typecheck, lint,
  clippy, build, `recipe.py smoke`); resampler/DRC/clock/channel-mapping/
  pre-fill logic unit-tested as pure components; no locking or allocation in
  the realtime callback path (by construction, review-verified); existing
  gain/pause/save semantics preserved; final by-ear + perf-log verification
  on the maintainer's machine (user loop, same-day).
- **Branch:** `fix/w270-native-av-clock`
- **Design:** `native-emulation-design.md` §2 (updated).

---

## 3. Parallel Implementation Strategy

### Pass 1

Single item, single phase — `fix/w270-native-av-clock` branches from
`version/0.26.1`, backend-only (no frontend/UI surface changes; NativePlayer's
poll/paint loop is untouched).

No conflicts — sole branch in the lane.

---

## 4. Out of Scope for v0.26.1

- Frontend frame presentation (WebGL texture upload / event-push frame
  channel / NSView-Metal overlay) — the rAF-poll + `putImageData` path stays;
  it is judder-polish, not the reported defect. Documented escalation in
  `native-emulation-design.md` §3 / Follow-ups.
- Audio-master core pacing (running the core off ring backpressure instead of
  a deadline clock) — DRC + deadline pacing is the well-trodden fix; escalate
  only if drift is still observable.
- Core-thread QoS/priority elevation (macOS `pthread_set_qos_class_self_np`)
  — noted as a follow-up if scheduling jitter is still visible in the perf log.
- Everything scheduled for v0.29 "Craft".

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26.1 |
|---|---|---|---|---|
| `fix/w270-native-av-clock` (W270) | ☑ | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- None yet.
