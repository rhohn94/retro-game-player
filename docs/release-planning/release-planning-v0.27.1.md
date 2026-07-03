# Release Planning — v0.27.1

> status: agreed
> Hotfix release — single-item lane, abbreviated ritual. Captures the scope
> and ledger for the v0.27.1 EmulatorJS audio-warmup port. Archive into
> `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.27.1` |
| **Previous** | v0.27 "Immersion" |
| **Theme** | Port the abandoned `fix/audio-warmup` branch's **warm-then-reset** cold-start fix forward onto the current EmulatorJS host page. User directive (2026-07-03): "since we still use EmulatorJS as a backup when native emulation is not available, please look into merging those fixes into the main channel." |

**History:** three masking approaches were tried on 2026-06-29
(`fix/audio-warmup`: gain fade-in → larger buffer → warm-then-reset) and
abandoned the next day when v0.21 "Bedrock" fixed the garble *at the root* by
hosting NES natively. But the root fix only covers NES: EmulatorJS remains
the primary in-page path for the 7 v0.24 systems (SNES, Genesis, Master
System, N64, PlayStation, Atari 2600, PC Engine) and the automatic fallback
for NES — and a fresh `AudioContext` still produces ~2–3 s of garbled samples
on every EJS boot. The branch's final approach (commit `2ecf102`) is the one
to port: **warm-then-reset** — boot once muted + covered to pay the JIT/
resampler cold-start cost, then reset the emulator and reveal, so the boot
the user sees and hears replays clean from power-on (preserving the
boot-with-sound retro vibe, which a pure fade-in would swallow).

---

## 2. Major Features

### W276 — Forward-port the warm-then-reset EJS audio warmup

Port `2ecf102`'s two `player.html` additions onto the current (v0.27) file —
NOT a git merge; the branch is based on v0.20 and predates the v0.23 save
bridge and the W243 volume/rewind bridge that now live in the same script:

1. **AudioContext master-gain shim** (before the boot script): wrap
   `AudioContext`/`webkitAudioContext`, route every `connect(ctx.destination)`
   through a per-context master gain held at 0 until
   `window.__harmonyRevealAudio()` fades it up (0.25 s exponential ramp).
2. **Warm-then-reset boot orchestration** (after the loader append): cover
   the frame (black, "Warming up…"), wait `WARMUP_MS = 3000` from the
   emulator's one-shot `start` event, `gameManager.restart()`, then reveal
   audio + uncover. `MAX_WAIT_MS = 25000` safety reveal so the page can never
   stay muted forever.

**Interaction seams the port must handle (new since the branch):**

- **Save bridge (W231):** its `start` handler (`restoreSram` + SRAM flush
  interval + pending-volume apply) must run exactly once even if the
  post-reset boot re-fires `start` — make it one-shot like the warmup's own
  listener. SRAM restored before the reset survives it (reset preserves the
  core's SRAM region — that is what battery saves are).
- **Volume (W243):** parent volume flows through `EJS_emulator.setVolume`;
  the master-gain shim multiplies independently, so they compose. Muted
  warmup must win regardless of user volume (gain 0 × anything = 0).
- **Pause (v0.15 overlay / W243 pause-on-blur):** if a `harmony-pause`
  arrives during the warm window, defer the reset until resume (track the
  paused state in the message bridge); the reveal must not fire on a paused,
  garbled frame.

Also: port the `server.rs` route test asserting the served `player.html`
contains `__harmonyMaster`; update `in-page-play-design.md` with a
§Warm-then-reset section (incl. the accepted ~3 s boot-latency cost on the
EJS path and why fade-in/large-buffer were rejected); the fix must be
observable via the smoke inspect route if feasible (the cover element is a
DOM marker).

- **Acceptance:** all gates green; `player.html` serves the shim +
  orchestration; save/volume/pause seams handled per above; design doc
  updated. By-ear verification on a real EJS boot is the user's final gate
  (same loop as v0.26.1/v0.27 native audio).
- **Branch:** `fix/w276-ejs-audio-warmup`

---

## 3. Parallel Implementation Strategy

### Pass 1

`fix/w276-ejs-audio-warmup` — single item, no conflicts.

---

## 4. Out of Scope for v0.27.1

- Any native-path change (W274's pipeline is untouched).
- Shortening the warm window adaptively (measure-the-garble); recorded as a
  possible refinement if 3 s proves annoying.
- Deleting the historical `fix/audio-warmup` branch (superseded once this
  ships; needs the user's explicit OK for a forced delete).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.27.1 |
|---|---|---|---|---|
| `fix/w276-ejs-audio-warmup` (W276) | ☑ | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- None yet.
