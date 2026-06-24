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

Section panes: **Folders** (add/remove content folders, rescan), **Cores**
(deep-link to `/cores`), **Controllers** (binding editor, W14), **Providers**
(search-provider CRUD, deep-link/inline), **Familiar** (probe status + base URL),
**Appearance** (named-theme select — drives the anti-FOUC theme), **RetroArch**
(locate/set path).

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

## Open questions

- Gamepad text-entry mechanism for the search query + provider URL templates
  (on-screen keyboard vs. macOS dictation) — resolve in W14/W17.
- Whether the hero teaser on `/` reuses the full Game-detail component or a
  lighter variant — resolve in W13.
