# Release-Planning Workflow

> **Up:** [↑ Design docs](README.md)


## Motivation

The `grm-release-planning` skill produces a structured work-items report by reading
the roadmap, in-flight plan, carryovers, and design docs. That read phase is
inherently parallel — roadmap, carryovers, and design-doc readiness are
independent — yet the skill's serial execution in one context reads them one
after another. For a release with several design docs, the read phase dominates
wall-clock and token volume.

v1.4 adds a **Workflow** that mechanises the skill's read-heavy steps: it fans
parallel subagents across the gather phase, collects structured results, and
synthesises a report in the same format the skill describes. The result is the
same planning input, produced faster and at roughly one-eighth the token cost of
an all-opus serial run.

This document specifies how the workflow is designed and why, so the lessons
survive independent of the script. The plan is in
[`release-planning-v1.4.md`](../../release-planning-v1.4.md) §2 W1.

## Scope

**In scope:**
- The `grm-release-planning` workflow script (`claude-code/.claude/workflows/release-planning.js`)
  and its design rationale.
- The agent-tiering cost model and the A/B measurements that drove it.
- The read-only safety contract that keeps workflows clear of the worktree-isolation
  and protected-branch hooks.
- The `.claude/workflows/<name>.js` naming convention.
- Comparison of Workflow, skill, `spawn_task`, and `Agent` — when to use each.
- Cross-links to [integration-workflow.md](../integration-workflow.md) §Workflow-based-orchestration and to
  the parallel W7 spike's candidate list.

**Out of scope for v1.4:**
- Building workflows for other skills — the W7 spike researches candidates; the
  builds are v1.5+.
- Auto-running the workflow from the skill — it remains opt-in and billed.
- A Copilot-flavor equivalent — `Workflow` is a Claude Code primitive; the gap
  is documented in P3.1 (see §Flavor note).
- Code-review, hardening, or schema changes to the workflow script itself
  (owned by W3).
- Integrating the workflow into `grm-workflow-bootstrap` or golden baselines
  (owned by W4).

## Design

### Workflow vs. skill vs. spawn_task vs. Agent

Four orchestration mechanisms exist in this scaffolding; each fits a different
shape of work:

| Mechanism | Human in loop | Isolation | Mutates code | Best for |
|---|---|---|---|---|
| `spawn_task` | yes (chip) | worktree per item | yes (commits) | distributing work items (`grm-release-phase`) |
| `Agent` | no | shared session | via tools | helper subagents inside the master's session |
| `Workflow` | no | shared, read-mostly | no (by convention) | parallel read / verify / synthesis fan-out |
| skill | yes (prompted) | master's session | via skills | interactive, user-guided multi-step procedures |

**Skill vs. Workflow — complementary, not competing.** The
`grm-release-planning` skill is the authoritative description of *what* a
release plan must contain (Steps 1–5 in `SKILL.md`). The `grm-release-planning`
Workflow is one mechanised *way* to draft the report's first pass by fanning
the read-heavy steps across subagents. Both produce the same report shape; the
Workflow returns a draft that the master hands to the user for iteration before
`grm-release-agreement` locks scope.

**When to use each:**
- Use the **skill** when you want an interactive, user-guided walk through the
  planning steps — easiest for small releases or when the user wants to steer
  each step.
- Use the **Workflow** when you want fast, parallelised coverage of a larger
  release with many design docs and carryovers — and the user has explicitly
  opted into multi-agent orchestration (Workflow is billed).
- Use **`spawn_task`** to distribute concrete work items once the plan is
  locked (`grm-release-phase`). Each item is interactive, worktree-isolated, and
  commits code on a branch — the opposite of the Workflow's read-only profile.
- Use **`Agent`** for helper subagents inside the master's own session (e.g.,
  reading a single file in the background). Not for fan-out across many items.

See also [[integration-workflow.md](../integration-workflow.md) §Workflow-based-orchestration](../integration-workflow.md#workflow-based-orchestration)
for the full comparison table and the Copilot flavor-gap note.

### Agent-tiering / cost model

#### A/B measurements (v1.4 plan, this repo)

Four configurations were measured on the same planning job:

| Config | Model / strategy | Cost (approx.) | vs. baseline |
|---|---|---|---|
| v1 | All-opus, fan-out sizing (one sizer per item) | ~$14.5 | baseline |
| v2 | Tiered models, batched sizing | ~$2.3 | ~84% cheaper |
| v3 | Tiered models, fan-out sizing | ~$3.4 | ~76% cheaper |
| v4 | Tiered + batched + orient/velocity merge + single-step reads (shipped config) | ~$1.7 | ~88% cheaper |

v4 is the shipped configuration. The measurements are approximations; the
ratios are robust across runs.

#### Finding 1 — model tier is the dominant cost lever

Every agent pays a fixed context cost on entry: system prompt + tool schemas
account for roughly 45K tokens per agent. Each agent's own *output* is small by
comparison (~1K). This means **token volume is nearly flat across model tiers**
— the same agents reading the same files produce roughly the same number of
input tokens regardless of model. What changes is the *rate*:

- Opus ≈ 5× the cost of Sonnet per token
- Sonnet ≈ 3× the cost of Haiku per token
- Therefore Opus ≈ 15× the cost of Haiku

Switching every mechanical reader from opus to haiku cuts cost by ~15× on those
agents with no quality loss — they are doing mechanical extraction, not
judgement. The workflow applies this insight directly:

| Phase | Agent | Model | Why |
|---|---|---|---|
| Orient | Version resolver + velocity reader | haiku | Mechanical lookup from well-structured files |
| Gather | Roadmap reader, carryover reader | haiku | Structured extraction; no judgement needed |
| Gather | Design-doc readiness reader | haiku | Schema-constrained classification (see below); no free-text judgement |
| Size | Item sizer (batch or fan-out) | sonnet | Requires file-reading + calibrated judgement on scope |
| Synthesize | Report assembler | session model | User-facing deliverable; output is small; no reason to downgrade |

**Note:** `agent()` exposes a `model` parameter but not an `effort` parameter.
Model tier is therefore the *only* cost knob available inside a workflow script.
Effort-level tuning must be done by the user at session level.

**Design reader was downgraded Sonnet → Haiku (v1.10 W1, unacted v1.9 audit
rec C4).** The reader was originally Sonnet "for light judgement," but its
output is bounded by `DESIGN_SCHEMA`: each doc is classified into a fixed
3-value `status` enum (`exists-sufficient` / `exists-needs-extension` /
`missing-blocks-impl`) plus a short path string and a short `needed`
instruction. That is enum classification, not open-ended reasoning, so the
schema removes the free-text judgement that motivated Sonnet — Haiku produces
the same structured result at the ~3× lower Haiku rate (`docs/grimoire/token-efficiency-audit.md`
rec C4: "≈3× cheaper on that reader; low-risk trial"). All three Gather readers
are now Haiku. The sizers (C5/C6) stay Sonnet: their bands are genuine scope
judgement whose errors propagate into the plan.

#### Workflow model tiers vs. the dispatch profile (v1.10 decision)

The v1.9/v1.10 audit downgrades are now the **unconditional** in-script defaults
for this workflow: `read:design` → Haiku (W1/C4), the synthesizer → Sonnet
(v1.9 E3/C7), and the sizers held at Sonnet. These tiers are correct regardless
of cost profile, because each step is schema-bounded or mechanical — Haiku/Sonnet
produce the same structured result a high-effort project would, so even the
highest cost posture has no reason to pay Opus there.

The in-script tiers therefore stay **decoupled from the model/effort dispatch
profile** (reaffirming the v1.9 principle). The profile dial governs
`grm-release-phase` `spawn_task` dispatch only; workflows are Claude-Code-only
orchestration, and wiring them to the profile would re-introduce complexity for
marginal benefit when the savings are already captured unconditionally above.
Tuning, when a project genuinely needs more capability, is per-item via the
escape hatches — the `opus-required` plan flag (N4 dispatch ceiling) for
dispatch, and `item.hard` (write-capable Execute → Opus) for workflows — not a
profile-wide override.

A **profile-aware `workflow-overrides` block was considered and declined**: it is
redundant with the unconditional W1/W2 downgrades and contradicts the decoupling
principle (analogous to v1.9's E6 data-gated no-op).

#### Finding 2 — batched sizing beats fan-out below a threshold

v2 (batched) is cheaper than v3 (fan-out) despite using the same model tier.
Why: fan-out sizers each re-read the same overlapping design docs and each
pay the full per-agent fixed overhead (45K context). A single batched sizer
reads each shared file exactly once and pays the overhead once. For a typical
release (≤8 items), the overlap is high and one batched agent wins on both
cost and wall-clock.

The workflow uses an adaptive strategy:

- **≤ `SIZE_FANOUT_THRESHOLD` items (computed default, see below):** one batched
  sonnet agent reads shared files once and sizes all items together.
- **> threshold:** fan-out (one agent per item) — many independent items make
  parallel wall-clock worth the duplicated reads.

##### The fan-out crossover formula (v1.10 W4)

The threshold was a fixed constant (`8`). It is now **derived** from the cost
model so the magic number is explained, and exposed as a configurable arg.

The two strategies trade tokens against wall-clock:

| | Token cost (for N items) | Wall-clock |
|---|---|---|
| Batched (one sizer) | `F + R` — fixed context once, shared docs read once | `F + N·w` — serial, item-by-item in one context |
| Fan-out (N sizers) | `N·(F + R)` — each agent re-pays `F` and re-reads `R` | `F + w` — parallel, ~constant |

where `F` = per-agent fixed context (system prompt + tool schemas, ~45K —
Finding 1, the dominant per-agent cost), `R` = the overlapping design/source
docs the sizers read, and `w` = the incremental read+reason a batched sizer
spends per *additional* item (~6K).

For any `N > 1`, fan-out is **strictly more expensive in tokens** (`N·(F+R)`
vs `F+R`). The only thing it buys is wall-clock: the batch sizer accumulates
`N·w` of serial work, while fanned agents finish in ~constant time. Fanning out
is worth its ~N× token premium only once the batch's serial accumulation rivals
a single agent's fixed-context floor:

```
N · w  ≳  F        ⇒        N  ≳  F / w
```

With `F ≈ 45,000` and `w ≈ 6,000`, the crossover is `45000 / 6000 ≈ 7.5`, which
rounds to the shipped default of **8** — confirming the original constant, now
with a derivation behind it. Below the crossover, batching wins on *both* axes
(cheaper and faster on the overlap); above it, fan-out trades the token premium
for parallel wall-clock.

Both inputs are named constants in the script (`PER_AGENT_FIXED_CONTEXT`,
`SIZER_PER_ITEM_WORK`) and the default is `Math.round(PER_AGENT_FIXED_CONTEXT /
SIZER_PER_ITEM_WORK)` — no bare magic number.

##### Configurable override

`SIZE_FANOUT_THRESHOLD` is overridable per invocation:

```js
Workflow({ name: 'release-planning', args: { sizeFanoutThreshold: 12 } })
```

A non-positive or non-finite value falls back to the computed default. The goal
is to cut cache-churn/waste from over-fanning-out on small releases while
letting a caller (or a future profile-aware override) tune the crossover for a
different cost posture. The script reads the arg directly; the seam for the
v1.10 P4 profile-aware override lookup is left clean (the override resolution is
a single guarded assignment with no profile coupling baked in).

#### Further token trims (applied in v4)

- **Orient folds the velocity read.** Both the version-resolver and the
  velocity calibration derive from `docs/version-history.md`. Reading it once
  in the orient phase avoids a duplicate read in a separate gather agent.
- **Single-step reads.** Every agent is instructed to read its named files in a
  single step and not explore further. Fewer turns per agent means less
  cache-read churn, which is the dominant token volume after the fixed-context
  cost.
- **Structured-output schemas.** Each agent returns a validated JSON object
  (`agent()` `schema` option). Schema validation happens at the tool-call layer
  and forces a retry on mismatch, so the synthesis phase receives clean data
  rather than parsing free text.

### Read-only safety contract

Workflow scripts in this scaffolding are **read-only by convention**: they write
no files and create no branches. This is not enforced by the harness — it is a
design rule backed by a concrete benefit.

The worktree-isolation model (each work item runs in its own branch in its own
worktree) and the protected-branch hooks (`protected-branch-guard.sh`) exist to
prevent uncoordinated writes. A workflow that wrote files or created branches
would collide with those guards in unpredictable ways — it runs in the
integration master's shared session, outside any worktree boundary.

By staying read-only, a workflow:
- Never conflicts with any worktree.
- Never triggers a protected-branch hook.
- Never needs a branch, a commit, or the integration-allow marker.
- Returns its result to the master, who reviews it and takes any file-writing or
  branch-creating next step through the normal skills
  (`grm-design-doc-scaffold`, `grm-release-agreement`).

The `grm-release-planning` workflow is an example of this pattern: it returns a
markdown draft; the master hands it to the user; the user iterates; then the
normal skill sequence locks scope.

### The `.claude/workflows/<name>.js` convention

Saved workflows live at `.claude/workflows/<name>.js` within the flavor's root
(e.g. `claude-code/.claude/workflows/release-planning.js`). The filename is the
invocation name:

```js
Workflow({ name: 'release-planning' })
Workflow({ name: 'release-planning', args: { target: '1.4' } })
Workflow({ name: 'release-planning', args: '1.4' })
Workflow({ name: 'release-planning', args: { target: '1.4', sizeFanoutThreshold: 12 } })
```

Every script must begin with an `export const meta = { ... }` pure literal
block declaring `name`, `description`, `whenToUse`, and `phases`. The `phases`
array titles must match the `phase()` calls in the script body — the harness
uses them to drive the progress display.

**Flavor note.** `Workflow` is a Claude Code primitive; it does not exist in
the Copilot flavor. `.claude/workflows/` and its contents are never mirrored
into `copilot/`. The gap is documented in `copilot/docs/grimoire/integration-workflow.md`
and `copilot/AGENTS.md` (owned by P3.1). See also
[[integration-workflow.md](../integration-workflow.md) §Workflow-based-orchestration](../integration-workflow.md#workflow-based-orchestration).

### Candidates for future workflows

See [workflow-candidates.md](workflow-candidates.md) for the ranked list of
future Workflow candidates (produced by the v1.4 W7 spike). That file is
authored by a parallel task; this section is intentionally a pointer only.

## Acceptance

- [ ] `docs/design/release-planning-workflow-design.md` exists at the flat
      path and follows the house layout (Motivation, Scope, Design, Acceptance,
      Open questions, Follow-ups).
- [ ] `docs/design/README.md` indexes this doc.
- [ ] The cost model and all four A/B datapoints (v1 ~$14.5 / v2 ~$2.3 /
      v3 ~$3.4 / v4 ~$1.7, ~88% under baseline) are captured in prose, not
      only in the JS header.
- [ ] The read-only safety contract is stated explicitly and explains why it
      prevents conflicts with the worktree-isolation and protected-branch hooks.
- [ ] The `.claude/workflows/<name>.js` convention is documented with the
      invocation syntax.
- [ ] Cross-links to [integration-workflow.md](../integration-workflow.md) §Workflow-based-orchestration
      and to `workflow-candidates.md` are present.

## Open questions

*(None at time of writing. Resolve and prune as the doc evolves.)*

## Follow-ups

- **W3 — Harden `release-planning.js`.** The batched sizer matches results back
  to items by exact name and silently drops unmatched items via
  `.filter(Boolean)`; fix index-matching or exact-echo validation. See
  `release-planning-v1.4.md` §2 W3.
- **W4 — `grm-workflow-bootstrap` + golden.** Teach bootstrap and its golden
  baseline about the `.claude/workflows/` artifact class (manifest row, restore
  logic, golden copy). See `release-planning-v1.4.md` §2 W4.
- **W6 — `grm-workflow-scaffold` skill.** A one-command scaffolder analogous to
  `grm-design-doc-scaffold`, encoding the model-tiering and batch-vs-fanout lessons
  as explicit authoring rules. See `release-planning-v1.4.md` §2 W6.
- **Future Workflow builds.** The W7 spike surfaces candidates; actual builds
  are v1.5+ unless the spike finds a compelling near-zero-cost opportunity.
