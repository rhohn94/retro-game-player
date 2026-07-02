---
name: grm-orchestrate-release
description: Drive one full release end-to-end autonomously — planning, work dispatch, testing, merging, releasing, push, and cleanup — with zero permission prompts and zero per-step confirmations. Noir-only; composes the existing pipeline skills (planning → agreement → phase → phase-merge → project-release → cleanup) rather than reimplementing them. Use when the user says "orchestrate a release", "run a full release", or wants a hands-off release cycle.
---

# Orchestrate release — autonomous end-to-end driver

One invocation owns one complete release: **plan → lock → dispatch → merge →
release → push → cleanup → report**. The skill is a *driver*, not a
re-implementation — every stage is an existing skill, invoked in order, with
the autonomy dials verified up front so nothing stops for a permission prompt
or a per-step confirmation mid-flight.

**Posture (Noir-only, fail-closed).** Off the Noir paradigm this skill stops
at preflight. Autonomy is delivered mechanically, not by asking the model to
be brave: the deny guards (`protected-branch-guard.sh`, `worktree-guard.sh`,
`push-guard.sh`, `stealth-guard.sh`) stay fully active, and the
`autonomy-allow.sh` hook auto-approves only guard-vetted pipeline commands
under Noir. Design:
`docs/grimoire/design/orchestrate-release-design.md`.

## Step 0 — Preflight (deterministic, run first, always)

```bash
python3 .claude/skills/grm-orchestrate-release/orchestrate_preflight.py .
```

- **FAIL** on any line → stop and surface the fix (wrong paradigm, missing
  integration marker, missing/unwired hooks, no `dev` branch). Do not
  improvise around a FAIL.
- **WARN** lines → proceed, but announce the gates that will remain (e.g.
  `autonomous-push.enabled` false ⇒ the pipeline pauses at the push gate and
  waits for the user's go).
- All **PASS** → announce the milestone ("orchestrating v{X.Y} end to end;
  will report at push/cleanup or on a stop condition") and proceed without
  further confirmation requests.

## Pipeline — invoke, don't reimplement

| Stage | Skill | Autonomous behaviour |
|---|---|---|
| 1. Plan | `grm-release-planning` | Produce the work-items report from roadmap + carryovers + design docs. Under this skill, do **not** wait for report iteration — proceed with the defensible scope. |
| 2. Lock | `grm-release-agreement` | Write the planning doc (draft → agreed), create `version/{X.Y}` off `dev`, initialize the §5 ledger. |
| 3. Dispatch | `grm-release-phase` | Per open phase: batch by the §3 conflict map, dispatch isolated-worktree subagents, chip-free. |
| 4. Merge | `grm-release-phase-merge` | Merge returned branches in conflict-map order; tests after each merge; tick §5; final `version/{X.Y}` → `dev`. |
| 5. Release | `grm-project-release` | Preflight docs (version-history, feature-manifest), promote `dev` → `main`, bump, test, tag, build artifacts. |
| 6. Push | `grm-project-release` §push | Autonomous iff Noir + `autonomous-push.enabled` (push-guard suppresses the prompt itself); otherwise propose and wait. |
| 7. Cleanup | `grm-workspace-clean` + dead-worktree cleanup | Remove merged agent worktrees/branches per `docs/grimoire/integration-workflow.md` §Dead-worktree cleanup; confirm `dev`/`main` match origin. |
| 8. Report | — | One summary: version shipped, items landed/deferred, test state, follow-ups filed. |

Between stages, verify the previous stage's postcondition before continuing
(plan doc `status: agreed`; every §5 row Merged before release; tag exists
before push; worktrees gone after cleanup). A postcondition miss is a stop
condition, not something to patch around silently.

## Stop conditions (the only interruptions)

Pause and surface — never push through:

- **Merge conflict** the conflict-map ordering didn't prevent (ambiguous
  intent) — stop per `grm-release-phase-merge`.
- **Test failure** with unclear cause after a merge.
- **Guard block** (any hook exit 2): the guard is right until proven
  otherwise — investigate, never work around it.
- **Isolation failure**: missing `worktreePath:`/`worktreeBranch:` footer from
  a dispatched agent, or master HEAD drift — follow
  `docs/grimoire/design/dispatch-hardening-design.md` recovery.
- **Doc/config gate failure** at release preflight (doc-assurance `--strict`,
  config-validate).
- **User stop** at any time.

On a stop, report state precisely (what landed, what's pending, which §5 rows
are ticked) so the session can resume with `grm-release-phase-merge` or
`grm-end-session` rather than restarting.

## Why there are no permission prompts

- **Bash**: `autonomy-allow.sh` (PreToolUse) auto-approves the whitelisted,
  guard-vetted pipeline commands under Noir. Deny hooks take precedence, so
  nothing a guard blocks today is newly allowed.
- **Push**: `push-guard.sh` auto-approves guard-passed pushes only with the
  explicit `autonomous-push.enabled` opt-in (never inferred).
- **Everything else** (history rewrites, force flags, `rm`, redirections,
  non-framework scripts) still prompts — those are last-resort ops the
  pipeline never needs routinely.

## Token discipline

- Dispatch work through isolated-worktree subagents with the ≤800-token
  shared brief (`grm-release-phase` step 5); never inline design docs into
  dispatch prompts.
- Keep orchestrator context lean: read ledgers and reports, not diffs; use
  `grm-reviewer` / `grm-qa-agent` in their own sessions when review depth is
  needed.
- Prefer the deterministic helpers (preflight script, `release_plan.py`,
  `recipe.py`) over re-deriving state in prose.

## Relationship to neighbouring skills

- `grm-integration-master` — the *role guide* (posture, judgment calls); this
  skill is the *procedure* that role executes for one release.
- `grm-noir-loop` — iterates releases across `/loop` firings; each iteration's
  release-master MAY use this skill to run its single release.
- `grm-end-session` — the recovery/wind-down finale when a release is already
  mid-flight; this skill starts from zero instead.
