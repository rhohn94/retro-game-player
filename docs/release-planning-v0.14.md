# Release Planning — v0.14

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.14.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.14` |
| **Previous** | `v0.13` (Reveal — asset protocol / image loading) |
| **Theme** | "Lounge" — the couch / big-picture experience: navigate the whole UI with a controller, fill the screen, and read each console's hardware at a glance. First of three grouped releases in the 8-feature program. |

Three UI-layer features, all independent and low-risk. Closes program items
#1 (controller navigation), #2 (fullscreen), #5 (console hardware specs).
Design: [`presentation-shell-design.md`](design/presentation-shell-design.md).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W141** | Controller navigation of the UI | The built-but-unwired W14 controller stack is connected: the sidebar nav and library tiles register as spatial-focus targets, `confirm` activates, and a global `back` handler backs out. Controller focus mirrors to native DOM focus (ring + scroll-into-view). Mouse/keyboard paths unchanged. |
| **W142** | Fullscreen experience | The Harmony window toggles OS fullscreen via F11 and a focusable sidebar button (`useFullscreen` + `core:window:allow-set-fullscreen`/`is-fullscreen`). No-op outside a Tauri webview. |
| **W143** | Console hardware specs | `ConsoleInfo` gains `cpu`/`gpu`/`ram` (static, all 20 consoles, none blank — tested); threaded through `ConsoleDto` → `ipc/console.ts` → a "Hardware" table on the console detail page. No DB migration (static facts). |

---

## 3. Strategy

In-session, grouped release (per the user's "group related features" choice).
Each feature is additive and isolated: specs extend the static catalog, fullscreen
adds a guarded window hook + capability, and controller wiring connects the
existing engine to the shell + library without touching the pure spatial/action
modules. Full gates before merge; fullscreen + controller verified in the real
app (the mock-IPC smoke harness can't exercise the window API or a gamepad).

## 4. Out of scope

- Wiring every control on Cores / Search / Settings as controller-focusable —
  v0.14 delivers the core nav loop (sidebar ↔ library ↔ detail + Back); other
  screens stay mouse/keyboard-operable and can register focusables later.
- Controller rebinding UI (the binding engine + persistence already exist).
- In-game / RetroArch overlay and fullscreen-during-play — that's v0.15.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W141 — controller navigation | feat/v0.14-presentation | ☑ | `FocusableNavItem` + `GameTile` register via `useFocusable`; `ShellControllerBindings` sets global `back`; native-focus mirroring for ring + scroll. |
| W142 — fullscreen | feat/v0.14-presentation | ☑ | `useFullscreen` hook (F11 + focusable button); `core:window` fullscreen capabilities; guarded for non-Tauri. |
| W143 — console specs | feat/v0.14-presentation | ☑ | `cpu`/`gpu`/`ram` on `ConsoleInfo` (20 consoles, tested non-empty) → DTO → TS → Hardware table; smoke asserts "Hardware". |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.14 → dev | ☑ | merged `--no-ff`; gates green |
| dev → main promoted + tagged v0.14 | ☑ | |
| deployed | ☑ | /Applications/Harmony.app + deployed-apps/current at 0.14.0 |
| pushed to origin | ☑ | main + dev + tag v0.14 (fast-forward, no force) |
