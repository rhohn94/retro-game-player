# Feature-aware sync — v1.13 Design

> **Up:** [↑ Design docs](README.md)


> **Design authority for:** F1 (feature manifest + `framework-version` marker),
> F2 (sync adoption phase), F3 (adoption playbooks), F4 (release-time authoring
> hook), U1 (bake upstream URLs).
> **Informed by:** `docs/grimoire/sync-flow-audit.md` (SR1 findings).
> **Extends:** `.claude/skills/grm-sync-from-upstream/` (the engine),
> `grm-onboarding` skill §6.5 (the `baseline-version` precedent generalized here).

---

## §1 — Overview and goals

`grm-sync-from-upstream` is today file-level: it 3-way-merges files
(`NEW`/`UPDATE`/`MERGED`/`CONFLICT`/`REVIEW`) and the agent's post-sync job is
limited to resolving conflicts and re-filling `{placeholders}`. A new
capability's files land inert — the sync agent has no notion of a *feature*, so
nothing tells it "the v1.12 files you just synced add GitHub Issues support;
configure and adopt it."

**v1.13 adds a feature-aware adoption phase** layered on top of the existing
file merge. The goals, in priority order:

1. **Enable old-project adoption:** an old project runs sync, gets new files,
   and is walked (or offered) through enabling capabilities it missed — the
   motivating case being "sync v1.12 → adopt GitHub Issues" with an optional,
   confirmed migration of its existing roadmap `## Backlog`.
2. **Zero change for in-sync projects:** a project that already adopted every
   shipped feature sees no new prompts — the adoption phase is a no-op when
   nothing is un-adopted. Roadmap-only projects (no `framework-version`) fall
   back to per-feature `detect` predicates to determine what is and is not adopted.
3. **Idempotent and safe:** every `detect` check and `adopt` step is designed to
   be re-run without side effects. Migration is always explicitly confirmed and
   reversible; it never auto-runs.
4. **Paradigm-appropriate:** Noir auto-adopts; Supervised/Weiss offer each
   adoption individually.
5. **Release-time maintained:** close-out adds a manifest entry per new flagship,
   keeping the catalog honest like `version-history.md`.

**What this design does NOT change:** the 3-way merge engine (SR1 audit
confirms it is sound — see §5 for the `grimoire-config.json` exclusion that is
the only urgent mechanical fix). The adoption phase runs only *after* a clean
file merge and is purely additive.

---

## §2 — Feature manifest

### §2.1 — Location and format

**Location:** `.claude/skills/grm-sync-from-upstream/feature-manifest.md`

**Format:** versioned Markdown table (same pattern as `baseline-requirements.md`).

Rationale for Markdown over JSON: the manifest entries contain natural-language
`summary`, `detect`, `adopt`, and `migrate` descriptions that agents read and
execute as prose instructions. A Markdown table is directly human-readable,
editable in a PR, and processable by the agent without a parser. The
`baseline-requirements.md` precedent already proves this pattern scales to a
maintained, versioned catalog. JSON would add schema validation at the cost of
readability and editability; the manifest is not machine-parsed at runtime — the
agent interprets it. If a future toolchain needs machine parsing, a companion
`.json` export can be generated from the Markdown table at that time.

The first line carries the manifest version for idempotent tooling:

```
manifest-version: 1
```

### §2.2 — Per-entry schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `feature-id` | string (kebab-case) | yes | Stable unique key (e.g. `github-issues`). Never reused after removal. |
| `introduced-in` | `vX.Y` | yes | The Grimoire release that shipped this feature. Used for version-delta computation. |
| `summary` | string | yes | One-sentence human description of the capability. Shown to the user during adoption prompts. |
| `detect` | prose predicate | yes | How to determine whether the feature is already adopted in the project. Written as a testable instruction the agent evaluates (e.g. "check whether `.claude/grimoire-config.json` contains an `grm-issue-tracker` block with `provider` not equal to `roadmap`"). Returns true (adopted) or false (not yet adopted). |
| `adopt` | prose steps or skill invocation | yes | Idempotent steps to enable the feature. May reference a skill by name (e.g. "run `grm-issue-tracker-switch` with the captured provider"). Must be safe to re-run. |
| `migrate` | prose steps or null | no | Optional, separate data-migration steps. Absent/null = feature has no migration component. When present, migration is always explicitly confirmed and backed up before running. Never merged into `adopt`. |

**Field semantics — precise definitions:**

- **`detect`**: a predicate evaluated against the *downstream project* (not
  the upstream). The agent runs it as a read-only check against the project's
  `.claude/grimoire-config.json`, local files, and directory structure. It does
  not call external services. The result is boolean: adopted (skip) or
  not-yet-adopted (offer/run `adopt`). A feature whose `detect` returns true is
  always skipped regardless of `framework-version`.

- **`adopt`**: idempotent config-or-file enabling steps. May call a skill
  (e.g. `grm-issue-tracker-switch`), write config fields, or both. Running `adopt`
  twice on the same project must be safe (the underlying skills are idempotent).
  `adopt` does not touch existing user data — it configures capabilities, not
  migrates content.

- **`migrate`**: an optional, separate confirmed data-movement step. It is never
  part of `adopt` because it moves existing user content (e.g. roadmap bullets
  to a new tracker). It may require a backup, a confirmation prompt, and a
  rollback path. When absent or null, the feature has no data-migration
  component.

### §2.3 — Example entries (illustrative)

```markdown
manifest-version: 1

| feature-id | introduced-in | summary | detect | adopt | migrate |
|---|---|---|---|---|---|
| `github-issues` | v1.12 | External GitHub Issues tracker replaces/augments roadmap Backlog | Check `.claude/grimoire-config.json`: `issue-tracker.trackers` exists and at least one entry has `provider` not equal to `roadmap`. | Run the onboarding Step 6 question: ask the user for their preferred issue-tracker provider (roadmap / GitHub). If GitHub is chosen, call `issue-tracker-switch set github <owner/repo>` with the captured repo. | (optional, confirmed) Offer to migrate existing `docs/roadmap.md ## Backlog` bullets to the configured tracker via `grm-feedback-to-issue`. Back up roadmap first. Confirm before each bullet. Reversible: re-add to roadmap from backup on decline. |
| `execution-strategy` | v1.11 | Execution-strategy dial (Fast / Efficient / Cheap-Slow) for workflow dispatch | Check `.claude/grimoire-config.json`: `workflow-variant.value` is present and one of `{Fast, Efficient, Cheap-Slow}`. | Call `grm-workflow-variant-switch` with the user's chosen value (default `Efficient`). | null |
| `model-effort-profile` | v1.10 | Model/effort profile dial (cost posture) for agent dispatch | Check `.claude/grimoire-config.json`: `model-effort-profile.value` is present and a recognized profile name. | Call `grm-model-effort-profile-switch` with the user's chosen value (default `Medium`). | null |
```

---

## §3 — `framework-version` marker

### §3.1 — Location in `grimoire-config.json`

The marker lives as a new top-level field, peer to the existing dials:

```json
{
  "schema-version": 3,
  "name": "My Project",
  "framework-version": "v1.12",
  "work-paradigm": { "value": "Supervised" },
  "workflow-variant": { "value": "Efficient" },
  "model-effort-profile": { "value": "Medium" }
}
```

**`schema-version` stays at 3.** The `framework-version` field is additive at
schema-version 3 — the same graduation precedent used for `model-effort-profile`
(v1.10/P1), `workflow-variant` (v1.11/E1), and `grm-issue-tracker` (v1.12/I2/I3).
No schema-version bump is warranted for pure-additive field additions; readers
that do not understand `framework-version` simply ignore it.

### §3.2 — Semantics

**`framework-version`** records the highest Grimoire release whose feature set
this project has successfully adopted. It advances alongside `.scaffold-base/`
after a successful adoption phase (§4.5). It does NOT record the version of
the *files* in the project (that is `.scaffold-base/`'s job) — it records
which *feature adoptions* are complete.

- `"v1.12"` means all features introduced through v1.12 have been adopted
  (or were detected-as-already-adopted) on this project.
- Advancing to `"v1.13"` means the v1.13 adoption phase ran without failures.

### §3.3 — Forward-compat (absent marker)

When `framework-version` is absent from `.claude/grimoire-config.json` (i.e.
any project created before v1.13 F1), the adoption phase falls back to
**per-feature `detect`** evaluation: every manifest entry's `detect` predicate
is evaluated independently against the project. Features whose `detect` returns
true are skipped. Features whose `detect` returns false are offered/adopted.
This is the no-base fallback that gives old projects a graceful first-run
experience without requiring them to know which release introduced each feature.

### §3.4 — Advancement rule

`framework-version` advances to the upstream's current version **only after
all features up to that version have been offered/adopted without failure**
(§4.5). A partial adoption run (some features adopted, one failed) does not
advance the marker — the next run will re-evaluate the failed feature by
`detect` and resume from there.

### §3.5 — The adoption phase is the ONLY writer of `framework-version`

The sync script (`sync-from-upstream.sh`) does not write `framework-version`.
The only code path that writes or advances this field is the adoption phase
(§4), after confirming success. This is the counterpart to the
`grimoire-config.json` exclusion (§5): the file is excluded from the file-merge
walk precisely so the adoption phase can own it surgically.

---

## §4 — Sync adoption phase

The adoption phase is the new step added to `grm-sync-from-upstream` **after** the
file merge (`--apply`) completes successfully. It does not run during dry-runs
or `--adopt-base`. It does not run if the file merge produced unresolved
CONFLICTs (§4.1).

### §4.1 — Precondition: clean merge

The adoption phase runs only when:

1. `--apply` was used (not dry-run or `--adopt-base`).
2. Zero CONFLICT files remain unresolved in the post-merge tree. The script
   checks: any file with outstanding git conflict markers (`<<<<<<<`) → abort
   the adoption phase with a clear message:
   > "Adoption phase skipped: unresolved CONFLICT files remain. Resolve them
   > (re-run the sync to advance their base), then sync again to run adoption."

This ensures the adoption phase always operates on a clean, internally-consistent
tree.

### §4.2 — Delta computation

With `framework-version` present:
- Collect all manifest entries where `introduced-in` > `framework-version`.
- For each collected entry, run its `detect` predicate. Skip entries where
  `detect` returns true (already adopted).
- The remaining entries are the "to-adopt" set.

With `framework-version` absent (no-base fallback):
- Collect **all** manifest entries.
- For each entry, run its `detect` predicate. Skip entries where `detect`
  returns true.
- The remaining entries are the "to-adopt" set.

If the to-adopt set is empty: print "Adoption phase: all features up to
vX.Y are already adopted." and advance `framework-version` to the current
upstream version.

### §4.3 — Per-feature adopt loop

For each entry in the to-adopt set, processed in `introduced-in` ascending
order (oldest first):

| Paradigm | Behaviour |
|----------|-----------|
| **Noir** | Auto-run `adopt` without prompting. Log the feature-id and summary before running. After success, offer `migrate` (if present) with a single confirmation prompt — Noir asks once, not per item. On user decline, skip migration. |
| **Supervised** | Print the feature summary and ask: "Adopt `<feature-id>` (`<summary>`)? Yes / No / Details." On Yes, run `adopt`. On No, skip (and leave `detect` false — will be offered again next sync). On Details, print the full `adopt` prose, then re-ask. |
| **Weiss** | Same as Supervised — offer each adoption individually; the user leads. |

**Ordering matters:** features with `introduced-in` older than others must be
adopted first because later features may depend on config state set by earlier
ones (e.g. `grm-issue-tracker` block must exist before a future feature that
extends it). Ascending `introduced-in` order guarantees this.

### §4.4 — Idempotency and failure handling

- Each `adopt` step is idempotent by contract (the underlying skills exit early
  if already in the requested state).
- If an `adopt` step fails (non-zero exit / skill abort), log the error, skip
  that feature, and continue with the next. Do not fail the entire adoption run
  on a single failure.
- After the loop, report a summary:
  - Features adopted successfully.
  - Features skipped (already adopted / user declined).
  - Features that errored (with the error message).
- `framework-version` advances only to the last version where no feature
  errored (§4.5).

### §4.5 — Advancing `framework-version`

After the adopt loop completes:

- If every feature up to the upstream's current version was either adopted
  successfully or `detect`-confirmed as already-adopted, write
  `framework-version: "<upstream-version>"` to `.claude/grimoire-config.json`.
- If any feature errored or if the user declined an adoption that cannot be
  skipped (marked required — none in the initial manifest, but future entries
  may carry a `required: true` field), advance `framework-version` only to the
  last fully-adopted version boundary.
- Do not advance `framework-version` if the user merely declined an optional
  adoption — optional features that the user consciously declines are treated
  as "skipped, will not re-offer" only if the project records a
  `skipped-features: [...]` list (a future enhancement); absent that list, they
  are re-offered at the next sync.

### §4.6 — SKILL.md update (F2)

F2 will add a **Step 4.5 — Feature adoption** section to the `grm-sync-from-upstream`
SKILL.md between Step 4 (Resolve and re-specialize) and Step 5 (Report and commit),
noting:

1. After a clean `--apply`, the adoption phase runs automatically.
2. If paradigm files (`paradigms/*`) were `UPDATE`d during the sync, run
   `grm-work-paradigm-switch` to re-install the active paradigm into its live
   paths (SR1 Finding 3).
3. The adoption phase does not re-run on a re-run of `--apply` unless
   CONFLICT files were resolved since the last run (the phase checks the
   to-adopt set, which may already be empty).

---

## §5 — `grimoire-config.json` exclusion

Per SR1 Finding 2: `.claude/grimoire-config.json` must be added to
`is_excluded()` in `sync-from-upstream.sh`. The one-line change F2 makes:

```bash
# Before (current):
is_excluded() {
  case "$1" in
    README.md|.gitignore) return 0 ;;
    docs/roadmap.md|docs/design/README.md) return 0 ;;
    ...

# After (F2 adds):
is_excluded() {
  case "$1" in
    README.md|.gitignore) return 0 ;;
    docs/roadmap.md|docs/design/README.md) return 0 ;;
    .claude/grimoire-config.json) return 0 ;;   # adoption phase owns this file
    ...
```

**Rationale:** `grimoire-config.json` is a project-config file, not a
framework-managed file. Its content (`work-paradigm.value`, `grm-issue-tracker`
block, project name) is per-project and should never be overwritten by a
wholesale upstream copy. The adoption phase is the only writer of
`framework-version` into this file (§3.5). Excluding it from the file-merge
walk is safe because:

- An existing project always has its own config (appears as REVIEW today —
  kept local, which is correct).
- A brand-new project without a config gets it from onboarding, not sync.
- The upstream's default config (paradigm: Supervised, etc.) is irrelevant
  to an already-configured downstream project.

**Also excluded per SR1 Finding 4 (F2 also adds):**

```bash
    CLAUDE.md) return 0 ;;   # project-specific; re-specialize manually
```

`CLAUDE.md` at the flavor root is template-generic and requires the most
invasive re-specialization. Adding it to exclusions prevents it from arriving
as `NEW` and competing with the downstream project's own `CLAUDE.md`. SKILL.md
Step 4 will note that `CLAUDE.md` must be ported manually when it changes
upstream.

---

## §6 — Adoption versus migration

This distinction is load-bearing and must never be blurred.

| | Adoption | Migration |
|---|---|---|
| **What it does** | Enables a capability (writes config, activates a feature) | Moves existing user data from one location/format to another |
| **Reversibility** | Reversible by running `issue-tracker-switch set roadmap` or equivalent | Requires a pre-migration backup; reversible only from backup |
| **User confirmation** | Offered per-feature; auto-run under Noir | Always explicitly confirmed, even under Noir |
| **Data touched** | Config only (`.claude/grimoire-config.json`, skill config) | User content (`docs/roadmap.md`, issue text, etc.) |
| **Idempotent** | Yes — skills exit early if already in the requested state | No — running twice could double-migrate; backup prevents this |
| **Speed** | Fast (config write only) | Slow (may involve many items; confirm per batch or globally) |
| **Failure handling** | Log error, skip feature, continue | Abort on first error; never partial-migrate without rollback |

**Practical rule:** if a playbook step reads or writes user data that existed
before the sync (roadmap bullets, commit history, existing issue titles), it is
migration. If it only writes to `grimoire-config.json` or framework-managed
files, it is adoption.

**Migration is always a separate, explicitly-confirmed step** after adoption
completes. Even under Noir, migration requires a confirmation prompt and a
backup before it runs. Migration is offered, never forced.

---

## §7 — Paradigm behaviour

### §7.1 — Noir (auto-adopt to milestone)

Under Noir, the adoption phase runs without prompting for each feature's
`adopt` step. The agent logs each feature's summary and the action it is
taking before running it. After all adoptions complete, Noir offers migration
(if any features have migrate steps) with a single confirmation prompt covering
all pending migrations at once ("Migrate N items from roadmap Backlog to GitHub
Issues? Yes/No."). On Yes, migrations run sequentially; on No, they are
skipped entirely.

Noir does **not** skip the confirmation for migration — migration touches user
data and is always confirmed (§6).

### §7.2 — Supervised and Weiss (offer each adoption)

Under Supervised and Weiss, each feature in the to-adopt set is presented
individually:

```
New feature available: github-issues (introduced in v1.12)
  External GitHub Issues tracker replaces/augments roadmap Backlog.
  Adopt now? [Yes / No / Details]
```

On Details: print the full `adopt` prose from the manifest, then re-present
the Yes/No choice.

On No: skip this feature this run. It will appear again at the next sync
(because `detect` will still return false and `framework-version` will not
have advanced past v1.12). A future enhancement (§12) may add a
`skipped-features` list to suppress repeated offers.

After all adoptions, Supervised/Weiss offer migration with the same
confirmation flow as Noir — one prompt per pending migration.

### §7.3 — Paradigm-file update caveat

SR1 Finding 3: when the file merge produces `UPDATE` results for files under
`.claude/paradigms/`, the active paradigm content in its live paths (installed
by `grm-work-paradigm-switch`) may be stale. The adoption phase includes a check:
if any `paradigms/*` file was `UPDATE`d during this sync run, the phase adds a
post-adoption instruction:

```
Paradigm files updated. Re-run `grm-work-paradigm-switch` to re-install the active
paradigm (<paradigm-name>) into its live paths.
```

This is surfaced as a reminder, not an automated action, because `grm-work-paradigm-switch`
installs content into paths that may vary by project and should not run without
the user knowing.

---

## §8 — GitHub-issues playbook (worked example for F3)

This section specifies the `github-issues` manifest entry in full and explains
how F3 implements it. It also shows two cheap backfill entries to prove the
manifest generalizes to already-shipped dials.

### §8.1 — Manifest entry: `github-issues`

```markdown
| feature-id | introduced-in | summary | detect | adopt | migrate |
|---|---|---|---|---|---|
| `github-issues` | v1.12 | External GitHub Issues tracker replaces/augments roadmap Backlog | Check `.claude/grimoire-config.json`: field `issue-tracker.trackers` exists and at least one entry has `provider` not equal to `roadmap`. | Ask the onboarding Step 6 question: "Choose your issue tracker: Roadmap (default) / GitHub." If GitHub, ask for `owner/repo`. Call `issue-tracker-switch set github <owner/repo>`. If the user chooses Roadmap, mark as declined (skip). | (optional, confirmed, backed-up) Offer to migrate existing `docs/roadmap.md ## Backlog` bullets to the configured GitHub Issues repo via `grm-feedback-to-issue`. Step 1: back up roadmap (`cp docs/roadmap.md docs/roadmap.md.pre-migration-<ts>`). Step 2: confirm ("Migrate N roadmap items to GitHub Issues? This will remove them from roadmap.md. A backup is at docs/roadmap.md.pre-migration-<ts>."). Step 3: for each Backlog bullet, call `grm-feedback-to-issue` with `audience: internal`. Step 4: remove migrated bullets from roadmap. Reversible from backup. |
```

### §8.2 — Detect

The detect predicate is a read-only JSON check:

```bash
python3 -c "
import json, sys
c = json.load(open('.claude/grimoire-config.json'))
t = c.get('issue-tracker', {}).get('trackers', [])
adopted = any(x.get('provider') != 'roadmap' for x in t)
sys.exit(0 if adopted else 1)
"
```

Exit 0 = adopted (skip). Exit 1 = not yet adopted (offer).

### §8.3 — Adopt

The adopt step re-uses the onboarding Step 6 interview question (same prose,
same choices, same follow-up sub-question for `owner/repo`). This is the
natural reuse point: onboarding §3.4 already defines the exact interaction.

After the user answers, the step calls:

```bash
python3 .claude/skills/grm-issue-tracker-switch/issue_tracker_switch.py \
    set github <owner/repo>
```

If the user chose Roadmap (the default), the adoption is marked "user
declined" — `detect` will still return false (no block in config), but the
adoption run records the decline so `framework-version` can still advance past
v1.12 (the user made a conscious choice, not a skip).

Implementation detail for F3: the "user chose Roadmap at adoption time" case
should write an explicit `skipped-features: ["github-issues"]` note to config
or to a sidecar file, so the feature is not re-offered endlessly. This is the
one exception to the general "re-offer on next sync" rule — a conscious
roadmap-default choice should be respected. F3 decides the exact mechanism
(sidecar vs. config field vs. feature marked `adopt: skipped` locally).

### §8.4 — Migrate

Migration is a separate, confirmed, backed-up step offered only after adoption
succeeds and the user has a non-roadmap tracker configured:

1. Count `## Backlog` bullets in `docs/roadmap.md`.
2. Offer: "Migrate `N` roadmap Backlog items to GitHub Issues? A backup
   will be created at `docs/roadmap.md.pre-migration-<timestamp>`. Yes / No."
3. On Yes: backup, then call `grm-feedback-to-issue` for each bullet, then remove
   migrated bullets from roadmap.
4. On No: skip. Migration can be run again at the next sync or manually.

The `grm-feedback-to-issue` skill handles near-duplicate detection automatically.

### §8.5 — Cheap backfill entries (proving generality)

These entries cover already-shipped dials. Their `detect` returns true for any
project that ran onboarding after v1.10/v1.11 (config field already set), so
they are no-ops for current projects — they exist to onboard projects that
predate these dials and still carry a v1 or v2 config.

```markdown
| `execution-strategy` | v1.11 | Execution-strategy dial (Fast / Efficient / Cheap-Slow) | `.claude/grimoire-config.json` has `workflow-variant.value` set to one of `{Fast, Efficient, Cheap-Slow}`. | Ask: "Choose your execution strategy: Fast / Efficient (default) / Cheap-Slow." Call `grm-workflow-variant-switch` with the chosen value. | null |
| `model-effort-profile` | v1.10 | Model/effort profile dial (cost posture) | `.claude/grimoire-config.json` has `model-effort-profile.value` set to a recognized profile name. | Ask: "Choose your model/effort profile: Medium (default) / High Effort / Low Effort / Efficient / Autonomous / Eco-Budget." Call `grm-model-effort-profile-switch` with the chosen value. | null |
```

These entries demonstrate that the manifest is not Github-Issues-specific —
it generalizes to any dial, setting, or structural feature that has an
idempotent adoption step.

---

## §9 — Release-time authoring hook (F4)

Every new flagship capability introduced in a release must have a manifest
entry. This is enforced by convention (like `version-history.md`), not by
tooling (no automated check), because the judgment of what constitutes a
"flagship adoptable capability" requires human assessment.

### §9.1 — Where the instruction lives

The `grm-project-release` skill SKILL.md and the `grm-release-phase-merge` D2 close-out
section both receive an added checklist item:

```
- [ ] For each new flagship capability: add an entry to
      `.claude/skills/grm-sync-from-upstream/feature-manifest.md`
      (fields: feature-id, introduced-in, summary, detect, adopt, migrate?).
      Commit the manifest update as part of the D2 close-out branch.
```

This mirrors the `version-history.md` entry requirement that already appears in
the close-out checklist.

### §9.2 — What qualifies

A new manifest entry is required when a release introduces a feature that:

1. Has a user-visible capability a downstream project might want to adopt, AND
2. Has an idempotent `adopt` step (a skill call or config write that enables it), AND
3. Did not exist in prior releases (i.e. an old project genuinely needs a step
   to gain it).

A release that is purely internal (refactoring, tooling, doc-only) does not
require a manifest entry. When in doubt, err on the side of adding the entry —
false positives are filtered by `detect` (which will return true for
already-adopted projects and skip the entry).

### §9.3 — Authoring guidelines for manifest entries

- `feature-id`: kebab-case, stable (never reuse after removal), mirrors the
  release item code when possible (e.g. `github-issues` for v1.12 I2/I3).
- `introduced-in`: the exact release version string (`v1.12`, not `1.12` or
  `v1.12.0`).
- `detect`: write it as a concrete, executable check — prefer a one-liner
  Python or bash check over prose. The agent must be able to evaluate it.
- `adopt`: prefer a skill invocation over raw bash. Re-use onboarding interview
  prose exactly when the adoption mirrors an onboarding step.
- `migrate`: only present when user data actually moves. If in doubt, omit and
  add later — a missing migrate step is safer than an incorrect one.

---

## §10 — Bake upstream URLs (U1 design)

### §10.1 — What to bake

Two default upstream URLs:

1. **Grimoire Framework** — the `agentic-scaffolding` GitHub repo; used by
   `grm-sync-from-upstream` (`UPSTREAM_REPO` in `.scaffold-upstream.conf`).
2. **Aura design language** — the design-language upstream repo; used by
   `grm-design-language-adapt` as its default source-pin URL.

### §10.2 — Where they live

Both URLs live as a new `upstream-sources` block in the scaffold seed
of `.scaffold-upstream.conf` (for Grimoire) and as a `source-pin.default`
front-matter field in the `docs/design/ux/design-language.md` golden template
(for Aura).

**Decision: `.scaffold-upstream.conf` for the Grimoire URL; design-language
golden template front-matter for the Aura URL.**

Rationale: `.scaffold-upstream.conf` already owns `UPSTREAM_REPO` — extending
it with a seeded default is the natural extension point with no new mechanism
required. The design-language URL belongs alongside the design-language
document's `source-pin:` front-matter, which already exists (v1.4 C1).

For `.scaffold-upstream.conf`, the seed written by `grm-workflow-bootstrap` / `grm-repo-init`:

```sh
# Grimoire Framework upstream (seeded by workflow-bootstrap; overridable)
UPSTREAM_REPO=https://github.com/rhohn94/grimoire-framework.git
UPSTREAM_REF=main
# FLAVOR auto-detected from project layout; override only if ambiguous.
```

The comment makes the source clear and signals that forks should override it.

For the design-language golden template (`workflow-bootstrap/golden/docs/design/ux/design-language.md`):

```yaml
---
source-mode: upstream
source-url: https://github.com/rhohn94/design-language
source-pin: null   # set to the upstream SHA after first adapt
---
```

### §10.3 — Seeding by `grm-repo-init` / `grm-workflow-bootstrap`

`grm-workflow-bootstrap` writes `.scaffold-upstream.conf` (or updates the
`UPSTREAM_REPO` line if the file exists without it) as part of its file-restore
step. `grm-repo-init` writes the design-language golden template. Both are
idempotent: if the file already has a non-empty `UPSTREAM_REPO`, they do not
overwrite it (preserving forks that point at their own upstream).

**Idempotency rule:** check whether `UPSTREAM_REPO` is already set to a
non-empty value. If yes: no-op. If missing or empty: write the default.

### §10.4 — Overridable

A fork of the Grimoire framework (or a project with a private upstream) sets:

```sh
UPSTREAM_REPO=https://github.com/my-org/my-scaffold-fork.git
```

in `.scaffold-upstream.conf`. The seeding logic's idempotency check ensures the
fork's value is never overwritten by a subsequent `grm-workflow-bootstrap` run.

### §10.5 — Mirror across flavors

`claude-code/` canonical. The same `UPSTREAM_REPO` default is seeded in the
`copilot/` flavor's `grm-workflow-bootstrap` step. Copilot does not have
`sync-from-upstream.sh` (it has its own equivalent, or a gap), but the URL is
still seeded in the Copilot `grm-workflow-bootstrap` golden for future parity.

---

## §11 — Per-flavor notes

| Flavor | Notes |
|--------|-------|
| `claude-code/` (canonical) | Primary implementation target. All of F1/F2/F3/F4/U1 land here first. The feature manifest, `sync-from-upstream.sh` changes, and `grimoire-config.json` exclusion all live under `claude-code/.claude/`. |
| `copilot/` | No `sync-from-upstream.sh` equivalent (Copilot gap). Copilot receives: (a) the feature manifest file (same location, informational), (b) a gap-note in the Copilot sync skill that the adoption phase is not yet implemented for Copilot, (c) the `upstream-sources` seed in `grm-workflow-bootstrap` (U1). The adoption phase for Copilot is a D2 follow-up item. |
| Root (this repo) | Dogfoods the workflow. After D2, this repo's own `.claude/grimoire-config.json` gains `framework-version: "v1.13"`, and the feature manifest is seeded. The root `.scaffold-upstream.conf` is updated to use the canonical URL. |

### §11.1 — Consumer and flavor matrix

| Consumer / Skill | Touches | Notes |
|---|---|---|
| `sync-from-upstream.sh` (F2) | `is_excluded()` + adoption phase | Exclusion is a one-liner; adoption phase is a new post-`--apply` section. |
| `grm-sync-from-upstream` SKILL.md (F2) | Step 4.5 added | Describes adoption phase; notes paradigm-file re-install caveat. |
| `feature-manifest.md` (F1) | Created | Lives alongside the skill files. |
| `grimoire-config.json` schema (F1) | `framework-version` field added | Additive at schema-version 3; no version bump. |
| `grm-repo-init` / `grm-workflow-bootstrap` (U1) | `.scaffold-upstream.conf` seed | Idempotent; does not overwrite existing URLs. |
| `grm-onboarding` SKILL.md (no change) | — | Onboarding is the adopt precedent; this design reuses it without modifying it. |
| `grm-project-release` SKILL.md (F4) | Close-out checklist item added | "Add manifest entry for each new flagship." |
| `grm-release-phase-merge` SKILL.md (F4) | D2 checklist item added | Same instruction. |
| `grm-work-paradigm-switch` (no change) | — | Re-install reminder is surfaced by the adoption phase; the skill itself is unchanged. |

---

## §12 — Follow-ups and out-of-scope

### §12.1 — Out of scope for v1.13

- **Proprietary Grimoire tracker backend** — the `grm-issue-tracker` abstraction
  already accommodates it (v1.12); not built in this release.
- **Changing the file-level 3-way merge engine** — v1.13 adds a phase after
  it; the engine is sound (SR1) and unchanged.
- **The Steady Steward long-running loop** — this release supplies sync/adoption
  plumbing it will use; the loop itself is Backlog.
- **`skipped-features` list** — when a user consciously declines an adoption
  (e.g. "I want to keep Roadmap, not GitHub Issues"), the current design
  re-offers at the next sync. A `skipped-features: [...]` field in config would
  suppress repeated offers. Deferred to a follow-up.
- **Adoption phase for Copilot** — Copilot receives a gap-note in D2; full
  implementation is a follow-up.
- **`required: true` manifest field** — future entries may mark an adoption as
  required (blocking framework operation if skipped). Not introduced here.
- **Machine-parseable manifest companion** — if tooling needs a JSON version of
  the manifest, it can be generated from the Markdown table at that time.

### §12.2 — Follow-ups discovered during this design

- **`skipped-features` sidecar**: F3 should decide the mechanism for recording a
  conscious user decline of an optional adoption, so it is not re-offered
  endlessly (§8.3).
- **`grm-work-paradigm-switch` re-install as an adoption step**: if paradigm files
  are updated during sync, a future manifest entry could encode this as an
  idempotent `adopt` step rather than a manual reminder. Deferred because
  `grm-work-paradigm-switch` requires knowing the active paradigm name, which varies
  per project.
- **Copilot adoption phase**: the copilot flavor gap for the adoption phase.
  Estimate: medium. Depends on whether copilot gets its own sync-from-upstream
  equivalent or piggybacks on a shared mechanism.
