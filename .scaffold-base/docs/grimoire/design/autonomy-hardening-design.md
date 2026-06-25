# Autonomy hardening

> **Up:** [↑ Design docs](README.md)


> Design gate for v1.30. Closes #60–#64. Closes the unattended-operation gaps
> that forced manual intervention during the v1.22–v1.29 campaigns — without
> relaxing any safety rail.

## Motivation

Real friction hit while operating Grimoire autonomously:
- `spawn_task` chips need a human click, so genuine unattended dispatch had to be
  improvised with the `Agent` tool + `isolation:"worktree"` (#60).
- `git branch -D` was repeatedly blocked by the auto-mode classifier mid-campaign,
  stalling cleanup (#61).
- `grm-release-phase-merge` stops on *any* conflict, even trivial additive ones (#62).
- A transient model outage required a manual wait-and-retry (#63).
- The opt-in `autonomous-push` lacks an audit trail / documented envelope (#64).

## Goals

- Make the unattended dispatch path **first-class and documented**.
- A **branch-cleanup helper** that auto-selects safe `-d` vs `-D` and classifies
  throwaway branches, so deletion stops stalling.
- A **tiered conflict policy** (auto-resolve safe classes, escalate semantic).
- A documented **retry/backoff posture** for transient failures.
- A **push approval audit log** + policy envelope, all rails intact.

## Non-goals

- Relaxing `push-guard.sh` / `protected-branch-guard.sh`, or the safe-by-default
  human-gated push.
- Auto-resolving **semantic** conflicts; removing per-action confirmation for
  genuinely destructive ops.

## Design

### #60 — first-class unattended dispatch

The unattended path is the **write-capable workflow / isolated-worktree agent**
route (the `Agent` tool with `isolation:"worktree"`), since `spawn_task` requires a
human click. Documented in `grm-integration-master` + [integration-workflow.md](../integration-workflow.md) as the
canonical Noir unattended-dispatch mechanism, with the **#35 isolation checks**
codified: after every batch assert `HEAD == version/{X.Y}`, assert each branch
advanced (`git rev-list --count version..branch` non-empty), and check file-set
disjointness. Decision guidance: `spawn_task` (human-gated, attended) vs workflow
(unattended).

### #61 — branch-cleanup helper

`branch_cleanup.py` classifies local branches:
- **merged** into the integration branch ⇒ safe `git branch -d` (no data loss).
- **throwaway** (`worktree-agent-*`, `worker-*`, `wf-*`, agent-suffixed) ⇒ `-D`
  *candidates*, listed for a single batched confirmation (never auto-`-D`).
- **protected / unmerged** ⇒ never touched; reported.

Dry-run by default (prints the plan). `--apply` runs only the safe `-d`
deletions; `-D` candidates are emitted for the human to confirm in one batch —
resolving the mid-campaign stall without bypassing destructive-op confirmation.

### #62 — tiered merge-conflict resolution

`grm-release-phase-merge` classifies a conflict before stopping:
- **auto-resolvable**: additive/disjoint hunks, or a known-generated artifact
  (lockfiles, `docs/README.md` map, baselines) ⇒ resolve (prefer union / regen)
  and **log** it to §5 follow-ups.
- **semantic / ambiguous** ⇒ stop and surface (unchanged default).

Conservative: anything not clearly in an auto class escalates to the human.

### #63 — retry/backoff on transient failure

A documented posture for the master: on a **transient** tool/model failure
(timeout, "temporarily unavailable", rate limit) retry with backoff — up to **3
attempts** at 20s / 60s / 120s — before pausing for the human. **Persistent**
failures (auth, not-found, syntax) do not retry. Each retry is recorded so the
run stays auditable.

### #64 — push approval audit log + envelope

`push-guard.sh` appends an **approval record** to `.claude/cache/push-audit.log`
(timestamp + the permitted push command) the moment it permits a push — an
append-only, best-effort, gitignorable trail. All existing rails are unchanged
(marker + allowlist + denied destructive flags). The `autonomous-push` policy
envelope (still opt-in, still allowlisted, still human-gated by default) is
documented alongside.

## Subagent spawn_task guard

### Problem statement

Dispatched subagents under Noir carry the full tool set, including `spawn_task`.
Without an explicit prohibition in their prompt, they may call `spawn_task` to
flag out-of-scope discoveries mid-run — creating chips that require a human click
to open. This stalls the autonomous run and breaks the unattended posture that
Noir is designed to provide.

### Fix layer (a) — prompt clause

The Noir task-agent prompt template now includes a mandatory no-chip/no-question
clause. The master must include the following verbatim in every dispatched
agent's prompt:

> "Report all out-of-scope follow-ups as plain text in your final report.
> Never call `spawn_task`, never create chips, never ask the user; you are
> running unattended."

This clause is applied in `release-phase/SKILL.md` §Step 4 (Noir no-chip
clause). It is the primary guard: by explicitly prohibiting `spawn_task` use in
the subagent's system prompt, it prevents chip creation before it can happen.

### Fix layer (b) — master-side re-routing

The integration master treats any in-band chip indication as a structured
follow-up rather than a stop condition. If a subagent's result text contains
phrases like "spawned task", "created chip", or "filed background task", the
master logs the finding to §5 follow-ups in the planning doc and continues
merging — it does not pause for a human. This is documented in
`integration-master/SKILL.md` §Dispatch is chip-free (§Subagent spawn_task
guard).

### Residual risk

A chip that fires anyway (despite the prompt clause) is benign: it is a UI
element only and does not block the master's execution path. The master's
re-routing handles any in-band chip indication; any chip that does appear is
auditable via `.claude/cache/` chip records.

## Validation (dogfooded)

- `branch_cleanup.py` dry-run on this repo classifies branches into
  merged/throwaway/protected correctly.
- `push-guard.sh --self-test` still PASSES; a permitted push writes one
  `push-audit.log` line; the guard still denies unmarked / off-allowlist /
  destructive pushes.
- Conflict tiers + retry posture documented in the named skills.
