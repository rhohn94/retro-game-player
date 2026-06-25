# Agent roles — the canonical role registry

> **Up:** [↑ Design docs](README.md)


> **This doc is the single source of truth for the framework's agent roles.**
> Every role guide (`.claude/skills/<role>/SKILL.md`, the integration-master
> and task-agent sections of `CLAUDE.md`, `docs/integration-workflow.md`)
> **references** this taxonomy rather than redefining it locally. When a role's
> mandate or write surface changes, change it here first.

## Motivation

Grimoire's agent roster grew ad hoc. Three roles exist today — the **task
agent**, the **integration master**, and the **Reporter** — but their
definitions are scattered: the task agent and integration master live in
`CLAUDE.md` §"Which agent are you?", the Reporter in its own skill and a
duplicated taxonomy table in `docs/integration-workflow.md`. Other
review/research/QA work happens through *skills* (`code-review`,
`deep-research`) or *agent types* (`Explore`) that were never named as roles.

Two problems follow from the scatter:

1. **Drift.** With no single registry, a role's behaviour drifts from its
   intent. The reporter-tracker routing bug (#19) is exactly this: the Reporter
   guide locally re-derived "where do I file" and got it wrong. A role that
   references one authoritative contract cannot drift in isolation.
2. **No uniform slot for new roles.** v1.14 adds five new roles (Reviewer,
   Scout, Verifier, Triager, Researcher) and an grm-install-doctor skill. Without a
   shared spawn + return contract, each would invent its own session shape,
   its own write-surface rules, and its own per-paradigm behaviour.

This doc makes the taxonomy **first-class**: one table that owns every role's
session type, context width, write surfaces, spawn rule, model/effort pin, and
mandate; one per-role contract section; one spawn + return contract that every
new role slots into; and one explicit statement of the **role vs. profile**
line. The five new roles and the doctor reference this doc; they do not
re-establish the taxonomy.

## Scope

**Covers:**

- The **role taxonomy table** (§A) — all current and planned roles in one grid.
- A **per-role contract** (§B) for each role: mandate, MAY / MAY NOT, and
  per-paradigm (Supervised / Weiss / Noir) behaviour.
- A uniform **spawn + return contract** (§C) — how the integration master
  spawns a role, what the role returns, and the no-git-write default for narrow
  roles.
- The **role vs. profile** distinction (§D), cross-linked to the
  execution-profiles design.
- **Forward references** (§E) to the five new-role work items and the
  install-doctor, with the doctor explicitly classified as a *skill, not a
  role*.

**Does not cover:**

- The implementation of any individual new role — each ships in its own work
  item (§E) with its own `SKILL.md`; this doc defines the slots they fill.
- Operating **profiles** (e.g. Steady Steward, deferred to v1.15) — a profile
  tunes behaviour on top of a role/paradigm; it is not a role. The boundary is
  drawn in §D; the profile machinery itself is out of scope here.
- The three execution dials (work-paradigm / execution-strategy /
  model-effort-profile) — those are defined in their own design docs and are
  *consumed* by this taxonomy, not redefined.

## Design

### A. The role taxonomy table

A **role** is a named session mandate with a fixed write surface. Three roles
exist today; five are added in v1.14. The install-doctor (#25) is a **skill,
not a role** — it appears here only to mark that distinction (§E).

| Role | Session type | Context width | Git write surface | Issue-tracker write surface | Spawning rule (who / when) | Model/effort pin | One-line mandate |
|---|---|---|---|---|---|---|---|
| **Task agent** | Own-session (via `spawn_task`), isolated worktree | Medium–large | **Yes** — commits on its own branch rooted at `version/{X.Y}` | No (flags via the master → Reporter) | Integration master, per `grm-release-phase` batch | Per `grm-repo-reference` table — sized to the item | Implement one work item to its checkpoint, then self-review. |
| **Integration master** | Orchestration session (main loop) | Medium | **Merge only** — into `version/*` / `dev` / `main` from the marker-blessed worktree | Via Reporter or `grm-feedback-to-issue` directly | Human (Supervised/Weiss) or autonomously under Noir | opus / high — review + integration judgement | Own release scope; plan, spawn, merge, release. |
| **Reporter** | Own-session (via `spawn_task`) | Narrow | **No** | **Yes** — the configured tracker only | Integration master / human / any; when filing 1+ items off the main loop | ~Haiku / Eco — `grm-feedback-to-issue` synthesis | File feedback through `grm-feedback-to-issue`, then exit. |
| **Reviewer** (#21) | Own-session (via `spawn_task`) | Narrow — the diff + touched code | **No** (read-only on code + diff) | No (confirmed findings → Reporter) | Integration master, **pre-merge** (Noir: auto per branch) | review band (opus/high) | Review the diff; return findings split blocking vs non-blocking. *Wraps `code-review`.* |
| **Scout** (#22) | Own-session (via `spawn_task`) | Narrow | **No** (strictly read-only) | **No** | Integration master at release-planning, or a task agent facing ambiguity | scout band (sonnet/medium typical) | Investigate a question; return a condensed structured brief. *Wraps `Explore` / `deep-research`.* |
| **Verifier** (#23) | Own-session (via `spawn_task`) | Narrow — the branch under test | **No** source edits / git writes (reads the branch; runs build/test/release) | No (failures → Reporter) | Integration master, **pre-merge** (Noir: auto per branch) | verify band (sonnet/medium typical) | Run build/test/release; return a structured pass/fail report. |
| **Triager** (#24) | Own-session (via `spawn_task`) | Narrow | **No** | **Yes** — the configured tracker only | Integration master, on demand or scheduled grooming | triage band (sonnet/medium typical) | Groom the tracker (dedupe / label / prioritize / close stale); return a summary. |
| **Researcher** (#26) | Own-session (via `spawn_task`) | Medium | **No** | **Yes** — files ONE scoped item | Integration master, or escalated from a Reporter (under-specified item) | **review band (opus/high), profile-invariant** | Investigate, then author + file one scoped design item. *Composes `grm-source-to-design-docs`, `grm-design-doc-scaffold`, `grm-feedback-to-issue`.* |

**Reading the columns.** *Session type* distinguishes own-session roles
(launched via `spawn_task` into a fresh session — the integration master never
inhabits them) from the integration master's own main loop. *Context width* is
the briefing budget the role is built for — narrow roles are deliberately
cheap. *Git write surface* and *issue-tracker write surface* together fix what
the role may mutate; for every narrow role at least one is **No**. *Spawning
rule* names who launches it and at what point in the release flow. *Model/effort
pin* is the recommended tier (rides along in the `spawn_task` chip; see
`grm-repo-reference`); only the Researcher's pin is **profile-invariant** (§D). The
*mandate* is the one-line contract — the longer form is each role's §B section.

### B. Per-role contracts

Each contract states the mandate, what the role **MAY** and **MAY NOT** touch,
and its **per-paradigm behaviour** — mirroring how the Reporter is described in
`.claude/skills/grm-reporter/SKILL.md`. The paradigm pattern is uniform across the
narrow roles:

> **Supervised** — the integration master *proposes* the spawn; the user
> approves via the standard `spawn_task` gate before the session starts.
> **Weiss (Collaborative)** — the master *offers and waits*; it does not
> auto-spawn. **Noir (Autonomous)** — the master *spawns autonomously* (no
> per-spawn confirmation), and may batch-spawn at the end of a phase. **In all
> paradigms, no role pushes to origin — that stays human-gated.**

The full, authoritative contract for each role lives in that role's own guide;
the subsections below fix the registry-level invariants.

#### B.1 Task agent

- **Mandate:** implement one work item to the agreed checkpoint, then review its
  own output for bugs/incomplete work. Guide: `CLAUDE.md` §"Task execution".
- **MAY:** read anything in its worktree; commit atomically on its own branch
  rooted at `version/{X.Y}`; add/update `docs/design/{feature}-design.md`.
- **MAY NOT:** merge into any protected branch; touch sibling worktrees; push;
  edit an agreed release plan's §§1–4; append to a tracker directly (flags route
  through the master → Reporter).
- **Per-paradigm:** the *paradigm* tunes how the task agent confirms an
  ambiguous plan (Supervised proposes and waits; Weiss offers; Noir proceeds
  within agreed bounds), not its write surface. The write surface is fixed.

#### B.2 Integration master

- **Mandate:** own release scope and integration — plan, spawn, merge, release.
  Guide: `.claude/skills/grm-integration-master/SKILL.md` and
  `docs/integration-workflow.md`.
- **MAY:** merge into `version/*` / `dev` / `main` from the marker-blessed
  worktree; spawn every other role; file issues directly or via a Reporter;
  propose pushes (human-gated).
- **MAY NOT:** push without the human gate; bypass the guard hooks; mutate a
  protected branch from an unmarked worktree.
- **Per-paradigm:** this *is* the dial that the work-paradigm primarily tunes —
  Supervised gates at scope-lock / batch-spawn / each-merge / push; Weiss
  collaborates at each gate; Noir runs unsupervised to a milestone with push
  still human-gated. See the integration-master guide.

#### B.3 Reporter

- **Mandate:** receive feedback and file it through `grm-feedback-to-issue`, then
  exit. Authoritative guide: `.claude/skills/grm-reporter/SKILL.md` (this registry
  does not restate its internals).
- **MAY:** write to the **configured issue tracker** only.
- **MAY NOT:** make any git commit; read/write any `version/*` branch; append to
  `docs/roadmap.md` on a `version/*` or `main` branch; push.
- **Per-paradigm:** the canonical proposes / offers-and-waits / autonomous
  pattern above. The Reporter is **not** a paradigm role — it is available in
  all three.

#### B.4 Reviewer (#21)

- **Mandate:** review a branch's diff pre-merge; return findings split into
  **blocking** vs **non-blocking**. *Wraps the existing `code-review` skill* —
  it does not reimplement review logic.
- **MAY:** read the diff and the code it touches; run read-only analysis.
- **MAY NOT:** edit code; commit; merge; write to the tracker directly
  (confirmed findings are handed to a Reporter).
- **Per-paradigm:** canonical pattern; under Noir the master auto-spawns a
  Reviewer per branch before merge.

#### B.5 Scout (#22)

- **Mandate:** investigate a bounded question (a library, an unfamiliar
  subsystem, a design unknown) and return a **condensed structured brief**.
  *Wraps `Explore` / `deep-research`.*
- **MAY:** read source, docs, and the web (via the research skills it wraps).
- **MAY NOT:** edit anything; commit; write to the tracker. **Strictly
  read-only** — the narrowest write surface in the registry.
- **Per-paradigm:** canonical pattern. May also be spawned by a *task agent*
  facing ambiguity (the one role spawnable below the master), still as its own
  read-only session.

#### B.6 Verifier (#23)

- **Mandate:** run the project's build / test / release commands against a
  branch and return a **structured pass/fail report** (tests, build, release,
  acceptance-criteria-met). Removes the task-agent self-grading conflict —
  verification is done by a different session than the one that wrote the code.
- **MAY:** check out / read the branch; run build/test/release commands.
- **MAY NOT:** edit source; make any git write beyond reading the branch; write
  to the tracker (failures handed to a Reporter).
- **Per-paradigm:** canonical pattern; under Noir the master auto-spawns a
  Verifier per branch before merge.

#### B.7 Triager (#24)

- **Mandate:** groom the configured issue tracker — dedupe, label, prioritize,
  close stale items — and return a **grooming summary**. Write surface is the
  tracker only, exactly like the Reporter; no git.
- **MAY:** read and mutate issues in the configured tracker (label / prioritize
  / close).
- **MAY NOT:** make any git commit; touch source or branches; push.
- **Per-paradigm:** under **Supervised** it *proposes* the grooming actions and
  waits; under **Noir** it *applies* them within configured bounds. Pairs with
  the Steady Steward profile (v1.15) and Daily Routines (v1.16).

#### B.8 Researcher (#26)

- **Mandate:** a two-phase role — (1) **investigate** a topic (composing
  `grm-source-to-design-docs`), then (2) **author and file ONE scoped item** in the
  design-doc house layout (composing `grm-design-doc-scaffold` and
  `grm-feedback-to-issue`). Write surface is the issue tracker only.
- **MAY:** read broadly; produce a design-doc-shaped artifact; file exactly one
  scoped tracker item.
- **MAY NOT:** commit code; merge; file multiple unscoped items; push.
- **Model/effort:** pinned to the **review band (opus/high) and is
  profile-invariant** — the model-effort-profile dial does not lower it, because
  scoping a design item is judgement work (§D).
- **Per-paradigm:** mirrors the Reporter's gating. Adds a **Reporter →
  Researcher escalation** seam: when a Reporter receives feedback too
  under-specified to file as a clean item, the master may escalate it to a
  Researcher to investigate and scope before filing.

### C. The spawn + return contract

Every own-session role slots into one uniform contract so new roles add no new
mechanics. This is what lets §E's five roles ship without re-deriving session
shape.

**Spawn (integration master → role).** The master launches the role via
`spawn_task` with a **self-contained prompt** of this shape:

```
<Role>: <one-line mandate>.
Context: <≤800-token shared digest — see integration-workflow.md
         §Pre-digested context brief; link paths for anything over the cap>.
Inputs: <the branch / question / feedback / topic this run operates on>.
Return: <the exact structured artifact this role returns — see below>.
```

The prompt is briefable cold (the spawned session has no memory of the master's
context), names the recommended model/effort (the chip cannot set the model —
the user picks it when opening), and embeds the shared digest verbatim so the
batch maximizes cache reuse.

**Return (role → master).** Each role returns a **structured artifact**, not a
prose ramble — the master consumes it as data:

| Role | Returns |
|---|---|
| Task agent | branch name + files touched + a short summary |
| Reporter | filed issue number(s) + URL(s) |
| Reviewer | findings, split **blocking** vs **non-blocking** |
| Scout | a condensed structured **brief** |
| Verifier | a **pass/fail report** (tests / build / release / criteria) |
| Triager | a **grooming summary** (deduped / labelled / closed) |
| Researcher | the filed issue number + the scoped design artifact |

**No-git-write default for narrow roles.** Every narrow role defaults to **no
git writes** — only the task agent (own branch) and the integration master
(merges) touch git. A narrow role that needs to *record* something does so
through the issue tracker (Reporter, Triager, Researcher) or hands its findings
back for the master to act on (Reviewer, Verifier, Scout). This default is what
makes narrow roles safe to spawn concurrently with an in-flight integration
session or phase merge — they never contend for a branch. The
`protected-branch-guard.sh` hook enforces it fail-closed: an unmarked
own-session role cannot commit to a protected branch even if its prompt drifts.

**One-shot semantics.** Own-session narrow roles do not idle, loop, or wait for
follow-up work: they perform their mandate, return the artifact, and exit. If
more work of the same kind arrives later, spawn a fresh session.

### D. Role vs. profile

A **role** and a **profile** are different axes and must not be conflated:

- A **role** defines a *session mandate + write surface* — *what this session is
  allowed to do and is for* (this doc). Roles are discrete and named.
- An operating **profile** *tunes behaviour on top of* a role + paradigm — *how
  thorough, how cautious, how chatty* — without changing the write surface. The
  **Steady Steward** profile (deferred to **v1.15**) is the first example: it
  would, e.g., make a Triager groom more conservatively, or a Reviewer weight
  certain finding classes — but it never grants a role a new write surface.

Concretely: switching profile must **never** turn a read-only role into a
writing one, and must never relax a paradigm gate. The role fixes the write
surface; the paradigm fixes who-confirms; the profile only tunes the dials
*within* those fixed bounds. The Researcher's review-band pin is
**profile-invariant** precisely to demonstrate the boundary — a cost-lowering
profile may not drop a judgement role below its required tier.

This is the same composition principle as the three execution dials
(work-paradigm × execution-strategy × model-effort-profile), which are
orthogonal inputs that tune behaviour without redefining each other. The
canonical three-dials design — including where a future profile layer sits
relative to those dials — is
[`execution-profiles-design.md`](execution-profiles-design.md) (the canonical
copy of that design is maintained on this flavor; see `docs/design/README.md`).
Profiles compose *with* paradigm and the dials; they do not replace this role
registry.

### E. Forward references — the v1.14 new roles + doctor

The five new roles below each ship in their own work item, in **both flavors**
(`.claude/skills/<role>/SKILL.md` + `copilot/.github/prompts/<role>.prompt.md`),
with a `grm-sync-from-upstream` feature-manifest entry so downstream projects adopt
on next sync. Each fills the slot defined for it in §A/§B and uses the §C
spawn + return contract:

- **Reviewer** — issue **#21**, branch `n1-reviewer-role`. §B.4.
- **Scout** — issue **#22**, branch `n2-scout-role`. §B.5.
- **Verifier** — issue **#23**, branch `n3-verifier-role`. §B.6.
- **Triager** — issue **#24**, branch `n4-triager-role`. §B.7.
- **Researcher** — issue **#26**, branch `n5-researcher-role`. §B.8.

**Install-doctor — issue #25, branch `n6-install-doctor`: a skill, NOT a role.**
The install-doctor is a single idempotent, non-destructive *skill* that audits
framework files against `workflow-bootstrap/manifest.md`, validates the upstream
connection, runs every feature-manifest `detect` predicate, optionally repairs
under `--repair` / `--reinstall`, and emits a health report. It **wraps**
`grm-workflow-bootstrap` + `grm-sync-from-upstream` (no reimplementation). It does not
appear in the role taxonomy table as a role because it has **no session mandate
of its own** — it runs in whatever session invokes it (typically the integration
master's), defines no spawn/return contract, and gets no worktree. It is listed
here only to fix that classification: **roles are session mandates; the doctor
is a skill.**

## Acceptance

- [ ] Doc exists at `claude-code/docs/design/agent-roles-design.md` in the house
      layout, and is indexed in `docs/design/README.md`.
- [ ] The §A taxonomy table covers all eight roles (3 existing + 5 planned) with
      every required column: role, session type, context width, git write
      surface, issue-tracker write surface, spawning rule, model/effort pin,
      one-line mandate.
- [ ] Each role has a §B per-role contract with mandate, MAY / MAY NOT, and
      per-paradigm (Supervised proposes / Weiss offers-and-waits / Noir
      autonomous) behaviour, mirroring the Reporter.
- [ ] The §C spawn + return contract defines the spawn-prompt shape, the
      per-role structured return, the no-git-write default for narrow roles, and
      one-shot semantics.
- [ ] §D draws the role-vs-profile line explicitly and cross-references
      `execution-profiles-design.md`.
- [ ] §E forward-references issues #21/#22/#23/#24/#26 (roles) and classifies
      #25 (install-doctor) as a skill, not a role.
- [ ] `docs/integration-workflow.md` references this doc as the canonical role
      registry rather than redefining the taxonomy.

## Open questions

- None blocking R1. The exact model/effort *band names* for the new roles are
  recommendations here; each role's work item finalizes its pin against the
  live `grm-repo-reference` table.

## Follow-ups

- **v1.15 Steady Steward profile** — the first operating profile; will exercise
  the §D role-vs-profile boundary against the Triager and Reviewer.
- **De-duplicate the taxonomy tables.** The Reporter's §5 table and the
  [integration-workflow.md](../integration-workflow.md) §Agent-type-taxonomy table predate this registry;
  a later coherence pass should slim them to a pointer here (R2 / D2 scope),
  leaving this doc as the sole grid.
- **Reporter → Researcher escalation seam** (§B.8) — wire it concretely when the
  Researcher (#26) lands.
