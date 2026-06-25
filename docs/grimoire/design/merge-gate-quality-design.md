# Merge-gate quality enforcement

> **Up:** [↑ Design docs](README.md)


> Design gate for v1.26. Closes #40, #42, #44, #45: stop quality regressions at
> the merge boundary instead of after the fact. Adds a config-gated quality gate
> to `grm-release-phase-merge`, an auto-spawned Reviewer under Noir, a test-coverage
> threshold, and static-analysis/type-check folded into the build gate.

## Motivation

Today `grm-release-phase-merge` runs the project's test command after each merge and
ticks §5 — nothing else. `grm-coding-practices-audit` exists but is on-demand only,
the `grm-reviewer` role is optional and manual, there is no coverage floor, and
type-checking is not standardized. Regressions therefore land on
`version/{X.Y}`/`dev` and are caught (if at all) after the fact. v1.26 moves these
checks **to the merge boundary**, gated by config so projects opt into strictness.

## Goals

- A single **`code-quality` config cluster** holding the four dials.
- `grm-release-phase-merge` consults the dials **before ticking §5** for a branch.
- Safe defaults: warn-not-block, coverage off unless set, reviewer Noir-only.
- Mirrored across flavors; an idempotent sync adopt step.

## Non-goals

- Replacing the on-demand `grm-coding-practices-audit` / `grm-reviewer` invocations.
- Imposing any gate by default on projects that do not opt in.
- A specific CI provider or external service.

## Design — the `code-quality` config cluster

Additive block in `.claude/grimoire-config.json` (no schema-version bump — same
additive convention as `cost-governance`/`release-phase-model`):

```json
"code-quality": {
  "audit-gate":   { "value": "warn" },        // off | warn | block
  "auto-reviewer":{ "value": "noir" },         // off | noir | always
  "coverage-threshold": { "value": null },     // null | <percent 0-100> | "delta"
  "typecheck": { "value": "build" }            // off | build (fold into build gate)
}
```

Absent block ⇒ all dials at their defaults above (`warn` / `noir` / off / `build`),
so an un-migrated project behaves exactly as before **except** the audit runs in
warn (report-only) mode. The integration master reads the block **live** at merge
time — no file-swap.

### Dial 1 — `audit-gate` (#40)

Before ticking §5 for a freshly-merged branch, `grm-release-phase-merge` runs
`grm-coding-practices-audit` scoped to that branch's diff (`git diff <base>...<branch>`):
- `off` — skip.
- `warn` — run; new gaps are filed via `grm-feedback-to-issue` (audience internal) and
  noted in §5 follow-ups; merge proceeds.
- `block` — run; **new** gaps (gaps not present on the base) abort the merge: the
  branch is rolled back (`git reset --hard` to pre-merge `ORIG_HEAD`) and the §5
  row stays unticked with a recorded reason.

"New gap" = a gap whose stable audit-hint key + file is absent from a base-branch
audit. The audit is diff-scoped so the gate is fast and only charges the branch
for what it introduced.

### Dial 2 — `auto-reviewer` (#44)

- `off` — never auto-spawn.
- `noir` (default) — under the Noir paradigm only, spawn a `grm-reviewer` per branch
  before the merge; **blocking** findings stop the merge (same rollback as
  `audit-gate: block`); non-blocking findings become §5 follow-ups.
- `always` — auto-spawn regardless of paradigm.

Reuses the existing `grm-reviewer` role wholesale (own-session, structured
blocking/non-blocking report) — no new review logic.

### Dial 3 — `coverage-threshold` (#42)

- `null` — off (default).
- a percent `0-100` — after the post-merge test run, parse coverage from the test
  command output; if below the floor, treat as a test failure (merge stops, §5
  unticked).
- `"delta"` — compare branch coverage against the base; a **drop** fails the gate.

Captured at bootstrap as `{coverage-command}` (often the test command with a
coverage flag) when the project opts in; the project documents how coverage is
emitted in a parseable form.

### Dial 4 — `typecheck` (#45)

- `off` — no type-check step.
- `build` (default) — the project's `{typecheck-command}` (e.g. `mypy`,
  `tsc --noEmit`, `cargo check`, `go vet`) runs as part of the **build gate**, so
  "build passes" implies "types check". Captured at bootstrap; quick-start
  templates ship a per-profile default.

## Where it plugs in

- `grm-release-phase-merge` SKILL — new **§Quality gate (before ticking §5)** section
  ordering the four checks: typecheck/build → tests(+coverage) → audit-gate →
  auto-reviewer; any failing gate stops the merge with the standard rollback.
- `grm-workflow-bootstrap` — interview captures `{lint-command}`,
  `{typecheck-command}`, `{coverage-command}` placeholders (blank ⇒ dial off) and
  writes the `code-quality` block defaults.
- [coding-standards.md](../../coding-standards.md) — documents the gate and the four dials as the
  authoritative reference; commands table gains `typecheck` / `coverage` rows.
- `grm-sync-from-upstream` `feature-manifest.md` — one `merge-gate-quality` row,
  config block additive + opt-in.

## Idempotency & safety

- All dials default to non-blocking / off, so adoption is behaviour-preserving
  apart from report-only audit output.
- A blocked merge rolls back to `ORIG_HEAD` (no partial state) and leaves the §5
  row unticked with a reason — re-runnable after the branch is fixed.
- The gate reads config live; no file-swap, no schema bump.

## Validation

No automated harness. Review against acceptance criteria:
- With `audit-gate: block`, a branch introducing a named gap is rolled back.
- With `auto-reviewer: noir` under Noir, a blocking finding stops the merge.
- With `coverage-threshold: 80`, a sub-80 run stops the merge.
- With `typecheck: build`, a type error fails the build gate.
- Absent `code-quality` block ⇒ defaults applied; no schema-version change.
