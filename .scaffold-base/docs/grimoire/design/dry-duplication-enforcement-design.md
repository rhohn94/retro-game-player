# DRY & duplication enforcement

> **Up:** [↑ Design docs](README.md)


> Design gate for v3.19, fourth release of the v3.16–v3.21 **project
> code-quality** program. Promotes duplication from a reported metric to a
> first-class, gate-able dimension with a concrete remediation path, and fixes a
> standing self-consistency defect: the audit-hint coverage table has claimed a
> cross-language duplication hint since v1.27 that never existed.

## Motivation

DRY is stated everywhere in Grimoire's guidance — `CLAUDE.md` §Coding practices
("Don't: duplicated code"), [coding-standards.md](../../coding-standards.md) §Standard practices ("No
duplicated code (DRY)"), and the v1.27 audit-hint coverage table lists a
"Duplication (DRY)" row. But the *enforcement* is thin and partly fictional:

- [coding-standards.md](../../coding-standards.md) carries **no** `audit:` hint for duplication, so
  `grm-coding-practices-audit` never actually checks it cross-language — yet the
  coverage table asserts one hint exists. The doc contradicts itself.
- `grm-code-health` reports duplication (`jscpd`) but treats it as informational;
  there is no remediation path connecting a found duplicate to the framework's
  existing reuse machinery (the **component-registry**).

So a managed project can copy-paste across files indefinitely with only an
informational nudge, and the standards doc miscounts its own coverage.

## Goals

- Add the missing **`dry-no-duplication`** cross-language audit-hint to
  [coding-standards.md](../../coding-standards.md) and make the coverage table truthful.
- A **DRY remediation path**: when a cross-file duplicate is found, the guidance
  routes to *extract a shared unit → register it in the component-registry* so
  reuse is discoverable, not re-duplicated.
- Promote duplication to a **first-class `grm-code-health` gate dimension** — a
  cross-file duplication threshold that the v1.26 `code-quality` dials can warn
  or block on, alongside the existing dead-code/complexity gates.

## Non-goals

- A new config dial (reuse the v1.26 `code-quality` `audit-gate`).
- Auto-extraction / auto-refactor of duplicates.
- A new duplication tool — `jscpd` stays the cross-language detector.
- Token-footprint duplication of the framework's *own* docs (that is v3.21).

## Design

### 1. The missing cross-language hint (self-consistency fix)

[coding-standards.md](../../coding-standards.md) §Standard practices gains:

```
<!-- audit: id="dry-no-duplication" check="no copy-pasted logic across files; repeated blocks (>N lines, ≥2 sites) factored into a shared unit" severity="warn" applies="all" -->
```

on the existing DRY bullet. The v1.27 coverage table is updated so its
"Duplication (DRY)" row points at a hint that now genuinely exists. Per-language
docs already specialize it (`css-dry-declarations`; Rust's reuse guidance).

### 2. DRY remediation path → component-registry

A new *DRY & duplication remediation* subsection states the resolution ladder:

1. **Lift** the duplicated block into a shared function / base class / module
   (the OO + base-class guidance already in the doc).
2. **Generalize** it so it carries no caller-specific values (the architecture
   *genericity* rule).
3. **Register** the extracted unit via the **`grm-component-registry`** so the next
   consumer finds it instead of re-duplicating — closing the loop between
   "duplication found" and "reuse made discoverable."

### 3. First-class duplication gate in code-health

`grm-code-health` Section A already runs `jscpd`. This release pins it as a
**gate-able** dimension: a configurable duplication threshold (block size ×
site count) whose breach the v1.26 `audit-gate` dial treats as warn/block, and a
report line that names the *remediation* (lift + register) rather than only the
sites. No new dial; the existing `audit-gate` governs it.

## Self-consistency pass (program requirement, DRY scope)

- **Finding (fixed):** the v1.27 audit-hint coverage table claimed a
  "Duplication (DRY)" hint in [coding-standards.md](../../coding-standards.md); none existed. Resolved by
  adding `dry-no-duplication`, making the table accurate.
- **DRY stated in three places** (`CLAUDE.md`, [coding-standards.md](../../coding-standards.md),
  coverage table) — confirmed consistent in *intent*; the gap was enforcement,
  now closed. The CLAUDE.md one-liner remains a summary that defers to
  [coding-standards.md](../../coding-standards.md) (the doc's own stated precedence).

## Validation / Idempotency

- `grep 'dry-no-duplication' docs/coding-standards.md` → present; the coverage
  table's duplication row now resolves to a real hint.
- `grm-coding-practices-audit` picks the new hint up with no skill change.
- Edits are declarative/idempotent; re-running is a no-op.
- `grm-doc-assurance` reports no new flavor-parity / link / house-layout findings.

## Flavor parity

[coding-standards.md](../../coding-standards.md), this design doc, and the `grm-code-health` prose are mirrored
to `claude-code/` and `copilot/` (code-health prose Claude-Code-only; copilot
carries the standards). The remediation ladder cites `grm-component-registry`, which
exists in both flavors.
