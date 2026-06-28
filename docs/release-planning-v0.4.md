# Release Planning — v0.4

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.4.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.4` |
| **Previous** | `v0.3` (Resonance — Aura design-token adoption) |
| **Theme** | "Motion" — smooth, fluid animation for every transition and event, built on a single motion-token source and centrally honouring `prefers-reduced-motion`. Third release of the GUI-and-cores program. |
| **Ticket** | [#2](https://github.com/rhohn94/harmony/issues/2) |

**Context.** Several screens already animate (LibraryPage/GameDetailPage
entrance, SearchPage result stagger, CoresPage column crossfade, CoreRow
entrance + layout, HeroBackdrop crossfade) but each hard-codes its own durations
and spring configs, and the biggest continuity gaps are unanimated: **route
transitions**, **library grid tile entrance**, the **provider dialog**, and
**sidebar-nav / hover micro-interactions**. Aura already exposes motion
primitives (`--aura-dur-*`, `--aura-ease-*`, `--aura-entrance-*`) that Harmony
should build on rather than reinvent. Framer Motion v11 provides
`MotionConfig reducedMotion="user"`, which lets one wrapper make every Framer
animation honour the OS reduced-motion setting.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W41** | Motion-token foundation + reduced-motion | A single motion source: CSS tokens (`--harmony-dur-*`, `--harmony-ease-*`) in `src/theme/motion.css` forwarding Aura's primitives, and a TS preset module (`src/lib/motion.ts`) holding the Framer durations/spring presets/shared variants. Existing motion components and CSS transitions reference these instead of inline literals. `prefers-reduced-motion` is honoured centrally: `<MotionConfig reducedMotion="user">` wraps the app (all Framer motion) **and** a global reduced-motion CSS rule neutralises CSS transitions/animations. |
| **W42** | Close the motion gaps | Route transitions (an `AnimatePresence` crossfade keyed by `location.pathname`, `mode="wait"`); library grid tiles stagger in on load; the provider dialog animates enter/exit; sidebar-nav active state and search-result hover transition smoothly (CSS, not fragile inline handlers where avoidable). No janky/instant major state change remains. |
| **W43** | Verify motion | `node scripts/visual-inspect.mjs` still passes on all four routes (motion wrappers must not break rendering — route keying + `AnimatePresence` verified not to blank the page). Tests assert the motion presets exist and that the app is wrapped in `MotionConfig`. A guard test bans raw inline spring/duration literals in motion components where a preset exists. All gates green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Dependency order: W41 (establish the
token source + reduced-motion centralisation, refactor existing motion onto it)
→ W42 (consume it to fill the gaps) → W43 (verify). The motion-token TS module
is the single source for Framer-side numbers (Framer transitions are JS numbers,
not CSS vars); `motion.css` mirrors the same values for the CSS side, with the
mirror documented so they stay in sync. Each work item committed atomically; the
full gate suite must pass before merge.

## 4. Out of scope

- New screens, toasts/alert components (none exist yet) — motion support for
  them lands with the feature that introduces them.
- Gamepad/controller-driven motion behaviour beyond what exists (W14 owns nav).
- Bumping the Aura pin (reuse v3.20's motion primitives as-is).
- The residual inline-spacing tokenisation deferred from v0.3 (tracked separately).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W41 — motion-token foundation + reduced-motion | version/0.4 (in-session) | ☑ | `src/lib/motion.ts` (DUR/EASE/SPRING/variants) + `src/theme/motion.css` (tokens forwarding Aura primitives + global reduced-motion rule); `<MotionConfig reducedMotion="user">` wraps the app; existing motion refactored onto the presets. |
| W42 — close the motion gaps | version/0.4 (in-session) | ☑ | Route crossfade (`AnimatePresence` keyed by pathname), library grid stagger (`GameTile` → `motion.button`), provider-dialog pop, sidebar-nav + tab + result-row transitions. |
| W43 — verify motion | version/0.4 (in-session) | ☑ | `scripts/motion.test.mjs` (4 tests) guards no raw literals + both reduced-motion hooks + preset exports; visual-inspect verified=true guiOk=true on all 4 routes (motion wrappers don't blank the page); 44 tests green. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.4 → dev | ☑ | merged `--no-ff`; 44 tests + visual-inspect green on dev |
| dev → main promoted + tagged v0.4 | ☑ | |
| pushed to origin | ☐ | HUMAN-GATED — do not push without explicit go |
