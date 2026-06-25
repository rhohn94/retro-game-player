# Managed-project quality tooling

> **Up:** [↑ Design docs](README.md)


> Design gate for v1.27. Closes #41, #43, #46, #47, #48, #49: give managed
> projects deterministic, fast, CI-runnable quality tooling out of the box,
> complementing (not replacing) the agent-driven `grm-coding-practices-audit`.

## Motivation

`grm-coding-practices-audit` is agent-driven (no linter/AST). It is good for
nuanced, hint-keyed adherence checks but is neither fast nor deterministic, and
it does not cover dependency vulnerabilities, dead code, duplication, or
complexity trends. Managed projects deserve real tooling — wired in at scaffold
time and reused by the merge gate (v1.26) — so quality is enforced by tools, not
only by convention.

## Goals

- A documented **tooling tier**: linter/formatter + pre-commit, per app profile.
- New skills for **dependency/security audit**, **dead-code + duplication**, and
  **complexity/maintainability** reporting — each language-appropriate behind one
  abstraction, each emitting a report and an optional gate.
- **Expanded audit-hints** so the existing `grm-coding-practices-audit` catches more.
- Reuse the v1.26 `code-quality` dials and `{lint/typecheck/coverage}` commands —
  no new config schema.

## Non-goals

- Mandating a specific CI provider.
- Cross-language build integration; auto-fixing findings without review.
- Re-implementing the agent audit.

## Design

### Tooling tier (#41, #48) — `coding-standards/tooling.md`

A new sub-doc is the authority for the deterministic tooling layer:
- **Linter + formatter** per language (ruff+black / eslint+prettier /
  clippy+rustfmt / gofmt+go vet), surfaced as `{lint-command}` (captured at
  bootstrap, v1.26). The quick-start templates ship a matching config file in
  their `files/` tree so a scaffolded project lints from day one.
- **Pre-commit** framework config (`.pre-commit-config.yaml` or native hooks)
  that runs format + lint + fast tests, **reusing the same commands** (single
  source of truth — no command duplicated between pre-commit and the merge gate).
  Opt-in install at bootstrap.

`grm-quick-start-template` references this tier: applying a profile drops in the
lint/format config and (on opt-in) the pre-commit config.

### `grm-dependency-audit` skill (#46)

One skill, language-dispatched: `pip-audit` / `npm audit` / `cargo audit` /
`govulncheck`. Emits a normalized findings report (package, advisory, severity,
fixed-in). With `--file-issues`, routes each finding through `grm-feedback-to-issue`
(severity → label). Optional pre-release gate: fail on findings at/above a
configured severity. Read-only by default; never edits manifests.

### `grm-code-health` skill (#47, #49)

One skill emitting two report sections from language-appropriate tools:
- **Dead code + duplication** (#47): `vulture` / `ts-prune` / `cargo-udeps` +
  a jscpd-style duplication pass. Reports unused symbols and duplicated blocks.
- **Complexity + maintainability** (#49): `radon` / `ts-complexity` / `gocyclo` /
  clippy-cognitive. Reports current values and a **delta vs a stored baseline**
  (`.claude/cache/code-health-baseline.json`), so regressions are visible.

Both sections feed the v1.26 `code-quality` gate optionally (a regression or a
new dead-code/dup finding can warn or block). Run-on-demand and
optional-pre-merge modes; thresholds configurable.

### Audit-hints expansion (#43)

The audit surface grows by adding `<!-- audit: id=… check=… severity=… applies=… -->`
hints to [coding-standards.md](../../coding-standards.md) and the per-language sub-docs — covering error
handling, duplication, one-class-per-file, dependency hygiene, and per-language
idioms. No `grm-coding-practices-audit` skill change: the skill reads hints live. A
coverage table in [coding-standards.md](../../coding-standards.md) lists hint count per dimension.

## File-level changes (work-item map)

- `docs/coding-standards/tooling.md` — NEW tooling-tier authority (#41,#48).
- `.claude/skills/grm-dependency-audit/SKILL.md` — NEW (#46).
- `.claude/skills/grm-code-health/SKILL.md` — NEW (#47,#49).
- `docs/coding-standards.md` + `coding-standards/{python,javascript,rust}.md` —
  audit-hints + a hint-coverage table (#43).
- `.claude/skills/grm-quick-start-template/SKILL.md` — reference the tooling tier on
  apply (#41,#48).
- `sync-from-upstream/feature-manifest.md` — rows for the new skills + tooling.
- `workflow-bootstrap/manifest.md` — register the two new skills.

## Idempotency & safety

- New skills are read-only/report-first; gating is opt-in via the v1.26 dials.
- `grm-code-health` baseline is a derived, regenerable cache artifact (gitignorable).
- Re-running any scan with unchanged sources is deterministic.

## Validation

- `grm-dependency-audit` emits a normalized report and (with `--file-issues`) files
  one issue per finding.
- `grm-code-health` reports dead code, duplication, and complexity with a baseline
  delta; a regression is flagged.
- A newly-added audit-hint is exercised by `grm-coding-practices-audit` with no skill
  change.
- A scaffolded profile lints and (on opt-in) installs pre-commit.
