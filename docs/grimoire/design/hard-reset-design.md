# Hard-reset design

> **Up:** [↑ Design docs](README.md)


## Motivation

A Grimoire scaffold accumulates project-local state the moment a user starts
using it: a roadmap, a version history, one or more release plans, project
design docs, project source, and a customised `CLAUDE.md`. Sometimes an
operator wants to **start that project over** — abandon the accumulated
planning/source state and return the scaffold to its pristine, not-yet-onboarded
condition — without losing the work that already exists on disk and without
hand-deleting two dozen files.

Today there is no supported way to do this. A user would have to manually
identify which files are framework vs. project, decide what to keep, re-install
the onboarding sentinel, and re-run onboarding — error-prone, and one slip
deletes real work. The **`grm-hard-reset`** skill makes this a single guarded
operation: it **archives** (never deletes) every project-local file into a
timestamped directory, restores the framework to its pristine state, re-installs
the onboarding sentinel, and re-runs onboarding — behind a strong per-action
confirmation gate.

The non-negotiable invariant is **archive, never delete**. A hard reset must
always be fully recoverable from the archive it produces.

---

## Scope

**Covers:**

- The **file-class split** — which files are FRAMEWORK (restored to pristine)
  vs. PROJECT-LOCAL (archived then cleared), and how ambiguous files
  (`CLAUDE.md`, `.gitignore`) are handled.
- The **archive destination** — a timestamped `.grimoire-archive/<ts>/`
  directory, its layout, what is copied into it, and `.gitignore` handling.
- **Re-onboarding** — whether the reset re-installs the
  `GRIMOIRE_ONBOARDING_SENTINEL` and re-runs `grm-onboarding` /
  `grm-workflow-bootstrap`, and the exact sequence.
- **Config handling** — restore `grimoire-config.json` to defaults vs. preserve
  selected preferences (paradigm, workflow-variant), and the opt-flag that
  selects between them.
- The **git-history relationship** — archiving copies files; it does **not**
  rewrite git history.
- The **safety guard** — strong per-action explicit confirmation with an
  itemised pre-flight summary, per the `CLAUDE.md` §Commits destructive-op rule.
- The **skill shape** — the new `grm-hard-reset` skill, its trigger phrases, and the
  flavors to mirror (canonical `claude-code/` → root → `copilot/`).

**Does not cover:**

- The implementation of the skill itself — that is C1 (Phase 2). This doc is
  C1's contract.
- Re-onboarding behaviour internals — owned by
  [`onboarding-design.md`](onboarding-design.md); this doc only specifies the
  hand-off.
- Paradigm content-set internals — owned by
  [`work-paradigm-design.md`](work-paradigm-design.md); this doc references the
  switch contract, it does not restate it.
- Git history rewriting, branch deletion, or any `git reset --hard` /
  `git clean` operation — explicitly out of scope (see §5).
- A "soft reset" / partial-revert mode — a future follow-up if requested.

---

## Design

### 1. File-class split

Every path under the scaffold is classified into one of two classes. The class
determines what the reset does with it: FRAMEWORK files are **restored to
pristine** (via the golden baseline / `workflow-bootstrap --restore`);
PROJECT-LOCAL files are **archived, then cleared** so the scaffold returns to
its day-one shape.

The authoritative inventory of framework files is
`grm-workflow-bootstrap`'s `manifest.md` (the "Restorable skills / infrastructure /
workflows / paradigm content sets" sections). The reset reads that manifest
rather than hard-coding the list, so the two never drift.

#### 1.1 FRAMEWORK files (restore to pristine — archived first if customised)

| Path / glob | Source of truth |
|---|---|
| `.claude/skills/**` (all skills in `manifest.md`) | golden `golden/skills/` |
| `.claude/hooks/*.sh` | golden `golden/hooks/` |
| `.claude/settings.json` | golden `golden/settings.json` |
| `.claude/push-allowlist` | golden `golden/push-allowlist` |
| `.claude/workflows/*.js` (Claude-Code flavor only) | golden `golden/workflows/` |
| `.claude/paradigms/{supervised,weiss,noir}/**` | golden `golden/paradigms/` |
| `.claude/grimoire-config.json` | regenerated — see §4 |
| `docs/design/README.md` (the template index) | golden / template |
| `docs/coding-standards.md`, `docs/architecture-guidelines.md`, `docs/grimoire/integration-workflow.md`, `docs/grimoire/version-design.md`, `docs/quickstart.md`, `docs/features.md` | scaffold template copies |

Framework files are **restored**, not deleted. Where a framework file has been
customised by the project (e.g. a patched skill, an edited `settings.json`), a
copy of the current version is placed in the archive (§2) before the pristine
golden copy overwrites it, so customisation is recoverable.

#### 1.2 PROJECT-LOCAL files (archive, then clear)

| Path / glob | Notes |
|---|---|
| `docs/roadmap.md` | Project's own roadmap — archived, then reset to the template placeholder. |
| `docs/version-history.md` | Project's shipped-version log — archived, then reset to empty template. |
| `docs/release-planning-v*.md` | All release plans — archived, then removed. |
| `docs/design/*-design.md` (except `README.md`) | Project feature design docs — archived, then removed. The template `README.md` index is restored to its pristine row set. |
| `docs/design/ux/**` | Per-project UX design language + tier docs — archived, then removed. |
| `ux-demo/**` | The UX demo app — archived, then removed. |
| Project source tree | Whatever lives outside the scaffold's own `docs/`, `.claude/`, `claude-code/`, `copilot/` — archived, then removed. **Enumerated against an exclude-list, not a hard-coded include-list** (see §1.4). |
| `.claude/integration-allow.local` | Local-only integration marker — archived, then removed. |
| `.claude/settings.local.json` | Local-only per-machine settings — archived, then removed. |

After archiving, project-local files are returned to their pristine template
form (roadmap/version-history) or removed entirely (release plans, project
design docs, source).

#### 1.3 Ambiguous case: `CLAUDE.md`

`CLAUDE.md` is **partly framework, partly project**: it carries permanent
framework instructions (the onboarding-sentinel detection block, worktree
isolation, commit discipline, paradigm sections) *and* project-specific values
filled in by `grm-workflow-bootstrap` (test/build/release commands, the project's
own roadmap-entry references, project-named prose).

**Decision: treat `CLAUDE.md` as project-local for archival, framework for
restoration.** Concretely:

1. **Archive** the current `CLAUDE.md` verbatim into the archive (§2), so the
   project's customisations are fully recoverable.
2. **Restore** `CLAUDE.md` from the pristine scaffold template — the version
   that ships with the onboarding sentinel on line 1 and placeholder
   `{test-command}` / `{build-command}` / `{release-command}` tokens unfilled.
   This is the same `CLAUDE.md` a freshly-copied scaffold has.

This guarantees the post-reset `CLAUDE.md` is byte-for-byte the day-one file
(sentinel present, placeholders unfilled), which is exactly what re-onboarding
(§3) expects to operate on.

#### 1.4 Ambiguous case: `.gitignore`, and the project-source exclude-list

- **`.gitignore`** is treated as **framework** and left **in place / merged, not
  cleared** — it carries scaffold-maintenance entries (`.sync-backup/`,
  `.scaffold-sync-backup/`, `.claude/integration-allow.local`,
  `.claude/settings.local.json`) plus the new `.grimoire-archive/` entry (§2.3).
  The reset ensures the archive-ignore entry is present and otherwise leaves the
  file untouched. The current `.gitignore` is archived as a courtesy copy.
- **Project source** is identified by **exclusion**, never by an include-list:
  anything that is *not* one of the framework areas
  (`.claude/`, `claude-code/`, `copilot/`, the scaffold's own template `docs/*`
  files, `.gitignore`, `.git/`) and *not* already classified above is treated as
  project source → archived, then removed. The exclude-list approach means the
  reset never silently leaves a stray project file behind, and the pre-flight
  summary (§6) lists every path it intends to touch so the user can veto.

> **Scaffold-self note.** In the agentic-scaffolding repo itself, `claude-code/`,
> `copilot/`, and `docs/design/*` ARE the product, not project-local state. The
> `grm-hard-reset` skill is meant for **adopting projects**, not for the scaffolding
> repo's own dogfood checkout; running it here would archive the product. The
> skill's pre-flight summary makes this obvious (it would list the product as
> "project source"), and the confirmation gate (§6) is the backstop. No special
> self-detection is specified for v1.8 — the human gate is sufficient.

---

### 2. Archive destination

#### 2.1 Location & timestamp

All archived files are **copied** into a single timestamped directory at the
repo root:

```
.grimoire-archive/<ts>/
```

`<ts>` is a UTC timestamp in `YYYYMMDD-HHMMSS` form (e.g.
`.grimoire-archive/20260529-143012/`). A new directory is created per reset, so
repeated resets never overwrite earlier archives. The `.grimoire-archive/`
parent accumulates one subdirectory per reset.

#### 2.2 Layout

Inside `<ts>/`, the original repo-relative paths are preserved, so the archive
is a faithful snapshot that can be diffed against or copied back by hand:

```
.grimoire-archive/20260529-143012/
├── MANIFEST.md                     # what was archived + why (class per path)
├── CLAUDE.md                       # the project's customised CLAUDE.md
├── grimoire-config.json            # the project's config at reset time
├── docs/
│   ├── roadmap.md
│   ├── version-history.md
│   ├── release-planning-v1.7.md
│   ├── release-planning-v1.8.md
│   └── design/
│       ├── auth-design.md
│       └── ux/
│           └── design-language.md
├── ux-demo/
│   └── ...
├── src/                            # project source (mirrored paths)
│   └── ...
└── framework-customisations/       # customised framework files (§1.1)
    └── .claude/
        ├── settings.json
        └── skills/<patched-skill>/SKILL.md
```

- **Project-local files** are mirrored at their original repo-relative path
  under `<ts>/`.
- **Customised framework files** (only those that differ from golden) are
  mirrored under `<ts>/framework-customisations/` so they are clearly separated
  from project work and never confused with restorable defaults.
- **`MANIFEST.md`** records, per archived path, its class (project-local vs.
  framework-customisation), its original location, and the reset timestamp +
  the `grimoire-config` values at reset time. This makes the archive
  self-describing for a future manual restore.

#### 2.3 `.gitignore` handling for the archive

`.grimoire-archive/` is added to `.gitignore` (idempotently — only if absent):

```
# Hard-reset archives (recoverable snapshots; never committed)
.grimoire-archive/
```

Rationale: archives are potentially large (they can contain the entire project
source), are recovery snapshots rather than tracked history, and should not
pollute the post-reset commit. Recovery is a filesystem copy-back, not a git
operation.

---

### 3. Re-onboarding

**Recommendation: yes — the reset re-installs the sentinel and re-runs
onboarding.** The whole point of a hard reset is to return to the day-one
not-yet-onboarded state; leaving the scaffold un-onboarded would be a
half-reset. The sequence is:

1. **Pre-flight summary + confirm** (§6) — the user sees exactly what will be
   archived/restored and explicitly confirms.
2. **Archive** all project-local files and any customised framework files into
   `.grimoire-archive/<ts>/` (§2). Write the archive `MANIFEST.md`.
3. **Restore framework to pristine** — run `workflow-bootstrap --restore`
   semantics over the manifest set: restore golden skills, hooks,
   `settings.json`, `push-allowlist`, workflows, and the three paradigm content
   sets. (This reuses the existing restore path rather than reimplementing it.)
4. **Clear / reset project-local files** — reset [roadmap.md](../../roadmap.md) and
   `version-history.md` to their template placeholders; remove release plans,
   project design docs, `ux-demo/`, and project source (already archived in
   step 2).
5. **Restore `CLAUDE.md` to the pristine template** with the
   `GRIMOIRE_ONBOARDING_SENTINEL` on line 1 (§1.3). This is the sentinel
   re-install — re-installing the template `CLAUDE.md` *is* the sentinel
   re-install; there is no separate sentinel-only step.
6. **Write `grimoire-config.json`** per §4 (defaults or preserved preferences).
7. **Hand off to onboarding.** Because line 1 of `CLAUDE.md` is now the
   sentinel, the very next prompt the user issues triggers the standard
   onboarding flow (`grm-onboarding` skill → `grm-repo-init` → `grm-work-paradigm-switch`
   → `grm-workflow-bootstrap`), per [`onboarding-design.md`](onboarding-design.md)
   §1–§5. The reset itself does **not** drive the interview inline — it restores
   the trigger condition and stops, so the user's next interaction is a normal
   first-run onboarding.

   - *Exception — `--reonboard-now` (optional):* if the user wants the interview
     to run immediately in the same session, the skill may invoke the
     `grm-onboarding` skill directly after step 6 instead of waiting for the next
     prompt. Default is the trigger-on-next-prompt behaviour (less surprising,
     mirrors a genuine fresh scaffold).

**Why restore framework before clearing/writing config:** the restore step
(step 3) repopulates `.claude/paradigms/` and golden-derived files; §4's config
write and any later `grm-work-paradigm-switch` need those in place. Clearing
project-local files (step 4) after the archive (step 2) guarantees nothing is
removed before it is safely copied.

---

### 4. Config handling

Two reasonable behaviours exist for `grimoire-config.json`:

- **Reset to defaults** — `schema-version` at current, `name` cleared (to be
  re-asked at onboarding), `work-paradigm.value: "Supervised"`,
  `workflow-variant.value: "Efficient"`. Truest to "pristine".
- **Preserve selected preferences** — keep the project's chosen
  `work-paradigm.value` and `workflow-variant.value` (and optionally `name`),
  so a re-onboarding doesn't force the operator to re-pick a paradigm they
  already settled on.

**Recommendation: preserve preferences by default; offer `--reset-config` to
force defaults.**

Rationale: a hard reset is usually "start the *project* over", not "I changed my
mind about how I want to work". The paradigm and workflow-variant are
operator-level ergonomics that rarely change between project restarts; forcing a
re-pick is friction with little upside. The operator who genuinely wants a
clean-slate config passes `--reset-config`.

Concretely:

| Field | Default (preserve) | With `--reset-config` |
|---|---|---|
| `schema-version` | current schema version | current schema version |
| `name` | preserved | cleared → re-asked at onboarding |
| `work-paradigm.value` | preserved | `"Supervised"` |
| `workflow-variant.value` | preserved | `"Efficient"` |

In **both** cases the *original* `grimoire-config.json` is archived (§2.2) before
being rewritten, so the pre-reset config is always recoverable. When preferences
are preserved, the reset writes a config consistent with the **current** schema
version (it does not resurrect a stale schema), and the subsequent
`grm-work-paradigm-switch` (driven by onboarding / `workflow-bootstrap --restore`)
re-installs the preserved paradigm's content set into the active paths — so a
preserve-mode reset lands in the same paradigm it started in, with pristine
content.

---

### 5. Relationship to git history

**The hard reset operates entirely on the working tree by copying and rewriting
files. It does NOT touch git history.**

- Archiving is a **file copy** into `.grimoire-archive/<ts>/`. No commits are
  rewritten, no history is rewritten, no branches are deleted, no tags are
  removed.
- The reset performs **no** `git reset --hard`, `git clean`, `git push --force`,
  or `git branch -D`. Those destructive history operations are explicitly out of
  scope (and would in any case require their own per-action confirmation under
  the `CLAUDE.md` §Commits rule).
- Prior project history remains fully present in git after a reset. The reset's
  effect is visible as ordinary working-tree changes (files removed/reset, the
  archive directory created-but-gitignored), which the user reviews and commits
  like any other change.
- Because the archive is git-ignored (§2.3), it does not enter history; it lives
  only on the working filesystem as a recovery snapshot. Recovery is a manual
  filesystem copy-back from `.grimoire-archive/<ts>/`, not a `git revert` /
  `git checkout` of old history.

This separation is deliberate: archiving gives the operator a recoverable copy
*and* an intact git history, two independent recovery paths.

---

### 6. Safety guard (destructive-adjacent → strong per-action confirmation)

A hard reset clears project-local files and overwrites framework files. Even
though it archives everything first, it is **destructive-adjacent** and is
governed by the `CLAUDE.md` §Commits rule:

> "Destructive ops (`git reset --hard`, `git push --force`, `git branch -D`)
> require explicit user confirmation each time (per-action)."

The guard:

1. **No silent invocation.** The skill never runs end-to-end without an explicit
   confirmation in the same turn. A trigger phrase only *enters* the skill; it
   does not authorise the reset.
2. **Itemised pre-flight summary.** Before any file is touched, the skill prints
   a concrete summary built from the §1 classification against the *actual*
   working tree:
   - the archive destination path (`.grimoire-archive/<ts>/`);
   - the list of project-local paths to be archived-then-cleared;
   - the list of framework files to be restored (and any customised ones that
     will be archived first);
   - the config behaviour in effect (preserve vs. `--reset-config`) and the
     resulting `grimoire-config.json` values;
   - the re-onboarding behaviour (sentinel re-install + trigger-on-next-prompt,
     or `--reonboard-now`);
   - an explicit "git history is NOT modified" line (§5).
3. **Explicit per-action confirmation.** The user must affirmatively confirm
   (via `AskUserQuestion`) after seeing the summary. A bare "yes" to a different
   question does not carry over. If the user declines, the skill exits having
   changed nothing.
4. **Archive-before-clear ordering** (already in §3) is itself a safety
   property: nothing is cleared until its archive copy exists and the archive
   `MANIFEST.md` is written.
5. **Refuse on a dirty *un-archivable* state** — if the working tree contains
   files the skill cannot classify or copy (permissions, symlink loops), it
   reports them and refuses rather than partially resetting.

---

### 7. Skill shape & flavors to mirror

**New skill: `grm-hard-reset`** (`.claude/skills/grm-hard-reset/SKILL.md`).

**Trigger phrases:** "hard reset", "reset the scaffold", "re-initialize the
project", "start the project over", "factory reset Grimoire", "wipe and
re-onboard", "archive and reset". The description must make clear the operation
is **destructive-adjacent** and **archives before clearing** so it triggers only
on deliberate intent.

**Options (flags):**

| Flag | Effect | Default |
|---|---|---|
| `--reset-config` | Reset `grimoire-config.json` to defaults instead of preserving preferences (§4). | off (preserve) |
| `--reonboard-now` | Run the `grm-onboarding` interview inline after reset instead of arming the sentinel for the next prompt (§3 step 7). | off (arm sentinel) |

**Composition:** the skill reuses existing machinery rather than reimplementing
it — it reads `grm-workflow-bootstrap`'s `manifest.md` for the framework inventory
(§1) and uses `workflow-bootstrap --restore` semantics for the framework
restore (§3 step 3), then arms the sentinel and hands to `grm-onboarding` (§3
step 7). It is **not** in the `grm-workflow-bootstrap` manifest's restorable set in
a way that resets itself mid-run — like `grm-workflow-bootstrap` and
`grm-workflow-snapshot`, `grm-hard-reset` is a meta-skill (it is a framework file that is
restored, but it must not archive/clear itself while executing; the running copy
is preserved).

**Flavors to mirror (C1 implementation):** canonical first, then propagate.

1. **`claude-code/`** — the canonical, gold-standard copy. Author the skill here
   first: `claude-code/.claude/skills/grm-hard-reset/SKILL.md`. Add it to
   `claude-code/.claude/skills/grm-workflow-bootstrap/manifest.md` and ship a golden
   copy under `workflow-bootstrap/golden/skills/grm-hard-reset/`.
2. **Root `.claude/`** — adopt into this project's own dogfood copy
   (`.claude/skills/grm-hard-reset/SKILL.md` + manifest + golden), matching the
   canonical version.
3. **`copilot/`** — the parallel flavor. Add the Copilot equivalent
   `copilot/.github/prompts/hard-reset.prompt.md`, mirroring the *behavioural*
   contract (file-class split, archive-then-clear, confirmation gate,
   re-onboarding) in Copilot prompt form. **Copilot has no `.claude/workflows/`
   equivalent**, so the workflow-file archival/restore row (§1.1) is omitted in
   the Copilot flavor; everything else mirrors.

The golden re-baseline (`grm-workflow-snapshot`) and the manifest/[features.md](../../features.md)
updates ride along with C1, or with the release's D1 dogfood pass per the v1.8
plan.

---

## Acceptance

- [ ] `docs/design/hard-reset-design.md` exists in house format and is indexed
      in `docs/design/README.md`.
- [ ] The FRAMEWORK vs. PROJECT-LOCAL file-class split is enumerated concretely
      (§1.1, §1.2), with the framework inventory sourced from
      `grm-workflow-bootstrap`'s `manifest.md`.
- [ ] Ambiguous cases are decided: `CLAUDE.md` (archive-as-project,
      restore-as-framework-template, §1.3) and `.gitignore` + project-source
      exclude-list (§1.4).
- [ ] The archive destination is specified: timestamped
      `.grimoire-archive/<ts>/`, never delete; layout, `MANIFEST.md`, and
      separated `framework-customisations/` subtree (§2.1–§2.2).
- [ ] `.gitignore` handling for the archive is specified, idempotently (§2.3).
- [ ] Re-onboarding behaviour is specified and recommended: sentinel re-install
      via pristine `CLAUDE.md`, then trigger-on-next-prompt onboarding, with the
      `--reonboard-now` opt-flag and the full step sequence (§3).
- [ ] Config handling is decided: preserve preferences by default, `--reset-config`
      to force defaults; original config archived in both cases (§4).
- [ ] The git-history relationship is stated explicitly: archives copy files and
      do NOT rewrite history; no destructive git ops (§5).
- [ ] The safety guard is specified: no silent invocation, itemised pre-flight
      summary, explicit per-action confirmation, archive-before-clear ordering;
      references the `CLAUDE.md` §Commits destructive-op rule (§6).
- [ ] The implementation target is named: new `grm-hard-reset` skill, its trigger
      phrases + flags, and the flavors to mirror (claude-code/ canonical → root
      → copilot `.github/prompts/`), gating C1 (§7).

---

## Open questions

- **Self-protection in the scaffolding repo.** §1.4 notes the skill is for
  adopting projects, not the agentic-scaffolding dogfood checkout, and relies on
  the human gate. If accidental self-runs become a real risk, a future revision
  could add an explicit "this looks like the scaffolding source repo — refuse?"
  guard. Deferred — human gate is sufficient for v1.8.

---

## Follow-ups

- **Soft reset / selective reset** — a mode that archives + clears only a chosen
  subset (e.g. release plans + design docs, keeping source) rather than the full
  project-local set. Out of scope for C1; revisit if requested.
- **Archive pruning / retention** — `.grimoire-archive/` accumulates one
  subdirectory per reset; a future helper could list/prune old archives. Out of
  scope for v1.8.
- **Restore-from-archive helper** — recovery is currently a manual filesystem
  copy-back guided by the archive `MANIFEST.md`. A future `hard-reset --restore
  <ts>` could automate it. Deferred.
