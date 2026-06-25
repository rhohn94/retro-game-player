# Modularization metrics & framework self-consistency capstone

> **Up:** [↑ Design docs](README.md)


> Design gate for v3.20, fifth release of the v3.16–v3.21 **project
> code-quality** program. Two threads: (1) add **modularization metrics** —
> coupling / instability / module-size — to the managed-project quality surface,
> and (2) the program's **capstone self-consistency audit**: a systematic
> contradiction sweep across Grimoire's own instructions (CLAUDE.md, skills,
> docs) with the findings remediated in this release.

## Motivation

The earlier program releases enforced *language* quality (Rust v3.16, HTML/CSS
v3.17), *architecture boundaries* (v3.18), and *DRY* (v3.19). What is still
unmeasured is **modularity as a quantity**: how tightly coupled the modules are,
which modules are unstable (depended-upon but volatile), and whether modules are
growing past a healthy size. `grm-code-health` reports complexity per *unit* but not
coupling between *modules*, so a project can stay within per-function complexity
budgets while congealing into a tangled, hard-to-change module graph.

Separately, the program promised a *critical pass over Grimoire's own
instructions for contradictions*. v3.16–v3.19 each ran a scoped pass; v3.20 runs
the **capstone** — a framework-wide sweep — and ships the fixes.

## Goals

- A **module-coupling dimension** in `grm-code-health` Section B: afferent (Ca) /
  efferent (Ce) coupling and instability `I = Ce/(Ca+Ce)` per module, plus a
  module-size budget, with baseline delta.
- **Modularization guidance** in [architecture-guidelines.md](../../architecture-guidelines.md) (target
  instability for core vs leaf modules; split a module before it grows past
  budget) with audit-hints so `grm-coding-practices-audit` checks it.
- The **capstone self-consistency audit**: framework-wide contradiction sweep;
  every confirmed finding fixed in this release and recorded below.

## Non-goals

- A full dependency-graph visualizer (metrics are numeric; visualization is out
  of scope).
- A hard coupling ceiling by default (metrics are warn-level; projects opt in).
- Token-footprint reduction of the framework's own docs (→ v3.21).

## Design

### 1. Module-coupling metrics in code-health

`grm-code-health` Section B gains, per module (a directory or package):

| Metric | Meaning | Signal |
|---|---|---|
| Ca (afferent) | modules that depend on this one | high = widely relied on |
| Ce (efferent) | modules this one depends on | high = does a lot of reaching |
| I = Ce/(Ca+Ce) | instability, 0 (stable) → 1 (unstable) | core modules should trend toward 0 |
| size | lines / file count per module | over budget → split |

Computed from the same import scan the `grm-architecture-audit` skill already uses
(shared mechanism, not a new parser). Recorded in the baseline cache for delta.
A module that is both **unstable and widely depended-upon** (high Ca *and* high
I) is the headline finding — that is the painful-to-change hotspot.

### 2. Modularization guidance + audit-hints

[architecture-guidelines.md](../../architecture-guidelines.md) §Module & boundary design gains modularization
guidance and two hints:
- `arch-module-instability` — core/shared modules trend stable (low I); volatile
  logic lives in leaf modules.
- `arch-module-size` — modules stay within a size budget; split before they grow
  past it (language sub-docs already specialize this, e.g. Rust's ~400-line
  module budget from v3.16).

### 3. Capstone self-consistency audit (findings & fixes)

A framework-wide sweep of CLAUDE.md, the release-pipeline skills, and the
standards/integration docs for genuine contradictions. Confirmed findings, all
fixed in this release:

1. **`grm-repo-reference` undercounted the profile registry** — said "The five
   starter profiles" while `.claude/model-effort-profiles.json` defines **six**
   (the `Autonomous` profile was undocumented). Fixed: heading de-counted and an
   `Autonomous` bullet added; the registry named as source of truth.
2. **`grm-release-agreement` description overstated its single-step effect** — said
   it "Creates … with status:agreed" while its body writes `status: draft` first
   and transitions to `agreed` in a later step (the guard hook requires the
   two-step lock). Fixed: description now states the draft→agreed transition.
3. **Paradigm-label inconsistency in the `grm-release-phase` variants** — the Noir
   and Weiss variants carry a `(Noir)` / `(Weiss)` title suffix; the Supervised
   variant had none. Fixed: Supervised variant titled `(Supervised)`.

No higher-severity contradiction (conflicting git-protocol or worktree
instructions, missing skill references) was found — the cross-references,
counts, and pipeline sequencing are otherwise consistent.

## Validation / Idempotency

- Coupling metrics are deterministic over a fixed import graph (same source →
  same Ca/Ce/I), order-stable, idempotent.
- `grep -c 'audit: id=' architecture-guidelines.md` rises from 6 to 8.
- The three capstone fixes are verifiable: `grep 'five starter' ` → absent;
  `grep 'status: draft then'` in release-agreement description → present;
  Supervised release-phase title carries `(Supervised)`.
- `grm-doc-assurance` reports no new flavor-parity / link / house-layout findings.

## Flavor parity

[architecture-guidelines.md](../../architecture-guidelines.md), this design doc, and the `grm-code-health` prose are
mirrored to `claude-code/` and `copilot/`. The capstone fixes to `grm-repo-reference`
and `grm-release-agreement` are mirrored to `claude-code/` (skills are
Claude-Code-canonical; copilot mirrors equivalent prompts where they exist).
