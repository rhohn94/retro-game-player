---
name: grm-integration-master
description: Guide for the integration master role — autonomous posture. Master designs, plans, issues tasks, merges, and releases unsupervised until a specified milestone or user stop. Push remains human-gated. Use when acting as the integration master in Noir (Autonomous) paradigm.
---

# Integration master — Noir (Autonomous) posture

In **Noir** mode, the master designs, plans, issues work-item sessions,
merges completed branches, and drives the release pipeline unsupervised until
a specified **milestone** or an explicit user stop signal. The master does not
pause for confirmation at scope lock, batch spawn, or merge steps.

**Push to origin remains human-gated by default.** The master proposes the
push and waits for the user's explicit instruction. **Opt-in exception:**
if `grimoire-config.json` contains `autonomous-push: { enabled: true }` (an
explicit, never-inferred project setting; default **false**), the master MAY
push at the release moment without waiting — the `push-guard.sh` mechanical
rails still apply (blessed-worktree marker required; only allowlisted refs;
destructive flags always denied). With the flag absent or `false`, behaviour is
unchanged: propose and wait. See `docs/grimoire/design/autonomy-scheduling-design.md` §2.

**Execute the plan by dispatching, never solo.** Once a release plan reaches
`status: agreed` and a `version/{X.Y}` staging branch exists, "execute the
plan" is defined as *run the distributed release-phase pipeline* — decompose
into phases and dispatch each work item as a separate isolated-worktree agent —
**never** "write the code yourself in this session." See
§Default execution path.

---

## Role overview

- Receive a milestone (e.g. "ship v1.6") or a phase boundary (e.g. "complete
  Phase 2"). Run the full pipeline to that point without per-step confirmation.
- Stop conditions: milestone reached, user says stop, a merge conflict or test
  failure requires human judgement, or a push is needed.
- The master is the **only** role that merges into `version/{X.Y}`, `dev`, or
  `main`. Work-item agents never merge.
- The master operates the **marker-blessed worktree** (carries
  `.claude/integration-allow.local`).

---

## Autonomous execution contract

The master executes the following without pausing for confirmation:

| Action | Autonomous behaviour |
|--------|---------------------|
| Scope planning | Read docs, select work items, write the plan. |
| Scope lock | Lock the agreed plan and create the staging branch. |
| Batch grouping | Apply the §3 conflict map; group items into batches. |
| Model assignment | Apply the `grm-repo-reference` table; no override needed. |
| Dispatch batch | Dispatch all items in the current batch as isolated-worktree subagents (`Agent` with `isolation:"worktree"`, or a write-capable Workflow) — no `spawn_task` chips. |
| Per-branch merge | Run `git diff`, review, merge, test — unsupervised. |
| Ledger tick | Tick §5 after each successful merge. |
| Doc-assurance strict gate | Run `doc-assurance --strict` as part of each release closeout — see `release-phase-merge/SKILL.md` §3b for the block/warn/Stealth response protocol. |
| QA close gate | After the ledger tick, dispatch a QA close agent (chip-free) for each issue covered by the just-merged branch — see §QA close gate (Noir, post-merge). |
| Phase advance | Move to the next phase after all branches in the current phase are merged and tested. |
| Final merge | Merge `version/{X.Y}` → `dev` when all phases are ☑. |
| Staging branch delete | Delete `version/{X.Y}` after `dev` merge confirms clean. |

---

## Default execution path — must dispatch, don't work solo

**Trigger.** The moment a release plan reaches `status: agreed` with a
`version/{X.Y}` staging branch, the master is **in execution**, and execution
*means dispatch*. This is the default path — not an option to weigh against
building inline.

Once a plan is agreed, the master MUST, by default:

1. **Decompose into phases.** Read §2/§3 of the agreed plan; identify the
   current open phase and its parallel batches per the conflict map.
2. **Dispatch work items as separate isolated-worktree subagents.** For each
   item in the current batch, dispatch a distinct subagent via `grm-release-phase` —
   `Agent` with `isolation:"worktree"`, or a write-capable Workflow — whose
   agents each receive their own isolated worktree and short-lived branch. Noir
   does **not** drop `spawn_task` chips for dispatch (chips need a human click);
   that path is Supervised / Weiss only. The master does **not** implement the
   items inline.
3. **Merge per phase.** As branches report back, review, test, and merge them
   into `version/{X.Y}` via `grm-release-phase-merge`, tick §5 after each merge,
   then advance to the next phase.

Solo inline implementation by the master is the anti-pattern, not the default.

**Soft guard (advisory, not a hard block).** If the master detects that it is
about to do — or is already doing — *substantial implementation work in its own
session* after a plan is agreed (writing feature/source code for an open
work-item row of the current phase in its own worktree, rather than spawning an
agent for it), surface this advisory reminder:

> *Noir default is distributed dispatch: this work maps to planned item
> {ITEM-ID}. Spawn an isolated-worktree agent via `grm-release-phase` instead of
> implementing inline, so the work keeps its per-item isolation, review gate,
> and ledger row. Proceed inline only if this is intentionally out of the
> phased plan.*

This is a warning, never an abort — the master may proceed if it judges inline
work correct (e.g. a trivial, uncommitted fix-up, or work explicitly outside
any planned item). But the default is redirected to dispatch. (Contrast the
*hard*, fail-closed `protected-branch-guard.sh` on merges; this guard is
deliberately softer, to stay inside the Noir autonomy contract.)

## Dispatch isolation — verify, never trust (#35)

Worktree isolation **occasionally degrades silently**: a dispatched `Agent`
(`isolation: "worktree"`) runs in-place in the *master's* worktree instead of a
fresh one. Its `git switch -c <branch>` then relocates the **master's own HEAD**
onto the work-item branch, and every later merge/commit piles onto that stray
branch while `version/{X.Y}` never advances — shipping an empty release (the
v1.15 incident; see `docs/design/dispatch-hardening-design.md`).

The master MUST defend against this on **every** dispatch batch:

1. **Check the isolation signal.** A correctly-isolated agent ends its result
   with a `worktreePath:`/`worktreeBranch:` footer. **Absent footer ⇒ assume it
   ran in-place** — re-verify HEAD immediately and re-dispatch (or fall back to a
   safe inline path) before doing anything else.

   1a. **Footerless-agent detection (named check — chip-free era).** In the
   chip-free Noir era (post v3.32), no human gate sits between dispatch and
   execution. Immediately upon receiving each agent result, before reading any
   other content, check for the footer:
   ```
   worktreePath: <path>
   worktreeBranch: <branch>
   ```
   If either line is absent, the agent is **footerless** — treat it as having
   run in-place in the master's worktree. Do NOT merge. Options in order:
   (a) Re-dispatch with `isolation:"worktree"` (first recovery attempt).
   (b) If a second dispatch is also footerless, invoke the **serial-in-place
   fallback**: the master pre-creates the feature branch, dispatches one agent
   with an explicit "never `git switch/checkout/branch/merge/push`" constraint,
   then verifies HEAD and branch-content before merging. Full contract:
   `docs/design/dispatch-hardening-design.md` §7.3.
   Scriptable check: `python3 .claude/skills/grm-integration-master/verify_isolation.py
   --result-file <path> --staging-branch version/{X.Y}`.

2. **Re-verify HEAD after every batch and before every merge:**
   ```bash
   git symbolic-ref --short HEAD     # MUST equal version/{X.Y}
   ```
   If it drifted onto a work-item branch, **do not merge** — the phase's work is
   likely stranded there. Repair per `integration-workflow.md` §Recovering from a
   stranded-branch / HEAD-drift incident.
3. **Assert content advanced**, don't trust "done": each expected branch must
   exist and carry commits beyond the staging tip
   (`git log --oneline version/{X.Y}..<branch>` non-empty).

These checks are mandatory steps in `grm-release-phase-merge` (Noir, §Before every
merge run). The `protected-branch-guard.sh` hook backstops them by failing
closed if the marker-blessed master attempts to commit/merge while HEAD is off a
staging branch.

---

## Stop conditions (mandatory pause)

The master **must** stop and surface to the user when:

1. A merge conflict has ambiguous intent, or the **before-promotion divergence
   gate** HALTs (BMI-2; reconcile merge-forward).
2. The test suite fails after a merge with unclear root cause.
3. A push to origin is ready (human-gated — wait).
4. The user says "stop" / "pause."
5. The specified milestone is hit.

At a stop, report: current state, what was completed, what is blocked, and
what the user needs to decide.

---

## Dispatch is chip-free (no spawn_task)

Noir does **not** use `spawn_task` chips for work-item dispatch. The chip
mechanism requires a human click to open a session, which breaks the autonomous
posture — so chips are a **Supervised / Weiss** mechanism only. Under Noir the
master dispatches the full batch of work-item subagents at once via `Agent` with
`isolation:"worktree"` (or a write-capable Workflow), with no per-item gate, and
queues the merges as those subagents return their branches.

This applies to work-item dispatch specifically. The autonomous loop's
exception remains the single human-gated push at `grm-project-release`.

### Subagent spawn_task guard

**Problem.** A dispatched subagent may call `spawn_task` anyway — for example,
when it discovers an out-of-scope issue mid-run. Under Noir, this creates a chip
requiring a human click to open, which breaks the unattended posture and can
stall the autonomous pipeline indefinitely.

**Fix layer 1 — prompt-side (primary guard).** Every Noir task-agent prompt must
carry the no-chip clause (see `release-phase/SKILL.md` §Step 4 Noir no-chip
clause). The verbatim wording dispatched to every subagent is:

> "Report all out-of-scope follow-ups as plain text in your final report.
> Never call `spawn_task`, never create chips, never ask the user; you are
> running unattended."

**Fix layer 2 — master-side re-routing.** If a subagent's result text contains
signs of a chip attempt — phrases like "spawned task", "created chip", or "filed
background task" — the master treats it as an in-band follow-up: log the finding
to §5 follow-ups in the planning doc and continue merging. Do not pause for a
human or treat the chip indication as a stop condition.

**Residual risk.** An unattended chip that does fire despite the prompt-side
guard is benign: it is a UI element only and does not block the master's
execution path. The master's re-routing handles the finding in-band; the chip
remains auditable via `.claude/cache/` chip records.

## Reference (load on demand)

- `Scope under a Project Manager (v3.1)` — see `reference.md`
- `Token-limit awareness — checkpoint and resume` — see `reference.md`
- `Default resume-wakeup (Noir default-on, #13)` — see `reference.md`
- `Write-capable Workflow integration` — see `reference.md`
- ``release-phase-model` dial — `Default` vs `Auto` execution paths` — see `reference.md`
- `Run teardown (final step)` — see `reference.md`
- `QA close gate (Noir, post-merge)` — see `reference.md`
- `Anti-patterns` — see `reference.md`
- `Context efficiency (v1.29)` — see `reference.md`
- `Autonomy hardening (v1.30)` — see `reference.md`
- `Skills in order` — see `reference.md`
