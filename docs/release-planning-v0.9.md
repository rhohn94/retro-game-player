# Release Planning — v0.9

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.9.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.9` |
| **Previous** | `v0.8` (Confirm — create-folder success feedback) |
| **Theme** | "Contact" — repair the whole Aura interaction layer so buttons, text fields, and selects actually respond to real user input. |

**Context (user-reported, plus a full audit).** Two bugs were reported: the
"Create a games folder" button does nothing, and the Search page has no way to
type a query. Both are symptoms of one systemic defect: large parts of the UI
were wired against an **imagined** Aura API. An exhaustive audit of all 7
interactive component files (58 controls) found **17 broken** ones:

- **Buttons (11):** wired via `events={{ "aura-click": … }}`. Aura's
  `<aura-button>` only ever fires a **native `click`** (it calls `this.click()`);
  it never dispatches `aura-click`, so those listeners are permanently silent.
  The dialog-opening "Create a games folder" button is one of these — which is
  why v0.8's success-state fix was invisible (the dialog never opened).
- **Text fields (4):** `<AuraField>` was given `value`/`type`/`placeholder`
  props with **no contained `<input>`**. `aura-field` is a label/glow *wrapper*
  around a contained control — it renders no input of its own and never emits
  `aura-field:input`. Result: an empty field with nothing to type into.
- **Selects (2):** `<AuraSelect>` was given native `<option>` children (Aura
  projects only `<aura-option>`) and listened for `aura-change` (Aura emits
  `aura:change`, with a colon) — doubly dead.

The correct patterns already exist and work elsewhere in the same codebase
(CoreRow/GameDetailPage buttons use `onClick`; FamiliarPane/RetroArchPane fields
use a contained `<input>`; LibraryFilters uses native `<select>`), so each fix
has a proven in-repo template.

**Why the tests missed it.** The headless inspect scripts *manually dispatched*
a synthetic `aura-click` CustomEvent that a real mouse never produces, and the
pure-logic vitest files never mounted an Aura control. So 100% of the wiring was
dead while the suite stayed green. v0.9 closes that gap with a static guard plus
a real-gesture headless proof.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W91** | Buttons respond to clicks | All 11 `events={{ "aura-click": … }}` buttons rewired to `onClick` (LibraryPage, LibraryFilters, SettingsPage ×9). Clicking each fires its handler in the real app. |
| **W92** | Text fields are typeable | The 4 prop-driven `<AuraField>`s (SearchPage, CreateGamesFolderDialog, ProviderDialog ×2) render a contained native `<input>` with React `value`/`onChange`; the dead `aura-field:input` listeners are removed; refs point at the inner input so auto-focus works. The user can type a games-folder path and a search query. |
| **W93** | Selects change value | The 2 `<AuraSelect>`s (Settings cores + theme) become native `<select>` + `onChange` (the working LibraryFilters pattern); picking a core/theme applies. |
| **W94** | Regression guard | A static vitest guard (`scripts/aura-wiring.test.mjs`) fails the build on any `aura-click` / `aura-field:input` / hyphenated `aura-change` listener or any prop-driven `AuraField` in `src/`. |
| **W95** | Real-gesture proof + verify | A headless script drives the create-folder flow with a **real** `page.click()` (asserting the dialog opens) and a **real** typed query (asserting the field updates), failing non-zero on regression. Full gate suite green: typecheck/lint/vitest/cargo test/build/visual-inspect. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Frontend-only, mechanical-but-careful
edits across 6 component files, each fix following an existing working template.
A new static guard test plus a hardened real-gesture inspect script turn the
previously-masked failure mode into a true gate. Each item committed atomically;
the full gate suite runs before merge. Design:
[`interaction-wiring-design.md`](design/interaction-wiring-design.md).

## 4. Out of scope

- The two backlog feature tickets — searching for game downloads
  ([#6](https://github.com/rhohn94/harmony/issues/6)) and expanding the console
  list to gens 1–6 ([#7](https://github.com/rhohn94/harmony/issues/7)) — are the
  next two releases (v0.10, v0.11), not v0.9.
- Re-skinning the two selects back to a custom Aura dropdown using
  `<aura-option>` — deferred; native `<select>` is correct, accessible, and
  matches the existing filter selects.
- The `MetaRow` focusable div (intentional read-only focus target, not a
  control) is left as-is.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W91 — buttons respond to clicks | version/0.9 (in-session) | ☑ | 11 `aura-click` listeners → `onClick` (LibraryPage, LibraryFilters, SettingsPage ×9). |
| W92 — text fields typeable | version/0.9 (in-session) | ☑ | 4 fields now wrap a contained `<input className="harmony-input">` with React `value`/`onChange`; refs moved to the input; dead `aura-field:input` removed; shared `.harmony-input` added to global.css. |
| W93 — selects change value | version/0.9 (in-session) | ☑ | Settings cores + theme `<AuraSelect>` → native `<select className="harmony-input">` + `onChange`; unused AuraSelect import dropped. |
| W94 — regression guard | version/0.9 (in-session) | ☑ | `scripts/aura-wiring.test.mjs` (2 tests) bans the dead event literals + prop-driven AuraField; green in the 62-test suite. |
| W95 — real-gesture proof + verify | version/0.9 (in-session) | ☑ | `scripts/inspect-interactions.mjs` real-clicks/real-types and asserts state changes (replaces the synthetic-event capture). All gates green: typecheck, lint, 62 JS tests, cargo test, clippy, build, visual-inspect (4 routes), 4/4 real-gesture checks. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.9 → dev | ☑ | merged `--no-ff`; 62 JS tests green on dev |
| dev → main promoted + tagged v0.9 | ☑ | |
| deployed | ☑ | `just deploy` → deployed-apps/current + /Applications/Harmony.app at 0.9.0 |
| pushed to origin | ☑ | main + dev + tag v0.9 (fast-forward, no force) |
