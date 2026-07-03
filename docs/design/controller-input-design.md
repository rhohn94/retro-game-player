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
