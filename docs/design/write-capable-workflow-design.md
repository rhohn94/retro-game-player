# Write-Capable Workflow Tier

> **Up:** [↑ Design docs](README.md)

## Motivation

The v1.4 `.claude/workflows/` convention established **Workflows as read-only
by design**: they read files, synthesise a draft, and return the result to the
integration master — never mutating a branch or the worktree. That contract
kept Workflows free of conflict with `protected-branch-guard.sh` and
`worktree-guard.sh`, which exist to prevent uncoordinated writes.

The read-only rule was always a *convention*, not a platform constraint. The
Claude Code `Workflow` harness supports file-mutating agents and
`isolation: 'worktree'` natively; nothing in the platform forbids write-capable
agents inside a Workflow script. What was missing was a safety model that
makes write-capable Workflows *safe by construction* in the presence of the
guard hooks.

The **Noir (Autonomous)** paradigm introduced in v1.6 lifts the read-only
convention for that paradigm only. Under Noir, Workflows may be
**write-capable**: each mutating agent runs in its own isolated worktree, commits
to a short-lived branch, and exits. The integration master collects the branches
and merges them — the same pattern used by `grm-release-phase` + `spawn_task`, but
orchestrated inside a Workflow script rather than through interactive chips.

This document specifies the tier model, the Noir gate that controls access, the
isolated-worktree execution model and its safety rails, and the three execution
variants (Efficient / Fast / Careful-Serial) that callers choose from.

---

## Scope

**Covers:**
- The two workflow tiers (read-only vs. write-capable) and their paradigm gating.
- The isolated-worktree parallel execution model: per-agent worktrees, branch
  naming, master-merge orchestration, conflict handling, and tie-in to
  `grm-release-phase-merge`.
- Safety rails: what agents may and may not do; why push stays human.
- The three execution variants and when each is selected.
- Lessons from the v1.5 vet (workflow run `wf_84d9bd9b-704`): sequential
  direct-commit on the staging branch worked and the guards permitted it from
  the marker-blessed worktree. Contrast with the isolated-worktree parallel
  target this release builds.
- NW1 acceptance criteria; downstream work contracts for NW2, NW3, NW4.

**Does not cover:**
- Authoring paradigm content sets (WP2).
- Implementing the file-swap installer or switch skill (WP3).
- Updating `grm-workflow-bootstrap` / golden (WP4).
- Implementation of the `grm-workflow-scaffold` skill update (NW4 owns that).
- Implementing the guard changes required for write-capable agents (NW2 owns
  that).
- Implementation of the actual isolated-worktree execution machinery (NW3 owns
  that).

---

## Design

### 1. Two workflow tiers

#### 1.1 Tier definitions

| Tier | Paradigm gate | Agents mutate files? | Isolation | Commits? | Push? |
|------|--------------|---------------------|-----------|---------|-------|
| **Read-only** | All paradigms | No | Shared session | No | No |
| **Write-capable** | **Noir only** | Yes | Per-agent worktree | Yes (own branch) | Never (human gate) |

**Read-only tier (today's convention, preserved in Weiss + Supervised):** the
Workflow fans out agents to read, analyse, and synthesise; it returns a draft
to the master. No file is written; no branch is created. All three paradigms
can use read-only Workflows. The existing `grm-release-planning` workflow is a
canonical example.

**Write-capable tier (Noir only):** the Workflow fans out agents that each
receive an isolated worktree, implement a discrete work item, commit to a
short-lived branch, and exit. The master (not a Workflow agent) merges the
branches back into the staging ref. Write-capable Workflows are gated to Noir
because they require the integration master to operate autonomously — picking
up branches, resolving conflicts, and driving the merge sequence without
per-step user confirmation. That posture is exactly what Noir is designed for.

#### 1.2 Noir gating

A Workflow script declares its tier in `export const meta`:

```js
export const meta = {
  name: 'example-write-capable',
  tier: 'write-capable',   // 'read-only' (default) | 'write-capable'
  // …
};
```

At runtime, `grm-workflow-scaffold`-generated scripts must check the active paradigm
before entering any write-capable phase:

```js
// Pseudocode — NW3 specifies the real runtime check
if (meta.tier === 'write-capable' && activeParadigm() !== 'Noir') {
  throw new Error(
    'write-capable workflows require the Noir paradigm. ' +
    'Switch paradigm or use a read-only workflow.'
  );
}
```

The guard is explicit, early, and fail-closed. An agent that accidentally
invokes a write-capable Workflow in a Supervised or Weiss project gets a clear
error rather than silently degrading to read-only behaviour.

See [work-paradigm-design.md](work-paradigm-design.md) for the full paradigm
system, config schema, and switch mechanism.

---

### 2. Isolated-worktree parallel execution model

#### 2.1 The core pattern

Write-capable Workflow agents follow the same isolated-worktree model that
`grm-release-phase` / `spawn_task` uses for work items — adapted for unattended
orchestration inside a Workflow script rather than interactive chips:

1. **The Workflow script** receives a list of work items (e.g. files to edit,
   modules to implement).
2. For each item, it spawns an `agent()` call with `isolation: 'worktree'`.
   The harness creates a fresh git worktree for that agent.
3. **Each agent** implements its item, commits on the per-agent branch, and
   exits. It never touches `dev`, `main`, or `version/*` directly.
4. **After all agents complete**, the Workflow script collects the branch names
   and returns them (via structured output) to the integration master.
5. **The integration master** runs `grm-release-phase-merge` (or equivalent) to
   merge the branches into the staging ref in the order specified by the
   conflict map.

Push to origin remains human-gated throughout — even in Noir. The Workflow and
all its agents are inside the local repository; nothing reaches the remote.

#### 2.2 Branch naming

Per-agent branches follow the work-item naming convention already used by
`grm-release-phase`:

```
<item-slug>-<short-uuid>
```

Examples: `update-config-parser-a3f1`, `add-retry-logic-b7c2`.

The `short-uuid` suffix prevents collisions when the same item slug is used
across runs. The Workflow script generates and records the branch name before
spawning the agent so the master can reference it in the merge sequence.

#### 2.3 Conflict handling

The Workflow script must emit a **merge order** alongside the branch list —
the same conflict-map principle used in `release-planning-v1.6.md §3`:

```js
return {
  branches: [
    { branch: 'update-config-parser-a3f1', mergeAfter: [] },
    { branch: 'add-retry-logic-b7c2',      mergeAfter: ['update-config-parser-a3f1'] },
  ]
};
```

The integration master follows the `mergeAfter` dependency order when calling
`grm-release-phase-merge`. If a merge conflict arises:
- The master attempts an automatic merge (non-conflicting hunks).
- On unresolvable conflict: the master surfaces a summary to the user (Noir
  preserves the human-push gate but also preserves human escalation for true
  conflicts) and pauses until resolved.
- The resolved merge continues; the remaining branches proceed in order.

#### 2.4 Tie-in to release-phase-merge

`grm-release-phase-merge` already knows how to merge a branch into a staging ref,
run tests, tick the ledger, and handle conflict escalation. Write-capable
Workflows reuse this machinery: the Workflow produces a branch list;
`grm-release-phase-merge` consumes it. No new merge logic is invented.

NW3 will wire the handoff: the Workflow script's structured-output schema
must match (or be mappable to) the input contract `grm-release-phase-merge`
expects. NW2 will confirm that the guard hooks permit merges from the
integration-allow-marked worktree after agents have committed to their
isolated branches.

#### 2.5 Execute-agent model tier — Sonnet default, `item.hard` Opus override

Execute (implementation) agents **default to `model: 'sonnet'`**, not the session
model. Under Noir the session model is Opus, so an Execute agent inheriting it
pays the Opus rate (Opus ≈ 5× Sonnet per token) **multiplied by the fan-out
width** — the single most expensive tier in any workflow. The v1.9 model-tier
audit ([`docs/token-efficiency-audit.md`](../token-efficiency-audit.md) §D2)
measured per-agent Opus task-dispatch at ~1.4–2.4M relative cost each and
recommended Sonnet-by-default for write-capable Execute, since most implementation
is mechanical and Sonnet is the implementation workhorse with no quality loss on
that work.

The tier is selected per item via an **`item.hard`** flag carried on the plan
item:

```js
model: item.hard ? 'opus' : 'sonnet'
```

- `hard` defaults to **`false`** → the agent runs on **Sonnet**.
- The Orient agent (or the caller via `args.items`) sets `hard: true` **only**
  for genuinely hard items needing Opus-level judgement (intricate algorithms,
  deep cross-module reasoning). Set sparingly: each `hard: true` forfeits the ~5×
  saving for that item.
- **Never `haiku`** for write-capable agents — too weak; risks rework that costs
  more than the tier saving.

`grm-workflow-scaffold` encodes this default in the write-capable template so future
scaffolded workflows do not regress to all-Opus Execute.

#### 2.6 Workflow model tiers vs. the dispatch profile (v1.10 decision)

The audit downgrades are now the **unconditional** in-script defaults: Execute →
Sonnet with `item.hard` → Opus (W2/D2, §2.5), and in `release-planning.js`
`read:design` → Haiku (W1/C4) and the synthesizer → Sonnet (v1.9 E3/C7). These
tiers are correct regardless of cost profile — the steps are schema-bounded or
mechanical implementation, so even a high-effort project gains nothing from Opus
there (the `item.hard` flag covers the genuinely hard exceptions).

The in-script tiers stay **decoupled from the model/effort dispatch profile**
(reaffirming the v1.9 principle). The profile dial governs `grm-release-phase`
`spawn_task` dispatch only; workflows are Claude-Code-only orchestration, and
coupling them to the profile would re-introduce complexity for marginal benefit
when the savings are already captured unconditionally. The tuning mechanism is
the **per-item escape hatch** — `item.hard` (Execute → Opus) here, and the
`opus-required` plan flag (N4 dispatch ceiling) on the dispatch side — not a
profile-wide override.

A **profile-aware `workflow-overrides` block was considered and declined**:
redundant with the unconditional W1/W2 downgrades and contradicting the
decoupling principle (analogous to v1.9's E6 data-gated no-op).

---

### 3. Safety rails

Write-capable Workflow agents operate under the following invariants. These
are the rails NW2 must codify and test.

#### 3.1 Agents never push

No agent spawned by a Workflow — read-only or write-capable — is permitted to
call `git push`. Push is exclusively the human operator's action. This holds
even under Noir. The `push-guard.sh` hook (which already exists) enforces
this at the tool level.

#### 3.2 Agents never touch dev / main / version/*

Write-capable agents commit only on their own per-agent branch (§2.2). They
have no `integration-allow.local` marker, so `protected-branch-guard.sh`
blocks any `git commit`, `git merge`, or `git rebase` on `dev`, `main`, or
`version/*` from within an agent worktree. This is **fail-closed by
construction**: the guard denies by default; the marker is absent in every
agent worktree.

#### 3.3 Agents stay inside their own worktree

Each agent's `CLAUDE_PROJECT_DIR` is set to its isolated worktree path.
`worktree-guard.sh` blocks any Edit/Write/Bash path that resolves outside
the active worktree root. Agents cannot reach sibling worktrees or the
canonical checkout.

#### 3.4 The master owns all merges

Only the integration master (the marker-blessed worktree) can merge agent
branches into the staging ref. This is enforced by `protected-branch-guard.sh`
(§3.2) and `worktree-guard.sh` (§3.3) in combination: agents cannot merge
because they lack the marker; the master can merge because it has the marker.

#### 3.5 Push stays human (v1.6 non-goal boundary)

Pushing to `origin` is out of scope for v1.6, even under Noir. The Workflow
and master may create any number of local commits and merges; triggering a
remote push requires an explicit human action. This boundary is stated in
`release-planning-v1.6.md §4` and is a deliberate deferral — not a missing
feature. The autonomous-push opt-in is its own future configuration item (see
`docs/roadmap.md` Backlog).

---

### 4. Three execution variants

Each write-capable (and read-only) Workflow exposes three named execution
variants that the caller selects at invocation time via `args.variant`
(`Efficient` / `Fast` / `Careful-Serial`). These describe a single Workflow's
*internal* parallelism/collision-ordering posture.

> **v1.11 note — distinct from the project execution-strategy dial.** This
> Workflow-internal `args.variant` is a *different namespace* from the
> project-level **execution-strategy** dial (`grimoire-config.json`
> `workflow-variant.value`, graduated active in v1.11 with presets
> **`Fast` / `Efficient` / `Cheap-Slow`** — see
> [execution-profiles-design.md](execution-profiles-design.md)). `Careful-Serial`
> here is a per-Workflow merge-correctness *ordering* mode; it is **not** a
> project cost posture (S1 showed serial ≠ cheap). The project dial governs the
> integration master's fan-out/isolation; this `args.variant` governs one
> Workflow run. The identifiers never collide.

#### 4.1 Variant definitions

| Variant | Parallelism | Focus | When to choose |
|---------|------------|-------|---------------|
| **Efficient** | Parallel | Low wasted / repeated work | Default; most releases; overlapping file dependencies |
| **Fast** | Parallel | Minimum wall-clock time | Time-critical runs; independent items; cost is not a concern |
| **Careful-Serial** | Serial (one at a time) | Maximum control; minimum collision risk | Risky changes; highly entangled items; debugging a workflow |

**Efficient (parallel, low-waste):**
Agents fan out in parallel, but the Workflow batches shared reads, deduplicates
overlapping file access, and respects the conflict map to avoid agents touching
the same file concurrently. An agent waits on its `mergeAfter` dependencies
before the master merges it, preventing avoidable conflicts downstream.
This is the default variant and builds directly on the v1.4 cost model (see
[release-planning-workflow-design.md §Design/Agent-tiering](release-planning-workflow-design.md)).

**Fast (parallel, minimal time):**
Maximum fan-out — all agents launch concurrently regardless of file overlap.
Duplicated reads are accepted. Conflict resolution is expected and handled
reactively by the master. Suitable when the work items are genuinely independent
(no shared files, no semantic coupling) and the caller values speed over token
efficiency.

**Careful-Serial (not parallel):**
Agents execute one at a time in the order specified by the conflict map.
Each agent's branch is merged by the master before the next agent starts.
No worktree isolation is strictly required (agents could run sequentially on
a shared worktree), though isolation may still be used for auditability.
This variant has the lowest risk of conflict and the highest control — at the
cost of wall-clock latency equal to the sum of all agents.

#### 4.2 Variant selection

The caller passes the variant at Workflow invocation:

```js
Workflow({ name: 'example-write-capable', args: { variant: 'Careful-Serial' } })
```

If no variant is passed, the Workflow defaults to `Efficient`. The active
`workflow-variant.value` from `grimoire-config.json` may override the default
when that field is activated (future release).

#### 4.3 Variant encoding in workflow scripts

The `grm-workflow-scaffold` skill (updated by NW4) will emit variant-aware scaffolding:
a `selectVariant(args)` helper and separate phase definitions per variant. The
`Careful-Serial` variant always uses `maxConcurrency: 1` in its phase
configuration; `Efficient` and `Fast` use `maxConcurrency: N` with differing
deduplication logic.

---

### 5. Lessons from the v1.5 vet

#### 5.1 What wf_84d9bd9b-704 proved

In v1.5, the integration master ran a workflow (run ID `wf_84d9bd9b-704`) that
performed **sequential direct-commit on the staging branch** (`version/1.5`)
from the marker-blessed worktree. Key observations:

- The guards permitted commits from the marker-blessed worktree — the
  `integration-allow.local` marker worked as designed.
- Sequential execution in a single worktree produced a clean, linear commit
  history with no merge conflicts.
- The approach required no per-agent worktree isolation because the work was
  ordered and non-overlapping.

This confirms the guard model is sound and the marker mechanism is correctly
scoped.

#### 5.2 Contrast: sequential direct-commit vs. isolated-worktree parallel

| Dimension | v1.5 vet (sequential, direct-commit) | v1.6 target (isolated-worktree parallel) |
|-----------|-------------------------------------|------------------------------------------|
| Agents | One agent at a time on staging branch | N agents concurrently, each in own worktree |
| Isolation | None needed (sequential) | Per-agent worktree (`isolation: 'worktree'`) |
| Commit target | Staging branch directly | Per-agent short-lived branch |
| Merge | No merge needed (direct commit) | Master merges each agent branch into staging |
| Conflict risk | None (sequential, non-overlapping) | Possible; conflict map + merge order mitigate |
| Throughput | O(N) serial latency | O(max-depth) parallel latency |
| Guard model | Marker-blessed single worktree | No-marker agent worktrees + marker-blessed master |

The v1.5 sequential approach is still valid and is exactly what the
**Careful-Serial** variant formalises. The v1.6 isolated-worktree parallel
target builds on that proven foundation, adding the per-agent branch + master-
merge layer to enable parallel execution without sacrificing safety.

#### 5.3 Guard model implications

Because the v1.5 vet ran in the marker-blessed worktree, a single
`protected-branch-guard.sh` exemption covered all commits. The v1.6
isolated-worktree model requires:

- **Agent worktrees:** no marker → `protected-branch-guard.sh` blocks any
  attempt to commit on `dev/main/version/*`. Agents commit on their own
  per-agent branch (unprotected) — this is allowed.
- **Master worktree:** has the marker → may merge agent branches into the
  staging ref as today.
- **No new marker type needed:** the existing binary marker model covers both
  cases. NW2 must verify (via tests) that this holds for the parallel case
  where multiple agent worktrees exist concurrently.

---

## Acceptance

- [ ] Design doc at `docs/design/write-capable-workflow-design.md` in house
      layout; indexed in `docs/design/README.md`.
- [ ] Two workflow tiers defined: read-only (all paradigms) vs. write-capable
      (Noir only); `meta.tier` field specified; Noir gate described with
      fail-closed behaviour (§1).
- [ ] Isolated-worktree parallel execution model described: per-agent worktree,
      branch naming scheme, conflict handling + merge order, `grm-release-phase-merge`
      tie-in (§2).
- [ ] Safety rails enumerated: no-push, no-protected-branch mutation, worktree
      confinement, master-only merges, human-push gate (§3).
- [ ] Three execution variants specified with precise behaviour and selection
      criteria: Efficient (parallel, low-waste), Fast (parallel, min-time),
      Careful-Serial (not parallel) (§4).
- [ ] v1.5 vet lessons captured: what `wf_84d9bd9b-704` proved; contrast table;
      guard model implications (§5).
- [ ] NW2, NW3, NW4 have clear contracts to implement against this design.

---

## Open questions

*(none — all decisions resolved)*

---

## Follow-ups

- **NW2** (guard reconciliation): verify `protected-branch-guard.sh` +
  `worktree-guard.sh` are safe by construction for write-capable agents in
  concurrent isolated worktrees; add tests (§5.3 implications).
- **NW3** (isolated-worktree parallel execution): implement the execution
  machinery: `isolation: 'worktree'` agent spawning, branch naming, conflict
  map output schema, `grm-release-phase-merge` handoff, and the three variant
  phase configurations.
- **NW4** (`grm-workflow-scaffold` update): update the skill to support the
  `tier: 'write-capable'` declaration, emit variant-aware scaffolding, and
  document both tiers and the variants in the convention doc.
- **D1** (docs): update `CLAUDE.md` + `docs/integration-workflow.md` to
  document the Noir write-capable tier, the three variants, and the retained
  human-push gate.
- **Future**: investigate whether the Careful-Serial variant should skip
  worktree isolation for trivial single-file edits to avoid setup overhead
  (see `docs/roadmap.md` Backlog: "Research: worktree-isolation overhead for
  serial / small work").
- **Future**: autonomous-push opt-in (explicitly out of scope for v1.6; its
  own future configuration item).
