# Release Planning — v0.40

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.40.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.40` |
| **Previous** | v0.39 "Focus" (CRT renderer full-display-resolution decoupling) |
| **Theme** | **"Loose Ends"** — no single flagship; instead close three long-open, independently-tracked backlog gaps that don't need a new feature surface: the remainder of the keyboard-accessibility punch list (#29) that v0.38's TV/dialog/settings pass didn't cover, a core-options probe robustness follow-up from the v0.29 review (#33), and adopting Aura's real upstream TypeScript types in place of the hand-rolled shim (#40). |

---

## 2. Major Features

### W394 — Keyboard operability + ARIA audit: Library/Search/Detail (#29 remainder)

**Description:** Issue #29 was filed 2026-07-02 proposing a global
`:focus-visible` treatment plus a keyboard pass over Library/Search/
Settings/Detail. Since then, two things already shipped: W283's
`src/theme/focus-visible.css` gives every native focusable element a
token-driven focus ring app-wide, and v0.38 ("Better with a keyboard")
delivered focusable/escapable TV menus, dialogs, and Settings with screen
readers tracking the TV rails. What's left of #29's scope is the part v0.38
didn't touch: a keyboard-operability + ARIA pass over the **Library** (`/`),
**Search** (`/search`), and **Game Detail** (`/game/:id`) routes — confirm
every interactive control is reachable and operable via Tab/Shift+Tab/
Enter/Space with no dead-ends, Escape behaves consistently with the
existing Settings/TV convention, and the Library grid / Search results /
any tabbed region carry correct ARIA roles.

**Acceptance criteria:**
- Every actionable control on Library (`/`), Search (`/search`), and Game
  Detail (`/game/:id`) is reachable and operable via keyboard only, with no
  keyboard traps.
- Escape closes any dialog/overlay opened from these three routes,
  consistent with the existing Settings/TV Escape behavior (v0.38).
- ARIA roles audited and corrected on the Library grid, Search result list,
  and any tabbed region on these routes; controller and mouse behavior
  unchanged.
- Global `:focus-visible` ring (`src/theme/focus-visible.css`) is reused,
  not re-implemented.
- Issue #29 closed with a comment noting what this item shipped vs. what
  v0.38 (#34) already covered.

**Branch:** `w394-keyboard-a11y-remainder`
**Design doc:** `docs/design/harmony-ux-design.md` (extend — add a
cross-cutting keyboard-accessibility section alongside its existing §0
shell/controller-model and §6 controller-focus sections)

---

### W395 — core-options probe robustness (#33)

**Description:** Two narrow, independent Rust robustness gaps flagged by
the v0.29 W282 pre-merge Reviewer, neither reachable by today's single
native core (fceumm) but worth closing before the native-hosted core
catalog broadens:
1. `src-tauri/src/core/core_options/persistence.rs`'s `settings_key`
   builds `format!("core_option::{system}::{core_id}::{option_key}")` with
   no escaping — two different triples could collide if any component
   ever contained `::`.
2. `src-tauri/src/core/core_options/probe.rs`'s `probe_declared_options`
   drives `load → set_environment → init`, never `load_game` — a core
   that declares its option list during `retro_load_game` (post-ROM-
   analysis) would silently report zero options.

**Acceptance criteria:**
- `settings_key` is collision-proof against any component containing
  `::` (escape/percent-encode each component, or store the triple as
  separate columns instead of a delimited string). Existing
  `settings_key_is_namespaced_and_collision_free` test extended with a
  `::`-containing-component case.
- `probe_declared_options` also drives `load_game` (with a representative
  stub ROM buffer) and merges variables declared at either `retro_init`
  or `retro_load_game`. A unit test simulates a stub core that declares
  options only during `retro_load_game`.
- No behavior change to the existing fceumm-only path (still declares
  during `retro_init`).
- Issue #33 closed.

**Branch:** `w395-core-options-probe-robustness`
**Design doc:** `docs/design/core-options-design.md` (extend — mark the
tracked follow-up resolved)

---

### W396 — Adopt Aura upstream React TypeScript types (#40)

**Description:** The vendored Aura React bindings bundle
(`vendor/aura/bindings/react/`, v3.541.0) now ships real generated types
(`aura-react.d.ts`, `hooks.d.ts`, `jsx.d.ts` — confirmed present), but
`tsconfig.json` still maps `@aura/react` to the hand-rolled shim
`src/theme/aura-react.d.ts`, whose own header cites a now-stale rationale
(design-language#858, "ships as plain JS with NO TypeScript types"). Every
Aura component is currently typed as a generic `AuraComponent` with
`[attr: string]: unknown`, and Aura's ~30 upstream hooks
(`bindings/react/hooks.js`) have no import alias at all.

**Acceptance criteria (verbatim from issue #40):**
- `tsconfig.json` maps `@aura/react` types to
  `vendor/aura/bindings/react/aura-react.d.ts` (or the alias resolves so
  `tsc` picks up the vendored `.d.ts` naturally).
- `src/theme/aura-react.d.ts` deleted (or reduced to genuinely app-local
  augmentations only), with its stale dl#858 rationale gone.
- An `@aura/react/hooks` alias (vite + tsconfig) added so upstream hooks
  are importable; no obligation to adopt specific hooks in this item.
- `pnpm typecheck` passes; any prop/event mismatches the real types
  surface are fixed, not suppressed.
- `docs/design/ux/design-language.md` §2.3/§7 updated to match.
- Issue #40 closed.

**Branch:** `w396-aura-upstream-types`
**Design doc:** `docs/design/ux/design-language.md` (extend §2.3 Import
strategy, §7 Aura-in-React friction findings)

---

## 3. Parallel Implementation Strategy

**Pass 1 (parallel, no file overlap between items):**
- W394 (Library/Search/Detail route + component files, their CSS,
  `harmony-ux-design.md`)
- W395 (`src-tauri/src/core/core_options/persistence.rs`, `probe.rs`,
  `core-options-design.md`)
- W396 (`tsconfig.json`, `vite.config.ts`, `src/theme/aura-react.d.ts`,
  `design-language.md`, plus any call site the real types force a fix in)

All three touch disjoint areas (frontend route/CSS layer vs. Rust
core-options module vs. TS build config + theme shim) — single fully
parallel pass, no merge-order dependency.

**Conflict map:**
| Branch | Files touched |
|---|---|
| `w394-keyboard-a11y-remainder` | Library/Search/Game-Detail route + component files, their `*.css`, `harmony-ux-design.md` |
| `w395-core-options-probe-robustness` | `persistence.rs`, `probe.rs`, `core-options-design.md` |
| `w396-aura-upstream-types` | `tsconfig.json`, `vite.config.ts`, `src/theme/aura-react.d.ts`, `design-language.md`, call sites surfaced by real types |

---

## 4. Out of Scope for v0.40

- **RA server submission / leaderboards, Vulkan HW-render, GameCube/Wii
  native hosting (#50), i18n, collections polish, fleet self-update (#39),
  docs debt (#44/#51), metadata enrichment (#24), natural-language search
  (#47), placeholder art (#46), notarized DMG (#27), test-depth integration
  coverage (#28), netplay, Windows/Linux ports, JS-render fetch tier, PS1
  `.chd` hunk decompression (#49), issue hygiene reconciliation (#42), docs
  hygiene (#41)** — all unrelated to this loose-ends release; unchanged
  backlog, none carries a v0.40-specific carryover tag from v0.39 §4.
- **Grimoire-Requirement items** — none open at planning time (tracker
  read returned zero, 2026-07-10).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.40 |
|---|---|---|---|---|
| `w394-keyboard-a11y-remainder` (W394) | ☑ | ☑ | ☑ (grm-reviewer: merge-ready, 0 blocking) | ☑ (b7d2a0d) |
| `w395-core-options-probe-robustness` (W395) | ☑ | ☑ | ☑ (grm-reviewer: merge-ready, 0 blocking) | ☑ (c5c4302) |
| `w396-aura-upstream-types` (W396) | ☑ | ☑ | ☑ (grm-reviewer: merge-ready, 0 blocking) | ☑ (1ff9f23) |

### Follow-ups discovered during implementation

- **W394 (non-blocking, from grm-reviewer):** `harmony-ux-design.md` §8 says "two ambiguous nested lists" got an `aria-label` but the diff actually labels three `<ul>`s (includes the non-nested top-level `MergedResultsView` list) — cosmetic doc-wording fix. `CollectionPicker`'s toggle button leaves a dangling `aria-controls` pointing at the panel while it's closed/unmounted — standard disclosure-widget pattern, optional to tighten. The two new dead-button regression tests cover only the mouse-click path; a controller-confirm-path assertion would be a nice-to-have addition.
- **W395 (from grm-reviewer) — one worth tracking:** `probe_declared_options`'s new `load_game` stage sets only the `environment` callback before calling `load_game`, unlike the real `bring_up_core` path which also sets `video_refresh`/`audio_sample_batch`/`input_poll`/`input_state` first. A future core (not fceumm) that invokes any AV/input callback from inside `retro_load_game` would dereference a NULL callback pointer instead of degrading gracefully — the exact "as the native core catalog broadens" scenario W395 exists to harden against. Filed as [issue #54](https://github.com/rhohn94/retro-game-player/issues/54) rather than silently left as a comment, since it's the same class of finding that produced issue #33 in the first place. Two minor/cosmetic follow-ups also noted: the probe's per-call latency roughly doubles (~500ms → ~1000ms, no early-exit on the second drain window) since every probe call now runs both stages; `probe_load_game_declarations` has no dedicated unit test (only exercised via 2 FFI integration tests) — acceptable given its FFI dependency.
- **W396 (non-blocking, from grm-reviewer):** the `@aura/*` alias map is hand-duplicated across `vite.config.ts` and `vitest.config.ts`, and this item adds a silent ordering requirement (`/hooks` alias must precede the bare `@aura/react` alias) to that existing duplication — a good candidate for single-sourcing into one shared module. `design-language.md` §7.2's new claim that `className` "wins over `class`" when both are set is read from adapter source but not exercised by any call site or test — low-risk documentation-confidence note.

_Empty at start; populated by release-phase-merge as branches land._
