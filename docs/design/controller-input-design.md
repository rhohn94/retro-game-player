# Controller Input Design — Harmony v0.1 (W14)

> **Up:** [↑ Design docs](README.md)

> **Status:** authoritative for the W14 controller-input layer. Implements the
> controller model sketched in `harmony-ux-design.md` §0 and the
> `controller_bindings` surface in `architecture-design.md` §2.10 / §3.

## Motivation

Full controller-only operability is a **v0.1 first-class requirement**: a user
with no pointer must be able to drive every screen from a gamepad. This document
specifies the input pipeline — raw gamepad reads → semantic actions → spatial
focus → on-screen feedback → persisted bindings — and the integration choices
behind it.

## Scope

**Covers:** the gamepad-source spike + decision, the semantic-action layer with
per-family defaults, the spatial focus engine, the focus-ring + hint-bar overlay,
and binding persistence via the W3 `controller_bindings` repo.

**Does not cover:** per-screen focus orders (each screen item W13/W15/W16/W17
owns its own, consuming `useFocusable`/`HintBar`); a full in-app binding-editor
UI (the Settings → Controllers panel, W15, builds on `list_bindings`/`set_binding`).

## 1. Input source — the spike (decision)

**Decision: the browser Gamepad API (`navigator.getGamepads()`), not a native
Tauri plugin.**

Rationale:
- The Tauri 2 macOS webview (WKWebView) exposes the standard W3C Gamepad API, so
  button/axis state is readable from React with **zero native registration** —
  no new Rust crate (`tauri-plugin-gamepad`/`gilrs`), no `lib.rs` plugin
  registration, and **no added capabilities**. This keeps shared-file edits to
  the append-only IPC seam only.
- The polling model (a `requestAnimationFrame` loop diffing `Gamepad.buttons` +
  `Gamepad.axes`) is simple, dependency-free, and degrades cleanly in
  non-gamepad environments (tests/SSR), where `getGamepads` yields no pads.

Trade-off: the Gamepad API only delivers events while the webview is focused (no
background/global capture) and standard-mapping coverage depends on the OS
HID profile. Both are acceptable for a foreground launcher; if global capture is
later required, `useGamepadPoll` is the single swap point — the semantic layer
above it is source-agnostic.

Live hardware is **not** present in CI, so the spike is verified two ways: the
pure mapping logic is unit-tested (`actions.test.ts`, `spatial.test.ts`), and the
rAF polling is integration-verified later on a real pad (noted as a follow-up).

## 2. Semantic action layer (`actions.ts`)

Raw inputs map to a small closed set of **semantic actions**: `confirm`, `back`,
`nav_up/down/left/right`, `menu`, `quit`. The mapping is **pure** so it is fully
unit-testable without hardware.

### 2.1 Device families

`xbox`, `playstation`, `8bitdo`, `switch_pro`, plus a `generic` fallback.
`detectFamily(gamepadId)` classifies the Gamepad `id` string on robust vendor /
name substrings.

### 2.2 Per-family defaults & the confirm/back swap

D-pad and menu/quit bindings are family-invariant (standard-mapping indices).
Only **confirm/back swap by family**: Xbox / PlayStation / 8BitDo confirm with
the **bottom** face button (standard index 0) and back with the **right** one
(index 1); **Switch Pro** mirrors them (physical A is on the right), so confirm =
index 1, back = index 0. This is the classic Nintendo A/B swap.

### 2.3 Sticks & edge detection

`stickToNav(x, y)` maps the left analog stick to a single nav action with a
deadzone (`STICK_DEADZONE = 0.5`); the dominant axis wins so a diagonal resolves
to one move. `risingActions()` reports buttons newly pressed this frame
(rising-edge), so one physical press fires exactly one action regardless of poll
rate; the polling hook rate-limits held-stick repeats (`STICK_REPEAT_MS`).

## 3. Spatial focus engine (`spatial.ts`, `ControllerProvider.tsx`, `hooks.ts`)

A dependency-free geometric nearest-neighbour core (implemented in-repo rather
than vendoring `norigin-spatial-navigation`, to avoid a new runtime dependency
and lockfile churn — the heuristic is equivalent). `nextFocus(targets, current,
dir)` picks the lowest-cost target in a direction, where cost = primary-axis
travel + a heavy cross-axis penalty (row-major grid feel); it returns `null` at
an edge (the caller may edge-scroll).

`ControllerProvider` owns the single focused id, a registry of focusables, the
live device family, and the loaded binding overrides. It wires `useGamepadPoll`
so nav actions move focus, `confirm` activates the focused element's
`onActivate`, and `back`/`menu`/`quit` dispatch to the active screen's
registered handlers. Screens register elements with `useFocusable(id,
onActivate)` and read `isFocused`. The first focusable to mount claims focus so a
fresh screen is immediately controller-operable.

## 4. On-screen feedback (`FocusRing.tsx`, `HintBar.tsx`, `glyphs.ts`)

`FocusRing` draws a brand-cyan ring (`--aura-focus`) via outline + box-shadow
(layout-neutral). `HintBar` is the persistent footer; it resolves Xelu /
PromptFont-style glyphs per active family via `glyphFor` (e.g. ✕/○ on
PlayStation, Ⓐ/Ⓑ on Xbox) so the glyph always matches the button to press, and
renders an ordered list of `{ action, label }` hints plus an optional combined
`◀▶▲▼ Move`.

## 5. Persistence (`commands/controllers.rs`, `ipc/controllers.ts`)

Bindings persist in SQLite via the W3 `controller_bindings` repo. Three minimal
append-friendly commands back the frontend:
- `list_bindings(deviceFamily?)` → `ControllerBinding[]` — overrides folded over
  compiled-in family defaults (empty list = pure defaults).
- `set_binding(deviceFamily, action, button)` → `ControllerBinding` — upserts one
  override.
- `reset_bindings(deviceFamily)` → `void` (W267) — deletes every override row for
  one family (`ControllerBindingsRepo::delete_family`), restoring its compiled-in
  defaults. An empty family is a no-op success, not an error.

`resolveBindings(family, overrides)` applies overrides over `defaultBindings`,
ignoring unknown actions/buttons so a stale row can never crash input.

## 6. Cross-links

- `harmony-ux-design.md` §0 — controller model, focus ring, per-screen hints.
- `architecture-design.md` §2.10, §3 — `controller_bindings` surface + table.

## Remapping UI (W267)

Settings → Controllers replaces the stub with a full press-to-rebind editor
(`ControllersPane.tsx`), one section per `DEVICE_FAMILIES` entry, each a table
of the eight `SemanticAction`s showing the currently bound button (family
glyph via `glyphFor` + a human label).

**Capture mode.** Clicking/activating a row (mouse or controller `confirm` via
`useFocusable`) opens a "press a button…" overlay and starts polling
`navigator.getGamepads()` directly for the next rising-edge button press on any
connected pad whose `detectFamily(id)` matches the row's family — deliberately
bypassing the shared `ControllerProvider`/spatial-nav loop so ordinary nav
input doesn't leak into the capture. `Escape` or an 8-second timeout
(`CAPTURE_TIMEOUT_MS`) cancels back to the table with no change.

**Conflict handling.** A captured button already bound to a different action
in the same family surfaces a Swap/Clear choice rather than silently
clobbering it:
- **Swap** — the two actions exchange buttons; both stay bound.
- **Clear** — the rebound action takes the button; the other action becomes
  `UNBOUND` (a sentinel index of `-1`, distinct from every real Gamepad API
  button index, so it can never accidentally fire).

This merge is pure logic in the new `src/features/settings/remap.ts` module
(`findConflict`, `applyRebind`, `diffBindings`) — fully unit-tested
(`remap.test.ts`) without any DOM or hardware dependency, mirroring the
existing `actions.ts`/`spatial.ts` pure-core convention. `diffBindings` computes
only the rows that actually changed, so a rebind/swap persists the minimal set
of `set_binding` calls rather than rewriting the whole family.

**Live apply.** After persisting, the pane calls the controller context's new
`refreshBindings()` (`ControllerProvider.tsx`) — a small additive export that
re-fetches `listBindings()` and updates the overrides `ControllerProvider`
already threads into `useGamepadPoll`. No event bus, no restart: the next
gamepad poll tick immediately resolves bindings against the refreshed
overrides. **Reset to defaults** per family calls the new `reset_bindings` IPC
(§5) then the same `refreshBindings()` path.

**Pane navigability.** Every rebind row registers with `useFocusable` like any
other controller-operable control, so the pane itself is fully drivable from a
gamepad; capture mode's window-level `Escape` listener plus the direct
Gamepad-API poll give it exclusive input while open (nav/confirm from the
underlying pane do not interfere, since the shared poll loop is untouched by a
capture in progress).

## Open questions

- Global/background gamepad capture (needs a native plugin) — deferred; the
  `useGamepadPoll` swap point isolates it.
- In-app binding-editor UX lives with Settings → Controllers (W15).
