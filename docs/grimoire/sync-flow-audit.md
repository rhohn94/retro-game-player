# Sync-flow end-to-end audit — v1.13 SR1

> **Up:** [↑ Grimoire tier](README.md)


> Branch: `sr1-sync-audit`  
> Scope: `sync-from-upstream.sh` (3-way merge engine), `.scaffold-base/`
> provenance, flavor detection, file classification, and sync scope against
> the current multi-flavor layout.  
> Closes the Backlog "review sync flow end-to-end" item.

---

## What was tested

A scratch sandbox was created (not this repo) with a fake upstream (`claude-code/`
flavor subtree) and a fake downstream project initialized as a git repo with
`.scaffold-upstream.conf` pointing at the local upstream path. The following
scenarios were exercised live against the real `sync-from-upstream.sh` script:

1. **Dry-run** (no base established) — NEW detection, in-sync detection.
2. **`--adopt-base`** — base files created for all upstream files including
   `.py` helpers and `.js` workflow files.
3. **`--apply` with NEW files** — new skill directory (with `SKILL.md` +
   `issue_tracker.py`) and workflow `.js` file land correctly.
4. **`--apply` with MERGED** — both sides changed different regions of the same
   file; 3-way merge produced the correct combined result and advanced the base.
5. **CONFLICT** — both sides changed the same line; conflict markers written,
   base **not** advanced.
6. **Dirty-tree guard** — `--apply` refused with exit 3 on an uncommitted tree.
7. **REVIEW** — file differs between local and upstream but has no base record;
   kept local, flagged.
8. **`local`** — upstream unchanged since base, local edited; local kept silently.

Flavor detection, backup behavior, and summary counters were verified
behaviorally. `bash -n` syntax check was run before and after the fix.

---

## Mechanics table

| Mechanic | Result | Notes |
|---|---|---|
| Flavor detection: `.claude/` → `claude-code` | PASS | Correct for a standard Claude Code project. |
| Flavor detection: `.github/` → `copilot` | PASS (reasoned) | Code path verified; not live-tested (no copilot sandbox). |
| Ambiguous-flavor error | PASS (reasoned) | Both layouts present → `exit 2` with clear message. |
| `--adopt-base` snapshots upstream → `.scaffold-base/` | PASS | Walks all files including `.py` helpers and `.js` workflows. |
| `--adopt-base` does NOT touch local files | PASS | Confirmed no local file mutation. |
| `in-sync` detection | PASS | `diff -q` match → no action. |
| `NEW` file copy on `--apply` | PASS | Skill dir with `SKILL.md` + `issue_tracker.py` both landed. Workflow `.js` landed. |
| `UPDATE` fast-forward on `--apply` | PASS (reasoned) | `local == base`, `upstream != base` → overwrite + advance base. Code path clean. |
| `MERGED` 3-way merge on `--apply` | PASS | Non-overlapping edits auto-merged correctly; base advanced to upstream. |
| `CONFLICT` on `--apply` | PASS | Overlapping edits → git markers written; base **not** advanced. |
| `REVIEW` kept local, no base | PASS | File differs, no base → flagged, local untouched. |
| `local` kept silently | PASS | Upstream unchanged since base, local edited → kept. |
| Dirty-tree guard on `--apply` | PASS | Exit 3 with clear message; `--force` bypass available. |
| Backup on rewrite | PASS | `.scaffold-sync-backup/<timestamp>/` created for every rewritten file. |
| Base NOT advanced on CONFLICT | PASS | Verified: base still held pre-conflict content after `--apply`. |
| `.py` helper files walked and synced | PASS | `issue_tracker.py`, `parse_usage.py` reached by the `find . -type f` walk. |
| `.js` workflow files walked and synced | PASS | `.claude/workflows/release-planning.js` reached and landed as NEW. |
| Exit code on clean dry-run | **BROKEN — FIXED** | See Finding 1 below. |
| `grimoire-config.json` protection | **GAP** | See Finding 2 below. |
| Paradigm files (`paradigms/*`) scope | **GAP** | See Finding 3 below. |
| `CLAUDE.md` at flavor root | **GAP (minor)** | See Finding 4 below. |

---

## Findings

### Finding 1 — Exit code 1 on every successful invocation (FIXED)

**Severity:** Medium (breaks CI/shell-error-check integration; confusing to agents
checking `$?`).

**Root cause:** The `cleanup()` trap function uses `[ -n "$CLEANUP_TMP" ] && rm -rf
"$CLEANUP_TMP"`. When `CLEANUP_TMP` is empty (the common case — local upstream
path used directly, no temp clone), `[ -n "" ]` returns exit code 1. In bash
the `&&` short-circuit prevents `set -e` from aborting, but the EXIT trap's last
command retains exit code 1, which bash propagates as the script's exit code.

**Fix applied:** Added `|| true` to the cleanup function:

```bash
cleanup() { [ -n "$CLEANUP_TMP" ] && rm -rf "$CLEANUP_TMP" || true; }
```

`bash -n` passes before and after. Exit codes verified: dry-run → 0,
`--adopt-base` → 0, `--apply` with changes → 0, dirty-tree refusal → 3 (unchanged).

---

### Finding 2 — `grimoire-config.json` not excluded (GAP)

**Severity:** High for F2/feature-aware adoption.

The script walks **all** files under `$FLAVOR_DIR` (the upstream `claude-code/`
subtree), including `.claude/grimoire-config.json`. That file in the upstream
distribution carries scaffold defaults (`work-paradigm: Supervised`, `workflow-variant:
Efficient`, `model-effort-profile: Medium`). A downstream project has its own
`grimoire-config.json` with the user's chosen paradigm, tracker provider, and
schema-version.

**Current behavior:** if the downstream project already has `grimoire-config.json`
(v1.12+), it will appear as `REVIEW` (differs, no base — kept local). That is
safe for an existing project. For a brand-new project without one, it would arrive
as `NEW` and be copied verbatim — acceptable as a bootstrap default.

**F2 risk:** The feature-aware adoption phase (F2) will read/write
`grimoire-config.json` to advance `framework-version`. If sync silently applies
a stale upstream config, it could regress the user's provider config. D1 should
specify whether `grimoire-config.json` should be added to `is_excluded()` (full
exclusion) or be treated as a data-merge target (additive fields only). Adding
it to exclusions is the safe default:

```bash
.claude/grimoire-config.json) return 0 ;;
```

**Not fixed here** — the F2 adoption-phase design (D1) must decide.

---

### Finding 3 — Paradigm content files (`paradigms/*`) synced without guard (GAP)

**Severity:** Medium.

The upstream `claude-code/.claude/paradigms/` subtree (18 files across
`supervised/`, `weiss/`, `noir/`) is walked by the sync script. A downstream
project's active paradigm content (`integration-master/SKILL.md`,
`CLAUDE-agent-role.md`, etc.) is installed from `paradigms/<active>/` into live
paths by `grm-work-paradigm-switch`. If the user has customized their active paradigm
content, a sync could offer `MERGED` or `CONFLICT` against their live files — but
those live files are not in `paradigms/`; they're in their install locations.

The `paradigms/` directory files themselves are rarely customized per-project (they
are framework-managed), so an `UPDATE` or `NEW` there is generally safe. However:

1. There is no documentation in SKILL.md warning that paradigm files will be
   synced and that `grm-work-paradigm-switch` should be re-run afterward to re-install
   the active paradigm into live paths.
2. D1 should note that a feature manifest entry for a new paradigm addition
   requires a post-sync `grm-work-paradigm-switch` step in the adoption playbook.

**Not fixed here** — add a note to SKILL.md Step 4 (Resolve and re-specialize)
in a D1 or D2 pass.

---

### Finding 4 — `CLAUDE.md` at flavor root reaches the downstream project (GAP, minor)

**Severity:** Low.

`claude-code/CLAUDE.md` sits at the flavor root and is walked by `find . -type f`.
It is **not** in `is_excluded()` (only `README.md` is). For a downstream project
that has no `CLAUDE.md` (unlikely — most will), it arrives as `NEW`. It IS the
generic scaffold template, so arriving as NEW is not wrong per se. However:

- SKILL.md Step 4 mentions re-specializing NEW generic files using
  `grm-workflow-bootstrap`, but doesn't call out that `CLAUDE.md` itself requires
  the most invasive re-specialization of any file.
- The `.claude/skills/grm-workflow-bootstrap/golden/CLAUDE.md` also exists inside
  the skill subtree and would also appear as `NEW` (different path), creating two
  competing CLAUDE.md candidates.

**Recommendation for D1:** Add `CLAUDE.md` to `is_excluded()` (or at least the
golden copy path) and call out in SKILL.md Step 4 that it must be ported manually.

---

## Scope coverage of the current walk

The script uses `find . -type f | sort` from `$FLAVOR_DIR`, so it covers
**everything** in the upstream flavor:

| Artifact class | In scope? | Notes |
|---|---|---|
| `.claude/skills/*/SKILL.md` | YES | Full tree. |
| `.claude/skills/*/*.py` helpers | YES | Walked, NEW/UPDATE/MERGED/CONFLICT correctly. |
| `.claude/skills/*/` other companions (`.gitignore`, `.md`) | YES | Walked. |
| `.claude/hooks/*.sh` | YES | Full hooks dir. |
| `.claude/workflows/*.js` | YES | PASS — landed correctly as NEW in live test. |
| `.claude/settings.json` | YES | Synced. |
| `.claude/model-effort-profiles.json` | YES | Synced (registry is framework-managed; safe). |
| `.claude/paradigms/**` | YES | Synced; see Finding 3. |
| `.claude/grimoire-config.json` | YES | Not excluded; see Finding 2. |
| `.claude/push-allowlist` | YES | Synced. |
| `.claude/skills/grm-workflow-bootstrap/golden/**` | YES | Golden copies are part of the flavor subtree and will be walked. For downstream projects that have `workflow-bootstrap/golden/`, this means golden copies stay in sync with upstream — generally correct. |
| `docs/*.md` (structural) | YES | `docs/integration-workflow.md`, `docs/version-design.md` etc. all synced. `docs/roadmap.md` and `docs/design/README.md` are excluded. |
| `CLAUDE.md` (flavor root) | YES (gap — not excluded) | See Finding 4. |
| `README.md` | NO | Correctly excluded. |

---

## Recommendations for D1

1. **Fix confirmed — done:** Exit code 1 from cleanup trap (Finding 1).

2. **Exclude `grimoire-config.json`** (Finding 2): Add to `is_excluded()` as a
   project-config file. F2's adoption-phase will manage `framework-version` as
   a surgical write, not a wholesale sync.

3. **Document paradigm-file sync consequence** (Finding 3): SKILL.md Step 4
   should note that if paradigm files were `UPDATE`d, run `grm-work-paradigm-switch`
   to re-install the active paradigm into live paths. F3 github-issues playbook
   and future playbooks should include this step if paradigm files changed.

4. **Exclude (or document) `CLAUDE.md`** (Finding 4): Lowest priority, but add
   to exclusions or add a prominent note in Step 4.

5. **The 3-way merge engine is sound:** NEW / UPDATE / MERGED / CONFLICT / local
   / REVIEW all behave as documented. `.py` helpers and `.js` workflows are
   already in scope. Base advancement is correct (advanced on clean; not advanced
   on CONFLICT). D1's feature-aware adoption phase can build on top of this engine
   without changes to the merge mechanics themselves.

6. **`--adopt-base` is reliable:** Use it as the recommended first step for any
   project whose files were already manually reconciled with a known upstream
   version, before F2 adds the `framework-version` marker. It correctly snapshots
   all artifact classes including new `.py`/`.js` companions.

7. **"Old project syncs v1.12 → adopts GitHub Issues" path:** The blocking risk
   is Finding 2 (`grimoire-config.json`). If sync runs without that exclusion and
   the downstream project has no base for `grimoire-config.json`, it will appear
   as `REVIEW` (safe — kept local). If the downstream project used `--adopt-base`
   after a prior sync, it would appear as `UPDATE` or `local` depending on whether
   upstream changed it. F2 must own the `framework-version` write surgically
   rather than relying on sync to deliver it via a full-file copy.
