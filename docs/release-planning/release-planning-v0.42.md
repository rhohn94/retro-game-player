# Release Planning — v0.42

> status: agreed
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
| `w421-rust-conformance` (W421) | n/a | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (53093f8) |
| `w422-ts-promise-magic` (W422) | n/a | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (35768e1) |
| `w423-search-components` (W423) | n/a | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (6b02f73) |
| `w424-css-conformance` (W424) | n/a | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (c08d08b) |
| `w425-settings-a11y` (W425) | n/a | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (ba1caa6) |

**Quality gate (post-merge, full integrated suite on version/0.42 @ ba1caa6):**
768 vitest / 1020 cargo / `pnpm typecheck` clean / `pnpm lint` clean /
`cargo check` clean / `cargo clippy -D warnings` clean / `recipe.py smoke`
exit 0 (all 12 routes render, guiOk=true).

**Pre-merge review:** adversarial per-branch review (one reviewer per branch,
high effort, each blocking finding independently re-verified) — all five
`merge-ready`, `behaviorPreserved: true`, `acceptanceMet: true`, **zero**
confirmed blocking findings, zero unjustified out-of-scope files.

### Follow-ups discovered during implementation

All 28 issues (#56,#57,#60,#70–#89,#91–#96,#79,#81) landed with zero blocking
findings. Non-blocking notes and deferred items:

- **W421 / #70:** the `#[allow(clippy::too_many_arguments)]` on `drain_video`
  was already function-scoped — the fix added a justifying comment (matching
  `commands/search.rs`'s pattern), so the "narrow blanket allow" framing was
  really a documentation add; zero behaviour impact.
- **W421 (deferred):** two more hand-rolled percent-encoders
  (`core/retroachievements/client.rs`, `core/metadata/steamgriddb_client.rs`)
  share #57's DRY smell — outside this lane's file scope; candidate for a
  future DRY pass.
- **W421 (pre-existing, not introduced):** `cargo fmt --check` flags nearly the
  whole tree — a local rustfmt/toolchain version drift, not caused by this
  release; intentionally not reformatted inside a conformance run.
- **W422 / #78 (deferred):** the deeper root cause of the SearchPage
  floating-promise lives in `useResultSelection.ts`'s `openSelected()`
  await-loop; the call-site `.catch()` satisfies the lint finding but does not
  surface a specific-link-open failure in the UI — a small future UX item.
- **W423 / #77:** the reveal-item-in-dir failure routes to `swallow()`
  (telemetry) rather than the error UI (which would replace the whole panel) —
  defensible divergence from the "route into error UI" framing; not a
  correctness change.
- **W424 / #56 (latent fragility):** the `--aura-surface-2`-override hover
  trick is behaviour-identical for the current cores-row composition and does
  not leak into neutral AuraButtons, but if a tint-resolving Aura component
  (select/chip/badge/hovered ghost-button) were ever nested inside a cores
  row, it would newly tint on row hover. The in-file comment documents the
  mechanism but not this containment assumption — worth a comment/guard if
  cores-row markup grows.
- **W425 (a11y visual change):** the `AuraField label=` additions (#92) render
  a **visible** label that duplicates the existing placeholder text in several
  settings panes — intended, consistent with the existing
  `LocateToolPane`/`RetroAchievementsPane` pattern, and behaviour-preserving,
  but a small visible/layout change rather than an invisible `aria-label`.
- **W425 (pre-existing crash, filed separately):** `FamiliarPane.tsx:81` reads
  `probe.capabilities.length` with no null-guard; the mock-IPC `probe_familiar`
  stub returns `{available:false}` with no `capabilities`, throwing and
  blanking the Settings page via the ErrorBoundary. Confirmed unrelated to this
  lane's edits; filed as its own follow-up task (does not trip route-mount
  smoke — a deeper probe path). **Candidate v0.43 bug-fix item.**
