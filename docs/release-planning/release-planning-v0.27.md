# Release Planning — v0.27

> status: agreed
> Captures the scope and ledger for v0.27 "Immersion". Archive into
> `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.27` |
| **Previous** | v0.26.2 (post-rename image repair) |
| **Theme** | **Immersion** — make playing a game in TV mode actually feel like a console. Driven by the 2026-07-03 couch playtest: (1) launching a game showed a "tiny porthole" (desktop 760px player card inside the fullscreen takeover), (2) PlayStation ✕ mid-game launched a *different* game (native player never claims the controller's exclusive slot, so the home's spatial nav stayed live), (3) requested feature: 5 s dwell on a tile boots a live attract preview, (4) native audio "mostly fine but slightly off" + the perf log turned out to be unreviewable (stderr-only, discarded for Finder-launched apps), (5) standing request: re-evaluate the whole TV takeover feature for gaps and fix them. |

User directive (2026-07-03): "In TV mode, play attract mode feature when you
hover over a game for 5 seconds. … I want playing games to be a fullscreen
experience. … Make sure controller inputs are properly scoped. Please
re-evaluate the entire picture mode feature for implementation gaps and fix
them."

---

## 2. Major Features

### W272 — TV takeover play experience (fullscreen + input ownership)

Fill presentation for both players inside the takeover (kill the 760px
desktop card; TV-scale chrome; overlay is the sole in-game menu on the TV
surface) + one shared exclusive-controller-scope hook adopted by BOTH
players (fixes ✕-launches-another-game; gives the native path
controller-drivable overlays). Spec: `tv-mode-design.md` §v0.27 → W272.

- **Acceptance:** per the design contract; all gates green; desktop
  detail-page play visually unchanged; tv-takeover smoke route still green.
- **Branch:** `fix/w272-tv-play-experience`

### W274 — Native audio polish + observable telemetry

Catmull-Rom resampler (replaces linear), DRC_GAIN 0.01 → 0.005, perf line
persisted to a per-session `logs/native-perf.log` (stderr fallback), stretch
QoS elevation. Spec: `native-emulation-design.md` §2 → "v0.27 (W274)".

- **Acceptance:** resampler identity/quality unit tests; DRC clamp tests
  updated; a Finder-launched session leaves a readable perf log; gates green.
- **Branch:** `fix/w274-native-audio-polish`

### W273 — TV hover-attract (5 s dwell live preview)

Dwell 5 s on a native-capable shelf tile → full-bleed ducked live preview
behind the home; strict purity (no play-session record, no saves, ever);
teardown on any focus/launch/exit change. Spec: `tv-mode-design.md` §v0.27 →
W273. Runs Pass 2 — it builds on W272's presentation plumbing in
`src/features/play/`.

- **Acceptance:** per the design contract incl. the purity byte-identical
  check; gates green.
- **Branch:** `feat/w273-tv-hover-attract`

### W275 — TV mode gap audit + fixes

Walk every tv-mode-design §Acceptance bullet plus the new v0.27 contracts
against the code; exercise the interplay seams (exit-confirm vs takeover,
pause-on-blur in TV, W235 vs W273 attract, auto-TV-mode boot, focus
restoration, external path, reduced motion, keyboard parity). Fix small gaps
in-branch; record structural findings as follow-ups. Runs Pass 3 (audits the
POST-fix feature).

- **Acceptance:** audit findings table in the branch's report; every fixed
  gap has a test or smoke marker; gates green.
- **Branch:** `fix/w275-tv-gap-audit`

---

## 3. Parallel Implementation Strategy

### Pass 1

`fix/w272-tv-play-experience` ∥ `fix/w274-native-audio-polish` — disjoint
(frontend play/tv surfaces vs Rust audio backend).

### Pass 2

`feat/w273-tv-hover-attract` — W272 ↔ W273: both touch
`src/features/play/` players and the TV home surface: → sequenced.
W273 also needs a `start_native_play` preview flag (backend, additive).

### Pass 3

`fix/w275-tv-gap-audit` — W273 ↔ W275: the audit must evaluate the finished
feature including attract: → sequenced.

---

## 4. Out of Scope for v0.27

- EmulatorJS-path attract previews (save-suppression through the iframe glue)
  — recorded follow-up in tv-mode-design.md.
- Frontend frame-presentation upgrades (WebGL/event-push/NSView overlay) —
  unchanged escalation ladder in native-emulation-design.md §3.
- CRT filters (#23), idle screensaver, collections rail — tv-mode-design
  §Follow-ups, v0.29+.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.27 |
|---|---|---|---|---|
| `fix/w272-tv-play-experience` (W272) | ☑ | ☐ | ☐ | ☐ |
| `fix/w274-native-audio-polish` (W274) | ☑ | ☑ | ☑ | ☑ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.27 |
|---|---|---|---|---|
| `feat/w273-tv-hover-attract` (W273) | ☑ | ☐ | ☐ | ☐ |

### Pass 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.27 |
|---|---|---|---|---|
| `fix/w275-tv-gap-audit` (W275) | ☑ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- None yet.
