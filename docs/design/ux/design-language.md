---
source: upstream
source-url: https://github.com/rhohn94/design-language
source-sha: ""
source-pin: ""
adaptation-status: draft
---

# UX Design Language

> **Up:** [↑ UX](README.md)


<!-- Project agent: this file is the per-project UX design-language authority.
     It starts as a template stub. Fill each section for THIS project, then run
     the `design-language-adapt` skill to pull and adapt the upstream source.
     That skill governs how this file's front-matter and acceptance checklist
     are consumed — read its SKILL.md before editing them. -->

## Motivation

<!-- Project agent: state in 2-4 sentences why THIS project needs an explicit UX
     design language. What inconsistency or re-invention does it prevent? Who
     reads this doc — designers, the authoring agent, reviewers? Keep it concrete
     to this project; the cross-project rationale is already in the scaffolding
     design doc and should not be restated here. -->

## Scope

<!-- Project agent: list what this project's design language covers (e.g. the
     control set, views, and states the project actually ships) vs. what is
     explicitly deferred (non-goals). Be honest about the long tail — the
     `ux-demo` covers only the most relevant 2-5 controls/views, so anything
     beyond that belongs under deferred here. -->

## Design

### Source

<!-- Project agent: record whether this project tracks `upstream` or runs in
     strict-`local` mode (see the `source:` front-matter field above).
       - `upstream`: `design-language-adapt` clones the `source-url` repo, freezes
         it by `source-sha`, and surfaces diffs for selective review on re-runs.
       - `local`: the clone step is skipped; this file's content is authoritative
         and no `source-sha` is tracked.

     Front-matter field reference:
       source-pin:  (optional) Specific upstream commit SHA to pin this
                    adaptation to, instead of tracking HEAD. When set, the
                    skill checks out that exact SHA from the cloned repo;
                    `source-sha:` will equal this value after adaptation.
                    Leave empty to track HEAD (default behaviour).
       source-sha:  The upstream SHA actually used during the last adaptation.
                    Written by the skill — do not edit by hand.

     See the `design-language-adapt` skill for the full behaviour of each mode. -->

### Local design tokens

<!-- Project agent: define this project's adapted design tokens. Translate the
     upstream language into THIS project's stack — do not paste HTML/CSS into a
     non-web project. Cover at least:
       - Colors      — accent, surface, text, error/warning palettes
       - Type        — families, scale, weights
       - Spacing     — the spacing scale / unit
       - Radius      — corner radii for controls and surfaces
       - Motion      — easing and duration conventions, if any
     Adapt where the upstream concept does not map cleanly; note the deviation. -->

### Component map

<!-- Project agent: list which upstream components this project adapts, and to
     what local control/widget. Start with the 3-5 most relevant components your
     `ux-demo` will cover. One row per component, e.g. upstream "primary button"
     -> this project's equivalent. Omit upstream components the project does not
     use. Follow the verbatim-where-possible, adapt-where-necessary rule (see
     the `design-language-adapt` skill). -->

### Theme & components

This project's structured token and component tiers live in two companion files:

- [`theme.md`](theme.md) — design token scales (colour, spacing, type, radius, motion).
  Status: `draft` (see the file's front-matter).
- [`components.md`](components.md) — named component recipes referencing theme tokens.
  Status: `draft` (see the file's front-matter).

The prose adaptation above remains the human-readable authority. The tiers are
machine-addressable companions: `ux-demo-build` reads `components.md` for which
controls to build and `theme.md` for the values to apply. Edit `theme.md` to
change token values; component recipes in `components.md` reference tokens by
path and update automatically.

<!-- Project agent: advance the `adaptation-status` fields in theme.md and
     components.md to `adopted` after reviewing and completing the token values
     and maps-to fields. Never auto-adopt — the user makes this call. -->

## Adaptation acceptance

<!-- Project agent: this is the project-specific contract. Each item asserts "the
     demo correctly shows X" against the adapted language; the user ticks a box
     after reviewing the `ux-demo` and its screenshots under
     `ux-demo/screenshots/`. Do NOT auto-tick these — the user marks them complete
     after demo review. Map filenames 1:1 to items where practical. The
     `ux-demo-build` skill produces the demo these items are reviewed against. -->

- [ ] <!-- e.g. the primary button uses the adapted accent colour -->
- [ ] <!-- e.g. the error state uses the adapted error palette and warning iconography -->
- [ ] <!-- e.g. the form-field stack uses the adapted spacing scale -->

## Open questions

<!-- Project agent: unresolved decisions for this project's design language.
     Resolve and prune as you go; delete this section if there are none. -->

## Follow-ups

<!-- Project agent: out-of-scope items deferred to a later branch or release —
     e.g. controls the demo did not yet cover, or a theme layer on top of these
     tokens. -->
