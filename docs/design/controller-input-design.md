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

### 2.4 Auxiliary (per-family, additive) bindings — W278

`BindingMap` is deliberately **one-button-per-action**: `resolveBindings` /
`risingActions` assume a single physical button fires a given semantic action,
which is the right shape for confirm/back/nav/menu/quit everywhere else in the
app. The v0.28 "Living Room" TV system menu (tv-mode-design.md §v0.28 → W278)
needed a SECOND physical button to also open it — the PlayStation touchpad
click — without turning every action's binding into an array just to
accommodate one extra button on one family.

The fix is a small, separate, additive lookup in `actions.ts`, deliberately
**not** folded into `resolveBindings`/`risingActions`:

```ts
export const STANDARD_BUTTON = {
  // ...
  touchpad: 17, // PlayStation touchpad click (DualShock 4 / DualSense)
} as const;

const AUX_BINDINGS: Partial<Record<DeviceFamily, Partial<Record<SemanticAction, number>>>> = {
  playstation: { quit: STANDARD_BUTTON.touchpad },
};

export function defaultAuxBinding(family: DeviceFamily, action: SemanticAction): number | null;
```

`defaultAuxBinding(family, action)` returns the extra button index for that
family/action pair, or `null` when there is none — today only
`playstation`/`quit` has an entry. Consumers that need "does EITHER the
primary or the aux button fire this action" check both explicitly (see
`useMenuTrigger.isMenuTriggerPressed`, controller feature) rather than the aux
table changing `resolveBindings`'s return shape. This keeps three existing
contracts completely undisturbed:

- **`quit`'s primary binding** stays Select (`STANDARD_BUTTON.select`) for
  every family, in `resolveBindings`/`defaultBindings` — unaffected by W278.
- **`risingActions`/the main `useGamepadPoll` dispatch** are untouched — the
  aux table is not read there at all, so `nativeInput.ts`'s "quit" mapping and
  every other `quit` consumer see no change.
- **Persisted rebind overrides keyed `"quit"`** (`controller_bindings` DB rows)
  keep resolving through `resolveBindings` exactly as before; the aux
  touchpad binding is independent of any override on the primary binding (a
  user who rebinds `quit` off Select does not lose the PS touchpad's ability
  to open the TV menu, and vice versa — they are two separate paths to the
  same action, not one binding with an override).

The TV menu's own trigger is a raw-poll rising-edge hook
(`src/features/controller/useMenuTrigger.ts`) mirroring `useLongPress`'s shape
(own small rAF loop reading `navigator.getGamepads()` + the same
`resolveBindings`/`detectFamily` helpers) rather than routing through
`ControllerProvider`'s dispatch — so it fires regardless of who currently
holds the exclusive claim stack. `isMenuTriggerPressed(pad, family,
overrides)` is the pure, unit-tested "is the trigger down this tick" check
(both the primary Select binding and, for PlayStation, the aux touchpad
button); see tv-mode-design.md §v0.28 → W278 for the TV-feature-level gating
policy (`useTvSystemMenuTrigger`) that wraps it.

### 2.5 Gameplay menu trigger — Start+Select chord / 5s hold (W279)

**The defect this replaces.** Through v0.28 W278, `useExclusiveControllerScope`
/`routeScopedAction` (src/features/play/) opened the in-game overlay on a bare
`menu` semantic action — a single Start press. Independently,
`nativeInput.ts`'s `computeJoypadBits` maps that SAME physical button straight
into the NES core's `START` joypad bit on every poll tick, regardless of
overlay state. So one Start press did double duty: it reached the running
game **and** popped the app's own overlay in the same frame — any game that
itself uses Start for pause/menu could never be played without fighting the
launcher's menu (user directive, 2026-07-03).

**The fix.** `routeScopedAction`'s bare-`menu` branch is removed: while the
overlay is closed, **every** semantic action is swallowed (Start reaches the
core only, exactly like every other joypad button — `nativeInput.ts` is
intentionally unchanged). The overlay is now summoned by a dedicated,
gameplay-only raw-poll hook, additive to (not a replacement for) the semantic
dispatch:

```ts
// src/features/play/useGameplayMenuTrigger.ts
export const MENU_HOLD_MS = 5000; // its OWN constant — see the callout below

export function useGameplayMenuTrigger(opts: {
  onOpen: () => void;
  onProgress?: (progress: number) => void; // 0..1, drives the hold indicator
  overrides?: ReadonlyArray<{ deviceFamily: string; action: string; button: string }>;
  enabled?: boolean;
}): void;
```

Two additive ways to summon the overlay (the user's "or" ships as **both**,
not a choice made for them):

1. **Chord:** Start + Select held together in the same poll tick fires
   `onOpen` once, immediately, on the rising edge of "both down".
2. **Hold:** Start held **alone** (Select not also down — a chord in
   progress never also counts toward the hold) for `MENU_HOLD_MS` fires
   `onOpen` once; releasing before the threshold cancels silently (no
   overlay, no partial-open) and the hook re-arms for the next press.

Mirrors `useLongPress`/`useMenuTrigger`'s shape exactly: its own small rAF
loop reading `navigator.getGamepads()` directly plus the same
`resolveBindings`/`detectFamily` pure helpers, independent of the
exclusive-claim dispatch. `useExclusiveControllerScope` wires it up alongside
the claim lifecycle, enabled exactly while that scope owns the slot and the
overlay is closed — so it is naturally gameplay-only and naturally shared by
both play paths (InPagePlayer, NativePlayer) with no per-player duplication.

**Two distinct hold-threshold constants — do not conflate them:**

| Constant | Value | File | Gates |
|---|---|---|---|
| `LONG_PRESS_MS` | 600 ms | `controller/useLongPress.ts` | The TV-mode toggle long-press, **outside** gameplay (`useTvModeControllerToggle`, gated `!gameplayClaimActive`) |
| `MENU_HOLD_MS` | 5000 ms | `play/useGameplayMenuTrigger.ts` | The in-game overlay hold-open gesture, **only while** gameplay owns the exclusive claim |

Both mirror a CSS custom property for anything that needs to *show* the
threshold (`--rgp-tv-long-press-ms` / `--rgp-tv-menu-hold-ms` in
`theme/tv.css`) — the same dual-source pattern as `DUR`/`EASE` mirroring
`motion.ts` ↔ `motion.css`, since a CSS custom property can't be read by a
rAF loop. They are unrelated on purpose: one is a quick TV-shell toggle
outside any game, the other is a deliberately slow (5 s) gameplay-only
threshold chosen so it never fires by accident during normal play.

**Hold indicator.** `MenuHoldIndicator` (`src/features/play/`) renders a
small progress ring while `onProgress` reports > 0 — built from the live
held-duration, not a CSS animation, so there is nothing for the fill itself
to need to know about reduced motion. The container's show/hide rides the
existing `--rgp-dur-fast` token transition, which the app's central
reduced-motion rule (`theme/motion.css`) already zeroes to instant — so
reduced-motion users get a plain, static appear/disappear with no
per-component media query, per the established "one central rule, no
component opts out itself" policy. Styled at the desktop scale in
`library.css` (`.rgp-hold-indicator*`) and re-dressed at the `--rgp-tv-*`
10-foot scale for the TV takeover in `tv-game-surface.css`
(`.rgp-player--takeover .rgp-hold-indicator*`), the same "shared component,
scoped override" pattern the in-game overlay itself already uses.

**Scope note.** This is a **gameplay-only** rebind — it lives entirely in
`useExclusiveControllerScope`/`useGameplayMenuTrigger` and does not touch
W278's TV-system-menu trigger (`useMenuTrigger`/`useTvSystemMenuTrigger`,
gated on `!gameplayClaimActive`, "outside of games"). The two menus stay on
structurally distinct, non-conflicting gestures by construction: one
requires holding the gameplay exclusive claim, the other requires its
absence, so there is no cross-gating between them to get wrong.

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
- `native-emulation-design.md` §Multiplayer input (v0.35 "Player Two", W350) —
  per-port native joypad state; this doc's remapping/binding layer stays
  global (applies to all pads of a family) and is unaffected by per-port
  routing on the native-hosting side.

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

## Compatibility matrix

Audited and hardened for v0.26 (W268) against real-world macOS `Gamepad.id`
strings for Xbox, DualShock 4 (PS4), DualSense (PS5), 8BitDo, and Switch Pro.
`detectFamily` (§2.1) now prefers a vendor hex-id sniff (Chromium/Firefox-style
`Vendor: XXXX` / `XXXX-YYYY-name` tags) and falls back to name-substring
matching for platforms — notably macOS WKWebView — that report a bare product
name with no hex tag. `detectPlayStationModel` further distinguishes DualShock
4 vs DualSense within the `playstation` family (product hex `05c4`/`09cc` vs
`0ce6`) for surfaces that need the finer-grained pad model.

| Family | Detection | Nav (spatial-nav) | In-page play input | Native play input | Remap support | Glyphs |
|---|---|---|---|---|---|---|
| Xbox (wired + Bluetooth) | Vendor hex `045e`; name fallback `/xbox\|xinput/` | Standard mapping → full D-pad/stick/confirm/back/menu/quit | EmulatorJS reads the browser Gamepad API directly (own mapping) | `nativeInput.ts` `GAMEPAD_BINDINGS` (STANDARD_BUTTON indices) | Yes — `controller_bindings` overrides via Settings → Controllers | Ⓐ confirm / Ⓑ back / Ⓨ / Ⓧ / ☰ Menu / ⊗ Quit |
| DualShock 4 (PS4) | Vendor hex `054c` + product hex `05c4`/`09cc`; name fallback `/dualshock\|wireless controller/` | Same as Xbox (standard mapping) | Same (EmulatorJS's own mapping) | Same (`GAMEPAD_BINDINGS`) | Yes | ✕ confirm / ○ back / △ / □ / ☰ Options / ⊗ **Share** |
| DualSense (PS5) | Vendor hex `054c` + product hex `0ce6`; name fallback `/dualsense/` | Same as Xbox (standard mapping) | Same (EmulatorJS's own mapping) | Same (`GAMEPAD_BINDINGS`) | Yes | ✕ confirm / ○ back / △ / □ / ☰ Options / ⊗ **Create** |
| 8BitDo | Vendor hex `2dc8`; name fallback `/8bitdo/` | Same as Xbox (standard mapping; some older firmwares report a non-"standard" `Gamepad.mapping` — see degradation fallback below) | Same (EmulatorJS's own mapping) | Same (`GAMEPAD_BINDINGS`) | Yes | Ⓐ confirm / Ⓑ back / Ⓨ / Ⓧ / ☰ Menu / ⊗ Quit |
| Switch Pro | Vendor hex `057e`; name fallback `/switch pro\|pro controller\|nintendo/` | Same as Xbox, but confirm/back mirrored (physical A on the right — §2.2) | Same (EmulatorJS's own mapping) | Same (`GAMEPAD_BINDINGS`) | Yes | Ⓐ confirm / Ⓑ back / Ⓧ / Ⓨ / ☰ Menu / ⊗ Quit |
| Generic (unrecognized) | Fallback when no rule matches | Standard-mapping defaults (Xbox-style confirm/back) | Same (EmulatorJS's own mapping) | Same (`GAMEPAD_BINDINGS`) | Yes | Ⓐ confirm / Ⓑ back / Ⓨ / Ⓧ / ☰ Menu / ⊗ Quit |

**Tested id-string list** (data-driven cases in `actions.test.ts`):
- `Xbox Wired Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)`
- `Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)`
- `045e-0b13-Xbox Wireless Controller`
- `Xbox 360 Controller (XInput STANDARD GAMEPAD)`
- `Xbox One Controller`
- `DUALSHOCK 4 Wireless Controller`
- `Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4)`
- `Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)`
- `DualSense Wireless Controller`
- `DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)`
- `8BitDo SN30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6001)`
- `2dc8-6001-8BitDo SN30 Pro`
- `Pro Controller`
- `Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)`

**PlayStation touchpad (W278, TV system menu).** `STANDARD_BUTTON.touchpad`
(index 17) is a DualShock 4 / DualSense-only aux binding for `quit`, layered on
top of the table above rather than a new column: PlayStation pads open the TV
system menu (v0.28 "Living Room") with EITHER Select (like every other family)
OR a touchpad click — see §2.4 for the aux-binding mechanism. No other
recognised family reports a button at index 17.

**Non-standard mapping fallback.** `classifyMapping` (`actions.ts`) flags any
pad whose `Gamepad.mapping !== "standard"` (empty string, or any other
non-standard value some third-party/older firmware reports) as degraded.
`useGamepadPoll` still applies the best-effort STANDARD_BUTTON fallback (most
such pads are physically standard-shaped) so input is never silently dead, but
surfaces a one-per-family-per-session visible hint via `HintBar`'s
`mappingNotice` prop ("This controller didn't report a standard button
layout... remap in Settings → Controllers"), mirroring the play-path
degradation-notice pattern (`src/features/play/degradation.ts`).

**Navigability audit (this pass).** SearchPage was a known controller
dead-end (no elements registered with the spatial-nav registry) — fixed: the
query field, per-result filter field, run-search/toolbar/expand-collapse
actions, provider chips (+Add / Browse providers), provider group headers,
every result row (both provider-grouped and game-merged views), and the
selection-footer actions now register via `useFocusable`. `back` (B) is wired
globally in `App.tsx`'s `ShellControllerBindings` and applies to every route,
including Search. Consoles/Cores/Settings routes use native `<button>`/
`tabIndex` elements (keyboard-Tab reachable, not a dead end) but are **not yet
registered with the spatial-nav registry** for D-pad navigation — tracked as a
follow-up (see below) rather than fixed here, since it spans many files outside
this work item's file ownership and risks colliding with sibling W267's
Settings/Controllers-pane work.

## 7. Keyboard as an input method (W283)

Full keyboard-only operability is additive to (not a replacement for) the
gamepad model above: a user with no controller must be able to reach and
operate every screen, including TV mode (the system menu + embedded desktop
screens, v0.28 W278) and the gameplay menu overlay (v0.28 W279's hold/chord
affordance opens it from a gamepad; the keyboard reaches it via `Escape`, same
as before this work item — see below).

### 7.1 Two keyboard paths, by design

Two independent things already made most surfaces keyboard-reachable before
this work item, both worth naming explicitly since W283 only fills the
remaining gap:

1. **Native Tab order.** Every focusable control in this app is a real
   `<button>`, `<a>`, `<input>`, `<select>`, or an element carrying
   `tabIndex={0}` — never a `<div onClick>` with no keyboard path. Tab/
   Shift-Tab already reached almost everything, and Enter/Space already
   activate a focused native `<button>` for free (browser default behaviour,
   nothing to build).
2. **The semantic-action dispatch.** `ControllerProvider`'s exclusive-claim
   stack + spatial-nav engine (§3) already gives every SEMANTIC action
   (`nav_*`/`confirm`/`back`/`menu`/`quit`) one shared, correct routing table
   regardless of physical input source — but until W283 the ONLY thing that
   fed it was the gamepad poll (`useGamepadPoll`). TV mode's home/rails/hero
   (`TvHome`), the system menu (`TvSystemMenu`), and embedded screens
   (`TvEmbeddedScreen`) are driven entirely through this dispatch with no
   native Tab-order fallback of their own — so a keyboard-only user could
   reach nothing in TV mode at all before this work item.

### 7.2 The keyboard bridge (`useKeyboardNav`, `keyboardMap.ts`)

W283 closes gap 2 with one small ADDITIVE bridge, not a second dispatch
implementation:

```ts
// src/features/controller/keyboardMap.ts — pure, unit-tested
export function keyToSemanticAction(key: string): SemanticAction | null;
export function isNativeControlTarget(target): boolean; // input/textarea/select/contenteditable
export function isControlGuardExempt(key: string): boolean; // true only for Escape

// src/features/controller/useKeyboardNav.ts — the DOM listener
export function useKeyboardNav(opts: { dispatchAction; enabled? }): void;
```

Fixed layout (not configurable, not persisted, and NOT read from
`resolveBindings`/`controller_bindings` — a keyboard user gets one familiar
layout independent of any gamepad family/rebind state):

| Key | Semantic action |
|---|---|
| `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` | `nav_up` / `nav_down` / `nav_left` / `nav_right` |
| `Enter`, `Space` | `confirm` |
| `Escape` | `back` |

`menu`/`quit` have no dedicated key — every destination those actions gate
(the TV system menu, dialogs) already has an on-screen Tab/Enter-reachable
control (TvShell's ☰ Menu / Exit buttons, a dialog's own Cancel button), so a
second bespoke key would add nothing a keyboard user can't already do.

`ControllerProvider` exposes the exact function `useGamepadPoll`'s rising-edge
detector calls as `dispatchAction` on the context (`ControllerContextValue`) —
`useKeyboardNav` calls the SAME function, so the keyboard path automatically
gets the exclusive-claim stack, spatial nav, and screen-level action handlers
for free, with zero duplicated routing logic. Mounted once in `App.tsx`'s
`Root` (covers both `Shell` and `TvShell`, so it needs no per-screen wiring —
the same "one shared dispatch, every screen just works" property the gamepad
poll already had).

### 7.3 Guardrails against double-firing

Four deliberate checks in `useKeyboardNav` keep the bridge from stepping on
existing keyboard handling elsewhere in the app:

- **`e.defaultPrevented`** — a screen with its own local keyboard handling
  (e.g. `CoresPage`/`SystemList`'s ArrowLeft/Right column switch, a dialog's
  own Escape handler) already called `preventDefault()` on the SAME key by
  the time it reaches the window-level bridge; respecting that avoids a
  second, redundant semantic dispatch for a key a screen already fully owns.
- **Native control targets** — `isNativeControlTarget` skips arrows/Enter/
  Space while the event target is an `<input>`/`<textarea>`/`<select>`/
  contenteditable region, so normal text-cursor movement, native `<select>`
  arrow-cycling, and checkbox/radio Space-toggle are never hijacked.
  `Escape` is exempt from this guard (`isControlGuardExempt`) — closing an
  overlay/dialog must work regardless of which field inside it has focus,
  matching every existing per-dialog `onKeyDown` Escape handler already in
  this codebase (`CreateGamesFolderDialog`, `ProviderDialog`).
- **Native activation targets, `confirm` only** — `isNativeActivationTarget`
  skips dispatching `confirm` (Enter/Space) while the event target is itself
  a real `<button>`/`<a>`/`<summary>` (or an element carrying an activatable
  ARIA role: `button`/`link`/`menuitem`/`tab`), letting the browser's own
  click-on-Enter/Space fire instead. This matters well beyond avoiding one
  redundant call: MOST of this app's buttons (`CoresPage`, `SettingsPage`'s
  section tabs, every dialog's Cancel/Save button) never registered with the
  spatial-nav focus registry (`useFocusable`) — dispatching `confirm` through
  the semantic layer for one of those would look up whatever the
  CONTROLLER-focus registry separately thinks is focused (a stale id from a
  different screen, or nothing), not the button the user is actually looking
  at. Only `confirm` needs this check — arrows/Escape have no browser default
  to conflict with on a plain button.
- **`gameplayClaimActive` gates the whole bridge off** — `App.tsx` disables
  `useKeyboardNav` entirely while a player owns the gameplay exclusive claim
  (the same signal `useTvModeControllerToggle`/`useTvSystemMenuTrigger`
  already gate on). `NativePlayer`/`InPagePlayer` install their OWN complete
  keyboard handling for game input + the overlay while mounted (arrows/Enter
  move overlay selection, Escape opens/closes it) — this work item does not
  touch either file; running both listeners in parallel would double-fire
  overlay selection moves, so the global bridge steps aside entirely for the
  whole gameplay session instead.

### 7.4 Known pre-existing quirk (not introduced by W283)

A dialog that does not claim the controller's exclusive slot (e.g.
`CreateGamesFolderDialog`, `ProviderDialog`) has no screen-level `back`
handler installed while open, so a dispatched `back` action falls through to
`ShellControllerBindings`' global `back: () => navigate(-1)` — this was
already true for a GAMEPAD `back` press before W283 (both dialogs lacked an
exclusive claim already); the keyboard bridge's Escape key inherits the exact
same pre-existing behaviour rather than special-casing keyboard differently
from gamepad. Each dialog's own `onKeyDown` Escape handler still closes it
correctly in the same keystroke; the extra `navigate(-1)` is a latent,
unrelated quirk worth its own follow-up (give these dialogs an exclusive `ui`
claim, matching every other overlay in the app) rather than something to fix
as a side effect of this accessibility pass.

## Follow-ups (W268)

- Register Consoles/Cores/Settings' remaining interactive elements
  (`ConsolesPage`/`ConsoleDetailPage`/`CatalogBrowser`/`CoresPage`/`CoreRow`/
  `SystemList`/`SettingsPage` section nav + panes) with `useFocusable` so D-pad
  navigation reaches them directly, not just native Tab order. Scoped out of
  W268 to respect file ownership with sibling W267 (Settings → Controllers
  pane) — a dedicated follow-up work item should own the full-app spatial-nav
  registration audit.
- Live-hardware verification of the DualSense/DualShock 4 product-id sniff and
  the non-standard-mapping fallback on real 8BitDo/older-firmware pads (the
  spike note in §1 applies equally here — no gamepad hardware in CI).

## Follow-ups (W283)

- Give `CreateGamesFolderDialog`/`ProviderDialog` an exclusive `ui` claim (like
  every other overlay in the app) so `back`/Escape can't fall through to the
  shell's `navigate(-1)` while either is open (§7.4).
- `TvRail`'s windowed tile row has no `role="list"` — deferred (not required
  by the W283 acceptance criteria) since the windowed spacer `div`s need
  auditing for correct `aria-hidden` interaction with a real list role first.
