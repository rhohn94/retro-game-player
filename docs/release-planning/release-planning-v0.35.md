# Release Planning — v0.35

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.35.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.35` |
| **Previous** | v0.34 (Engines — multi-system native engine, HW-render N64, PS1 discs) |
| **Theme** | "Player Two" — two-controller multiplayer for NES and SNES: a second connected controller is picked up automatically by the emulators, no configuration required. |

User directive (2026-07-05): ensure multiplayer support, specifically for
NES and SNES; support two controllers, automatically picked up by emulators.

Grounding facts (planning read, 2026-07-05, post-v0.34):

- The native input path is single-player end-to-end: `set_native_input(bits:
  u16)` carries ONE joypad mask; the libretro `input_state` callback ignores
  its `port` argument (`callbacks.rs:349`), so every port a core polls sees
  player 1's buttons; `NativePlayer.tsx:365` polls only `getGamepads()[0]`.
- Menu navigation (`useGamepadPoll.ts`) picks the first connected pad —
  unaffected by this release except where noted in W352's lane.
- NES and SNES both run on the native engine as of v0.34 (fceumm, snes9x);
  the EJS in-page path is their fallback tier and EmulatorJS has its own
  gamepad-to-player assignment that needs verification/config (W353).
- Keyboard input merges into the player-1 mask today; that stays true.

---

## 2. Major Features

### W350 — Per-port native input (backend)

Replace the single shared joypad mask with per-port state: `set_native_input`
gains a `port` parameter (ports 0 and 1 this release; storage sized for 2,
extensible), the `input_state` callback returns the polled port's mask
(ports ≥ 2 report not-pressed), and session start/stop clears all ports.
Explicitly announce two connected joypads to the core via
`retro_set_controller_port_device(port, RETRO_DEVICE_JOYPAD)` for ports 0–1
at load (the libretro default is joypad, but announcing is contract-polite
and matters for cores that lazily allocate port state). Backward IPC
compatibility: the existing no-port call shape must keep working as port 0
(the EJS/native switch and overlay release-all-buttons paths call it).

- **Acceptance:** a stub core polling ports 0 and 1 sees two independent
  masks; port isolation covered by tests (press on port 1 never leaks to
  port 0); `set_native_input` without a port behaves exactly as today
  (port 0); all-ports release on overlay open/session stop is tested;
  NES + SNES cohort behavior unchanged for single-pad sessions.
- **Branch:** `w350-per-port-native-input`
- **Design:** `native-emulation-design.md` — new §Multiplayer input;
  `controller-input-design.md` cross-link.

### W351 — Two-controller capture, assignment, and lifecycle (frontend)

`NativePlayer` polls all connected gamepads and pushes per-port masks:
gamepad→port assignment is automatic and stable (first-connected pad → port
0, second → port 1, keyed by `Gamepad.index`; keyboard always merges into
port 0). Disconnect lifecycle: a pad unplugged mid-game releases its port
(zero mask pushed once), a reconnect reclaims the lowest free port; no
manual assignment UI this release. Surface the pickup visibly but quietly: a
small "P1 / P2" connected-controllers indicator in the in-game overlay and
on the detail page player chrome (reusing the existing notice/chip
patterns), so a second player plugging in sees the pickup happen.

- **Acceptance:** with two pads connected, port 0 and port 1 masks track
  their own pads (unit-tested via the pure bit-math layer with fake pad
  objects); unplugging pad 2 releases port 1 (release-all pushed exactly
  once); keyboard continues driving port 0 alongside pad 0; the P1/P2
  indicator reflects connect/disconnect; single-pad sessions are visually
  and behaviorally unchanged except the indicator.
- **Branch:** `w351-two-pad-capture-lifecycle`
- **Design:** `controller-input-design.md` — new §Two-player capture.

### W353 — EJS fallback two-player verification/config

Make the EmulatorJS in-page path (NES/SNES fallback tier) pick up two
controllers too: verify EmulatorJS's default gamepad→player assignment
inside the loopback player page, set the `EJS_*` configuration needed for
automatic player-2 assignment (no in-iframe manual mapping required), and
document what its built-in behavior provides. If EmulatorJS's auto
assignment proves broken for player 2 under our host page, file the finding
as an issue and record the honest limitation in the design doc — the native
path is the primary multiplayer surface.

- **Acceptance:** the host page config enables two-pad play on EJS NES/SNES
  (verified as far as headless testing allows; on-device two-pad check is a
  human follow-up alongside the native one); design doc records EmulatorJS's
  assignment behavior and our configuration; a blocker, if found, is filed
  and documented rather than half-shipped.
- **Branch:** `w353-ejs-two-player`
- **Design:** `in-page-play-design.md` — §7 note on player-2 config.

---

## 3. Parallel Implementation Strategy

Two passes:

| Pass | Items | Rationale |
|---|---|---|
| P1 | W350, W353 | W350 owns `src-tauri/src/play/native/*` + `commands/native_play.rs` + `src/ipc/native-play.ts` (IPC shape only). W353 owns the EJS host page (`src-tauri/vendor/player.html` serving path / `play/server.rs` config injection) + `in-page-play-design.md`. No overlap. |
| P2 | W351 | Depends on W350's IPC shape. Owns `NativePlayer.tsx`, `nativeInput.ts`, overlay/detail chrome, `controller-input-design.md`. |

Merge order = pass order. Conflict map: W351 touches `src/ipc/native-play.ts`
only if W350's shape needs a TS-side addition it didn't already make — W350
lands the full IPC surface (Rust + TS binding) so W351 consumes, not edits.

---

## 4. Out of Scope for v0.35

- **More than two players** (ports 2–3) — storage is extensible; UI,
  testing, and assignment policy deferred until a real 4-player need.
- **Manual port-assignment / player-swap UI** — automatic assignment only
  this release; a swap affordance is a future item.
- **Per-player rebinding UI** — the v0.26 press-to-rebind remapping stays
  global (applies to all pads of a family); per-player overrides deferred.
- **N64/PS1 multiplayer** — the plumbing W350 lands is system-agnostic and
  N64/PS1 may work incidentally on the native path, but only NES/SNES are
  verified/claimed this release (user directive scope).
- **Menu/shell navigation from the second pad** — `useGamepadPoll` keeps
  first-pad-drives-menus; in-game is where two controllers matter now.
- **Wiimote/motion input** — unchanged non-goal.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero, 2026-07-05).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.35 |
|---|---|---|---|---|
| `w350-per-port-native-input` (W350) | ☐ | ☐ | ☐ | ☐ |
| `w353-ejs-two-player-v035p1-01` (W353) | ☑ | ☑ | ☑ | ☑ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.35 |
|---|---|---|---|---|
| `w351-two-pad-capture-lifecycle` (W351) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- **Pass-1 note:** dispatched via the write-capable workflow
  (`release-phase-model: Auto`); branch names carry the `-v035p1-NN` suffix.
- Reviewer (W353, non-blocking): the player-0 `EJS_defaultControls` entry
  covers gameplay control ids 0–13 only — EmulatorJS's built-in ids 14–26
  keyboard hotkeys (quick save/load/state-slot) are dropped by the
  override; low impact (Harmony's overlay save bridge covers saves) but the
  doc/comment should say "gameplay buttons 0–13", not full parity.
- Reviewer (W353, non-blocking): per-game localStorage `controlSettings`
  outrank `EJS_defaultControls`; neutralized today by the ephemeral loopback
  port (fresh origin per launch) — document the precedence; `EJS_gameID` +
  a stable policy or `EJS_disableLocalStorage` would make it deterministic.
- Reviewer (W353, cosmetic): `server.rs` test asserts literal
  `playerControls(true/false)` source strings — brittle to reformatting.
- **P2 hand-off (from W350 review, MUST be done in W351):** migrate the
  three `setNativeInput(0)` release sites in `NativePlayer.tsx` (≈lines
  188, 202, 487) to `releaseAllNativeInput()` — until then port 1 input
  would survive overlay-open/teardown once a port-1 writer exists.
