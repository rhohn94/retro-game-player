# Internal documentation assurance

> **Up:** [↑ Design docs](README.md)


> Design gate for v1.28. Closes #50–#54: make Grimoire's own docs self-checking.
> One `grm-doc-assurance` skill backed by a runnable script implements five checks —
> flavor parity, design-doc layout, link integrity, a validated docs map, and
> cross-doc release consistency.

## Motivation

The dual-flavor mirror (`claude-code/` canonical ↔ root dogfood ↔ `copilot/`)
and the heavy cross-linking between skills, design docs, roadmap, version-history
and the feature-manifest drift by hand — proven repeatedly during the v1.22–v1.27
campaigns (un-stamped CLAUDE.md, un-synced paradigm sources, stale tracker links).
Nothing checks these mechanically. v1.28 adds a deterministic assurance pass run
at release closeout.

## Goals

- One skill, five composable checks, each independently selectable.
- A **runnable script** (dogfooded on this very repo) — not just prose.
- Report-only by default; `--strict` returns non-zero for a closeout gate.

## Non-goals

- Prose/style rewriting; external (network) link validation; a docs site builder.

## The five checks

1. **flavor-parity (#50).** For a declared set of must-match paths (skills, hooks,
   standards docs), compare `claude-code/<p>` against root `<p>` (and note
   `copilot/` analogs). Report files that diverge or are missing on one side.
   A declarative allow-list records intentionally-divergent paths (e.g. CLAUDE.md
   paradigm stamp differs by flavor).
2. **design-doc layout (#51).** Each `docs/design/*-design.md` must contain the
   house sections (Motivation, Goals, Non-goals, Design, Validation/Idempotency).
   Report missing/empty sections and unresolved `## Open questions`.
3. **link integrity (#52).** For every Markdown file, resolve relative links and
   `docs/...`/skill references; report dead targets. Skips http(s) and anchors.
4. **docs map (#53).** Validate `docs/README.md` (the documentation map) lists
   every `docs/*.md`; report orphans (file not in map) and stale entries (map row
   with no file), both directions. `--write-map` regenerates it.
5. **release consistency (#54).** Every `## vX.Y` section in `version-history.md`
   has a matching roadmap "Shipped" entry; every shipped version that introduced
   an adoptable feature has a `feature-manifest.md` row with the right
   `introduced-in`; `manifest-version` is monotonic; `framework-version` ≥ newest
   shipped.

## Implementation

`.claude/skills/grm-doc-assurance/SKILL.md` + `doc_assurance.py` (stdlib-only,
read-only except `--write-map`). CLI: `doc_assurance.py [check…] [--strict]
[--write-map]`. Default runs all checks, prints a per-check report, exits 0.
`--strict` exits non-zero on any finding (closeout gate).

A `docs/README.md` documentation map is added as the check-4 source of truth.

## Validation (dogfooded)

Run on this repo at ship time:
- link-integrity finds zero dead intra-repo links (fix any it surfaces).
- release-consistency reconciles v1.0–v1.28 across the four sources.
- design-doc layout passes for all `*-design.md` (or surfaces gaps to fix).
