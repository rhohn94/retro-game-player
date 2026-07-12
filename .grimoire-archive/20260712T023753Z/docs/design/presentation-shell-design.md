# Presentation shell — controller nav, fullscreen, console specs (v0.14 "Lounge")

> Status: implemented (v0.14). Groups three UI-layer features that make Harmony
> pleasant in a couch / big-picture setting: controller navigation of the shell,
> an OS-fullscreen toggle, and a hardware-specs table on each console.

## 1. Controller navigation (#1)

The W14 controller stack (`src/features/controller/`) was fully built —
gamepad polling, a pure spatial-nav engine, semantic-action mapping, per-device
glyph hints — but **never wired into any screen**: `useFocusable` and
`setActionHandlers` had zero callers, so D-pad / stick input moved nothing in
the live app. v0.14 connects it:

- **Sidebar** (`App.tsx` `FocusableNavItem`) — each primary-nav link registers
  via `useFocusable(\`nav:${path}\`, () => navigate(path))`. When the controller
  moves focus to an item we mirror it to native DOM focus (`ref.focus()`) so it
  scrolls into view and shows the ring; `confirm` navigates.
- **Library grid** (`GameTile`) — each tile registers as `game:${id}`;
  `confirm` opens the detail page, and native focus mirroring fires the existing
  `onFocus` → hero crossfade.
- **Global Back** (`ShellControllerBindings`) — registers a screen-level `back`
  handler (`navigate(-1)`) so the controller's B button always backs out.

The spatial engine is geometry-based over one shared registry, so the sidebar
(left of the content) is reachable by `nav_left` from the grid and vice-versa.
Mouse and keyboard paths are unchanged — the controller is additive.

**Scope:** v0.14 wires the core navigation loop (sidebar ↔ library ↔ detail +
Back). Progressive enhancement of every control on Cores / Search / Settings is
deferred; those screens stay mouse/keyboard-operable and can register focusables
incrementally without touching the engine.

## 2. Fullscreen experience (#2)

`src/features/shell/useFullscreen.ts` toggles the Harmony window in/out of OS
fullscreen via Tauri's window API (`getCurrentWindow().setFullscreen`), gated by
the new `core:window:allow-set-fullscreen` + `core:window:allow-is-fullscreen`
capabilities. Triggers:

- **F11** anywhere (global `keydown`).
- **A focusable sidebar button** (`FullscreenButton`) — so the toggle is also
  reachable by controller.

The hook is guarded (dynamic `import("@tauri-apps/api/window")` in a try/catch),
so it is a silent no-op outside a Tauri webview (tests / headless inspection).
`Escape` is intentionally NOT bound here — it is reserved for the in-game overlay
(v0.15).

## 3. Console hardware specs (#5)

`ConsoleInfo` (`core/console/catalog.rs`) gains `cpu` / `gpu` / `ram` as static
`&'static str` fields (RAM spans bytes→MB across the retro era, so a display
string is cleanest). All 20 consoles are populated with accurate figures; a test
asserts none is blank. The values flow through `ConsoleDto` → `ipc/console.ts`
→ a `<table class="harmony-specs">` rendered in a new "Hardware" section on
`ConsoleDetailPage`. No DB migration — these are fixed hardware facts, kept in
code alongside the rest of the static catalog (the DB stays reserved for
fetched/cacheable Wikipedia media).

## Verification

- Headless smoke renders the Hardware table (the `console-detail` route now
  asserts on "Hardware").
- Fullscreen + controller focus require the real Tauri window (+ a gamepad for
  nav), so they are verified in the running app, not the mock-IPC smoke harness.
