# Settings navigation shell

> **Up:** [↑ Design index](README.md)

## Motivation

Every individual Settings pane has its own design doc (behavior, IPC
surface, acceptance criteria), but the shell that hosts them —
`SettingsPage.tsx`, the two-column section-nav container — never got one.
This doc covers the shell itself: the section list, the nav/pane wiring, and
the one piece of pure logic (`remap.ts`) that lives alongside the shell
rather than inside a single pane. Pane *behavior* is intentionally not
restated here — each pane's doc (linked below) remains the authoritative
source for it.

## Scope

**In scope:** `src/features/settings/SettingsPage.tsx` (the two-column
shell, the `SectionId` union, cross-pane navigation) and
`src/features/settings/remap.ts` (pure press-to-rebind/conflict logic used
by `ControllersPane.tsx`).

**Out of scope:** individual pane behavior — see the per-pane pointers
below and each pane's own design doc.

## Design

### Archetype

Sectioned-form ([harmony-ux-design.md](harmony-ux-design.md) §3): a fixed
left-hand section list and a single right-hand pane that renders whichever
section is active. `SettingsPage` owns exactly one piece of state — the
active `SectionId` — and switches panes via a plain `switch` in the
module-local `SectionPane` component; no router, no per-pane mount/unmount
lifecycle beyond React's own.

### Two-column layout

Left column: `<nav role="tablist" aria-orientation="vertical">` — one
`role="tab"` button per section, `aria-selected`/`aria-controls` wired to
the matching `role="tabpanel"` on the right. This is real ARIA tab
semantics (not page navigation dressed up as tabs) so a screen reader
announces section switches correctly. Every nav button and the active
tabpanel carry `tabIndex={0}` so the app's spatial-nav engine can reach
them like any other focusable control — no separate controller-only nav
path.

Right column: the active pane, `id`/`aria-labelledby` matched to its tab.
Panes read/write exclusively through their own domain IPC wrapper — the
shell itself never makes a raw `invoke` call.

### Section list

`SECTIONS: Section[]` (`{ id: SectionId; label: string }[]`) is the single
source of truth for nav order and labels; `SectionId` is a closed string
union so an unhandled pane is a compile error, not a silent blank panel.
Adding a pane means: add its `SectionId` variant, add a `SECTIONS` row, add
its `case` in `SectionPane`, and create the pane component under `./panes/`.

### Cross-pane navigation

Panes are otherwise siloed, but one exception is threaded through
deliberately: `CoresPane` can jump the user straight to `CoreOptionsPane`
(e.g. "configure this core's options" from a core row) via an
`onOpenCoreOptions` callback that `SectionPane` wires to
`onNavigate("core-options")`, which is `SettingsPage`'s own `setActive`.
This is the shell's only inter-pane coupling; it stays a plain callback
prop rather than a shared nav store since it's a single fixed jump, not a
general routing need.

### `remap.ts` — pure rebind logic

`ControllersPane.tsx` hosts the full press-to-rebind editor
([controller-input-design.md](controller-input-design.md) §Remapping UI),
but the merge/conflict logic behind it lives in `remap.ts`, deliberately
separated from the pane so it needs no DOM, no Gamepad API, and no IPC to
unit-test (`remap.test.ts`):

- `bindingRows(bindings)` — builds the ordered table of `{ action,
  buttonIndex }` rows the pane renders for one `BindingMap`.
- `findConflict(bindings, action, buttonIndex)` — finds another action
  already bound to a captured button (excluding the sentinel `UNBOUND`
  index, `-1`), or `null` when the button is free.
- `applyRebind(bindings, action, buttonIndex, resolution?)` — pure merge:
  no conflict → the action simply takes the button; conflict + `"swap"` →
  the two actions trade buttons; conflict + `"clear"` → the losing action
  becomes `UNBOUND`; conflict + no `resolution` → returns an unchanged copy
  (the pane must ask the user to choose before calling again). Always
  returns a new object.
- `diffBindings(from, to)` — the minimal set of changed `(action, button)`
  rows between two maps, so a rebind persists only what actually changed.
- `buttonIndexToStoredName` / `buttonDisplayLabel` — translate a raw
  Gamepad API button index to, respectively, the token `setBinding`
  persists and a human-readable label (named `STANDARD_BUTTON` indices get
  their key, e.g. `dpadUp` → "Dpad Up"; anything else falls back to the
  plain index).

`ControllersPane.tsx` is the module's only impure caller (DOM, Gamepad API
polling, IPC persistence); `remap.ts` itself imports nothing from React or
Tauri.

## Panes hosted

Each row is the shell's `SectionId` → the pane component → the design doc
that owns its behavior. [harmony-ux-design.md](harmony-ux-design.md)
§Implementation (W15) is the original shell writeup from the W15 release
that introduced `SettingsPage.tsx`; it's cited below for the panes it still
accurately describes (Folders, Cores, Appearance), but is a point-in-time
record, not a living doc — it predates, and is now superseded by, the
per-pane docs listed for every section that has since grown its own
(Controllers, Core Options, CRT Filter, Performance, RetroAchievements,
Familiar, Game Sources). This doc is the current source of truth for the
shell itself.

| Section | Pane component | Behavior documented in |
|---|---|---|
| Folders | `FoldersPane.tsx` | [harmony-ux-design.md](harmony-ux-design.md) §Implementation (W15) |
| Game Sources | `GameSourcesPane.tsx` | [non-retro-library-design.md](non-retro-library-design.md) §UI (Steam/GOG/itch/CrossOver scans, Apps confirm-gate, manual entry, SteamGridDB key) |
| Cores | `CoresPane.tsx` | [harmony-ux-design.md](harmony-ux-design.md) §Implementation (W15) |
| Core Options | `CoreOptionsPane.tsx` | [core-options-design.md](core-options-design.md) |
| Controllers | `ControllersPane.tsx` | [controller-input-design.md](controller-input-design.md) §Remapping UI |
| Providers | `ProvidersPane.tsx` | [provider-discovery-design.md](provider-discovery-design.md) (catalog + custom-template CRUD) |
| Familiar | `FamiliarPane.tsx` | [familiar-enrichment-design.md](familiar-enrichment-design.md) |
| RetroAchievements | `RetroAchievementsPane.tsx` | [retroachievements-design.md](retroachievements-design.md) |
| Playback | `PlaybackPane.tsx` | [performance-tooling-design.md](performance-tooling-design.md) (hosts the FPS-counter toggle) |
| CRT Filter | `CrtFilterPane.tsx` | [crt-filter-design.md](crt-filter-design.md) |
| Performance | `PerformancePane.tsx` | [performance-tooling-design.md](performance-tooling-design.md) |
| Appearance | `AppearancePane.tsx` | theme selection: [harmony-ux-design.md](harmony-ux-design.md) §Implementation (W15); "Start in TV mode" toggle: [tv-mode-design.md](tv-mode-design.md) §Auto-enter |
| RetroArch | `RetroArchPane.tsx` | [emulation-launch-design.md](emulation-launch-design.md) (RetroArch binary locate/path config) |

## Acceptance

- Every `SectionId` variant has a matching `SECTIONS` entry and a
  `SectionPane` case — an unhandled variant fails to compile.
- Nav buttons and the active pane are keyboard/controller-reachable
  (`tabIndex={0}`) and expose correct `role="tab"`/`role="tabpanel"` ARIA
  wiring, including `aria-selected` tracking the active section.
- `remap.ts` has no DOM/Gamepad API/IPC imports and is fully covered by
  `remap.test.ts` without mounting `ControllersPane`.
- `CoresPane`'s "configure options" affordance lands on the Core Options
  pane via `onOpenCoreOptions`/`onNavigate`, not a separate route.

## Open questions

None outstanding.

## Follow-ups

- `FoldersPane`, `CoresPane`, and `AppearancePane` still lean on
  [harmony-ux-design.md](harmony-ux-design.md)'s W15 implementation record
  rather than a doc of their own. That record is otherwise stale (it still
  describes `ControllersPane` as a stub and documents raw `invoke()` calls
  the codebase has since wrapped in typed IPC modules), so splitting these
  three panes out into a standalone, current doc — or refreshing the W15
  section in place — is a candidate follow-up if any of them grows enough
  behavior to justify it.
