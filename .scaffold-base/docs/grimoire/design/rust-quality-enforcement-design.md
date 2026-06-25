# Rust quality enforcement

> **Up:** [↑ Design docs](README.md)


> Design gate for v3.16, first of the v3.16–v3.21 **project code-quality**
> program. Deepens how Grimoire enforces Rust code quality in *managed
> projects* — clippy, rustfmt, cognitive-complexity, module structure, and
> unused-dependency hygiene — wiring deterministic checks into the existing
> `grm-code-health` scan, the `grm-coding-practices-audit` surface, and the v1.26
> merge-gate dials. No new top-level skill: the framework prefers extending the
> data-driven surfaces (audit-hints + recipe `lint` target) over adding skills.

## Motivation

Rust is a large slice of the projects Grimoire scaffolds, yet the framework's
Rust enforcement is uneven. `docs/coding-standards/rust.md` carries strong prose
guidance but only four audit-hints, so `grm-coding-practices-audit` (which assembles
its checklist *only* from hints) covers a fraction of the written standard.
`grm-code-health` lists Rust tools but never pins the exact invocations, and nothing
ties `cargo clippy -D warnings` / `rustfmt --check` / `cargo machete` to the
merge boundary. The result: a managed Rust project can drift on formatting,
accrue clippy debt, grow cognitively-complex functions, and carry dead
dependencies without any Grimoire gate noticing.

## Goals

- A canonical **Rust quality command set** (format-check, lint, complexity,
  unused-deps) with exact invocations, surfaced through the recipe `lint`
  target so every consumer drives it by one stable name.
- **Audit-hint parity**: every enforceable rule in [rust.md](../../coding-standards/rust.md) carries an
  `audit:` hint, so `grm-coding-practices-audit` covers the whole written standard,
  not a quarter of it.
- A **complexity & module-size** dimension for Rust in `grm-code-health` (clippy
  `cognitive_complexity`, function/module line budgets) with baseline delta.
- Folds into the existing v1.26 `code-quality` dials at the merge gate — no new
  config cluster, no new default strictness.

## Non-goals

- A new standalone skill (extend `grm-code-health` + `grm-coding-practices-audit`).
- Imposing clippy-pedantic or a complexity ceiling by default — defaults stay
  warn-not-block; projects opt into `-D warnings` and thresholds.
- Auto-fixing (`cargo clippy --fix` / `cargo fmt`) inside a gate — report and
  let the task agent fix deliberately.
- Non-Rust languages (HTML/CSS is v3.17; architecture is v3.18).

## Design

### 1. The Rust `lint` recipe contract

`.claude/recipes.json` already exposes a `lint` target. For Rust projects the
canonical implementation is the ordered set:

| Dimension | Command | Gate semantics |
|---|---|---|
| Format | `cargo fmt --all -- --check` | fail = unformatted code |
| Lint | `cargo clippy --all-targets --all-features -- -D warnings` | fail = any clippy warning |
| Unused deps | `cargo machete` (or `cargo +nightly udeps`) | warn = dead dependency |
| Complexity | `cargo clippy -- -W clippy::cognitive_complexity` | warn = over threshold |

The recipe runs them in cheap-to-expensive order and stops the *gate* on the
first hard failure (format/lint) while collecting warn-level findings
(unused-deps/complexity) for the report.

### 2. Audit-hint parity in [rust.md](../../coding-standards/rust.md)

Every normative rule in [rust.md](../../coding-standards/rust.md) gains an `audit: id=… check=… severity=…
applies="rust"` marker. `grm-coding-practices-audit` greps these and builds its
checklist, so the audit surface grows with the doc and needs no skill change
(the data-driven contract from `coding-practices-audit-design.md`). New hints
cover module/function size, re-export discipline, `thiserror`/`anyhow` split,
cognitive complexity, rustfmt-check, and dependency pruning.

### 3. `grm-code-health` Rust complexity dimension

`grm-code-health` Section B (complexity + maintainability) pins the Rust path to
clippy's `cognitive_complexity` lint plus a function-length and module-length
budget, recorded in the baseline cache for delta reporting. Section A
(dead-code + duplication) pins `cargo machete` for unused deps and the
`dead_code` lint for unused symbols.

### 4. Merge-gate integration

No new dial. `grm-release-phase-merge` already consults the v1.26 `code-quality`
dials; the Rust `lint` recipe and the `code-health --gate` pass become the
concrete checks those dials govern for Rust projects. `audit-gate: warn`
(default) reports; `block` stops the merge.

## Self-consistency pass (program requirement)

Part of the v3.16–v3.20 program is a critical pass over Grimoire's *own*
instructions for contradictions. For v3.16 the pass is scoped to the Rust
surface: reconcile [rust.md](../../coding-standards/rust.md) against [coding-standards.md](../../coding-standards.md) and `CLAUDE.md`
(e.g. the cross-language "unit-test every function" rule vs Rust's
`#[cfg(test)]` convention; the "no magic numbers" rule vs Rust `const`
guidance). Findings and their resolution are recorded in the v3.16 release
plan's self-consistency section.

## Validation / Idempotency

- **Audit-hint parity** is checkable: `grep -c 'audit: id=' rust.md` rose from 4
  to 13, and `grm-coding-practices-audit` picks every new hint up with no skill
  change (data-driven contract).
- **Idempotent docs**: re-running the standards edits is a no-op; the recipe
  `lint` contract is declarative. `grm-doc-assurance` must report **no new**
  flavor-parity, link, or house-layout findings attributable to this release
  (pre-existing findings are out of scope and tracked separately).
- **Flavor parity**: [rust.md](../../coding-standards/rust.md) and this design doc are byte-identical across
  root, `claude-code/`, and `copilot/` (verified by `diff`).

## Flavor parity

[rust.md](../../coding-standards/rust.md) and the standards docs are mirrored to `copilot/`. The recipe
contract is documented identically. `grm-code-health` is Claude-Code-only tooling
prose; the copilot mirror carries the same guidance in its standards docs.
