# Workflow Candidates

> **Up:** [↑ Design docs](README.md)


## Motivation

The Workflow tool excels at read-heavy, parallelizable work where multiple independent analysis agents fan out simultaneously and a synthesis step combines their output. It is not suited to state-mutating sequences (file writes, branch operations, git commits) because distributed writes introduce ordering hazards and interactive confirmation gates stall automation. The cost model targets ~$1.7/run by pairing haiku agents for mechanical extraction with a single sonnet pass for judgment and a session-level synthesis. A skill is a strong candidate when: (a) its steps are mostly reads across independent files, (b) those reads can start concurrently, and (c) no mandatory user-confirmation gate blocks the critical path.

---

## Ranked Overview

| Rank | Skill / seam | Fit score | Token band | Read-only safe | Status |
|------|-------------|-----------|------------|----------------|--------|
| 1 | `grm-release-planning` | 4 | M | Yes | shipped v1.4 |
| 2 | `grm-source-to-design-docs` (analysis phase only) | 4 | L | Partial — write phase excluded | **shipped v1.18** |
| 3 | `grm-release-agent-tracker` | 4 | S | No — ticks §5 ledger | |
| 4 | `grm-release-phase` (read / batch phase only) | 5* | S | No — spawn_task calls excluded | |
| 5 | `grm-design-doc-scaffold` | 3 | XS | No — writes file + commits | |
| 6 | `grm-design-language-adapt` (fetch + diff phase) | 3 | M | Partial — write phase excluded | |
| 7 | `grm-ledger-tick` | 3 | XS | No | |
| 8 | `grm-release-agreement` | 3 | S | No | |
| 9 | `grm-sync-from-source` (diff preview phase) | 3 | M | Partial | |
| 10 | `grm-sync-from-upstream` | 3 | M | No | |
| 11 | `grm-workflow-snapshot` (diff phase) | 3 | S | Partial | |
| 12 | `grm-worktree-preflight` | 3 | XS | Yes | |

\* `grm-release-phase` scores 5 on orchestration fit but is excluded from the workflow pattern because its primary output is side-effectful `spawn_task` calls, not synthesized analysis.

---

## Per-Candidate Details

### `grm-release-planning`

**Skill / seam:** Reads roadmap, version history, prior release plans, and design docs to produce a sized work-items report for the next version — no file writes until the user confirms scope.

**Value of parallel fan-out:** Each document is independent. Roadmap, version history, and every design doc can be fetched simultaneously by haiku agents; a sonnet agent classifies and sizes items; a final session-level synthesis produces the structured report. This maps directly to the existing `release-planning.js` workflow pattern and is already proven at ~$1.7/run.

**Token-cost band:** M. Typically 4-8 source documents, each under 2k tokens; haiku extraction passes are cheap; one sonnet synthesis is the dominant cost.

**Read-only safety:** Yes. No files are written during workflow execution. The user approves scope before `grm-release-agreement` writes anything.

**Priority rank for v1.5+:** Already shipping as `release-planning.js`. Reference implementation.

---

### `grm-source-to-design-docs` — analysis phase

**Skill / seam:** Surveys an existing project's source tree and docs to identify design-doc candidates and draft content for each.

**Value of parallel fan-out:** Directory survey, README reading, and per-module analysis are all independent. A workflow can dispatch one haiku agent per module/file cluster, then aggregate a candidate manifest before writing anything. The write phase (file creation, git commit) is excluded from the workflow and handled by a follow-on interactive step.

**Token-cost band:** L. Source repos can be large; fan-out agents each read a subset; total context may be 20k+ tokens across agents. Sonnet judgment required for classifying candidates.

**Read-only safety:** Partial. The analysis / candidate-identification phase is fully read-only. The write phase (Step 4 onward) must remain outside the workflow.

**Priority rank for v1.5+:** High. Natural extension of the release-planning pattern; splits cleanly at the user-confirmation gate.

**Status:** Shipped in v1.18 as `.claude/workflows/source-to-design-docs.js`.

---

### `grm-release-agent-tracker`

**Skill / seam:** Reads the §5 ledger and git branch state to produce a merge-queue and status table; optionally ticks one ledger row.

**Value of parallel fan-out:** Git branch checks for all subagent branches can be issued concurrently. Ledger read is a single small file. Combining these in parallel shaves latency on wide releases (10+ branches).

**Token-cost band:** S. One small doc read, N git commands (N = number of tracked branches). Haiku-only fan-out; no sonnet judgment required.

**Read-only safety:** No. The skill conditionally edits the §5 ledger when the user reports a branch done. The read / status-report path is safe; the mutation path is not. A workflow variant covering only the read path would be safe.

**Priority rank for v1.5+:** Medium. The read-only reporting subset is a strong candidate; the mutation step should remain a thin interactive skill wrapper.

---

### `grm-release-phase` — batch-planning phase

**Skill / seam:** Reads the agreed plan, identifies the current open phase, groups work items into conflict-free parallel batches, and assigns model/effort per token estimate.

**Value of parallel fan-out:** Reading the release plan doc, reading the conflict map, and reading prior ledger state are all independent. A workflow that outputs a batch manifest (without actually calling `spawn_task`) would give the integration master a preview before committing to spawns.

**Token-cost band:** S. One release plan doc, one conflict map, one ledger section. Sonnet judgment needed for batch grouping; haiku for extraction.

**Read-only safety:** No. The actual skill dispatches `spawn_task` calls. A workflow covering only the planning/preview phase would be read-only safe, but the dispatch step must remain outside.

**Priority rank for v1.5+:** Medium. A "batch-plan preview" workflow that stops short of spawning has clear value for large phases (5+ items) but is lower priority than `grm-source-to-design-docs`.

---

### `grm-design-doc-scaffold`

**Skill / seam:** Creates a single `docs/design/{feature}-design.md` from the house template and wires it into the design index.

**Value of parallel fan-out:** The only parallelizable step is reading sibling docs for cross-link context. The write + commit path is strictly sequential.

**Token-cost band:** XS. One template, a handful of sibling docs, one file write, one git commit.

**Read-only safety:** No. Writes a file and commits.

**Priority rank for v1.5+:** Low. Sequential and write-heavy; not a natural workflow target. Better served by a fast inline skill.

---

### `grm-design-language-adapt` — fetch and diff phase

**Skill / seam:** Fetches the upstream UX design-language source, records the source SHA, and produces a diff / draft adaptation for the project.

**Value of parallel fan-out:** The upstream fetch and the read of existing project docs (README, roadmap, coding standards) can proceed concurrently. A workflow that outputs the draft adaptation stops before writing, letting the user review before committing.

**Token-cost band:** M. Upstream source can be 5-15k tokens; project docs add another 5k. Sonnet pass required for adaptation judgment.

**Read-only safety:** Partial. The fetch + draft phase is read-only; the write + diff-presentation step is not. A workflow covering only through draft generation would be safe.

**Priority rank for v1.5+:** Low-medium. Useful for projects that re-adapt frequently; lower priority than planning-workflow extensions.

---

### `grm-ledger-tick`

**Skill / seam:** Flips status markers in the §5 ledger doc and commits the change.

**Value of parallel fan-out:** Minimal. The only parallel work is verifying multiple branch SHAs via `git log`, which is trivially fast.

**Token-cost band:** XS. One small doc, a few git commands.

**Read-only safety:** No. Primary purpose is the file mutation + commit.

**Priority rank for v1.5+:** Low. Too small and sequential to warrant a workflow.

---

### `grm-release-agreement`

**Skill / seam:** Locks a confirmed scope report into a versioned planning doc, creates the `version/{X.Y}` branch, and commits.

**Value of parallel fan-out:** None after the user confirms scope. Pre-confirmation, reading the work-items report and the prior release plan could be parallel, but both are small.

**Token-cost band:** S. Two small docs, one branch create, two commits.

**Read-only safety:** No. Creates branch and commits files.

**Priority rank for v1.5+:** Low. Inherently sequential and gated on user confirmation.

---

### `grm-sync-from-source` — diff preview phase

**Skill / seam:** Diffs live workflow files against a source project to produce an action table of files to copy or skip.

**Value of parallel fan-out:** Each file diff is independent. A workflow could fan out one haiku agent per file pair, then aggregate the action table before any copy happens.

**Token-cost band:** M. Depends on the number of files diffed (typically 10-30 files, each 1-5k tokens).

**Read-only safety:** Partial. The diff / action-table phase is read-only; the apply + re-generalize phase is not.

**Priority rank for v1.5+:** Low. Infrequent operation; manual review is already part of the loop.

---

### `grm-sync-from-upstream`

**Skill / seam:** Applies upstream scaffolding updates via 3-way merge, resolves conflict markers, and re-specializes placeholder tokens.

**Value of parallel fan-out:** Low. Steps are strongly ordered; conflict resolution requires sequential judgment.

**Token-cost band:** M. Similar file count to `grm-sync-from-source`.

**Read-only safety:** No. Applies file changes and resolves merge markers.

**Priority rank for v1.5+:** Low. Interactive conflict resolution blocks automation.

---

### `grm-workflow-snapshot` — diff phase

**Skill / seam:** Diffs live skill/hook files against the golden baseline to identify what has changed and needs to be re-generalized.

**Value of parallel fan-out:** Each file diff is independent and can be a separate haiku agent.

**Token-cost band:** S. 10-20 files, each small.

**Read-only safety:** Partial. The diff phase is read-only; the copy + manifest update phase is not.

**Priority rank for v1.5+:** Low. Infrequent; existing skill is fast enough.

---

### `grm-worktree-preflight`

**Skill / seam:** Runs `git merge-base` and `git rev-parse` checks to verify a worktree is on the correct staging ref.

**Value of parallel fan-out:** None. Two sequential git commands.

**Token-cost band:** XS. Purely git I/O.

**Read-only safety:** Yes. No mutations.

**Priority rank for v1.5+:** Low. Already trivially fast as a skill; no parallelism to exploit.

---

## Poor Fits (score < 3)

| Skill | Reason |
|-------|--------|
| `grm-project-release` | Linear checklist with destructive git ops and mandatory user confirmation gates at each step. |
| `grm-release-phase-merge` | Strictly sequential: each merge must pass tests before the next can proceed; parallelism is unsafe. |
| `grm-repo-init` | One-time setup with hard step ordering; no fan-out. |
| `grm-repo-reference` | Static lookup table; invoked inline by other agents, not a fan-out target. |
| `grm-ux-demo-build` | Opt-in, requires user confirmation before overwriting, ends in a human hand-off. |
| `grm-workflow-bootstrap` | Fundamentally interactive — requires a multi-turn `AskUserQuestion` interview before patching files. |

---

## Roadmap Feed

This ranked list is the input for the [roadmap.md](../../roadmap.md) Backlog. Recommended sequencing for v1.5+:

1. **`grm-source-to-design-docs` analysis workflow** — highest new-value addition; clean split at user-confirmation gate.
2. **`grm-release-agent-tracker` read-only workflow** — low cost, high frequency during active releases.
3. **`grm-release-phase` batch-plan preview workflow** — useful for large phases; complements existing `release-planning.js`.
4. Lower-priority partial workflows (`grm-design-language-adapt` fetch phase, `grm-sync-from-source` diff phase) — assess demand before investing.

Candidates scoring below 3 should not be added to the Backlog as workflow targets.
