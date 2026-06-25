# UX Enhancements: Auto-detection, Theme/Component Layer, Visual Regression

> **Up:** [↑ Design docs](README.md)


> Scaffold-level design for the v1.18 UX-tier expansion. This doc designs
> three enhancements that sit **on top of** the existing UX design-language
> machinery — the per-project authority [`ux/design-language.md`](ux/design-language.md),
> the [`grm-design-language-adapt`](../../.claude/skills/grm-design-language-adapt/SKILL.md)
> skill, the [`grm-ux-demo-build`](../../.claude/skills/grm-ux-demo-build/SKILL.md)
> skill, and the GUI/non-GUI branch in
> [`grm-workflow-bootstrap`](../../.claude/skills/grm-workflow-bootstrap/SKILL.md).
> It is a design-only deliverable (the v1.18 UX-tier design gate); the
> skill/implementation work is downstream (C2/C3/C4).

## Motivation

The UX tier today is correct but manual at three seams:

1. **Onboarding asks a cold question.** `grm-workflow-bootstrap` Step 3 Q9 ("does
   this project have a UI?") and its GUI-stack follow-up are answered from
   scratch even when the repo already carries unambiguous framework evidence
   (a `package.json` with `react`, a `vite.config.ts`, `*.swift` files). The
   user re-types facts the repo already knows (#4).
2. **The adaptation has one tier.** `ux/design-language.md` flattens design
   tokens and component recipes into prose under one `## Design` section.
   There is no structured, machine-addressable **theme** (token scales) or
   **component** (named specs) layer that `grm-ux-demo-build`, downstream
   tooling, or a future codegen step could consume without re-parsing prose
   (#5).
3. **The demo has no memory.** `grm-ux-demo-build` produces a demo and asks the
   user to drop screenshots under `ux-demo/screenshots/`, but nothing
   captures a **baseline** or **diffs** subsequent runs. Visual drift in the
   adaptation is invisible until a human eyeballs it (#6).

These three enhancements close those seams while preserving the tier's core
contract: **detection pre-fills, the user confirms; the model never
auto-adopts.**

## Scope

**Covers (designed here, built downstream):**

- GUI-framework auto-detection that pre-fills the `grm-workflow-bootstrap`
  GUI/non-GUI branch and seeds design-language defaults (#4).
- A two-tier **theme + components** layer on top of `ux/design-language.md`:
  schema, file layout, how `grm-design-language-adapt` produces it, how it
  composes with the existing adaptation (#5).
- Visual-regression for `ux-demo/`: capture, baseline store, diff, opt-in
  skill flow, drift reporting (#6).

**Does not cover (explicit non-goals):**

- Concrete per-project component sets or token values — v1.18 ships the
  **layer and schema**, not a populated library for any one project.
- Choosing or vendoring a specific screenshot/diff tool — the visual-regression
  design stays tool-agnostic; tool selection is a per-project call.
- Any change to the upstream Aura design-language repo itself.
- The Copilot-flavor port of these skills (separate v1.18 work item).

## Design

### 1. GUI-framework auto-detection (#4)

**Where it plugs in.** A new detection pass runs at the **start** of
`grm-workflow-bootstrap` Step 3 Q9, before the question is asked. It scans the
repo root (and one level of obvious source dirs) for framework signals,
computes a best-guess `(gui-presence, framework, stack-hint)` tuple, and
**pre-selects** the corresponding `AskUserQuestion` option plus pre-fills the
GUI-stack follow-up. The question is still asked — detection changes the
default, never the answer.

**Detection table (signal → inferred framework / stack).** Signals are
grouped by source. A project may hit several rows; precedence resolves them
(below).

| # | Signal source | Signal | Inferred framework / stack | GUI? |
|---|---|---|---|---|
| 1 | `package.json` deps | `react`, `react-dom` | React (web) | Yes |
| 2 | `package.json` deps | `react-native`, `expo` | React Native (mobile) | Yes |
| 3 | `package.json` deps | `vue` | Vue (web) | Yes |
| 4 | `package.json` deps | `svelte`, `@sveltejs/kit` | Svelte / SvelteKit (web) | Yes |
| 5 | `package.json` deps | `@angular/core` | Angular (web) | Yes |
| 6 | `package.json` deps | `solid-js` | SolidJS (web) | Yes |
| 7 | `package.json` deps | `electron` | Electron (desktop, JS) | Yes |
| 8 | `package.json` deps | `next`, `nuxt`, `@remix-run/*`, `astro`, `gatsby` | meta-framework over the detected base (Next→React, Nuxt→Vue, …) | Yes |
| 9 | Config file | `vite.config.*`, `next.config.*`, `nuxt.config.*`, `svelte.config.*`, `angular.json`, `astro.config.*` | confirms / disambiguates the web stack above | Yes |
| 10 | Config file | `tailwind.config.*`, `postcss.config.*` | web styling present (corroborating, not deciding) | (boost web) |
| 11 | File extension | `*.swift` + `*.xcodeproj`/`Package.swift` with a UI dep | SwiftUI / UIKit (Apple) | Yes |
| 12 | File extension | `*.kt`/`*.java` + `AndroidManifest.xml` | Android (Kotlin/Java) | Yes |
| 13 | File extension | `*.xaml` | WPF / WinUI / Avalonia (.NET) | Yes |
| 14 | File / dep | `pubspec.yaml` with `flutter` | Flutter (cross-platform) | Yes |
| 15 | Dep / import | `PyQt*`, `PySide*`, `tkinter`, `wxPython`, `kivy` | Python desktop GUI | Yes |
| 16 | Dep | `egui`, `iced`, `tauri`, `slint` (Cargo.toml) | Rust GUI / Tauri | Yes |
| 17 | Native/mobile marker | `Info.plist`, `*.storyboard`, `ios/`+`android/` dirs | native/mobile app shell | Yes |
| 18 | TUI dep | `rich`, `textual`, `blessed`, `bubbletea`, `ratatui` | terminal UI (TUI) | Yes (TUI) |
| 19 | Server-only deps, no view layer | `express`/`fastify`/`flask`/`gin` with **no** row 1–18 hit | likely headless service | Lean "No, headless" |
| 20 | Library manifest, no app entry | published-package shape, no UI dep | likely headless library | Lean "Not yet" / "No" |

The **stack-hint** the table yields is written verbatim into the
`{ux-demo-stack}` slot (e.g. "React (web)", "SwiftUI", "Textual (TUI)") so
`grm-ux-demo-build` produces a stack-pure demo without a second interview.

**Precedence (deterministic, highest wins).**

1. **Explicit native/mobile + framework dep** (rows 11–17) — strongest, names a
   concrete platform.
2. **Declared runtime dep in a manifest** (rows 1–8, 14–16, 18) — a dependency
   the project chose to install.
3. **Config-file presence** (rows 9–10) — corroborates/disambiguates a manifest
   hit; a config file alone (no dep) is a weak signal.
4. **File-extension census** (rows 11–13 extension half) — used to disambiguate
   between multiple manifest hits or when no manifest exists.
5. **Negative/headless leans** (rows 19–20) — applied only when **no**
   positive GUI signal (rows 1–18) fired.

Meta-frameworks (row 8) resolve their base via the underlying dep (Next ⇒
React, Nuxt ⇒ Vue) and report the meta-framework as the stack hint. When two
peer web frameworks both appear (rare — e.g. a monorepo), detection reports
**the highest-confidence single guess and lists the runner-up**, deferring to
the user to pick.

**Confidence + the confirm-not-assume rule.** Detection emits one of three
confidence levels, which only changes presentation — never the requirement to
confirm:

- **High** (a framework dep + corroborating config or extensions): pre-select
  "Yes", pre-fill the stack hint, phrase the prompt as *"Detected a React
  (web) UI — confirm or change."*
- **Medium** (a single weak signal, e.g. a lone config file): pre-select the
  leaning option but phrase as a question, surface the evidence.
- **Low / none** (no signal, or conflicting peers): ask the cold question
  exactly as today; offer the runner-up list if peers conflicted.

Hard rules:

- Detection **pre-fills the default and surfaces its evidence**; the user's
  `AskUserQuestion` answer is always authoritative. A wrong guess costs one
  keystroke to correct.
- Detection **never writes a file on its own** — it feeds Step 3 Q9, whose
  answer then drives the existing Step 4 patch table (the `source-url`,
  `{ux-demo-stack}`, deferral-row, or headless-N/A outcomes are unchanged).
- Detection is **read-only and offline** — it inspects files already in the
  repo; it makes no network call (the network call belongs to
  `grm-design-language-adapt`).
- When detection leans headless/deferred (rows 19–20) it still routes through
  the normal "Not yet" / "No, headless" outcomes; it never silently skips the
  UX tier.

**Seed of design-language defaults.** On a confirmed GUI answer, the inferred
stack also seeds the **theme tier's** initial token vocabulary choice (web ⇒
CSS-custom-property token names; native ⇒ the platform's resource idiom) —
see §2. This is a *default starting point* for `grm-design-language-adapt`, not a
committed token set.

### 2. Component-library / theme-system layer (#5) — flagship

This is the centrepiece. Today `ux/design-language.md` holds an unstructured
`## Design` section (`### Local design tokens`, `### Component map`). The
enhancement promotes those into two **structured, machine-addressable tiers**
that compose with — and never replace — the prose authority.

#### Two tiers

- **`theme` tier — design tokens.** The primitives: colour, spacing, type,
  radius, motion scales. Answers *"what are the raw values?"*
- **`components` tier — named component specs/recipes.** Each component is a
  named recipe that **references theme tokens** (never raw values) and
  describes structure, states, and the project-native control it maps to.
  Answers *"how are tokens composed into the things the project ships?"*

The `components` tier depends on the `theme` tier; the `theme` tier stands
alone. This mirrors the established two-level split in `ux/design-language.md`
(`Local design tokens` → `Component map`) but makes it structured and
addressable.

#### Where it lives

A new **`docs/design/ux/`** sub-layout, with [](ux/design-language.md) remaining the
human-readable authority and narrative entry point:

```
docs/design/ux/
  design-language.md   # unchanged role: prose authority, source front-matter,
                       #   adaptation-acceptance checklist. Gains a "### Theme & components"
                       #   subsection that LINKS to the two files below.
  theme.md             # NEW — the theme tier: token scales in a structured block
  components.md        # NEW — the components tier: named component specs
```

Rationale for two new files (not one structured block inside
[](ux/design-language.md)): the tiers are independently consumed (a token-only
tool needs [](ux/theme.md) without parsing component prose), independently
re-generated by `grm-design-language-adapt`, and grow at different rates. This is
exactly the [subdir convention](README.md#subdir-convention-docsdesigntier)
already established for the UX tier — "promote a tier to a subdir once it has
(or will have) more than one doc." [](ux/design-language.md) stays the orientation
anchor and cross-links the two.

#### Schema — [](ux/theme.md)

A YAML-fronted markdown file. The structured block is a single fenced
`yaml` block under a stable heading so it is trivially parseable, with prose
around it for humans:

```yaml
# theme.md  — structured token block
theme:
  meta:
    stack: "React (web)"          # seeded by §1 detection, confirmed by user
    token-syntax: css-custom-prop # css-custom-prop | swift-asset | android-res | flutter-theme | tui-style
  color:
    accent:   { value: "#3B6EF6", role: "primary action" }
    surface:  { value: "#FFFFFF", role: "card / panel background" }
    text:     { value: "#1A1D23", role: "default body text" }
    error:    { value: "#D33A2C", role: "error palette base" }
    warning:  { value: "#E8A317", role: "warning palette base" }
  spacing:                        # a scale, not loose values
    unit: 4                       # base step (px / pt / dp per stack)
    scale: [0, 4, 8, 12, 16, 24, 32, 48]
  type:
    family: { sans: "Inter", mono: "JetBrains Mono" }
    scale:  [12, 14, 16, 20, 24, 32]   # ramp
    weight: { regular: 400, medium: 500, bold: 700 }
  radius:
    scale: [0, 4, 8, 12, 9999]    # last = pill/full
  motion:
    duration: { fast: 120, base: 200, slow: 320 }  # ms
    easing:   { standard: "cubic-bezier(0.2,0,0,1)" }
```

Rules:

- Every token has a **name** and a **value**; colour/role pairs carry a
  `role` string so a component can reference *intent*, not a hex literal.
- Scales (`spacing`, `type`, `radius`, `motion`) are **ordered lists or named
  maps** — never one-off magic numbers (this enforces the repo coding
  standard "no magic numbers" at the design layer).
- `token-syntax` records the stack idiom so a downstream codegen/demo step
  knows how to render the tokens (CSS custom properties vs. an `Assets.xcassets`
  colour set vs. an Android `colors.xml`).
- Stacks that have no concept of a token (e.g. a pure CLI) populate only the
  tiers that apply (a TUI has colour + maybe type, no radius/motion) and note
  the omission — partial is valid.

#### Schema — [](ux/components.md)

Each component is a named recipe that references theme tokens by **path**
(e.g. `theme.color.accent`), never by raw value:

```yaml
# components.md — structured component block
components:
  primary-button:
    maps-to: "MUI <Button variant=contained>"   # the project-native control
    intent:  "main call-to-action"
    tokens:
      background: theme.color.accent
      text:       theme.color.surface
      radius:     theme.radius.scale[1]
      padding:    [theme.spacing.scale[2], theme.spacing.scale[4]]
    states:
      hover:    { background: "darken(theme.color.accent, 8%)" }
      disabled: { opacity: 0.4 }
    a11y: "role=button; visible focus ring; 4.5:1 text contrast"
  text-field:
    maps-to: "MUI <TextField>"
    intent:  "single-line text entry"
    tokens:
      border:  theme.color.text
      radius:  theme.radius.scale[1]
      padding: theme.spacing.scale[2]
    states:
      focus: { border: theme.color.accent }
      error: { border: theme.color.error }
    a11y: "associated <label>; aria-invalid on error"
  error-banner:
    maps-to: "MUI <Alert severity=error>"
    intent:  "surface a recoverable error"
    tokens:
      background: theme.color.error
      text:       theme.color.surface
      radius:     theme.radius.scale[2]
    a11y: "role=alert; not conveyed by colour alone (icon + text)"
```

Rules:

- A component spec carries: **`maps-to`** (the project-native control — the
  `ux-demo` must use *this*), **`intent`**, a **`tokens`** map referencing
  `theme.*` paths, optional **`states`**, and an **`a11y`** note.
- **No raw values in [](ux/components.md)** — every visual property resolves
  through a `theme.*` reference (or a documented transform like
  `darken(token, n%)`). This is the layer's core invariant: re-theme by
  editing [](ux/theme.md) only; component recipes are stable across themes.
- The v1.18 deliverable is the **schema + the two files as stubs** with
  worked illustrative examples. Populating a real per-project component set is
  downstream work (noted as a follow-up and as #5's "concrete sets are
  downstream").

#### How `grm-design-language-adapt` produces it

`grm-design-language-adapt` gains a step (downstream C-work; designed here): after
producing the prose adaptation (its current Step 3), it **also** emits/refreshes
[](ux/theme.md) and [](ux/components.md) as **drafts**:

1. Map upstream Aura token scales → [](ux/theme.md) structured block, in the
   project's `token-syntax` (seeded by §1 detection).
2. Map the upstream control taxonomy → [](ux/components.md) recipes, each
   referencing the just-written theme tokens, with `maps-to` set to the
   project's native control where known (else left as a `TODO` for the user).
3. Both files inherit the same lifecycle as [](ux/design-language.md): written as
   **draft**, `source-sha` recorded once on the authority file (the two tier
   files derive from the same upstream SHA — no separate SHA tracking), and
   the **user advances `adaptation-status` to `adopted`** — the skill never
   auto-adopts. The existing re-adaptation **diff** flow (Step 4) applies
   per-file: on re-run, the skill diffs upstream and presents proposed token /
   recipe changes for selective application, never a silent clobber.

#### How it composes with the existing adaptation

- [](ux/design-language.md) stays the **authority and narrative**; it gains a
  `### Theme & components` subsection that links to [](ux/theme.md)/[](ux/components.md)
  and states which tiers the project populated.
- The **Adaptation-acceptance checklist** in [](ux/design-language.md) is unchanged
  in role but can now reference component names ("the `primary-button` recipe
  renders with `theme.color.accent`"), making each checklist item map 1:1 to a
  named component + screenshot.
- `grm-ux-demo-build` reads [](ux/components.md) to know **which controls to build** and
  [](ux/theme.md) for the **values to apply** — replacing today's prose-parse of
  `### Component map`. Stack purity is enforced by `maps-to` naming the native
  control.
- **Backward-compatible:** a project that never adds the tier files keeps a
  valid single-file [](ux/design-language.md). The tiers are additive; their absence
  is not an error.

### 3. Visual-regression for `ux-demo` (#6)

**Goal.** Turn the screenshots `grm-ux-demo-build` already asks for into a
**baseline** that later runs **diff against**, so adaptation drift is caught
mechanically. Tool-agnostic but concrete on layout, flow, and reporting.

**Baseline store location.** A new sibling of the existing screenshot dir:

```
ux-demo/
  screenshots/          # existing — current/working screenshots per checklist item
  screenshots/baseline/ # NEW — the accepted baseline set (committed)
  screenshots/diff/     # NEW — generated diff artifacts (gitignored)
  visual-regression.json # NEW — manifest: item → baseline file, capture meta, tolerance
```

- `screenshots/baseline/` is **committed** (it is the accepted reference and
  must travel with the repo for diffs to be reproducible).
- `screenshots/diff/` is **gitignored** (regenerated each run; ephemeral).
- `visual-regression.json` is the manifest mapping each acceptance-checklist
  item / component to its baseline file, plus capture metadata (viewport size,
  device-pixel-ratio, the [](ux/theme.md)/[](ux/components.md) SHA the baseline was taken
  against) and a per-item tolerance.

**Capture.** Tool-agnostic. The skill defines *what* a capture is — one
deterministic screenshot per named component/checklist item at a fixed
viewport and DPR, with animations disabled (so `theme.motion` doesn't cause
flaky diffs) — and leaves *how* to the project's stack: a headless browser for
web, the platform snapshot API for native (XCUI snapshot, Espresso), a
terminal-capture for TUI. The manifest records the capture parameters so a
re-capture is byte-comparable.

**Diff approach — pixel-diff primary, structural fallback.**

- **Pixel-diff (primary, default).** Compare the new capture to its baseline
  pixel-by-pixel; report the **fraction of differing pixels** against the
  per-item tolerance in the manifest (e.g. `0.1%` to absorb anti-aliasing).
  Above tolerance ⇒ drift. Emit the diff image (highlighted deltas) to
  `screenshots/diff/`. This is the concrete default because it needs no DOM /
  view-tree access and works for every stack including TUI (character-grid
  diff).
- **Structural (fallback / opt-in).** Where the stack exposes a render tree
  (web DOM, native view hierarchy), a structural snapshot (serialized tree)
  can be diffed instead of / alongside pixels — more stable against pure
  anti-aliasing noise, blind to colour-only regressions. The manifest's
  per-item `mode: pixel | structural | both` selects. Default is `pixel`;
  projects opt a flaky item up to `structural` or `both`.

**Opt-in skill flow — a new `grm-ux-demo-regress` skill (not a `grm-ux-demo-build`
overload).** Rationale: `grm-ux-demo-build` *constructs* the demo (idempotent
build); regression *evaluates* it (a check with pass/fail). Different verbs,
different triggers, different output — keeping them separate honours the
one-responsibility rule and keeps `grm-ux-demo-build` lean. `grm-ux-demo-regress`
shares `grm-ux-demo-build`'s stack-purity and opt-in conventions and is likewise
**GUI-projects-only / never auto-run**. Its flow:

1. **`--accept` (establish/update baseline).** Build/launch the demo, capture
   the full set, write into `screenshots/baseline/`, regenerate
   `visual-regression.json` with current capture meta + token SHA. Used after
   the user has reviewed and adopted an adaptation. Overwriting an existing
   baseline requires explicit user confirmation (it is the reference of
   record).
2. **`--check` (default — diff against baseline).** Capture fresh, diff each
   item against its baseline at its tolerance/mode, write diffs to
   `screenshots/diff/`, and emit a **drift report**.
3. **No baseline present** ⇒ the skill reports "no baseline — run with
   `--accept` first" and stops (it never silently treats first-capture as
   pass).

**Drift reporting.** `--check` emits a structured report (a table, not a wall
of prose):

| Component / item | Mode | Diff | Tolerance | Verdict |
|---|---|---|---|---|
| `primary-button` | pixel | 0.04% | 0.10% | PASS |
| `error-banner` | pixel | 2.3% | 0.10% | **DRIFT** |
| `text-field` | structural | 1 node | 0 | **DRIFT** |

For each DRIFT row it names the diff artifact in `screenshots/diff/` and notes
whether the baseline's recorded [](ux/theme.md)/[](ux/components.md) SHA differs from the
current one (i.e. *expected* drift from a deliberate token change vs.
*unexpected* drift from a regression). A drift that matches a token change is a
prompt to re-`--accept`; a drift with no token change is a likely regression.
The skill **reports** drift; it never auto-accepts a new baseline and never
ticks the adaptation-acceptance checklist (user-only, same rule as
`grm-ux-demo-build`).

## Acceptance

- [ ] `ux-enhancements-design.md` exists with the three numbered sections,
      each citing its issue (#4 / #5 / #6), and a README index row links to it.
- [ ] #4: the detection table maps every listed signal class (package.json
      deps, config files, file extensions, native/mobile markers) to an
      inferred framework/stack with a GUI verdict, defines a deterministic
      precedence order, and states the confirm-not-assume rule (pre-fill the
      default + surface evidence; user answer is authoritative; detection is
      read-only/offline and writes no file itself).
- [ ] #4: detection is shown to feed `grm-workflow-bootstrap` Step 3 Q9 and reuse
      the existing Step 4 patch outcomes (source-url, `{ux-demo-stack}`,
      deferral row, headless N/A) rather than introducing a parallel path.
- [ ] #5: the design defines a two-tier `theme` (tokens) + `components`
      (named recipes) layer, gives a concrete schema for each, specifies file
      layout under `docs/design/ux/` ([](ux/theme.md) + [](ux/components.md) alongside
      the unchanged [](ux/design-language.md)), and states the no-raw-values-in-
      components invariant.
- [ ] #5: the design specifies how `grm-design-language-adapt` produces both tier
      files as drafts under the existing source-sha / draft→adopted /
      selective-diff lifecycle, and how the tiers compose with (do not
      replace) the prose authority, including backward-compatibility for
      single-file projects.
- [ ] #5: the doc states explicitly that v1.18 ships the layer + schema (stubs
      + worked examples) and that concrete per-project component sets are
      downstream.
- [ ] #6: the design specifies the baseline store location (committed
      `screenshots/baseline/`, gitignored `screenshots/diff/`, a
      `visual-regression.json` manifest), the capture model (tool-agnostic,
      fixed viewport/DPR, animations off), the diff approach (pixel-diff
      primary with per-item tolerance, structural fallback), the opt-in skill
      flow (new `grm-ux-demo-regress` with `--accept` / `--check`, GUI-only,
      never auto-run), and how drift is reported (per-item table with
      verdict + token-SHA correlation).

## Open questions

- Should `grm-ux-demo-regress` live as a wholly new skill or as a sub-mode of a
  renamed `ux-demo`? This doc proposes a new skill on responsibility grounds;
  the implementing C-work item may revisit if the two share enough scaffolding
  to merge cleanly.
- Token-syntax codegen (emitting actual CSS custom properties / `colors.xml`
  from [](ux/theme.md)) — designed as a `token-syntax` hint here but the generator
  itself is unscoped for v1.18.

## Follow-ups

- Populate concrete per-project [](ux/theme.md) / [](ux/components.md) sets for the
  dogfood project and any GUI reference project (downstream of v1.18).
- Optional token-codegen step turning [](ux/theme.md) into stack-native token
  artifacts.
- Extend the detection table as new frameworks emerge; consider promoting it
  to a data file the bootstrap reads rather than inline prose.
- A CI-friendly non-interactive `ux-demo-regress --check` exit-code mode (drift
  ⇒ non-zero) for projects that want regression in their pipeline.
- Copilot-flavor port of the auto-detection guidance and the theme/component
  schema (note: `grm-ux-demo-regress` tooling parity is flavor-dependent).
