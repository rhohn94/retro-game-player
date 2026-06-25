# Clean Room — complete framework/project boundary + regenerate-from-scratch

> **Up:** [↑ Design index](README.md)

> v3.41 "Clean-Room", CR-1 — the design spine. This is the canonical design the
> later lanes (CR-2 pointer-integrity, CR-3 operational-doc disposition, CR-4
> machine-readable manifest, CR-5 surgical-regenerate command) build to. It
> **extends** v3.39 "Bulkhead"
> ([documentation-separation-design.md](documentation-separation-design.md)),
> which separated framework-internal *design docs* from consumer docs; CR-1
> completes that boundary across **all** framework-owned file classes and adds a
> regenerate-from-scratch capability. **Design only** — no files move, no gate
> code changes, and no command is built here; those land in the later lanes.

## Motivation

v3.39 "Bulkhead" proved one point about one file class: a consumer who installs
a flavor should receive only consumer-facing material — the framework's own
design specs must never leak into their `docs/design/`. It solved that for
`docs/grimoire/design/**` (relocated, excluded at both ship gates) and a handful
of study artifacts. But the boundary is **partial**: it covers design docs and a
few named operational docs, file-by-file. The framework owns far more — skills,
hooks, paradigms, workflows, config, golden baselines, manifests, and a long
tail of operational docs — and there is **no single authority** that says, for
every file Grimoire owns, whether it is pure-framework / mixed / project-owned
and what happens to it on ship / sync / regenerate.

Two concrete gaps motivate this release:

1. **No complete taxonomy.** The Bulkhead exclusion sets
   (`EXCLUDED_PATH_PREFIXES`, `is_excluded()`) are hand-maintained lists kept in
   sync across two gates by hand. There is no enumerated, classified inventory of
   *every* framework-owned file class to derive them (and a future
   machine-readable manifest) from. File classes added since Bulkhead have
   accrued without a disposition decision, and ~8 shipped docs now hold relative
   links to excluded/relocated docs — dangling pointers in a consumer install.

2. **No regenerate-from-scratch capability.** A damaged framework layer has only
   two recovery paths, neither fitting the common case. `install-doctor --repair`
   restores **missing/drifted individual files** but does not reconcile *mixed*
   files or guarantee an idempotent whole-layer result. `grm-hard-reset` archives
   **everything** (including all project work) and re-onboards from zero — too
   blunt when a user just wants a clean framework layer with their project
   intact. There is no **surgical** middle path: regenerate the framework layer
   in place, preserving project files, idempotent, with archive-then-restore
   safety.

CR-1 supplies the conceptual basis for both: a complete file taxonomy, a
disposition contract per mixed file, a surgical-regenerate contract, and the
pointer-integrity rule that keeps the boundary honest. Later lanes implement it.

## Goals

- Enumerate **every class of file Grimoire owns** and classify each
  **pure-framework** / **mixed** / **project-owned** — a single authority CR-4
  turns into a machine-readable manifest and CR-5 consumes.
- Define a precise **split/merge contract** per mixed file (`CLAUDE.md` /
  `AGENTS.md`, `settings.json`, `.gitignore`, `roadmap.md`, `version-history.md`)
  — disposition + merge semantics concrete enough for CR-5 to implement.
- Define the **surgical-regenerate contract** (delete/restore/preserve sets,
  idempotency guarantee, archive-then-restore rollback) and contrast it with
  `grm-hard-reset`.
- Give a per-file **operational-doc disposition table** and state the
  **pointer-integrity rule extension** (no shipped doc may link an
  excluded/relocated doc) plus how to verify it.

## Non-goals

- **Building anything.** No file moves, gate-code edits, manifest schema,
  `regenerate` command, or pointer rewrites — those are CR-2…CR-5.
- **Re-litigating Bulkhead.** The v3.39 two-tier architecture, path-form rewrite
  rules, and two-gate exclusion mechanism stand; CR-1 extends, not changes them.
- **A config/schema bump or a new ship gate.** Exclusion stays the two existing
  gates (`build_distributables.py`, `sync-from-upstream.sh`); CR-4 may make their
  lists *derived* from the manifest, but adds no third gate.
- **Auto-running any migration or regenerate.** Like the Bulkhead migrate row,
  regenerate and any data-touching migration are explicitly invoked,
  archive-first, never silent.
- **Auditing shipped `SKILL.md` *prose***; that stays the Bulkhead follow-up.
  CR-1 scopes the boundary to *file classes* and *pointer integrity*.

## Scope

Covers: (1) the complete framework-owned file taxonomy with per-class
classification; (2) the mixed-file split/merge contract for the five mixed files;
(3) the surgical-regenerate contract consumed by CR-5; (4) the operational-doc
disposition table + the pointer-integrity rule extension and its verification —
the conceptual basis for CR-4's manifest and CR-5's regenerate command.

Does **not** cover (later lanes): the machine-readable manifest (CR-4); the
`regenerate` command (CR-5); rewriting the ~8 dangling pointers (CR-2);
relocating/seeding operational docs (CR-3); editing either ship gate; bumping the
feature-manifest version. See the v3.41 release-planning doc for lane contracts
and merge order.

## Design

### 1. Complete framework-owned file taxonomy

Every file in a Grimoire repo falls into exactly one of three classes:

- **pure-framework** — Grimoire-owned, no project content; safe to **delete +
  restore** from golden/bootstrap with no data loss.
- **mixed** — carries **both** a framework baseline *and* project content; must
  be **split/merged**, never blind-replaced (see §2).
- **project-owned** — never created, edited, or deleted by Grimoire; outside the
  framework layer. Regenerate must **preserve** these untouched.

The taxonomy by file class:

| File class | Path(s) | Class | Ships? | Regenerate disposition |
|---|---|---|---|---|
| **Skills** | `.claude/skills/**` (`SKILL.md`, helper `*.py`/`*.sh`) | pure-framework | yes (per flavor) | delete + restore from golden |
| **Hooks** | `.claude/hooks/*.sh` (guards) | pure-framework | yes | delete + restore from golden |
| **Paradigms** | `.claude/paradigms/**` (+ README) | pure-framework | yes | delete + restore; re-apply active paradigm via `grm-work-paradigm-switch` |
| **Workflows** | `.claude/workflows/*.js` | pure-framework (claude-code only) | yes (claude-code) | delete + restore from golden |
| **MCP servers** | `.claude/skills/*/server.py`, `mcp_runtime.py` | pure-framework | yes | delete + restore; re-register |
| **Framework design docs** | `docs/grimoire/design/**` | pure-framework | **no** (excluded, v3.39) | delete + restore |
| **Framework study artifacts** | the four `docs/grimoire/*.md` study files + `docs-organization-design.md` (v3.39 §4 set) | pure-framework | **no** (excluded, v3.39) | delete + restore (root-class) |
| **Maintenance home** | `docs/grimoire/maintaining-grimoire.md` | pure-framework | **no** (root-only) | delete + restore (root only) |
| **Tier index (shipped)** | `docs/grimoire/README.md` | pure-framework | **yes** (wiki-convention authority, v3.39 §6) | delete + restore from golden |
| **Operational docs** | top-level framework-internal `docs/*.md` (see §4) | mixed *or* pure-framework per row | per §4 | per §4 (relocate ⇒ restore; seed ⇒ mixed) |
| **Golden baseline** | `.claude/skills/grm-workflow-bootstrap/golden/**` | pure-framework | yes | the restore **source**; re-captured only by `grm-workflow-snapshot` |
| **Manifests** | `manifest.md`, `feature-manifest.md` | pure-framework | yes | delete + restore from golden |
| **Config** | `.claude/grimoire-config.json` (schema, dials), `.claude/settings.json` (framework allowlist/hooks) | **mixed** | yes | split/merge (§2) — never overwrite project keys |
| **Agent guidance** | `CLAUDE.md` (+ `copilot/AGENTS.md`) | **mixed** | yes | split/merge (§2) — preserve project placeholders + sentinel |
| **`.gitignore`** | repo-root `.gitignore` | **mixed** | yes | section-merge (§2) |
| **Roadmap** | `docs/roadmap.md` | **mixed** | yes | baseline-row reconcile (§2) |
| **Version history** | `docs/version-history.md` | **mixed** | yes (seeded empty for consumers) | seed-template vs Grimoire's own log (§2) |
| **Project design docs** | `docs/design/**` (incl. `ux/**`, README) | **project-owned** | template only | **preserve** (never touched) |
| **Project source / tests** | everything outside `.claude/` + framework `docs/` | **project-owned** | no | **preserve** |
| **Archives** | `.grimoire-archive/**` | project-owned | no | **preserve** (never re-archive) |

This table is the source for **CR-4's machine-readable manifest** (each row → a
manifest entry with `class` + `disposition`) and the set partition **CR-5's
regenerate** operates over. The Bulkhead exclusion lists
(`EXCLUDED_PATH_PREFIXES`, `is_excluded()`) are exactly the "Ships? = no" rows;
CR-4 may make those lists *derived* from the manifest so the two gates can no
longer drift apart by hand.

### 2. Mixed-file split/merge contract

A mixed file must never be blind-replaced from golden (destroys project content)
nor left untouched (lets the baseline rot); each is reconciled by a file-specific
merge:

| Mixed file | Disposition | Merge semantics (concrete) |
|---|---|---|
| **`.claude/settings.json`** | **mixed-split-merge** (3-way) | The framework owns a known permission **allowlist** (the maintenance-script scope) and the **hooks** block; the project owns any other `permissions.allow`/`deny` entries, `env`, and custom hooks. Regenerate computes a **3-way merge** (base = golden, theirs = current file, ours = golden framework block): result = project keys preserved verbatim ∪ framework allowlist/hooks reset to golden. Never widen beyond framework scope; never drop a project key. (This is the existing `workflow-bootstrap --restore` settings-merge, made canonical.) |
| **`CLAUDE.md` / `copilot/AGENTS.md`** | **mixed-split-merge** (section + sentinel aware) | The framework owns the standard managed sections (source-of-truth, onboarding-sentinel, work-paradigm, stealth-mode, agent-role, worktree, task-execution, commits, …); the project owns the **Project commands** placeholders (`{test-command}`, …) and project-authored sections. Regenerate restores framework sections from golden **but**: (a) preserves filled-in project placeholders (re-inject resolved values, don't reset to `{…}`); (b) **sentinel** — if line 1 is the `GRIMOIRE_ONBOARDING_SENTINEL` literal, preserve it (pre-onboarding); if clean, do **not** re-arm it (regenerate is not a factory reset). The active paradigm's rendered content is restored via `grm-work-paradigm-switch`, not by editing the rendered copy. |
| **`.gitignore`** | **section-merge** | Grimoire owns a delimited section (managed ignore entries — `.grimoire-archive/`, cache dirs); the project owns everything else. Regenerate replaces **only** the Grimoire-managed section (matched by its sentinel comment markers), leaving project lines and ordering intact. Append the section if absent; idempotent on re-run (no duplicate). |
| **`docs/roadmap.md`** | **baseline-row reconcile** | The framework seeds **baseline rows** (the standard backlog scaffold, e.g. the UX-defer row); the project owns its own rows and release history. Regenerate reconciles baseline rows against golden (restore any missing/garbled one) **without** touching project rows — never deletes or reorders project content. (Already shielded in `grm-sync-from-upstream` `is_excluded()` for the same reason.) |
| **`docs/version-history.md`** | **exclude-and-seed (consumer) vs framework log (root)** | A **consumer** gets a **seeded empty** file (heading + empty changelog) — their history is their own, never Grimoire's log. For **Grimoire's root copy** the file *is* the framework release log. Regenerate branches on audience: consumer ⇒ ensure the empty template exists, never overwrite existing entries; root ⇒ leave the log. Seed ships via golden; the populated log does not ship. |

**Invariant for all mixed files:** the merge is **idempotent** — two runs yield
the same file (clean diff on run 2). A non-idempotent merge is a bug (project
content leaking into the baseline, or the baseline re-applying). CR-5's
acceptance includes a second-run-clean-diff check per mixed file.

### 3. Surgical-regenerate contract (consumed by CR-5)

`regenerate` restores the **framework layer only, in place**, preserving project
files, with an idempotency guarantee and archive-then-restore safety — the
surgical middle path between `install-doctor --repair` (per-file, no whole-layer
guarantee) and `grm-hard-reset` (archives *everything*, re-onboards).

**Set partition** (from §1 taxonomy):

- **Delete + restore** — the **pure-framework** set: deleted then restored from
  golden/bootstrap. No project content ⇒ loss-free.
- **Split/merge** — the **mixed** set (§2): reconciled in place by the
  file-specific merge; never deleted, never blind-replaced.
- **Preserve** — the **project-owned** set: never read-for-write, deleted, or
  moved. Includes `docs/design/**`, project source/tests, existing
  `.grimoire-archive/**`.

**Idempotency guarantee.** A second run with no intervening edits produces a
**clean diff**: pure-framework files are already at golden on run 2; mixed merges
are idempotent (§2); project-owned files are untouched. CR-5 must assert this.

**Failure / rollback behavior — archive-then-restore, never silent data loss.**

1. **Pre-flight summary.** Enumerate the delete-set, merge-set, and preserve-set
   before any write (like `grm-hard-reset` Step 3).
2. **Archive first.** Before any mutation, copy every delete-set **and**
   merge-set file to `.grimoire-archive/<ts>/` (UTC-stamped, repo-relative paths,
   with a `MANIFEST.md` recording class + original path + reason = "regenerate"),
   reusing the `grm-hard-reset` layout. The preserve-set is **not** archived.
3. **Restore / merge.** Delete+restore the pure-framework set, then apply the
   per-file merges to the mixed set.
4. **Rollback.** On any failure, restore the archived originals over the
   partially-modified tree. Because the archive precedes any mutation, a crash
   leaves a recoverable copy. Never `--force`-delete without an archive in hand.

**Contrast with `grm-hard-reset`** (the key distinction CR-5 must preserve):

| | `regenerate` (surgical, CR-5) | `grm-hard-reset` (factory reset, existing) |
|---|---|---|
| Scope | framework layer **only**, in place | **everything** (project + framework) |
| Project files | **preserved** untouched | **archived** then cleared |
| Mixed files | **split/merged** (project content kept live) | archived (project content removed from live tree) |
| Onboarding sentinel | **not** re-armed (stays a working project) | **re-armed** (re-onboards from zero) |
| Config | framework keys reset, project keys preserved | rewritten to fresh schema (optionally cleared) |
| Archive | delete-set + merge-set only | full project-local tree |
| Use case | "framework layer damaged; fix it, keep my work" | "wipe scaffold back to not-yet-onboarded" |

`grm-install-doctor` remains the **read-only audit** that *detects* MISSING/DRIFTED
and may invoke regenerate as the remediation; regenerate is the whole-layer,
idempotent, mixed-aware action it delegates to.

### 4. Operational-doc disposition + pointer-integrity rule

Several framework-internal **operational docs** still ship from top-level
`docs/`. Each is tagged **relocate-to-`docs/grimoire/`** (pure-framework,
excluded) or **exclude-and-seed** (consumer gets an empty template; Grimoire
keeps its own):

| Operational doc | Disposition | Rationale |
|---|---|---|
| `docs/grimoire/integration-workflow.md` | **relocate** to `docs/grimoire/` | Framework-process doc (lane contracts, merge protocol); a consumer never authors releases the Grimoire way against their copy. (Its `#NNN` / dogfood prose is edited at the **paradigm source** `.claude/paradigms/*/integration-workflow.md`, not only the rendered copy — per v3.39 §5.) |
| `docs/grimoire/version-design.md` | **relocate** to `docs/grimoire/` | Framework versioning scheme; internal. |
| `docs/grimoire/qa-ledger.md` | **relocate** to `docs/grimoire/` | Grimoire's own retrospective-QA ledger; framework-dev provenance. |
| `docs/release-planning-v*.md` | **relocate** to `docs/grimoire/` | Grimoire's own per-release planning history (also the pre-existing `docs/release-planning-v3.41.md` docs-map finding's class). |
| `docs/version-history.md` | **exclude-and-seed** | Mixed (§2): consumer gets an empty template, Grimoire keeps its log. The one *seeded* (not relocated) doc — a consumer legitimately wants their own at this path. |
| `docs/token-efficiency-*.md` | **relocate** to `docs/grimoire/` | Framework-dev measurement/study artifacts; internal. |
| `docs/grimoire/execution-profile-spike-s1.md` | **relocate** to `docs/grimoire/` | Framework-dev spike artifact; internal. |

After relocation, each row joins the v3.39 exclusion set (its new
`docs/grimoire/<name>.md` prefix added to **both** `EXCLUDED_PATH_PREFIXES` and
`is_excluded()`, kept synchronized — the standing two-gate invariant). CR-3 owns
the moves; CR-4 may fold these prefixes into the manifest.

**Pointer-integrity rule (extension of v3.39's CRITICAL invariant).** v3.39
stated *no shipped pointer may reference an excluded doc*. CR-1 extends it to a
standing, verifiable rule covering **relative links**, not just literal
skill/script pointers:

> **No shipped doc may contain a relative link to an excluded or relocated doc.**

A shipped doc linking a target now under excluded `docs/grimoire/design/` (or a
relocated operational doc) would **dangle** in a consumer install (the target
never ships). There are **~8 known dangling pointers** today (shipped docs still
linking v3.39-relocated targets); CR-2 enforces and fixes them.

**How to verify (recommendation).** Extend `doc_assurance.py` with a check
scoped to the **shipped surface** (top-level `docs/` minus `docs/grimoire/**`,
plus each flavor's shipped tree): for every relative link in a shipped doc,
assert the target is **not** under any `EXCLUDED_PATH_PREFIXES` entry (reusing
the gates' exclusion source) — a deterministic, CI-able assertion, not a manual
sweep. CR-2 implements it; regenerate must not re-introduce a dangling pointer
(golden copies are clean).

## Acceptance

- This doc exists at `docs/grimoire/design/clean-room-design.md` in all three
  flavors (canonical `claude-code/`, `copilot/`, root), follows the house layout
  (Motivation / Goals / Non-goals / Scope / Design / Acceptance), and carries the
  `> **Up:** [↑ Design index](README.md)` breadcrumb.
- The design index (`docs/grimoire/design/README.md`) in all three flavors has an
  entry for it, and the docs map (`docs/README.md`) lists it.
- The four contracts are present and implementable: (1) the framework-owned file
  taxonomy with per-class classification; (2) the mixed-file split/merge contract
  for `CLAUDE.md`/`AGENTS.md`, `settings.json`, `.gitignore`, `roadmap.md`,
  `version-history.md`; (3) the surgical-regenerate contract (delete/restore/
  preserve partition, idempotency guarantee, archive-then-restore rollback,
  `grm-hard-reset` contrast); (4) the operational-doc disposition table + the
  pointer-integrity rule extension and its verification.
- `grm-doc-assurance` `flavor-parity links docs-map --strict` does not **regress**:
  flavor-parity and links stay clean; the new doc is added to the docs map via
  `--write-map`.
- The new doc introduces no new `grm-doc-assurance` hierarchy / relative-link /
  reachability findings for the CR-1 files.

## Follow-ups

- **CR-2** enforces the pointer-integrity rule and fixes the ~8 dangling
  pointers; **CR-3** relocates/seeds the operational docs per §4; **CR-4** writes
  the machine-readable manifest derived from the §1 taxonomy; **CR-5** builds the
  surgical `regenerate` command against §2 + §3.
- Making `EXCLUDED_PATH_PREFIXES` and `is_excluded()` **derived** from CR-4's
  manifest (eliminating the hand-sync risk between the gates) is a strong
  candidate for CR-4, left to that lane's design.
- A full audit of shipped `SKILL.md` *prose* remains the standing v3.39
  follow-up; CR-1 scopes the boundary to file classes and pointers.
