# Work Paradigm file-swap architecture

> **Up:** [↑ Design docs](README.md)

## Motivation

The Grimoire scaffolding must serve three distinct autonomy postures
(**Supervised**, **Weiss/Collaborative**, **Noir/Autonomous**) without
inflating every agent's context with instructions that don't apply. Today,
all instruction files are universal — there is no mechanism to load only the
rules relevant to the active paradigm. The Work Paradigm system closes this
gap: paradigm-neutral *names* + per-paradigm *content sets* + a file-swap
installer means agents always read instructions that match their operating
mode, and nothing else (the **leanness principle**).

The preference field (`work-paradigm`) was captured at onboarding in v1.5
(marked `in-development`). v1.6 activates it by building the storage layout,
installer, and switch mechanism this design specifies.

---

## Scope

**Covers:**
- Paradigm-neutral file naming scheme for skills, docs, and `CLAUDE.md`
  sections.
- Storage layout: three content sets in the repo + golden baseline under stable
  names; how the installer selects and writes active content.
- Per-paradigm content-diff map: which files differ and which are shared.
- Installer + switch mechanism end-to-end: onboarding selection → activation;
  the `grm-work-paradigm-switch` skill contract; idempotent re-install; restorability.
- Config schema change: `work-paradigm.in-development` removed, field made
  active; `schema-version` bumped from `1` → `2`; forward-compat with v1.5
  configs.

**Does not cover:**
- Implementing the Noir write-capable workflow tier (NW1–NW4).
- Authoring the actual per-paradigm content (WP2).
- Implementing the installer/switch skill code (WP3).
- Updating `grm-workflow-bootstrap` / golden (WP4).

---

## Design

### 1. Paradigm-neutral file naming scheme

All skills, instruction docs, and `CLAUDE.md` sections use the **same
stable names** regardless of which paradigm is active. Only the *content*
installed at those names changes.

#### 1.1 Stable name surfaces

| Surface | Stable name | Notes |
|---------|-------------|-------|
| Integration-master skill | `.claude/skills/grm-integration-master/SKILL.md` | **New in v1.6** — consolidates the master's guidance (today in `docs/grimoire/integration-workflow.md` / `CLAUDE.md`); `CLAUDE.md §Which agent are you?` is repointed to it; content is paradigm-specific |
| Release-phase skill | `.claude/skills/grm-release-phase/SKILL.md` | Autonomy posture differs per paradigm |
| Release-phase-merge skill | `.claude/skills/grm-release-phase-merge/SKILL.md` | Merge oversight differs |
| CLAUDE.md §Which agent are you? | `CLAUDE.md` (section replaced in-place) | Agent posture, oversight level |
| CLAUDE.md §Task execution | `CLAUDE.md` (section replaced in-place) | Approval gates differ |
| `docs/grimoire/integration-workflow.md` | `docs/grimoire/integration-workflow.md` | Decision/merge orchestration varies |

All other skills, hooks, and docs are **shared** (identical across paradigms).

#### 1.2 What does NOT change per paradigm

The following are paradigm-invariant and are never swapped:

- `grm-repo-init`, `grm-workflow-bootstrap`, `grm-project-release`, `grm-release-planning`,
  `grm-release-agreement`, `grm-release-agent-tracker` skills.
- All design docs under `docs/design/`.
- Hook scripts (`protected-branch-guard.sh`, `worktree-guard.sh`,
  `push-guard.sh`).
- `docs/roadmap.md`, `docs/version-history.md`, `docs/coding-standards.md`,
  `docs/architecture-guidelines.md`.
- `.claude/grimoire-config.json` schema and field names (only the
  `work-paradigm.value` field is read, never the installation target).

---

### 2. Storage layout

#### 2.1 Content-set directory

Paradigm content sets live under `.claude/paradigms/`:

```
.claude/paradigms/
  supervised/          # Supervised (default) — today's behavior refactored
    integration-master-SKILL.md
    release-phase-SKILL.md
    release-phase-merge-SKILL.md
    CLAUDE-agent-role.md       # §Which agent are you? replacement block
    CLAUDE-task-execution.md   # §Task execution replacement block
    integration-workflow.md
  weiss/               # Weiss / Collaborative
    integration-master-SKILL.md
    release-phase-SKILL.md
    release-phase-merge-SKILL.md
    CLAUDE-agent-role.md
    CLAUDE-task-execution.md
    integration-workflow.md
  noir/                # Noir / Autonomous
    integration-master-SKILL.md
    release-phase-SKILL.md
    release-phase-merge-SKILL.md
    CLAUDE-agent-role.md
    CLAUDE-task-execution.md
    integration-workflow.md
```

Each paradigm directory contains only the files that *differ* between
paradigms. Shared files (the majority) live exclusively in their canonical
location and are never duplicated into `.claude/paradigms/`.

#### 2.2 Stable-name mapping

The installer uses a fixed **install map** that records the source path
(inside `.claude/paradigms/<paradigm>/`) and its target active path:

| Source file | Installed to |
|-------------|--------------|
| `integration-master-SKILL.md` | `.claude/skills/grm-integration-master/SKILL.md` |
| `release-phase-SKILL.md` | `.claude/skills/grm-release-phase/SKILL.md` |
| `release-phase-merge-SKILL.md` | `.claude/skills/grm-release-phase-merge/SKILL.md` |
| `CLAUDE-agent-role.md` | Active content for `CLAUDE.md §Which agent are you?` |
| `CLAUDE-task-execution.md` | Active content for `CLAUDE.md §Task execution` |
| [integration-workflow.md](../integration-workflow.md) | `docs/grimoire/integration-workflow.md` |

`CLAUDE.md` section replacement uses sentinel comments to locate and replace
content in-place (see §4.3).

#### 2.3 Golden baseline

The golden baseline (maintained by `grm-workflow-bootstrap` / `grm-workflow-snapshot`)
must snapshot all three paradigm content sets:

```
.claude/golden/
  paradigms/
    supervised/   # mirrors .claude/paradigms/supervised/
    weiss/
    noir/
```

This ensures `workflow-bootstrap --restore` can regenerate the content sets
from the golden without a network fetch. WP4 wires this.

#### 2.4 Leanness principle

The installer writes exactly one paradigm's content into the active
filenames. Agents read only the installed (active) content. The other two
paradigms' content stays in `.claude/paradigms/` — agents never load files
from that directory during normal operation, so no inapplicable instructions
ever enter an agent's context.

---

### 3. Per-paradigm content-diff map

The following table specifies which content changes per paradigm and the
key behavioural axis along which it differs. The shared-content assertion is
also recorded.

#### 3.1 Content that differs per paradigm

| File | Supervised | Weiss (Collaborative) | Noir (Autonomous) |
|------|------------|----------------------|-------------------|
| `integration-master/SKILL.md` | User-confirmed gate at every major decision. Stops for scope/merge/push approvals. | Minimized design input from Claude. All design decisions deferred to user. Agent acts as researcher/assistant, surfaces options. | Agent designs, plans, issues subagent tasks, merges, and performs releases unsupervised until a specified milestone or user stop. |
| `release-phase/SKILL.md` | Spawns tasks; surfaces decisions for user confirmation before spawning. | Spawns tasks only after explicit user approval of each item. | Spawns tasks autonomously per the agreed plan without per-task confirmation. |
| `release-phase-merge/SKILL.md` | Merge prompted; user notified at each merge checkpoint. | Merge requires explicit per-branch user confirmation. | Master merges autonomously; notifies user only on conflict or completion. |
| `CLAUDE.md §Which agent are you?` | Integration master role described with user-gate checkpoints. | Researcher/assistant role described; decision-deferral posture. | Autonomous master role described; chip-free orchestration; milestone-stop contract. |
| `CLAUDE.md §Task execution` | Confirm with user before committing to an approach. | Present options, await user direction before acting. | Execute to the agreed checkpoint without per-step confirmation. |
| `docs/grimoire/integration-workflow.md` | Current flow: user-confirms at push, release, major merges. | Current flow + explicit user-led design sections; decision log. | Autonomous flow: master drives phases; push remains human-gated (v1.6 non-goal). |

#### 3.2 Content shared across all paradigms (never swapped)

- All task-agent skills: `grm-repo-init`, `grm-workflow-bootstrap`, `grm-project-release`,
  `grm-release-planning`, `grm-release-agreement`, `grm-release-agent-tracker`,
  `grm-design-doc-scaffold`, `grm-workflow-scaffold`, `grm-worktree-preflight`,
  `grm-source-to-design-docs`, `grm-sync-from-source`, `grm-sync-from-upstream`,
  `grm-ledger-tick`, `grm-onboarding`, `grm-work-paradigm-switch`.
- Hook scripts and guards.
- All design docs, roadmap, version history, coding standards.
- Workflow scripts under `.claude/workflows/`.
- `CLAUDE.md` sections: §Worktree isolation, §Commits, §Coding practices,
  §Project commands, §Workflows, §UX design language.

---

### 4. Installer + switch mechanism

#### 4.1 Selection captured at onboarding

The `grm-onboarding` skill records `work-paradigm.value` in
`.claude/grimoire-config.json` at project setup (a preview-only field in
v1.5). Under v1.6, onboarding calls the `grm-work-paradigm-switch` skill
**immediately after** writing the config, activating the chosen paradigm
before `grm-workflow-bootstrap` runs. This ensures the installed content is
already paradigm-correct when the user's first session opens.

#### 4.2 The `grm-work-paradigm-switch` skill contract

**Input:** a `work-paradigm` value: `Supervised | Weiss | Noir` (case-insensitive; also accept `Autonomous`, `Collaborative` as aliases).

**Steps:**

1. Read `.claude/grimoire-config.json`; extract current `work-paradigm.value`
   and compare to the requested paradigm. If they match and all active files
   already contain the correct content (idempotency check — see §4.4), report
   "already active" and exit without modification.
2. Resolve the paradigm directory: `.claude/paradigms/<paradigm-slug>/`
   where slug is `supervised | weiss | noir`.
3. For each entry in the install map (§2.2):
   a. For skill files: overwrite the target file with the source.
   b. For `CLAUDE.md` sections: locate the section by its sentinel comment
      markers, replace its body with the source file's content (see §4.3).
   c. For `docs/grimoire/integration-workflow.md`: overwrite with source.
4. Update `.claude/grimoire-config.json`: set `work-paradigm.value` to the
   canonical form, remove `work-paradigm.in-development` (it is no longer
   present in schema-version 2), bump `schema-version` to `2`.
5. Print confirmation: "Work paradigm switched to <Paradigm>. Active files
   updated."

**Error conditions:**
- Paradigm directory missing → abort, print path, instruct user to restore
  via `workflow-bootstrap --restore`.
- Source file missing → abort entry, log warning, continue remaining entries
  (partial install is recoverable).

#### 4.3 `CLAUDE.md` section replacement via sentinel comments

Each paradigm-variable `CLAUDE.md` section is bracketed by stable sentinel
comments that the installer uses as replacement anchors:

```markdown
<!-- PARADIGM_SECTION:agent-role:start -->
…section content (replaced per paradigm)…
<!-- PARADIGM_SECTION:agent-role:end -->

<!-- PARADIGM_SECTION:task-execution:start -->
…section content (replaced per paradigm)…
<!-- PARADIGM_SECTION:task-execution:end -->
```

The installer replaces the *content between* the start/end markers (inclusive
of the markers themselves is acceptable; the source files include the markers).
Sections outside the sentinel brackets are untouched. Sentinel comments are
invisible to agents reading `CLAUDE.md` as prose.

**The section heading stays OUTSIDE the markers.** The `## Which agent are
you?` / `## Task execution` heading lines live in `CLAUDE.md`'s skeleton, above
the `:start` marker, and are never part of the swapped block. Paradigm
`CLAUDE-*.md` source files therefore contain **body-only** content between the
markers (no `##` heading) — otherwise a swap would duplicate the heading. (This
boundary rule was added after the v1.6 Phase-2 vet caught a heading-duplication
mismatch between the WP2 content and the WP3 marker placement.)

#### 4.4 Idempotent re-install

Running `grm-work-paradigm-switch` with the currently active paradigm is safe
and produces no visible change. The skill detects idempotency by:

1. Reading `work-paradigm.value` from the config.
2. Computing a checksum (or byte-level comparison) of each active file against
   its paradigm source.
3. If all match → early exit with "already active."

This means `workflow-bootstrap --restore` can call the switch skill as a
post-restore step without risk of spurious diffs.

#### 4.5 Restorability

`workflow-bootstrap --restore` is responsible for:

1. Restoring the golden-snapshotted paradigm content sets to
   `.claude/paradigms/`.
2. Calling `grm-work-paradigm-switch` with the value from
   `.claude/grimoire-config.json` to re-install the active paradigm's content.

If `.claude/grimoire-config.json` is missing or `work-paradigm` is unset,
restore defaults to `Supervised`.

---

### 5. Config schema change

#### 5.1 Schema-version 1 → 2

| Field | v1 (schema-version 1) | v2 (schema-version 2) |
|-------|-----------------------|-----------------------|
| `schema-version` | `1` | `2` |
| `work-paradigm.value` | `"Supervised" \| "Autonomous" \| "Collaborative"` | `"Supervised" \| "Weiss" \| "Noir"` (canonical; aliases accepted on input) |
| `work-paradigm.in-development` | `true` (required) | **removed** — field is now active |
| `workflow-variant.value` | `"Efficient" \| "Fast" \| "Careful-Serial"` | unchanged (still `in-development: true` — activated in a future release) |
| `workflow-variant.in-development` | `true` | `true` (unchanged) |

#### 5.2 v2 example

```json
{
  "schema-version": 2,
  "name": "My Project",
  "work-paradigm": {
    "value": "Noir"
  },
  "workflow-variant": {
    "value": "Efficient",
    "in-development": true
  }
}
```

#### 5.3 Forward-compat with v1.5 configs (schema-version 1)

Any Grimoire skill that reads `work-paradigm` must handle both versions:

- **If `schema-version` is `1`** (or missing): `work-paradigm` is
  `in-development`; treat it as advisory. Map the v1 value to the canonical
  v2 name (`Autonomous` → `Noir`, `Collaborative` → `Weiss`,
  `Supervised` → `Supervised`). Do not activate paradigm switching — the
  installer has not run yet.
- **If `schema-version` is `2`**: `work-paradigm.value` is active canonical.

The `grm-work-paradigm-switch` skill performs the migration when first invoked on
a v1 config: it activates the paradigm, drops `in-development`, and writes
`schema-version: 2`. This is the only migration path; no automated migration
runs silently.

#### 5.4 Value alias table

| Input (accepted) | Canonical stored value |
|-----------------|----------------------|
| `Supervised`, `supervised` | `Supervised` |
| `Autonomous`, `autonomous`, `Noir`, `noir` | `Noir` |
| `Collaborative`, `collaborative`, `Weiss`, `weiss` | `Weiss` |

#### 5.5 Schema-version 2 → 3 (`model-effort-profile`, E7)

v1.9's E7 adds a `model-effort-profile` field, mirroring `workflow-variant`. The
bump is **purely additive** and preserves the work-paradigm invariant: a
`schema-version: 3` config still means `work-paradigm` is active (the v2
guarantee from §5.1 is unchanged — nothing about `work-paradigm` is touched).

| Field | v2 (schema-version 2) | v3 (schema-version 3) |
|-------|-----------------------|-----------------------|
| `schema-version` | `2` | `3` |
| `model-effort-profile.value` | *(absent)* | `"Medium" \| "High Effort" \| "Low Effort" \| "Efficient" \| "Eco/Budget"` |
| `model-effort-profile.in-development` | *(absent)* | `true` (previewed; resolver still defaults to `Medium` until activation) |
| all other fields | unchanged | unchanged |

**Forward-compat:** a v2 config (no `model-effort-profile`) is read identically
to a v3 config whose value is `Medium` — readers treat a missing field/object as
`Medium`/default (the registry's `default-profile`). No migration is forced; old
configs behave exactly as today. A future `grm-model-effort-profile-switch` skill
would drop `in-development` + bump version on first switch, the same shape as
`grm-work-paradigm-switch`. The profile *data* lives in
`.claude/model-effort-profiles.json` with its own independent `schema-version`,
so the distribution can evolve without touching the project config schema.

---

### 6. Noir default execution path — "must dispatch, don't work solo" (F2)

> Added in v1.8. This section extends the Noir paradigm content (§3.1) with a
> *behavioural default*, not a new file surface. It pairs with the onboarding →
> first-release-planning bridge (F1): **F1 makes a fresh Noir project PLAN; F2
> makes it DISTRIBUTE the work.**

#### 6.1 Problem statement

The Noir content of §3.1 *describes* a phased, distributed pipeline — the master
plans, spawns work-item sessions via `spawn_task` (or write-capable Workflow
agents), and merges per phase. But nothing in the installed content *forces* the
autonomous session to enter that pipeline. Observed behaviour: told to "build X"
under Noir, the session reads the prompt, and — because it is fully autonomous
and unsupervised — simply **implements the entire project inline in its own
session**. It never decomposes into phases, never dispatches isolated-worktree
agents, and never hands branches to the integration master to merge.

The autonomy posture that makes Noir powerful is exactly what makes the
collapse-to-solo failure mode likely: with no per-step user gate to interrupt
it, the path of least resistance is to just do the work. The result loses every
benefit the phased model exists to provide:

- **Parallelism** — independent items that could run concurrently run serially
  inside one context.
- **Per-item isolation** — one worktree per work item (the NW1 safety rail) is
  abandoned; all changes pile into a single working tree.
- **Review gates** — the per-branch review + test step in `grm-release-phase-merge`
  never runs, because there are no branches.
- **Ledger tracking** — §5 of the release plan is never ticked; there is no
  record of what was implemented, reviewed, or merged.

This is the same gap F1 closes on the planning side: the content *documents* the
right behaviour but does not *trigger* it. F2 makes the phased distributed
dispatch the **default execution path** under Noir, not merely a documented
option.

#### 6.2 Design — distributed dispatch as the Noir default

**Trigger.** The default path engages **after a release plan is agreed** (a
`docs/release-planning-v{X.Y}.md` reaches `status: agreed` and a `version/{X.Y}`
staging branch exists — i.e. immediately after `grm-release-agreement`, which under
Noir follows directly from `grm-release-planning` and, via F1, from onboarding for a
fresh project). From that point the master is **in execution**, and execution
*means dispatch*.

**Required behaviour.** Once a plan is agreed, the Noir integration master
MUST, as its default path:

1. **Decompose into phases.** Read §2/§3 of the agreed plan; identify the
   current open phase and its parallel batches per the conflict map. (This is
   already the `grm-release-phase` contract — F2 makes entering it non-optional, not
   a new mechanism.)
2. **Dispatch work items as separate isolated-worktree agents.** For each item
   in the current batch, spawn a distinct agent — `spawn_task` chips, or a
   write-capable Workflow whose agents each receive their own isolated worktree
   and short-lived branch (§Write-capable Workflow integration in the Noir
   `grm-integration-master` content; NW1 isolation rails). The master does **not**
   implement the items inline.
3. **Merge per phase.** As branches report back, the master reviews, tests, and
   merges them into `version/{X.Y}` via `grm-release-phase-merge`, ticking §5 after
   each merge, then advances to the next phase — exactly as the
   agentic-scaffolding project itself is dogfooded (this design doc's own v1.8
   work is being built this way: DG-* design gates in parallel, then F-track
   implementation agents, then a dogfood phase).

In short: **under Noir, "execute the plan" is defined as "run the distributed
release-phase pipeline," never "write the code yourself."** Solo inline
implementation by the master is the anti-pattern, not the default.

**Soft guard / advisory warning.** Because Noir is autonomous, F2 does not
impose a hard block (a hard stop would contradict the paradigm's no-per-step-gate
contract and could strand a genuinely tiny single-file change). Instead it adds
an **advisory soft guard** in the Noir content:

- **What triggers it:** the master detecting that it is about to do — or is
  already doing — *substantial implementation work in its own session* after a
  plan has been agreed, instead of dispatching. "Substantial" is judged by the
  master against the plan: the agreed plan has open work-item rows for the
  current phase, and the master is writing feature/source code for one of them
  in its own worktree rather than spawning an agent for it. (A trivial,
  uncommitted fix-up, or work explicitly outside any planned item, does not
  trip it.)
- **What it says:** an advisory reminder along the lines of — *"Noir default is
  distributed dispatch: this work maps to planned item {ITEM-ID}. Spawn an
  isolated-worktree agent via `grm-release-phase` instead of implementing inline, so
  the work keeps its per-item isolation, review gate, and ledger row. Proceed
  inline only if this is intentionally out of the phased plan."* The master may
  proceed if it judges inline work correct, but the default is redirected to
  dispatch.
- **Advisory, not a hard block.** The guard is a warning surfaced in the content
  (and, optionally later, a non-blocking notice) — it never aborts the session.
  This keeps it inside the Noir autonomy contract while correcting the
  collapse-to-solo default. (Contrast with the *hard*, fail-closed
  `protected-branch-guard.sh` that governs merges — that one is a real block; the
  F2 guard is deliberately softer.)

#### 6.3 Interaction with the v1.6 write-capable workflow tier

F2 is about **entering** the distributed-dispatch path, which is orthogonal to
the v1.6 **read-vs-write capability** of a Workflow. The write-capable tier (NW1–
NW4, `docs/design/write-capable-workflow-design.md`) defines *how* a fan-out
agent is allowed to mutate files (isolated worktree, short-lived branch, master
merges); F2 defines *that* the Noir master must fan out at all after a plan is
agreed. Once F2 has the master dispatching, it may choose `spawn_task` chips or a
write-capable Workflow (Efficient / Fast / Careful-Serial variant) as the
dispatch vehicle — that choice is unchanged from v1.6. F2 adds no new tier and
relaxes none of the write-capable safety rails; it only removes the option of
*not* dispatching.

#### 6.4 Implementation targets (F2 edits)

F2 is paradigm-content editing only — it touches the **Noir** content set and
its installed copies, and leaves Supervised and Weiss content unchanged
(§3.1's Supervised/Weiss rows are not modified). The exact files F2 must edit:

| Content surface | Files (per flavor) |
|---|---|
| Noir integration-master content | `.claude/paradigms/noir/integration-master-SKILL.md` — canonical `claude-code/.claude/paradigms/noir/integration-master-SKILL.md`, the root dogfood copy `.claude/paradigms/noir/integration-master-SKILL.md`, and the `copilot/` equivalent **if/where a surface exists** (see note below). |
| Noir release-phase content | `.claude/paradigms/noir/release-phase-SKILL.md` — canonical `claude-code/.claude/paradigms/noir/release-phase-SKILL.md`, the root dogfood copy `.claude/paradigms/noir/release-phase-SKILL.md`, and the `copilot/` equivalent if/where a surface exists. |
| Active installed copies (Noir-active projects) | `.claude/skills/grm-integration-master/SKILL.md` and `.claude/skills/grm-release-phase/SKILL.md` — the currently-installed active content, when the active paradigm is Noir. (For a non-Noir-active project these stay untouched; the edit lands in the `noir/` content set and is installed on the next `grm-work-paradigm-switch` to Noir.) |
| Golden baseline | `.claude/golden/paradigms/noir/integration-master-SKILL.md` and `release-phase-SKILL.md` re-baselined by `grm-workflow-snapshot` — **owned by D1**, not F2 (per the §3 conflict map: golden re-baseline runs last). |

The two Noir content files receive: (a) the §6.2 "must dispatch, don't work
solo" default-path instruction (in `integration-master-SKILL.md`, as the defined
meaning of "execute the plan," and in `release-phase-SKILL.md`, as the trigger
that the master enters this skill by default once a plan is agreed); and (b) the
§6.2 soft-guard / advisory-warning text.

> **Copilot note.** Per the v1.8 plan §4, the full Copilot Work Paradigm
> file-swap port is backlogged — `copilot/` has no `paradigms/noir/` content set
> today. F2 mirrors the *behavioural* instruction into the `copilot/` equivalent
> **only where a corresponding surface already exists**; absent that surface, F2
> records a gap-note (consistent with how v1.8 handles Copilot behavioural
> mirrors elsewhere) and the canonical change lands in `claude-code/` + root.
> The mirror precedence is the standard one (`CLAUDE.md` §Source of truth):
> `claude-code/` canonical first, then root dogfood, then `copilot/`.

---

## Acceptance

- [ ] Design doc exists at `docs/design/work-paradigm-design.md` and is
      indexed in `docs/design/README.md`.
- [ ] Noir default-dispatch path is specified: problem statement, post-plan-
      agreement trigger, required decompose → dispatch → merge-per-phase
      behaviour, and the advisory soft-guard (trigger + message + advisory-not-
      block nature) (§6.1–§6.2).
- [ ] §6 names the F2 implementation targets (Noir `grm-integration-master` +
      `grm-release-phase` content across `claude-code/` canonical + root + active
      installed copies; copilot where a surface exists; golden owned by D1) and
      records the interaction with the v1.6 write-capable tier (§6.3–§6.4).
- [ ] Paradigm-neutral file naming scheme is specified: stable active paths
      enumerated, paradigm-invariant files listed (§1).
- [ ] Storage layout is specified: `.claude/paradigms/<paradigm>/` directory
      structure, install map, golden snapshot path (§2).
- [ ] Leanness principle is stated: only active paradigm's content installed;
      agents never load `.claude/paradigms/` directly (§2.4).
- [ ] Per-paradigm content-diff map is enumerated: every differing file, with
      the key behavioural axis per paradigm (§3.1). Shared content asserted (§3.2).
- [ ] Installer + switch end-to-end is specified: onboarding → activation
      path (§4.1), skill contract with error conditions (§4.2), `CLAUDE.md`
      sentinel scheme (§4.3), idempotency (§4.4), restorability (§4.5).
- [ ] Schema change fully specified: v1→v2 diff, v2 example, forward-compat
      rules, alias table (§5).
- [ ] WP2, WP3, WP4 have clear contracts to implement against this design.

---

## Open questions

*(none — all decisions resolved)*

---

## Follow-ups

- **WP2** (paradigm content): author the three content sets under
  `.claude/paradigms/` per §3.1; Supervised set is behavior-equivalent to
  today; Weiss/Noir encode their postures.
- **WP3** (switch skill): implement `grm-work-paradigm-switch` per §4.2–§4.4;
  integrate call into `grm-onboarding`; install sentinel comments in `CLAUDE.md`
  per §4.3; write schema-version 2 on first switch.
- **WP4** (bootstrap + golden): extend `grm-workflow-bootstrap` + golden to
  include `.claude/paradigms/` per §2.3; implement restore path per §4.5.
- **D1** (docs): update `CLAUDE.md` + `docs/grimoire/integration-workflow.md` to
  document paradigm selection/switch per the installed content structure.
- **F2** (v1.8, Noir default dispatch): per §6, edit the Noir
  `grm-integration-master` + `grm-release-phase` content (claude-code/ canonical + root
  + active installed copies; copilot where a surface exists) to make distributed
  release-phase dispatch the default post-plan-agreement execution path and add
  the advisory soft guard against solo inline implementation. Golden re-baseline
  is D1's. Pairs with F1 (onboarding → first-release-planning bridge).
- **Future**: determine whether the Supervised paradigm gets a Grimoire-themed
  name (roadmap notes "Gris" as a candidate — a neutral/grey middle tier).
- **Future**: autonomous push opt-in (v1.6 non-goal; blocked on proven
  paradigm system).
