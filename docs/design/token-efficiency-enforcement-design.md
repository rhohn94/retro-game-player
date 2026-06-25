# Token-efficiency enforcement (skill-footprint budget)

> **Up:** [↑ Design docs](README.md)


> Design gate for v3.21, the program's token-efficiency release. **Applies and
> enforces** the existing v1.9 token-efficiency *methodology*
> ([token-efficiency-design.md](token-efficiency-design.md)) rather than re-deriving it — turning its
> Lever 4 (fixed-context / preamble trim, *data-gated*) into an operative
> convention for the framework's own skill files: a **lean head + `reference.md`
> split** that shrinks the per-trigger loaded footprint without losing
> capability. Establishes the measured baseline and lands the first worked split.

## Motivation

The v1.9 methodology ranks cost levers and explicitly marks Lever 4
(boilerplate/preamble trim) the *lowest* value — *except* for files that are
**high-frequency and cold-read-dominated**: "a large preamble loaded once per
spawned task agent across hundreds of one-shot spawns." A skill's `SKILL.md` is
exactly that class — its full body loads into context every time the skill
triggers, on every agent that uses it. The v1.29 `grm-doc-assurance` **skill-budget**
check already measures this (a 12,000-byte budget per `SKILL.md`) and recommends
the fix — *"split a lean head + reference.md"* — but **no skill had applied it**:
zero `reference.md` files existed and **13 skills sat over budget**. The
convention was documented and unused; the saving was identified and unbanked.

## Goals

- Make the lean-head/`reference.md` split an **operative, worked convention**,
  not just a doc-assurance recommendation — with a concrete first application.
- **Bank a measured reduction** on the worked example and record the baseline so
  remaining remediation is tracked, not lost.
- Tie the convention to the v1.9 methodology (it *is* Lever 4 applied to the
  worthwhile class) and to the existing `grm-token-measure` protocol for per-op A/B.

## Non-goals

- Re-deriving the cost model / levers / measurement protocol — v1.9 owns those.
- Splitting all 13 over-budget skills in this release (a multi-release backlog;
  several are release-critical and must be split carefully — see §Backlog).
- Behaviour change: a split must preserve the skill's behaviour exactly — the
  head stays self-sufficient for the common path; `reference.md` carries detail
  the head points to. "Same result, fewer tokens loaded" is the bar (v1.9 §Scope).
- A new config dial or a hard gate that blocks a release on skill size (the
  budget stays a `grm-doc-assurance` warn-level finding).

## Design

### The lean-head / reference.md convention

A skill over the 12,000-byte budget splits into:

- **`SKILL.md` (lean head)** — front-matter (name + description + triggers), the
  one-paragraph purpose, the **load-bearing operating instructions** (schema +
  procedure), and a short *Reference (load on demand)* section that names each
  moved section and when to read it. Must be self-sufficient for the common path.
- **`reference.md`** — formats, lookup tables, deep-dives, anti-patterns — the
  detail an agent reads only when it actually needs that specific piece.

Behaviour is preserved because the procedure in the head tells the agent exactly
when to consult `reference.md`; the common path never needs it. The saving is
real because the head is what loads on every trigger; `reference.md` loads only
on demand.

### Worked example (this release): `grm-cost-budget`

`grm-cost-budget` was reference-heavy (16,890 bytes): a config schema + procedure
(load-bearing) plus six detail sections (persistence format, mode tables, output
strings, defer mechanism, verbosity deep-dive, anti-patterns). The split keeps
§1 schema + §2 procedure in the head and moves §3–§8 to `reference.md`:

| File | Before | After | On-trigger load |
|---|---|---|---|
| `cost-budget/SKILL.md` | 16,890 B | **8,991 B** | every trigger |
| `cost-budget/reference.md` | — | 9,150 B | on demand only |

**Result: a 7,899-byte (~47%) reduction in the per-trigger loaded footprint**,
under the 12,000 budget. Over-budget skills: 13 → 12. (Byte count is the
`grm-doc-assurance` budget metric and a sound proxy for the token footprint; for a
per-operation token A/B, use the v1.9 `grm-token-measure` protocol on the skill's
session transcript.)

### Baseline & remediation backlog

The 12 still-over-budget skills, largest first, are the tracked remediation
backlog (split in later releases, release-critical ones with extra care):
`grm-onboarding` (46.5 KB), `grm-design-language-adapt` (27.8 KB), `grm-workflow-scaffold`
(25.6 KB), `grm-workflow-bootstrap` (24.7 KB), `grm-integration-master` (19.3 KB),
`grm-release-phase-merge` (15.9 KB), `grm-ux-demo-regress` (15.1 KB), `grm-sync-from-upstream`
(14.7 KB), `grm-researcher` (13.7 KB), `grm-triager` (13.4 KB), `grm-hard-reset` (13.1 KB),
`grm-scout` (12.1 KB). The `grm-doc-assurance` skill-budget check is the live tracker —
each future split removes one finding.

## Validation / Idempotency

- `wc -c .claude/skills/grm-cost-budget/SKILL.md` → 8,991 B (was 16,890; under the
  12,000 budget). `reference.md` exists and carries §3–§8 verbatim.
- `grm-doc-assurance` skill-budget findings: **13 → 12** (cost-budget removed); no
  new flavor-parity/link/house-layout findings.
- The split is content-preserving — §3–§8 moved verbatim, the head points to
  each; re-running the byte check is deterministic/idempotent.
- Flavor parity: `grm-cost-budget` head + reference mirrored to `claude-code/`.

## Flavor parity

`grm-cost-budget` is a Claude-Code skill; its `SKILL.md` + `reference.md` are
mirrored to `claude-code/.claude/skills/grm-cost-budget/`. This design doc is
mirrored to `claude-code/` and `copilot/`. The convention applies to any flavor
that ships large skill files; copilot prompts adopt the same head/reference
split when they exceed budget.

## Tooling (v3.37.2)

The convention is now **automated**: `.claude/skills/grm-doc-assurance/split_skill.py`
performs the lean-head/`reference.md` split deterministically (verbatim section
moves, flavor-mirrored, budget-verified) — replacing the ~100K-token split agent
with a Bash call. `.claude/skills/grm-token-measure/footprint.py` reports the static
baseline. Over-budget `grm-doc-assurance` findings name `split_skill.py` as the fix.
