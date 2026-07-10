# Harmony UX Design — Screen Inventory (v0.1)

> **Up:** [↑ Design docs](README.md)

> **Status:** D3 deliverable. The v0.1 screen inventory for Harmony, consuming
> the design language fixed in [ux/design-language.md](ux/design-language.md) and
> the module/IPC map fixed in [architecture-design.md](architecture-design.md).
> Where this doc and the master contract disagree, the master contract wins.

## Motivation

The library/cores/search/settings/controller agents (W13–W17) each build one
screen against the shared Aura language. This doc gives each screen a fixed
archetype, a textual layout sketch, its key Aura components, controller-navigation
notes, and Framer Motion transition notes — so the screens merge into one
coherent, fully controller-operable app. **Full controller-only operability is a
v0.1 requirement**; every interactive element here is reachable and actionable
from a gamepad with no pointer.

## Scope

**Covered:** the five v0.1 screens (library grid + hero + detail, settings, cores
management, file search) plus the cross-cutting controller focus/hint overlay —
each with archetype, layout sketch, Aura components, controller nav, and Framer
Motion notes.

**Not covered:** brand-knob values, the submodule pin, anti-FOUC, and the
archetype catalog (those live in [ux/design-language.md](ux/design-language.md));
IPC command shapes (those live in [architecture-design.md](architecture-design.md));
the controller binding model + spatial-nav engine internals
(`controller-input-design.md`, W14).

---

## 0. Shell, controller model, and motion conventions (shared)

**Shell.** The router is wrapped by a persistent `<aura-app>` frame
(`src/App.tsx`). It hosts: the `HeroBackdrop` (behind everything, transparent over
native vibrancy), the routed screen, and a persistent **`HintBar`** footer
(`components/HintBar.tsx`, W14) showing the live controller button hints for the
focused context.

**Controller model (W14, `features/controller/`).** A spatial-navigation layer
tracks a single **focus** target and draws the `FocusRing` (brand-cyan,
`--aura-focus`). Semantic actions map to gamepad buttons via
`controller_bindings` (architecture §2.10): `nav_up/down/left/right` move focus,
`confirm` activates, `back` pops, plus screen-specific actions surfaced in the
HintBar. Every screen below lists its focus order and per-context hints. No screen
requires a pointer.

**Motion conventions (Framer Motion).** Crossfades and springs only — **NO blur
filters** (architecture §5.2: blur is native + the pre-blurred hero handoff, never
a CSS/JS filter). Route changes crossfade (opacity + small `y`/scale spring);
focus moves spring the `FocusRing` to the new target; the hero crossfades on
selection change. Respect `prefers-reduced-motion` by collapsing springs to short
opacity fades.

---

## 1. Library grid + hero — `/` (W13)

**Archetype:** Gallery / Media-grid. **Key IPC:** `list_games`, `get_blurred_hero`.

### Layout sketch
```
┌───────────────────────────────────────────────────────────┐
│  [ HeroBackdrop — pre-blurred art of the focused game ]    │  ← native vibrancy + crossfade
│   ┌─────────────────────────────────────────────────────┐ │
│   │  HERO: large cover + title + system + ▶ Play         │ │  ← focused game's detail teaser
│   └─────────────────────────────────────────────────────┘ │
│   System filter:  [All] [NES] [SNES] [N64]                 │  ← <aura-tabs>
│   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│   │tile│ │tile│ │tile│ │tile│ │tile│ │tile│   <aura-grid>  │  ← cover-art tiles
│   └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                │
│   ┌────┐ ┌────┐ ┌────┐ …                                   │
└───────────────────────────────────────────────────────────┘
│  HintBar:  ◀▶▲▼ Move   Ⓐ Open   Ⓨ Play   ☰ Settings        │
```

### Key Aura components
`<aura-grid>` of `<aura-card>` tiles (cover art via `Game.artPath`, placeholder
when null); `<aura-tabs>` for the system filter; the hero block is a composed
`<aura-card>` over the `HeroBackdrop`. Tiles use `--aura-shelf-alpha` so vibrancy
shows between them.

### Controller navigation
Focus order: system tabs → grid tiles (row-major wrap). `nav_*` moves tile focus;
moving focus **updates the hero** (and triggers `get_blurred_hero` for the new
backdrop). `confirm` opens Game detail; a screen action `Play` (`Ⓨ`) launches
directly. Edge-scroll: focus past the last visible row scrolls the grid. Tabs are
reachable by `nav_up` from the top row.

### Framer Motion
Hero **crossfades** (opacity, ~180ms) when the focused game changes; backdrop
crossfades when its blurred bitmap resolves. `FocusRing` springs between tiles.
Grid scroll is a spring. No blur filter — the soft backdrop is the native/pre-blur
layer only.

---

## 2. Game detail — `/game/:id` (W13)

**Archetype:** Detail / Focus. **Key IPC:** `get_game`, `get_blurred_hero`,
`launch_game`, `fetch_boxart`, `enrich_game`.

### Layout sketch
```
┌───────────────────────────────────────────────────────────┐
│  [ HeroBackdrop — this game's pre-blurred art ]            │
│   ◀ Back                                                   │
│   ┌──────────┐   TITLE (clean_name)                        │
│   │  COVER   │   System · DAT-matched ✓ · size             │
│   │  (card)  │   Core: <active core for system>            │
│   └──────────┘   ┌──────────┐ ┌──────────┐ ┌───────────┐   │
│                  │ ▶ Play   │ │ Get art  │ │ Enrich ✦  │   │  ← <aura-button>s
│                  └──────────┘ └──────────┘ └───────────┘   │
│   Metadata / Familiar enrichment panel  (<aura-list>)      │
└───────────────────────────────────────────────────────────┘
│  HintBar:  Ⓐ Play   Ⓧ Get art   Ⓑ Back                     │
```

### Key Aura components
`<aura-card>` cover; primary `<aura-button>` (Play) + secondary buttons (Get art,
Enrich); `<aura-list>` for metadata rows. Panel uses `--aura-panel-alpha`.

### Controller navigation
Focus order: Back → Play (default focus) → secondary actions → metadata rows.
`confirm` on Play → `launch_game`; `back` returns to the grid **restoring the prior
tile focus**. Enrich (`✦`) calls `enrich_game` and never blocks — failures are
silent per architecture §2.8.

### Framer Motion
Enter via **shared-element-style** crossfade from the grid hero (opacity + slight
scale spring) so the cover feels continuous. Button focus springs the `FocusRing`.
Enrichment rows fade in as data arrives. No blur.

---

## 3. Settings — `/settings` (W15)

**Archetype:** Settings / Sectioned-form. **Key IPC:** `get_settings`,
`update_settings`, `list_content_folders`/`add`/`remove_content_folder`,
controllers + providers + Familiar commands, `locate_retroarch`/`set_retroarch_path`.

### Layout sketch
```
┌───────────────────────────────────────────────────────────┐
│  Settings                                                  │
│  ┌───────────────┐  ┌──────────────────────────────────┐  │
│  │ • Folders     │  │  [ active section pane ]          │  │
│  │   Cores       │  │   <aura-field> rows + actions     │  │
│  │   Controllers │  │                                   │  │
│  │   Providers   │  │                                   │  │
│  │   Familiar    │  │                                   │  │
│  │   Appearance  │  │                                   │  │
│  │   RetroArch   │  │                                   │  │
│  └───────────────┘  └──────────────────────────────────┘  │
│        <aura-nav>              section panes               │
└───────────────────────────────────────────────────────────┘
│  HintBar:  ◀▶ Section  ▲▼ Field  Ⓐ Edit  Ⓑ Back            │
```

Section panes (grown well past the original six — `SettingsPage.tsx`'s
`SECTIONS` table is the source of truth): **Folders**, **Game Sources**,
**Cores** (deep-link to `/cores`), **Core Options**, **Controllers** (binding
editor, W14), **Providers** (search-provider CRUD), **Familiar** (probe status
+ base URL), **RetroAchievements**, **Playback**, **CRT Filter**,
**Performance**, **Appearance** (named-theme select — drives the anti-FOUC
theme), **RetroArch** (locate/set path). Each newer pane's own contract lives
in its dedicated design doc (`core-options-design.md`, `retroachievements-design.md`,
`crt-filter-design.md`, `performance-tooling-design.md`) rather than being
re-described here.

### Key Aura components
`<aura-nav>` left section list; `<aura-field>` for each setting (text, toggle,
select — wired via the typed wrappers, **not** React `onChange`, per
[ux/design-language.md §7](ux/design-language.md)); `<aura-button>` for row
actions; `<aura-dialog>` for folder-picker confirmations.

### Controller navigation
Two-column focus: `nav_left/right` switches the focused **column** (section nav ↔
pane); within the pane `nav_up/down` moves between fields; `confirm` edits/toggles;
`back` returns to section nav, then to the grid. The Appearance theme select
applies immediately and persists so the next cold start's anti-FOUC script reads it.

### Framer Motion
Section-pane swap is a **crossfade + small x-slide spring**; toggles spring their
knob; dialogs scale-fade in. No blur.

---

## 4. Cores management — `/cores` (W16)

**Archetype:** Management / Table-master-detail. **Key IPC:**
`list_available_cores`, `list_installed_cores`, `install_core`, `update_core`,
`set_active_core`.

### Layout sketch
```
┌───────────────────────────────────────────────────────────┐
│  Cores                                                     │
│  ┌──────────────┐  ┌─────────────────────────────────────┐│
│  │ Systems      │  │  Cores for <selected system>        ││
│  │ • NES        │  │  ┌─────────────────────────────────┐││
│  │   SNES       │  │  │ mesen   v… ● active  [Set][Upd] │││
│  │   N64        │  │  │ fceumm  v… ○ install [Install]  │││
│  └──────────────┘  │  └─────────────────────────────────┘││
│                    └─────────────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
│  HintBar:  ▲▼ Core  Ⓐ Set active  Ⓧ Install/Update  Ⓑ Back │
```

### Key Aura components
Master `<aura-list>`/`<aura-nav>` of systems; detail `<aura-list>` of cores with
status badges (active ●, available ○, installed) and inline `<aura-button>`s
(Install / Update / Set active). Long actions show an `<aura-progress>` / spinner.

### Controller navigation
`nav_left/right` switches master ↔ detail; `nav_up/down` moves within the focused
list; `confirm` = primary action (Set active); a screen action (`Ⓧ`) =
Install/Update for the focused core. `set_active_core` updates the active badge in
place (exactly-one-active per system, architecture §3). `Dependency`/`Network`
errors surface as an inline `<aura-card>` notice, never a crash.

### Framer Motion
Status-badge change springs (scale pulse); install progress is a determinate
spring bar; master→detail focus crossfades. No blur.

---

## 5. File search — `/search` (W17)

**Archetype:** Search / Query-results. **Key IPC:** `list_providers`,
`add`/`update`/`remove_provider`, `run_search`.

### Layout sketch
```
┌───────────────────────────────────────────────────────────┐
│  Search   [ query field…                    ] (Ⓐ run)      │  ← <aura-field>
│  Providers: [✓ Provider A] [✓ Provider B] [+ Add]          │  ← provider chips
│  ┌─────────────────────────────────────────────────────┐  │
│  │ Provider A                                           │  │
│  │   • Result title …………………… (opens link in browser)   │  │
│  │   • Result title …………………………………………………………………           │  │
│  │ Provider B                                           │  │
│  │   • Result title …………………………………………………………………           │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
│  HintBar:  Ⓐ Run / Open link  ☰ Providers  Ⓑ Back          │
```

**Links only** — `run_search` returns URLs; selecting a result opens it in the
external browser. Harmony never downloads (architecture §2.5).

### Key Aura components
`<aura-field>` query input (wired via typed wrapper); provider toggle chips +
`<aura-dialog>` for add/edit provider (name + `urlTemplate` with `{query}`);
provider-grouped `<aura-list>` of results.

### Controller navigation
Focus starts in the query field; an on-screen / system text-entry affords
gamepad typing (controller-only requirement). `confirm` runs the search; focus then
moves into the results list (`nav_up/down`, grouped by provider); `confirm` on a
result opens its link. A context action (`☰`) opens provider management. `back`
clears focus to the query field, then exits.

### Framer Motion
Results **fade/stagger in** per provider group as `run_search` resolves; the query
field focus springs; the add-provider dialog scale-fades. No blur.

---

## 6. Controller focus / hint overlay — cross-cutting (W14)

**Archetype:** Shell / App-frame (the HintBar) + Overlay / Dialog (the transient
hint sheet). **Key IPC:** `list_bindings`, `set_binding`.

### Layout sketch
```
   … any screen …
┌───────────────────────────────────────────────────────────┐
│  [ FocusRing drawn around the current focus target ]       │  ← brand-cyan, springs
│                                                            │
│        ┌─────────────────────────────┐                     │
│        │  HINT OVERLAY (on hold/help)│                     │  ← <aura-dialog> sheet
│        │   Ⓐ Confirm   Ⓑ Back   …    │                     │
│        └─────────────────────────────┘                     │
└───────────────────────────────────────────────────────────┘
│  HintBar (persistent):  context-specific button hints      │
```

### Key Aura components
The persistent **HintBar** is a `components/HintBar.tsx` region inside `<aura-app>`
chrome; the transient **hint overlay** is an `<aura-dialog>` sheet; glyphs come
from a device-family glyph set keyed by `ControllerBinding.deviceFamily` (xbox /
playstation / 8bitdo / switchpro). The `FocusRing` (`components/FocusRing.tsx`)
draws the spatial-nav focus state.

### Controller navigation
This layer **is** the navigation: it owns focus, maps buttons → semantic actions
via `list_bindings`, and renders the live hints for the active screen context.
Holding `help` (or a long-press) raises the hint overlay listing all current
context actions with the correct device glyphs. The binding editor (in Settings →
Controllers) uses `set_binding` and is itself fully controller-operable.

### Framer Motion
`FocusRing` springs between targets (position + size). Hint overlay scale-fades in;
HintBar hint set crossfades when the focused context changes. Glyphs swap with a
quick crossfade when the active device family changes. No blur.

---

## 7. Cross-links

- Design language (Aura, brand knobs, archetypes, friction): [ux/design-language.md](ux/design-language.md)
- Master contract (modules, IPC, schema, seams): [architecture-design.md](architecture-design.md)
- Controller binding model + spatial-nav engine (W14): `controller-input-design.md`
- Library identification (W6/W13): `library-identification-design.md`
- Core management (W5/W16): `core-management-design.md`
- File search (W9/W17): `file-search-design.md`
- Native vibrancy seam (D2): `native-vibrancy-design.md`

---

## 8. Keyboard accessibility — cross-cutting (W394)

Issue #29 (filed 2026-07-02) proposed a global `:focus-visible` treatment plus
a keyboard pass over Library/Search/Settings/Detail. Two things shipped
first: **W283** gave every native focusable element a token-driven focus ring
app-wide (`src/theme/focus-visible.css` — reused here, never re-implemented,
per its own doc comment); **v0.38** ("Better with a keyboard") made TV menus,
dialogs, and **Settings** properly focusable/escapable with correct
screen-reader rail tracking. **W394** is the remainder: a keyboard-operability
+ ARIA pass over the three routes v0.38 didn't touch — **Library** (`/`),
**Search** (`/search`), and **Game Detail** (`/game/:id`).

**Escape convention (shared with §0/§6's controller model).** Keyboard Escape
and controller Back/Quit are the SAME semantic action (`useKeyboardNav`,
W283, `controller-input-design.md` §Keyboard as an input method) — a plain
`Escape` keydown maps to `back` and is dispatched through the identical
`ControllerProvider.dispatchAction` path a gamepad's Back button drives. An
overlay that wants Escape to close ITSELF (not fall through to the shell's
default `back` handler, which is `navigate(-1)` in `App.tsx`) must claim the
controller's exclusive `"ui"` slot for its open lifetime (`claimExclusive`,
the `TvSystemMenu`/`CreateGamesFolderDialog` precedent) — claims layer, so a
dialog opened from within an already-open panel (e.g. `DeleteCollectionDialog`
from inside `CollectionPicker`) correctly closes only the topmost one first.
W394 found and closed two gaps in this convention:

- **`CollectionPicker`'s dropdown panel** never claimed the exclusive slot, so
  Escape while it was open fell through to `navigate(-1)` — unexpectedly
  leaving the Game Detail page instead of just closing the picker. Fixed with
  the same claim + local `onKeyDown` pattern used everywhere else, with one
  addition: mid-rename, the first Escape cancels the rename (matching the
  already-shipped inline-cancel behavior) and only a second Escape closes the
  panel — nested-overlay Escape semantics, not a flat close.
- **`ProviderCatalog`** (Search's "Browse providers" sheet) had no Escape
  handling at all, unlike its sibling `ProviderDialog` (add/edit provider),
  which already implemented the convention. Fixed identically.

**ARIA roles audited.** `AchievementList.tsx` already carries a defensive
`role="list"` on its `<ul>` (v0.38 W384) because Safari/WebKit — the exact
engine Tauri's macOS WKWebView uses — drops a native `<ul>`'s implicit list
semantics once `list-style: none` is applied, unless `role="list"` is
present. That fix was never carried into Search's own result lists (also
`list-style: none`, for the same layout reasons): `MergedResultsView`'s
merged-results list and its per-row "available from N providers" expansion,
`ProviderResultGroup`'s per-provider row list, `ProviderDialog`'s
discovered-providers list, and `ProviderCatalog`'s catalog-entries list all
picked up `role="list"` (plus an `aria-label` on the two ambiguous nested
lists) to close the same gap. Separately, `CollectionPicker`'s dropdown panel
carried `role="menu"` despite containing checkboxes and text inputs — not a
valid ARIA menu (the APG menu pattern expects arrow-key/`menuitem` navigation,
not native Tab-order form controls) — corrected to `role="group"` with an
`aria-label` and an `aria-controls` link from its toggle button, a plain
disclosure-panel semantic that matches what the DOM actually is. The Library
system-filter tabs (`LibraryFilters.tsx`) already carry the correct
`role="tablist"`/`role="tab"`/`aria-selected` trio and were left as-is — no
other tabbed region exists on these three routes, and Search has none at all.

**A keyboard/mouse activation gap, found via a live end-to-end check (not
just unit tests).** `FocusableControls.tsx`'s `FocusableAction`, used with a
custom `render` prop, hands the caller an `onClick` that ONLY claims
controller focus (`useFocusable`'s `focus`) — the real action fires
separately, via the controller's own `confirm` semantic dispatch once that id
is the tracked focus (see `ResultsToolbar`'s checkbox/Expand-all/Collapse-all
usages, which correctly call the real handler alongside `onClick` in their
own wrapper). Two Search controls hadn't picked up that second half:
`SearchQueryBar`'s **Search** button and `ProviderChipsBar`'s **+ Add** /
**⊞ Browse providers** buttons passed the bare focus-claiming `onClick`
straight through. Concretely, this meant a mouse click OR keyboard Tab+Enter
on any of these three buttons did nothing at all — silently, since a
contained-less `<aura-button>`'s own Enter/Space handling calls `this.click()`
(re-firing the SAME inert `onClick`), and the global keyboard bridge yields to
that as "the native control's own activation" (`keyboardMap.ts`'s
`isNativeActivationTarget`) rather than double-dispatching. Only a real
gamepad's confirm button worked, because `useGamepadPoll`'s rising edge calls
the registered `onActivate` directly, bypassing the DOM click path entirely.
This was invisible to the existing component tests (which exercise
`dispatchAction` directly, not a real click) and was only caught by driving
the built bundle in a real headless browser end-to-end. Fixed by having each
button's `onClick` also invoke the real handler, mirroring the already-correct
`ResultsToolbar` precedent — verified with a live click in the same harness
post-fix, plus new `SearchQueryBar.test.tsx` / `ProviderChipsBar.test.tsx`
regression coverage.

**Deferred:** the same `FocusableAction`-with-custom-`render` shape is used
elsewhere in the app (Settings/Cores are out of this item's scope per its
release-plan boundary); whether any of those call sites have the identical
gap is worth a follow-up sweep rather than a blind fix, since some (like the
checkbox toggles here) correctly own their own activation via a native
`onChange` and must NOT also get a redundant `onClick` call.

## Implementation (W13)

The library grid + hero + detail screens are implemented under
`src/features/library/`:

- **`LibraryPage.tsx`** (`/`) — gallery archetype. Loads `list_games`, renders a
  responsive `<aura-card>` tile grid (`.harmony-grid`, `auto-fill`), a system
  filter (focusable tab-pills; `<aura-tabs>` was deferred because its
  selection-event contract is undocumented in the pinned Aura — pills keep the
  screen controller-focusable today), and a hero teaser. Focusing/hovering a tile
  updates the hero + backdrop.
- **`GameDetailPage.tsx`** (`/game/:id`) — detail archetype. `get_game` → cover +
  metadata `<aura-list>`-style rows; primary **Play** (`launch_game`), secondary
  **Get art** (`fetch_boxart`), Back (`navigate(-1)`). Enters via an
  opacity+scale spring.
- **`HeroBackdrop.tsx`** — full-bleed pre-blurred art from `get_blurred_hero`,
  **crossfaded** via Framer Motion `AnimatePresence` on selection change. No CSS
  blur — the bitmap is the backend's pre-blurred handoff, only scaled + dimmed.
- **`useBoxart.ts`** — cover-art resolution with graceful fallback:
  `Game.artPath` → `get_cached_art` → (detail only) `fetch_boxart` → placeholder.
- **`art.ts`** — `convertFileSrc` wrapper turning filesystem art paths into
  webview asset URLs; degrades to `null` (placeholder) outside the Tauri webview.
- **`library.css`** — feature styles in the `harmony-theme` override layer;
  translucent `--aura-shelf/panel-alpha` shelves (vibrancy reads through), visible
  `--aura-focus` rings on every focusable control (controller-nav-ready ahead of
  W14), and a `prefers-reduced-motion` collapse.

Aura wrappers use the `events`/`class` contract (never `onChange`/`className`).
Routing: `routes.tsx` swaps the W13 placeholder for `<LibraryPage />` at `/` and
adds `{ path: "/game/:id", element: <GameDetailPage /> }`; `App.tsx` is unchanged
(each screen self-mounts its `HeroBackdrop`).

**Resolved open question:** the `/` hero is a *lighter* teaser component
(`HeroTeaser`), not the full detail component — keeping the grid cheap.
## Implementation (W16)

W16 delivers the Cores Management screen at `/cores` as `src/features/cores/`.

**Files added:**
- `src/features/cores/useCores.ts` — data-fetching hook; calls `listAvailableCores`,
  `installCore`, `updateCore`, `setActiveCore` from `src/ipc/cores.ts`; groups cores
  by system; tracks per-core `"installing" | "updating" | "activating" | null` action
  state and per-core error (arch-rejection or network).
- `src/features/cores/CoresPage.tsx` — two-column master–detail layout; ArrowLeft/Right
  switches focused column (controller nav_left/right); auto-selects the first system on
  load; crossfades the detail pane with `AnimatePresence` on system change.
- `src/features/cores/CoreRow.tsx` — one row per core; shows id, version, status badge
  (● active / ○ installed / – available), inline action buttons (Install / Update /
  Set active), a CSS spinner while a long action is in flight, and an inline error card
  for `Unsupported` (non-arm64) or network failures.
- `src/features/cores/CoreRowList.tsx` (added W366) — maps a `Core[]` to `CoreRow`s,
  wiring each row's install/update/activate callbacks; extracted from two identical
  mapping blocks that used to live inline in `CoresPage.tsx`.
- `src/features/cores/SystemList.tsx` — focusable system list; ArrowUp/Down navigates
  within the list; selection drives the detail pane.
- `src/features/cores/cores.css` — `cores-spin` keyframe; focus-ring wiring for
  keyboard/controller nav; translucent shelf hover style.
- `src/features/cores/index.ts` — barrel exporting `CoresPage`.

**Shared-file edits:**
- `src/routes.tsx`: added `import { CoresPage } from "./features/cores";` and swapped
  the `/cores` placeholder element from `<Placeholder title="Cores" owner="W16" />` to
  `<CoresPage />`.

**Design decisions:**
- Status badge transition uses Framer Motion `layout="position"` so the badge springs
  in place when `setActiveCore` flips the active flag (exactly-one-active per system
  enforced by the W3 partial-unique index on the Rust side).
- Arch-rejection (`AppError.kind === "unsupported"`) surfaces as the inline error card
  on the affected row, never a crash or modal.
- `AnimatePresence mode="wait"` on the detail column prevents a flash when switching
  systems quickly.
- No blur filters anywhere (architecture §5.2).

## Open questions

- Gamepad text-entry mechanism for the search query + provider URL templates
  (on-screen keyboard vs. macOS dictation) — resolve in W14/W17.
- Whether the hero teaser on `/` reuses the full Game-detail component or a
  lighter variant — resolve in W13.

## Implementation (W15)

`src/features/settings/SettingsPage.tsx` — two-column sectioned-form archetype.

**Section nav (left column):** native `<nav>` with a `<button>` per entry in the
`SECTIONS` table (tabIndex for controller focus; 13 sections as of v0.37 —
see the list above). Active section highlighted with `--aura-primary`
background.

**Section panes (right column, original W15 set):**

- **Folders** (`FoldersPane`): lists `ContentFolder[]` via `listContentFolders()`; add
  path via text input → `addContentFolder()` then `scanFolder()` immediately; remove via
  `removeContentFolder()`; rescan per folder via `scanFolder()`. Scan result summary shown inline.
- **Cores** (`CoresPane`): groups installed cores by system via `listInstalledCores()`; per-system
  `<AuraSelect>` drives `setActiveCore()`. Deep-link to `/cores` available to install new cores.
- **Controllers** (`ControllersPane`): stub placeholder — the binding editor is W14
  (`controller-input-design.md`). Pane text explains the dependency.
- **Providers** (`ProvidersPane`): CRUD for `SearchProvider` via `listProviders()`,
  `addProvider()`, `updateProvider()` (toggle enabled), `removeProvider()`. URL templates
  validated for `{query}` placeholder before save.
- **Familiar** (`FamiliarPane`): probes status via `probeFamiliar()` on mount; editable
  base URL + API key inputs. Key sent via `invoke("save_familiar_config", …)` and immediately
  cleared from state — never stored client-side (W12 contract). Key reaches Keychain via the
  familiar backend.
- **Appearance** (`AppearancePane`): `<AuraSelect>` + quick-select buttons wired to
  `useAuraTheme().setTheme()`. Applies immediately; persists to `localStorage` via `AuraProvider`
  so the anti-FOUC head script reads it on next cold start.
- **RetroArch** (`RetroArchPane`): loads current path via `invoke("get_retroarch_path")` (silent
  degrade if command not yet wired); saves via `invoke("set_retroarch_path", { path })`.

**IPC:** all domain reads/writes go through the existing typed wrappers in `src/ipc/`; the
settings pane uses `src/ipc/invoke` directly only for `save_familiar_config`,
`get_retroarch_path`, and `set_retroarch_path` (domain-level wrappers for these will land when
W4/the settings backend finalises).

**Routing:** `src/routes.tsx` updated — the `/settings` entry now imports and renders
`<SettingsPage />` instead of the W15 placeholder.

**Aura usage:** `AuraButton`, `AuraField`, `AuraSelect` from `@aura/react`; `events`/`class`
contract followed on all Aura wrappers; native HTML elements use `className`.
