# Release Planning — v0.42

> status: draft
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.42.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.42` |
| **Previous** | v0.41 ("Follow-Through" — cleared the v0.40 coding-practices audit backlog) |
| **Theme** | "Conformance" — clear a collision-free batch of the open coding-practices audit issues, continuing the v0.40 "Loose Ends" → v0.41 "Follow-Through" quality trajectory. |

---

## 2. Major Features

This release is scoped entirely from the open coding-practices audit backlog
(the v0.41 audit batch #70–#99 plus still-open v0.40 items #56/#57/#60). Every
lane owns a **disjoint set of files** so all five merge conflict-free. No new
feature surface, no design docs.

### W421 — Rust conformance (`w421-rust-conformance`)

**Issues:** #70 (rs-no-blanket-allow, `video.rs`), #71 (rs-fn-length,
`rom.rs`), #72 (rs-fn-length, `core_loop.rs`), #73 (rs-fn-length, `import.rs`),
#74 (rs-fn-length, `native_play.rs`), #57 (dry-no-duplication,
`template.rs` + `wikipedia.rs`).

**Description:** Remove the blanket `#[allow(...)]` in `video.rs` (scope it to
the specific lint/lines that need it); split the four over-budget functions
into named helpers; de-duplicate the shared logic between `template.rs` and
`wikipedia.rs`.

**Acceptance criteria:** each named function is under the repo length budget or
the blanket allow is narrowed; behaviour unchanged (all existing `cargo test`
pass); `cargo clippy -D warnings` and `cargo check` clean; the duplication in
#57 is extracted to one shared path.

**Design doc:** none required (conformance to `docs/coding-standards.md`).

### W422 — TypeScript promise/magic conformance (`w422-ts-promise-magic`)

**Issues:** #75 (js-no-floating-promise, `play/NativePlayer.tsx`), #76
(js-no-floating-promise, `play/playSession.ts`), #78 (js-no-floating-promise,
`search/SearchPage.tsx`), #80 (no-magic-numbers, `consoles/CatalogBrowser.tsx`).

**Description:** Handle or explicitly void the flagged floating promises; lift
the magic numbers in `CatalogBrowser.tsx` to named constants.

**Acceptance criteria:** no floating-promise lint findings on the four flagged
sites; magic numbers replaced with named constants; `pnpm typecheck` +
`pnpm lint` clean; existing vitest suite green.

**Design doc:** none required.

### W423 — Search-components conformance (`w423-search-components`)

**Issues:** #77 (js-no-floating-promise, `search/components/DownloadAction.tsx`),
#81 (no-magic-numbers, `search/components/DownloadAction.tsx`), #60
(test-coverage, `search/components/resultVisibility.ts`).

**Description:** Fix the floating promise and magic numbers in
`DownloadAction.tsx` (same file — bundled to avoid a self-collision); add unit
coverage for `resultVisibility.ts`.

**Acceptance criteria:** `DownloadAction.tsx` clean of both findings;
`resultVisibility.ts` has direct unit tests covering its branches; suite green;
`pnpm typecheck` + `pnpm lint` clean.

**Design doc:** none required.

### W424 — CSS conformance (`w424-css-conformance`)

**Issues:** #56 (css-no-important, `cores.css`), #83 (css-dry-declarations,
`library.css`), #84 (css-flat-specificity, `global.css`), #85
(css-flat-specificity, `library.css`), #86 (css-naming-convention,
`cores.css`), #87 (css-design-tokens z-index, `library.css`), #88
(css-design-tokens 2px spacing, `library.css`), #89 (css-no-important,
`motion.css`).

**Description:** Remove `!important` where flagged; flatten over-specific
selectors; replace hard-coded z-index / spacing with design tokens; align
class names to convention; de-duplicate declarations. `library.css` is touched
by four issues — all owned by this one lane so there is no cross-lane CSS
collision.

**Acceptance criteria:** flagged findings resolved across the four CSS files;
no visual regression in the affected surfaces (`recipe.py smoke` passes);
`pnpm lint` clean.

**Design doc:** none required.

### W425 — Settings-panes + ProviderDialog a11y (`w425-settings-a11y`)

**Issues:** #79 (js-no-floating-promise, `settings/panes/GameSourcesPane.tsx`),
#91 (html-native-before-aria, `settings/panes/ControllersPane.tsx`), #92
(html-accessible-name, `settings/panes/SteamGridDbSection.tsx` +3 more), #93
(html-form-labels, `search/ProviderDialog.tsx`), #94 (html-accessible-name,
`search/ProviderDialog.tsx` helper fields), #95 (html-input-type-autocomplete,
`settings/panes/RetroAchievementsPane.tsx` +2 more), #96
(html-input-type-autocomplete, `settings/panes/ProvidersPane.tsx`).

**Description:** Add accessible names / form labels, prefer native semantics
before ARIA, set proper `type`/`autocomplete` on the flagged inputs, and handle
the `GameSourcesPane` floating promise. This lane owns **all** `settings/panes/*`
files plus `ProviderDialog.tsx`, absorbing the "+N more" files named in #92/#95
so there is no ambiguous cross-lane collision.

**Acceptance criteria:** flagged a11y findings resolved; every flagged input has
an accessible name and correct `type`/`autocomplete`; `GameSourcesPane`
floating promise handled; `pnpm typecheck` + `pnpm lint` clean; suite green.

**Design doc:** none required.

---

## 3. Parallel Implementation Strategy

**Single phase, all five lanes in parallel.** Each lane owns a disjoint set of
files, so there is no ordering constraint and no shared-file conflict.

**Conflict map (file ownership — disjoint by construction):**

| Lane | Owns |
|---|---|
| W421 | `src-tauri/src/play/native/runtime/video.rs`, `core/sources/rom.rs`, `play/native/runtime/core_loop.rs`, `core/library/import.rs`, `commands/native_play.rs`, `core/search/template.rs`, `core/metadata/wikipedia.rs` |
| W422 | `src/features/play/NativePlayer.tsx`, `src/features/play/playSession.ts`, `src/features/search/SearchPage.tsx`, `src/features/consoles/CatalogBrowser.tsx` |
| W423 | `src/features/search/components/DownloadAction.tsx`, `src/features/search/components/resultVisibility.ts` |
| W424 | `src/features/library/library.css`, `src/styles/global.css`, `src/features/cores/cores.css`, `src/theme/motion.css` |
| W425 | all `src/features/settings/panes/*.tsx`, `src/features/search/ProviderDialog.tsx` |

**Merge order:** any order (no dependencies). Tests run after each merge;
final `version/0.42 → dev` after all five land and the full suite is green.

---

## 4. Out of Scope for v0.42

Deferred with rationale; nothing here is a `Grimoire-Requirement` item (the
tracker read returned zero open, 2026-07-11).

- **#55 (css-no-inline-style, ProviderDialog +49 more, systemic):** ~50-file
  systemic change with heavy cross-lane collision surface; needs a dedicated
  pass, not a bundled autonomous lane.
- **#58 (arch-public-surface, missing `index.ts` in 4 feature dirs):**
  architectural surface change; defer.
- **#59 (js-pin-deps, `package.json`):** dependency-pin changes can shift
  resolutions/builds; wants a deliberate verify pass, not an autonomous batch.
- **#61 (rs-module-size / arch-module-size, multiple modules):** architectural
  module-splitting; too large/risky for a zero-checkpoint autonomous run.
- **#62 (css-relative-units, systemic px font-sizes across feature CSS):**
  systemic CSS change that collides with the W424 CSS files; defer.
- **#63 (FocusableAction render-prop contract inversion):** explicitly filed as
  "too risky to rush unsupervised" by the v0.40/v0.41 passes; needs a dedicated
  supervised pass.
- **#64 (`useUiExclusiveDismiss` hook extraction):** largest/riskiest
  candidate (~11 files, double-Escape edge case); same too-risky-unsupervised
  rationale as #63.
- **#82 (dry-no-duplication, settings-panes 11+ mount effects, systemic):**
  systemic settings-panes refactor that collides with W425; defer to a
  dedicated pass.
- **#90 (html-single-main-h1, `App.tsx` +4 routed pages):** ambiguous
  routed-page file set makes collision-free lane assignment impossible for an
  autonomous run; defer.
- **#97 (arch-standard-layout, vendor.toml / src-tauri/vendor):** architectural
  layout change; defer.
- **#98 / #99 (arch-module-size, `NativePlayer.tsx` / `InPagePlayer.tsx`):**
  module-size splits; `NativePlayer.tsx` is also touched by W422, so bundling
  would collide — defer the split to its own pass.
- **Feature work #27 (notarized DMG), #48 (N64 on-device), #50 (Vulkan
  HW-render):** require on-device verification / signing infrastructure — not
  safe for a zero-checkpoint autonomous release.
- **Any new roadmap flagship:** `docs/roadmap.md` has no `v0.42` entry; this
  release is scoped entirely from the coding-practices audit backlog.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.42 |
|---|---|---|---|---|
| `w421-rust-conformance` (W421) | n/a | ☐ | ☐ | ☐ |
| `w422-ts-promise-magic` (W422) | n/a | ☐ | ☐ | ☐ |
| `w423-search-components` (W423) | n/a | ☐ | ☐ | ☐ |
| `w424-css-conformance` (W424) | n/a | ☐ | ☐ | ☐ |
| `w425-settings-a11y` (W425) | n/a | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

_Empty at start; populated by release-phase-merge as branches land._
