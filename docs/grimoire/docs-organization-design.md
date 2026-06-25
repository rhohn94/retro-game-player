# Docs-by-Audience Reorganization

> **Up:** [↑ Grimoire tier](README.md)


> v1.17 D1 — audit + design gate. This document is itself the first inhabitant
> of the new `docs/grimoire/` tier, so it demonstrates the split it specifies.
> **Design only.** No files are moved and no references are edited here; the
> moves are C1, the pristine-source folder is C3.

## Motivation

`claude-code/docs/` currently mixes three audiences in one flat directory:

- **Operator-facing** docs an adopter reads to use Grimoire (quickstart,
  features, coding standards, roadmap).
- **Shared** design docs that both agents and operators reference
  (`docs/design/`).
- **Agent-only operational/process docs** that exist purely to drive the
  workflow (integration-workflow, cost spikes/validations, sync/feature
  audits). These are noise for an adopter skimming `docs/` and inflate the
  surface an operator must mentally filter.

Splitting agent-only operational docs into a dedicated `docs/grimoire/` tier
gives operators a clean top-level `docs/`, keeps the shared design tier where
agents already look, and gives the framework a clear home for its own
process artifacts.

## Scope

Covers: an audience classification of every file under `claude-code/docs/`;
the concrete `git mv` list into `docs/grimoire/`; the full reference-update
inventory C1 must execute against; the locked exception for
`release-planning-v*.md`; and the design of a pristine generation-source
folder (#8) distinct from the golden restore baseline.

Does **not** cover: executing the moves (C1), editing references (C1),
creating the source folder (C3), or any change to the Copilot flavor (a
separate migration step per CLAUDE.md).

## Design

### Classification rule

- **agent-only** operational/process docs → move to `docs/grimoire/`.
- **shared** design docs → `docs/design/` stays exactly where it is.
- **operator-facing** reference docs → stay at `docs/` top level.

### 1. Audit table (#9)

Every file physically present under `claude-code/docs/` today, classified:

| File | Audience | Disposition |
|---|---|---|
| `docs/quickstart.md` | operator-facing | stay at `docs/` |
| `docs/features.md` | operator-facing | stay at `docs/` |
| `docs/coding-standards.md` | operator-facing | stay at `docs/` |
| `docs/coding-standards/css.md` | operator-facing | stay (sub-dir of the above) |
| `docs/coding-standards/html.md` | operator-facing | stay (sub-dir of the above) |
| `docs/architecture-guidelines.md` | operator-facing | stay at `docs/` |
| `docs/version-design.md` | operator-facing | stay at `docs/` |
| `docs/roadmap.md` | operator-facing | stay at `docs/` |
| `docs/design/README.md` | shared | stay in `docs/design/` |
| `docs/design/onboarding-design.md` | shared | stay in `docs/design/` |
| `docs/design/issue-tracker-design.md` | shared | stay in `docs/design/` |
| `docs/design/feature-aware-sync-design.md` | shared | stay in `docs/design/` |
| `docs/design/ux/design-language.md` | shared | stay in `docs/design/ux/` |
| `docs/integration-workflow.md` | agent-only (paradigm-managed) | **move → `docs/grimoire/`** |
| `docs/feature-playbook-validation.md` | agent-only (validation artifact) | **move → `docs/grimoire/`** |
| `docs/issue-tracker-cost-spike.md` | agent-only (cost spike) | **move → `docs/grimoire/`** |
| `docs/issue-tracker-cost-validation.md` | agent-only (cost validation) | **move → `docs/grimoire/`** |
| `docs/sync-flow-audit.md` | agent-only (audit artifact) | **move → `docs/grimoire/`** |

> **Note on `version-history.md` / `release-planning-v*.md`:** the v1.17
> release-plan prose lists these among operator-facing docs, but in the
> shipped `claude-code/` copy neither file is physically present — both are
> *project-local* (created at runtime by `grm-release-agreement` / the release
> flow), not part of the shipped scaffold. They therefore have no row to move
> here. `release-planning-v*.md` is additionally path-locked (§4 below);
> `version-history.md` is operator-facing and would stay at `docs/` top level
> if/when a project creates one.

### 2. Concrete move list (C1 executes)

Exactly five files `git mv` into `docs/grimoire/`:

```
git mv docs/integration-workflow.md        docs/grimoire/integration-workflow.md
git mv docs/feature-playbook-validation.md docs/grimoire/feature-playbook-validation.md
git mv docs/issue-tracker-cost-spike.md    docs/grimoire/issue-tracker-cost-spike.md
git mv docs/issue-tracker-cost-validation.md docs/grimoire/issue-tracker-cost-validation.md
git mv docs/sync-flow-audit.md             docs/grimoire/sync-flow-audit.md
```

**[integration-workflow.md](../integration-workflow.md) is special — it is paradigm-managed.** Its active
copy at `docs/integration-workflow.md` is *written by the
`grm-work-paradigm-switch` skill* from a per-paradigm source
(`.claude/paradigms/<slug>/integration-workflow.md`). Moving the active target
to `docs/grimoire/integration-workflow.md` therefore additionally requires:

1. **Update the `grm-work-paradigm-switch` install-map target.** In
   `work-paradigm-switch/SKILL.md` §2 and §4.4 the target path
   `docs/integration-workflow.md` must become
   `docs/grimoire/integration-workflow.md` (two occurrences: the install-map
   row and the §4.4 prose). The same edit applies to the golden copy
   `.claude/skills/grm-workflow-bootstrap/golden/skills/grm-work-paradigm-switch/SKILL.md`.
2. **Update every paradigm source's internal `docs/integration-workflow.md`
   reference.** The three paradigm source [integration-workflow.md](../integration-workflow.md) files do
   not self-reference, but the *sibling* paradigm sources
   (`CLAUDE-agent-role.md`, `integration-master-SKILL.md`,
   `release-phase-merge-SKILL.md`) cross-reference
   `docs/integration-workflow.md` §sections and must be repointed to
   `docs/grimoire/integration-workflow.md` — in both the live
   `.claude/paradigms/` tree and the golden mirror.

These paradigm edits are part of C1's scope and are itemized in §3.

### 3. Reference-update inventory (C1 checklist)

Grep of `claude-code/` for each moved filename. Counts are **occurrence**
counts (a file may reference a name more than once). Golden mirrors under
`.claude/skills/grm-workflow-bootstrap/golden/` are listed separately because C1
must update them too (or re-snapshot via `grm-workflow-snapshot` after the live
edits — C1's call, but the bytes must end up consistent).

#### [integration-workflow.md](../integration-workflow.md) — by far the largest blast radius

**Live referencing files (31 files):**

| File | Occurrences |
|---|---|
| `.claude/hooks/protected-branch-guard.sh` | 1 |
| `.claude/hooks/worktree-guard.sh` | 2 |
| `.claude/paradigms/noir/CLAUDE-agent-role.md` | 1 |
| `.claude/paradigms/noir/integration-workflow.md` | 1 |
| `.claude/paradigms/noir/release-phase-merge-SKILL.md` | 2 |
| `.claude/paradigms/supervised/CLAUDE-agent-role.md` | 1 |
| `.claude/paradigms/supervised/integration-master-SKILL.md` | 2 |
| `.claude/paradigms/supervised/release-phase-merge-SKILL.md` | 2 |
| `.claude/paradigms/weiss/CLAUDE-agent-role.md` | 1 |
| `.claude/paradigms/weiss/integration-master-SKILL.md` | 1 |
| `.claude/paradigms/weiss/integration-workflow.md` | 1 |
| `.claude/paradigms/weiss/release-phase-merge-SKILL.md` | 2 |
| `.claude/skills/grm-hard-reset/SKILL.md` | 1 |
| `.claude/skills/grm-integration-master/SKILL.md` | 3 |
| `.claude/skills/grm-onboarding/SKILL.md` | 1 |
| `.claude/skills/grm-project-release/SKILL.md` | 1 |
| `.claude/skills/grm-release-phase-merge/SKILL.md` | 3 |
| `.claude/skills/grm-release-phase/SKILL.md` | 1 |
| `.claude/skills/grm-release-planning/SKILL.md` | 1 |
| `.claude/skills/grm-repo-init/SKILL.md` | 1 |
| `.claude/skills/grm-reporter/SKILL.md` | 1 |
| `.claude/skills/grm-sync-from-source/sync-from-source.sh` | 1 |
| `.claude/skills/grm-work-paradigm-switch/SKILL.md` | 4 |
| `.claude/skills/grm-workflow-bootstrap/SKILL.md` | 1 |
| `.claude/skills/grm-workflow-bootstrap/manifest.md` | 2 |
| `CLAUDE.md` | 4 |
| `README.md` | 2 |
| `docs/design/issue-tracker-design.md` | 2 |
| `docs/features.md` | 1 |
| `docs/quickstart.md` | 1 |
| `docs/sync-flow-audit.md` | 1 |

**Golden mirror referencing files (23 files):** every `.claude/skills/
workflow-bootstrap/golden/...` path that shadows a live file above —
`golden/CLAUDE.md`, `golden/hooks/protected-branch-guard.sh`,
`golden/hooks/worktree-guard.sh`, the three `golden/paradigms/<slug>/
integration-workflow.md` sources plus their sibling paradigm files, and the
`golden/skills/...` copies of `grm-hard-reset`, `grm-integration-master`, `grm-onboarding`,
`grm-project-release`, `grm-release-phase`, `grm-release-phase-merge`, `grm-release-planning`,
`grm-repo-init`, `grm-reporter`, `grm-work-paradigm-switch`, and `grm-issue-tracker`.

> **Distinguish two kinds of [integration-workflow.md](../integration-workflow.md) string.** (a) References
> to the **active doc path** `docs/integration-workflow.md` → these repoint to
> `docs/grimoire/integration-workflow.md`. (b) References to the **paradigm
> source file** `.claude/paradigms/<slug>/integration-workflow.md` (the
> install-map *source*) → the source filename does **not** change; only the
> install *target* changes. C1 must read each hit in context, not blanket
> sed, because both strings share the [integration-workflow.md](../integration-workflow.md) basename. The
> `grm-work-paradigm-switch` install map is the one place both appear together.

#### [feature-playbook-validation.md](feature-playbook-validation.md)

- **Live: 0 referencing files.** No hard-coded references anywhere in
  `claude-code/`. Safe to move with no follow-up edits.

#### [issue-tracker-cost-spike.md](issue-tracker-cost-spike.md) — 4 referencing files

| File | Note |
|---|---|
| `.claude/skills/grm-issue-tracker/SKILL.md` | live |
| `.claude/skills/grm-workflow-bootstrap/golden/skills/grm-issue-tracker/SKILL.md` | golden mirror |
| `docs/design/issue-tracker-design.md` | shared design doc → repoint to `docs/grimoire/...` |
| `docs/issue-tracker-cost-validation.md` | itself moving — relative reference stays intra-`grimoire/` |

#### [issue-tracker-cost-validation.md](issue-tracker-cost-validation.md)

- **Live: 0 referencing files.** Safe to move with no follow-up edits.

#### [sync-flow-audit.md](sync-flow-audit.md) — 1 referencing file

| File | Note |
|---|---|
| `docs/design/feature-aware-sync-design.md` | shared design doc → repoint to `docs/grimoire/...` |

**Per-file reference-site summary (the count C1 verifies against):**

| Moved file | Live referencing files | Golden mirror files |
|---|---|---|
| [integration-workflow.md](../integration-workflow.md) | 31 | 23 |
| [feature-playbook-validation.md](feature-playbook-validation.md) | 0 | 0 |
| [issue-tracker-cost-spike.md](issue-tracker-cost-spike.md) | 3 live (+1 self) | 1 |
| [issue-tracker-cost-validation.md](issue-tracker-cost-validation.md) | 0 | 0 |
| [sync-flow-audit.md](sync-flow-audit.md) | 1 | 0 |

### 4. Path-locked EXCEPTION (decided): `release-planning-v*.md` stays put

For v1.17, `docs/release-planning-v{X.Y}.md` **stays at `docs/` top level**
and is **not** relocated into `docs/grimoire/`, even though by audience it is
an agent-only process doc. Rationale — its path is hard-locked in three
independent places that would all have to change atomically and re-baseline:

- **`.claude/hooks/release-plan-guard.sh`** matches
  `docs/release-planning-v*.md` by glob to protect the agreed scope (§§1–4)
  of an `status: agreed` plan. The guard reads the basename pattern
  `release-planning-v*.md`; relocating the directory would silently disarm
  scope protection until the hook is updated.
- **`grm-release-agreement`** writes `docs/release-planning-v{X.Y}.md` as its
  create path.
- **`grm-release-planning` / `grm-release-phase-merge` / `grm-ledger-tick`** read and
  tick §5 of that same hard-coded path.

Moving it is a coordinated change across a guard hook plus the entire release
skill chain, with a live-data migration risk for any in-flight `agreed` plan.
That is out of scope for v1.17 and is explicitly deferred to a future change.
Decision: **path-locked, no move this version.**

### 5. Pristine source folder (#8): `.grimoire-source/`

#### Problem it solves

Doc-generating skills (`grm-source-to-design-docs`, `grm-design-doc-scaffold`,
`grm-design-language-adapt`) read existing skills/docs as *input* to synthesize new
docs. Today they read the **live** working tree — which may be mid-edit,
partially migrated (e.g. during this very reorg), or carrying a project's local
customizations. That makes generated output non-reproducible and lets in-flight
churn leak into generated docs. We want a **trustworthy, clean, stable input**
that is decoupled from whatever the live tree happens to be doing.

#### Proposal

A hidden, repo-root generation-source folder:

```
.grimoire-source/
```

**What it holds:** clean, unmodified source copies of the framework artifacts
that doc-generating skills consume as input — the canonical skill `SKILL.md`
files and the structural/operational docs (the same set that defines "how the
framework works"). It mirrors the shipped layout under its root (e.g.
`.grimoire-source/skills/<name>/SKILL.md`,
`.grimoire-source/docs/grimoire/integration-workflow.md`) so a consumer can
resolve an input by its normal relative path under the source root.

**Consumers (read-only):**

- **`grm-source-to-design-docs`** — reads the pristine skill/doc set to synthesize
  `docs/design/` structure for an existing project, instead of reading a
  possibly-dirty live tree.
- **`grm-design-doc-scaffold`** — reads the pristine house-layout/section sources
  when scaffolding a new `docs/design/{feature}-design.md`.
- **`grm-design-language-adapt`** — reads the pristine design-language source when
  producing the per-project `docs/design/ux/design-language.md` adaptation.

All consumers treat `.grimoire-source/` as **read-only**; none write into it.

**How it is populated and kept pristine:**

- Populated at framework install/bootstrap time (a `grm-workflow-bootstrap` step)
  by copying the canonical source artifacts in, and refreshed on
  `grm-sync-from-upstream` / `grm-sync-from-source` when the framework itself updates.
- It tracks the framework's *source of truth*, not the project's live edits:
  it is never written by feature work, task agents, or doc-generating skills.
  A consumer that finds `.grimoire-source/` missing falls back to the live tree
  with a one-line warning (fail-safe, not fail-closed) so generation still
  works on an un-bootstrapped checkout.
- Conservative scope: populate it only with the artifacts the three consumers
  actually read. Do not mirror the whole repo.

#### How it differs from `golden/`

| | `.../workflow-bootstrap/golden/` | `.grimoire-source/` |
|---|---|---|
| **Purpose** | **Restore baseline** — the bytes `workflow-bootstrap --restore` / `grm-hard-reset` write back to repair a drifted or wiped install | **Generation source** — trustworthy clean input that doc-generating skills *read* to synthesize new docs |
| **Direction** | Written *out* to active paths on restore | Read *in* by generator skills; never written to active paths |
| **Consumers** | `grm-workflow-bootstrap`, `grm-hard-reset`, `grm-install-doctor` | `grm-source-to-design-docs`, `grm-design-doc-scaffold`, `grm-design-language-adapt` |
| **Location** | Nested under the bootstrap skill | Repo-root hidden dir |
| **On missing** | Restore cannot proceed (fail-closed) | Generators fall back to live tree (fail-safe) |

They are deliberately separate: golden answers "what should the installed files
*be*"; `.grimoire-source/` answers "what clean input should a generator *read*".
Conflating them would couple restore semantics to generation semantics and make
either change risky. **C3 creates `.grimoire-source/`; this doc only designs
it.**

## Wiki hierarchy & relative links

This section is the **canonical convention authority** for all wiki-doc
conventions in Grimoire. `repo-reference/SKILL.md` routes agents here.
`CLAUDE.md` carries a lean pointer. There is no other place that defines
these rules — if something disagrees, this section wins.

### 1. Breadcrumb form

Every non-root, non-exempt `docs/**/*.md` opens with a blockquote breadcrumb
line using a **relative link** to the nearest tier index (`README.md` in its
directory, or a named ancestor index `.md`).

Exact pattern:

```
> **Up:** [↑ <Tier name>](<relative-path-to-README.md>)
```

Example (this very file would use):
```
> **Up:** [↑ Grimoire tier](README.md)
```

Enforcer regex: a non-index, non-exempt file must contain, within its first
~8 non-blank lines, a blockquote (`>`) containing a relative link whose
target basename is `README.md` in its own directory or an explicitly
designated parent `.md`. No YAML front-matter requirement.

### 2. Convention home (this section)

This section in `docs/grimoire/docs-organization-design.md` IS the canonical
convention authority. `repo-reference/SKILL.md` routes agents here. `CLAUDE.md`
carries a lean pointer. There is no other place that defines these rules.

### 3. Root identity

`docs/README.md` is the documentation root/anchor for the repo-root copy.
`claude-code/docs/README.md` is the canonical flavor root (must be created —
absent today). The repo-root `README.md` links down to `docs/README.md`.
Every tier below has an index page (`README.md` or a designated parent `.md`
that already links each child as a relative markdown link).

### 4. docs-map generation

Marker-delimited hybrid: `<!-- docs-map:begin -->` … `<!-- docs-map:end -->`
markers delimit the auto-generated region. `build_map` (in `doc_assurance.py`)
writes ONLY between the markers; curated content above and below the markers
is preserved. Idempotent — a second run with the same tree is a no-op. The
nested tree replaces the current flat three-bucket list.

### 5. Gating dial

One `grm-doc-assurance` setting in `grimoire-config.json` under a new `doc-hierarchy`
key:

```json
"doc-hierarchy": {
  "enforcer": { "value": "warn" }
}
```

Values: `off` / `warn` / `block`. Default: `warn`. This is an additive key —
no schema-version bump required. The `--strict` flag at release closeout
overrides to `block` regardless of the config value.

### 6. Migration vehicle

`grm-doc-assurance` owns **detection** (flags orphans, missing breadcrumbs,
absolute links, bare-prose references). A dedicated `grm-docs-migrate` skill
backed by `docs_migrate.py` **performs the rewrite** — archive-first, idempotent,
loud-fallback on unresolvable refs. The `feature-manifest` `migrate` column
invokes `docs-migrate --apply` for downstream projects. There is no duplicate
rewrite engine; detection and rewrite are separated by design.

### 7. Link-check scope

- **`check_hierarchy`** applies to `docs/**/*.md` only (orphan detection,
  up-link presence, per-tier index presence).
- **Absolute-path rejection** (any internal link starting with `/` or the repo
  URL) is repo-wide, covering `SKILL.md`, `CLAUDE.md`, and all `docs/`.
- **Bare-prose detection** (backtick refs to known `docs/` filenames appearing
  outside markdown links and code spans) is docs-scoped and conservative — only
  known filenames from the live docs tree are checked, to avoid false positives.

### 8. Exemptions

The following are exempt from up-link requirements and move requirements:

- `release-planning-v*.md` — path-locked by `release-plan-guard.sh` and the
  release skill chain; breadcrumb-only or exempt.
- `version-history.md` — operator-facing, stays at `docs/` top level.
- `qa-ledger.md` — ledger artifact, path-locked.

Paradigm-rendered docs (`paradigms/*/`) get breadcrumbs at their **source**
files and golden copies; the rendered/installed file (e.g.
`docs/grimoire/integration-workflow.md`) is never given a breadcrumb directly
because `grm-work-paradigm-switch` would overwrite it. An exemption list mirrors
the existing `PARITY_ALLOW_DIVERGENT` pattern.

### Lazy-navigation guidance

Cross-links should deep-link to the specific section or leaf page that answers
the question — use `[see §Design decisions](docs-organization-design.md#design-decisions)` or
`:line` references, not bare 'see the design doc' prose. Index pages should be
small (≤ 6 KB) and link-dense; leaf pages should stay focused (warn cap ≥ 20 KB).
Agents load the index, follow the link, read only the relevant leaf — this
structure is the Lever-4 (fixed-context trim) complement to verbosity's
output-side lever.

### Enforcer summary (for Phase 3 implementers)

`doc_assurance.py` Phase 3 additions: `check_relative_links` (absolute-link
rejection repo-wide; bare-prose detection docs-scoped; broken-anchor detection)
+ `check_hierarchy` (reachability from `docs/README.md`; up-link presence on
non-index, non-exempt pages; per-tier index presence) + nested marker-aware
`build_map` + off/warn/block dial from `grimoire-config.json` `doc-hierarchy`.
`--strict` escalates the dial to `block` for release closeout.

## Acceptance

- Every file under `claude-code/docs/` appears in the §1 audit with an
  audience and a disposition.
- §2 lists exactly the five `git mv` commands C1 runs, with the
  paradigm-managed handling for [integration-workflow.md](../integration-workflow.md) called out.
- §3 lists, per moved file, every referencing file (live + golden) with
  occurrence counts, usable as C1's execute-and-verify checklist.
- §4 states the `release-planning-v*.md` exception with its three lock points
  and rationale.
- §5 specifies `.grimoire-source/` — path, contents, consumers, population,
  pristineness, and the contrast with `golden/`.

## Open questions

- Whether C1 hand-edits the 23 golden mirror files or instead re-runs
  `grm-workflow-snapshot` after the live edits to re-baseline golden in one step.
  Either yields consistent bytes; recommend the snapshot path to avoid
  drift between live and golden.

## Follow-ups

- Relocate `release-planning-v*.md` into `docs/grimoire/` in a future version,
  coordinated with `release-plan-guard.sh` + the release skill chain (§4).
- Port the entire reorg to the `copilot/` flavor as a separate migration step
  (per CLAUDE.md: `claude-code/` first, then Copilot).
- Adopt the reorg into this project's own root `docs/` once the workflow wants
  it (dogfood step).
