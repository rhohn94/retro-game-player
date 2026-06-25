# HTML/CSS quality enforcement

> **Up:** [↑ Design docs](README.md)


> Design gate for v3.17, second release of the v3.16–v3.21 **project
> code-quality** program. Brings the HTML and CSS standards from stubs to
> enforceable standards with full audit-hint coverage, pins the HTML/CSS quality
> command set (htmlhint / stylelint / dead-CSS), and folds the checks into the
> recipe `lint` target and the v1.26 merge-gate dials. Mirrors the v3.16 Rust
> pattern: extend the data-driven surfaces, add no new skill.

## Motivation

HTML and CSS are a large slice of the projects Grimoire scaffolds, yet
`docs/coding-standards/html.md` and [css.md](../../coding-standards/css.md) are explicit **stubs** —
`> Stub — fill in as conventions are agreed` — with **zero** audit-hints. So
`grm-coding-practices-audit` checks *nothing* for the front-end, `grm-code-health` has
no HTML/CSS row at all, and there is no dead-CSS or semantic/a11y gate. A managed
web project can accumulate inline styles, non-semantic `<div>` soup, inaccessible
controls, unused CSS, and `!important` debt with no Grimoire gate noticing.

## Goals

- **Promote both stubs to real standards** — semantics, accessibility, forms,
  CSS organisation (BEM / utility), layout, design tokens, and the existing
  no-inline-styles anti-pattern — each normative rule carrying an `audit:` hint.
- A pinned **HTML/CSS quality command set** (htmlhint, stylelint, dead-CSS)
  surfaced through the recipe `lint` target.
- A **HTML/CSS row** in `grm-code-health`: dead CSS (unused selectors) as the
  dead-code dimension, `jscpd` for duplication, stylelint complexity heuristics.
- Folds into the existing v1.26 `code-quality` dials at the merge gate — no new
  config cluster, defaults stay warn-not-block.

## Non-goals

- A standalone skill (extend `grm-code-health` + `grm-coding-practices-audit`).
- A specific CSS framework or methodology mandate beyond "pick one and apply it
  consistently" (BEM is the worked example, not a requirement).
- A full WCAG conformance audit — the a11y hints are the high-value subset
  (labels, alt text, keyboard reachability, contrast intent), not certification.
- Non-front-end languages (Rust shipped in v3.16; architecture is v3.18).

## Design

### 1. The HTML/CSS `lint` recipe contract

| Dimension | Command | Gate |
|---|---|---|
| HTML lint | `htmlhint` (semantic, a11y-attr, no-inline-style rules) | warn → block per dial |
| CSS lint | `stylelint` (standard config + `no-!important`, BEM pattern) | warn → block per dial |
| Dead CSS | `stylelint` unused / PurgeCSS dry-run against templates | warn on unused selector |
| Duplication | `jscpd` over `.css`/`.html` | warn over threshold |

### 2. Audit-hint coverage

Every normative rule in [html.md](../../coding-standards/html.md) and [css.md](../../coding-standards/css.md) gains an `audit: id=… check=…
severity=… applies="html"|"css"` marker. `grm-coding-practices-audit` greps these,
so the front-end audit surface goes from empty to comprehensive with no skill
change (the data-driven contract from `coding-practices-audit-design.md`).

### 3. `grm-code-health` HTML/CSS row

Section A (dead-code + duplication): unused CSS selectors via PurgeCSS-style
dry-run + `jscpd`. Section B (complexity): selector-specificity / nesting-depth
heuristics from stylelint. Recorded in the baseline cache for delta reporting.

### 4. Merge-gate integration

No new dial. The HTML/CSS `lint` recipe and `grm-code-health` HTML/CSS pass become
the concrete checks the existing v1.26 `code-quality` dials govern for web
projects.

## Self-consistency pass (program requirement, HTML/CSS scope)

- The **no-inline-styles** anti-pattern is stated in *both* [html.md](../../coding-standards/html.md) and
  [css.md](../../coding-standards/css.md). Confirmed consistent (same intent, mutually cross-referenced); kept
  in both because each doc is read independently. No contradiction.
- **"No magic numbers"** appears in [css.md](../../coding-standards/css.md) (design tokens) and `CLAUDE.md`
  §Coding practices. Consistent — the CSS custom-property guidance is the
  front-end realization of the cross-language rule.

## Validation / Idempotency

- `grep -c 'audit: id=' html.md css.md` rises from **0** to the full rule count;
  `grm-coding-practices-audit` picks them up with no skill edit.
- Standards edits are declarative and idempotent; re-running is a no-op.
- `grm-doc-assurance` reports **no new** flavor-parity / link / house-layout findings
  attributable to this release.
- [html.md](../../coding-standards/html.md) / [css.md](../../coding-standards/css.md) / this design doc are byte-identical across root,
  `claude-code/`, and `copilot/` (verified by `diff`).

## Flavor parity

[html.md](../../coding-standards/html.md), [css.md](../../coding-standards/css.md), and this design doc are mirrored to `claude-code/` and
`copilot/`. The recipe contract is documented identically. `grm-code-health` HTML/CSS
tooling prose is Claude-Code-only; the copilot mirror carries the same standards.
