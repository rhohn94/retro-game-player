# Release Planning — v0.41

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.41.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.41` |
| **Previous** | v0.40 "Loose Ends" (closed three independently-tracked backlog gaps: keyboard a11y remainder, core-options probe robustness, Aura upstream TS types) |
| **Theme** | **"Follow-Through"** — no roadmap flagship is scheduled for v0.41 (`docs/roadmap.md` has no `v0.41` entry). This release clears the low-risk half of v0.40's own follow-up backlog: doc-accuracy fixes, a dangling-ARIA tightening, added test coverage, one real hardening fix (issue #54), and a config-duplication cleanup — all independently verified `design-ready` with no design-doc gaps. |

---

## 2. Major Features

### W401 — harmony-ux-design.md §8 doc-wording fix

**Description:** §8 "Keyboard accessibility" of `harmony-ux-design.md` claims
the W394 diff gave `aria-label` to "two ambiguous nested lists," but the actual
diff labels three `<ul>`/`<motion.ul>` elements (it also includes the
non-nested top-level `MergedResultsView` list). Pure doc-accuracy correction,
no code change.

**Acceptance criteria:**
- §8's prose accurately describes 3 labeled lists, not 2, and names
  `MergedResultsView` alongside the nested-list cases.
- No other content in §8 changes; no code touched.

**Branch:** `w401-harmony-ux-doc-fix`
**Design doc:** `docs/design/harmony-ux-design.md` (edit §8 only)

---

### W402 — CollectionPicker aria-controls tightening

**Description:** `CollectionPicker.tsx`'s disclosure toggle button
unconditionally sets `aria-controls={panelId}` even while the panel is
closed/unmounted, leaving a dangling ARIA reference. Standard
disclosure-widget pattern: only advertise `aria-controls` while the
controlled element actually exists in the DOM.

**Acceptance criteria:**
- `aria-controls` is only set on the toggle button while the panel is open
  (`aria-controls={open ? panelId : undefined}` or equivalent).
- `CollectionPicker.test.tsx` gains an assertion covering the closed-state
  absence of `aria-controls`.
- No behavior change to the panel's open/close mechanics.

**Branch:** `w402-collectionpicker-aria-controls`
**Design doc:** none required (test-covered behavior, no design-doc claim to update)

---

### W403 — Dead-button regression test: controller-confirm path

**Description:** W394's two dead-button regression tests
(`SearchQueryBar.test.tsx`, `ProviderChipsBar.test.tsx`) cover only the
mouse-click activation path. `CollectionPicker.test.tsx` already has a
controller-confirm-path pattern (a `window.__dispatchAction` helper firing a
`"confirm"` action after a control claims focus) to mirror. Test-only; the
underlying fix already shipped in W394.

**Acceptance criteria:**
- Both existing dead-button regression tests gain a controller-confirm-path
  variant using the `CollectionPicker.test.tsx` dispatch-helper pattern.
- No production code changes.

**Branch:** `w403-dead-button-controller-confirm-test`
**Design doc:** none required (test-only)

---

### W404 — core-options probe hardening (issue #54 + dedicated unit test)

**Description:** Two related W395 follow-ups on `probe.rs`, combined into one
item since both touch the same file and would conflict if split across
parallel branches:
1. **Issue #54:** `probe_declared_options`'s `load_game` stage sets only the
   `environment` callback before calling `load_game`, unlike the real
   `bring_up_core` path in `session.rs`, which also sets
   `video_refresh`/`audio_sample_batch`/`input_poll`/`input_state` first. A
   future non-fceumm core that invokes any AV/input callback from inside
   `retro_load_game` would dereference a NULL callback pointer.
2. **Coverage gap:** `probe_load_game_declarations` is currently exercised
   only via 2 FFI integration tests; add a dedicated unit test using the
   file's existing stub-core-builder pattern.

**Acceptance criteria:**
- `probe_declared_options`'s `load_game` stage sets the same callbacks
  `bring_up_core` sets before driving `load_game` (video_refresh,
  audio_sample_batch, input_poll, input_state), mirroring the known-good
  registration order.
- A stub core that invokes any of those callbacks from `retro_load_game`
  during the probe no longer NULL-derefs.
- At least one new unit test drives `probe_load_game_declarations` directly
  (bypassing `probe_declared_options`), reusing the existing stub-core-builder
  helpers.
- No behavior change to the existing fceumm-only path.
- Issue #54 closed with a comment noting what shipped.

**Branch:** `w404-core-options-probe-hardening`
**Design doc:** `docs/design/core-options-design.md` (extend — mark the issue
#54 follow-up resolved)

---

### W405 — Aura alias-map single-sourcing (Vite/Vitest)

**Description:** The `@aura/*` alias map (including the `/hooks`-before-bare-
`@aura/react` ordering constraint W396 introduced) is hand-duplicated across
`vite.config.ts` and `vitest.config.ts`. Extract it into one shared module
both configs import, so the ordering constraint can't silently drift out of
sync between them.

**Acceptance criteria:**
- A single shared module (e.g. `vite/aura-aliases.ts`) defines the `@aura/*`
  alias array, preserving `/hooks`-before-bare-`@aura/react` ordering.
- `vite.config.ts` and `vitest.config.ts` both import from it; no
  hand-duplicated alias arrays remain.
- `pnpm typecheck`, `pnpm test`, and `pnpm tauri build` (alias resolution)
  all still pass.
- `design-language.md` §2.3 updated to reference the shared module instead of
  describing two hand-kept mirrors.

**Branch:** `w405-aura-alias-single-source`
**Design doc:** `docs/design/ux/design-language.md` §2.3 (extend)

---

### W406 — Aura `className`/`class` precedence test coverage

**Description:** `design-language.md` §7's claim that `className` "wins over
`class`" when both are set on a generated Aura wrapper is read correctly from
`vendor/aura/bindings/react/aura-react.js`'s wrapper factory, but is not
exercised by any call site or test. Add a small render test to back the claim.

**Acceptance criteria:**
- A new test (following the `ErrorBoundary.test.tsx` render-test template)
  mounts a generated Aura wrapper with both `class` and `className` set and
  asserts `className` wins.
- §7's claim gains a one-sentence note that it is now test-backed.
- No source changes — the claim was already correct.

**Branch:** `w406-aura-classname-precedence-test`
**Design doc:** `docs/design/ux/design-language.md` §7 (one-sentence addition)

---

## 3. Parallel Implementation Strategy

**Pass 1 (parallel, no file overlap between items):**
- W401 (`harmony-ux-design.md` §8 only)
- W402 (`CollectionPicker.tsx`, `CollectionPicker.test.tsx`)
- W403 (`SearchQueryBar.test.tsx`, `ProviderChipsBar.test.tsx`)
- W404 (`probe.rs`, `core-options-design.md`)
- W405 (`vite.config.ts`, `vitest.config.ts`, `design-language.md` §2.3)
- W406 (new test file, `design-language.md` §7)

All six touch disjoint files or disjoint sections of the same doc
(`design-language.md` §2.3 vs. §7, ~250 lines apart) — single fully parallel
pass, no merge-order dependency. (W404 deliberately combines two upstream
candidates that both touched `probe.rs`, to eliminate an otherwise-certain
same-file conflict between them.)

**Conflict map:**
| Branch | Files touched |
|---|---|
| `w401-harmony-ux-doc-fix` | `harmony-ux-design.md` §8 |
| `w402-collectionpicker-aria-controls` | `CollectionPicker.tsx`, `CollectionPicker.test.tsx` |
| `w403-dead-button-controller-confirm-test` | `SearchQueryBar.test.tsx`, `ProviderChipsBar.test.tsx` |
| `w404-core-options-probe-hardening` | `probe.rs`, `core-options-design.md` |
| `w405-aura-alias-single-source` | `vite.config.ts`, `vitest.config.ts`, `design-language.md` §2.3, new `vite/aura-aliases.ts` |
| `w406-aura-classname-precedence-test` | new test file, `design-language.md` §7 |

---

## 4. Out of Scope for v0.41

- **Issue #63 (FocusableAction render-prop contract inversion, ~30K):**
  touches 9 call sites across 4 files; the v0.40 simplify pass explicitly
  filed it as "too risky to rush unsupervised" rather than apply it directly.
  Deferred to a future release where it can get a dedicated pass instead of
  being bundled into a zero-checkpoint autonomous run.
- **Issue #64 (`useUiExclusiveDismiss` hook extraction, ~60K):** the largest
  and riskiest candidate in the v0.40 follow-up pool — touches ~11 files
  including a component with a double-Escape edge case. Same
  too-risky-to-rush-unsupervised rationale as #63; deferred.
- **DispatchProbe test-helper triplication cleanup (~20K):** one of the three
  duplicate copies sits in a pre-existing file outside the v0.40 diff;
  regressing it would break an unrelated area. Deferred pending a full
  `pnpm test` safety net and closer review.
- **C-stub string constants shared-prefix/suffix extraction (~12K):**
  explicitly skipped in the v0.40 simplify pass itself — the reviewers judged
  parameterizing the C test fixtures a net readability loss. Left
  indefinitely backlogged unless a future pass disagrees.
- **Probe latency regression investigation (~25K):** `probe_declared_options`'s
  per-call latency roughly doubles (~500ms → ~1000ms) since both probe stages
  now always run. Not a confirmed defect — "noted but acceptable" per the
  v0.40 ledger — and the fix approach (grace-period vs. conditional skip)
  isn't chosen yet. Needs a spike/confirmation before it's a real work item,
  which doesn't fit a zero-checkpoint autonomous pass; deferred.
- **Any new flagship / roadmap-driven feature work** — `docs/roadmap.md` has
  no `v0.41` entry at planning time; this release is scoped entirely from the
  v0.40 follow-up backlog. A future release should pick up the next
  roadmap-scheduled flagship once one exists.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero, 2026-07-10).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.41 |
|---|---|---|---|---|
| `w401-harmony-ux-doc-fix` (W401) | ☑ | ☑ | ☑ (grm-reviewer-equivalent: merge-ready, 0 blocking) | ☑ (59ae7f0) |
| `w402-collectionpicker-aria-controls` (W402) | ☑ | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (063c525) |
| `w403-dead-button-controller-confirm-test` (W403) | ☑ | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (17c6490) |
| `w404-core-options-probe-hardening` (W404) | ☑ | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (0df0cac) |
| `w405-aura-alias-single-source` (W405) | ☑ | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (3681709) |
| `w406-aura-classname-precedence-test` (W406) | ☑ | ☑ | ☑ (merge-ready, 0 blocking) | ☑ (43dafb0) |

### Follow-ups discovered during implementation

All 6 items landed with zero blocking findings from the parallel pre-merge
review. Non-blocking notes, none scheduled:

- **W401:** "ambiguous" fits the two genuinely-nested lists more precisely
  than `MergedResultsView`'s own top-level list; wording nuance only, list
  count (3) and named components are accurate as written.
- **W402:** the new closed-state test also asserts `aria-expanded="false"`,
  slightly beyond the literal ask but harmless and consistent with the
  existing open-state test's style.
- **W403:** `SearchQueryBar.test.tsx`/`ProviderChipsBar.test.tsx` each
  re-declare a near-identical `DispatchProbe` component — now a third copy
  alongside `CollectionPicker.test.tsx`'s (the pre-existing v0.40 follow-up
  candidate for extracting this into a shared test helper, deferred out of
  v0.41 scope §4, now has one more site to consolidate).
- **W404:** `probe.rs`'s new `probe_video_refresh` signature line runs 107
  chars (repo convention ~100, not lint-enforced); the four no-op probe
  callback stubs mirror `play::native::callbacks`' shape and would be a good
  shared-extraction candidate if a third no-op-callback consumer appears.
- **W405:** `vite/aura-aliases.ts`'s `resolveVendored()` has no dedicated
  unit test (coverage is implicit via existing alias-resolution tests,
  consistent with `vite.config.ts` itself being untested elsewhere in the
  repo); the doc update also newly documents the previously-undocumented
  `@aura/runtime` alias as a bonus accuracy fix.
- **W406:** the new test file duplicates act/root/container setup-teardown
  boilerplate already present in `ErrorBoundary.test.tsx`/`TvRail.test.tsx`
  (no shared test-harness helper exists yet — consistent with the existing
  per-file pattern).

**Quality gate (post-merge, full suite on version/0.41):** 768 vitest / 1020
cargo (10 ignored, live-GL-gated) / `pnpm typecheck` clean / `cargo check`
clean / `pnpm lint` clean / `cargo clippy -D warnings` clean.
