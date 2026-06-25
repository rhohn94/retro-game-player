# Feature Playbook Validation — v1.13 F3

> **Up:** [↑ Grimoire tier](README.md)


> Validation performed against the worktree rooted on `version/1.13` (branch
> `f3-playbooks-redo`). All checks are **read-only**; live config and roadmap
> were never mutated.

---

## 1 — Migration mechanism (`migrate_roadmap_issues.py`)

### 1.1 Syntax validation

`ast.parse` self-check via `--check` flag:

```
python3 migrate_roadmap_issues.py --check
→ Syntax OK
```

### 1.2 Scratch dry-run (never the real roadmap)

Ran `parse_backlog_bullets()` against an in-memory scratch string with three
bullets (including a multi-line continuation bullet). Results:

```
Bullets parsed: 3
  [1] Auto-detecting GUI framework hints in workflow-bootstrap.
  [2] Component-library / theme-system layer (own flagship candidate).
  [3] Automated visual-regression of ux-demo screenshots. Supporting multi-browser targets.
```

Multi-line continuation correctly concatenated into bullet [3].

### 1.3 Idempotency check

With bullet [1]'s key pre-loaded into a mock state dict, the pending set
contained 2 items (bullets [2] and [3]) — confirmed skip of already-migrated
bullet.

### 1.4 Safety contract summary

| Contract | Mechanism |
|---|---|
| **Backup-first** | `backup_roadmap()` runs before any mutation; writes to `.claude/cache/roadmap-backup-<ts>.md` (gitignored via `.claude/cache/` rule in `.gitignore`). |
| **--dry-run default** | `main()` defaults to `dry_run=True`; `--apply` is required to act. No writes occur without the flag. |
| **Explicit confirmation** | `--apply` path calls `input("Migrate N bullet(s)? [yes/no]")` and aborts on anything other than `yes`/`y`. Never auto-runs, even under Noir. |
| **Idempotent** | `bullet_key()` produces a stable 120-char normalized key per bullet. Migrated keys are stored in `.claude/cache/roadmap-migration-state.json`; re-runs skip them. State is persisted after each successful filing (not batched), so a partial run is safe to resume. |
| **Reversible** | `--restore` prompts then copies the latest backup back over [roadmap.md](../roadmap.md). Migration state is NOT reset (by design) — only the roadmap file is restored. |
| **Reuse, not reimplementation** | Each bullet is filed via `subprocess` call to `issue_tracker.py create --audience internal`, which routes through the full IssueTracker abstraction (caching, routing, write-batching). |
| **No live `gh create`** | The dry-run and scratch validation never invoke `issue_tracker.py create`; only `parse_backlog_bullets()` and `bullet_key()` run. |

---

## 2 — Playbook detect validation

Detect predicates executed against `.claude/grimoire-config.json` (read-only
JSON check; no network, no skill invocation, no config mutation).

### 2.1 `github-issues` (introduced v1.12)

**Predicate:** `issue-tracker.trackers` exists and at least one entry has
`provider` != `roadmap`.

**Config state:** `provider = "github"`, `repo = "rhohn94/agentic-scaffolding"`.

**Result:** `adopted = True` — correctly skipped (no adoption needed).

**Conclusion:** detect is a real, testable config check. Returns boolean without
side effects.

### 2.2 `execution-strategy` (introduced v1.11)

**Predicate:** `workflow-variant.value` is present and one of
`{Fast, Efficient, Cheap-Slow}`.

**Config state:** `workflow-variant.value = "Efficient"`.

**Result:** `valid = True` — correctly skipped.

**Conclusion:** detect is a real, testable config check.

### 2.3 `model-effort-profile` (introduced v1.10)

**Predicate:** `model-effort-profile.value` is present and a recognized profile
name (`{High Effort, Low Effort, Medium, Efficient, Autonomous, Eco-Budget}`).

**Config state:** `model-effort-profile.value = "Medium"`.

**Result:** `valid = True` — correctly skipped.

**Conclusion:** detect is a real, testable config check.

---

## 3 — Playbook adopt validation

Adopt steps were not executed (that would mutate config). Instead, the referenced
skills were verified to exist and to be explicitly idempotent.

### 3.1 `github-issues` — adopt skill: `grm-issue-tracker-switch`

- **File:** `.claude/skills/grm-issue-tracker-switch/SKILL.md` + `issue_tracker_switch.py`
- **Idempotency:** SKILL.md description reads "Idempotent — exits early if
  already in the requested state."
- **Adopt step validity:** calls `issue-tracker-switch set github <owner/repo>`;
  skill is present and correct.

### 3.2 `execution-strategy` — adopt skill: `grm-workflow-variant-switch`

- **File:** `.claude/skills/grm-workflow-variant-switch/SKILL.md`
- **Idempotency:** SKILL.md description reads "Idempotent — exits early if the
  requested strategy is already active."
- **Adopt step validity:** calls `grm-workflow-variant-switch` with chosen value;
  skill is present and correct.

### 3.3 `model-effort-profile` — adopt skill: `grm-model-effort-profile-switch`

- **File:** `.claude/skills/grm-model-effort-profile-switch/SKILL.md`
- **Idempotency:** SKILL.md description reads "Idempotent — exits early if the
  requested profile is already active."
- **Adopt step validity:** calls `grm-model-effort-profile-switch` with chosen value;
  skill is present and correct.

---

## 4 — Overall result

| Playbook | detect real? | detect tested? | adopt skill exists? | adopt idempotent? |
|---|---|---|---|---|
| `github-issues` | Yes | Yes (adopted=True) | Yes | Yes (stated in SKILL.md) |
| `execution-strategy` | Yes | Yes (valid=True) | Yes | Yes (stated in SKILL.md) |
| `model-effort-profile` | Yes | Yes (valid=True) | Yes | Yes (stated in SKILL.md) |

All three playbooks pass validation. No live mutations performed.
