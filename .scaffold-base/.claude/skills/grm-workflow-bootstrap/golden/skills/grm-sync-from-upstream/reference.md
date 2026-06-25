# Sync-from-upstream — reference
Loaded on demand by `SKILL.md`.

## When to use this skill

- A project was started by copying `claude-code/` (or `copilot/`) out of this
  scaffolding, you've since customized it, and upstream has improved.
- You want the project to benefit from upstream skill/hook/doc fixes without
  losing your filled-in commands, branch names, or local edits.

Do **not** use it to push *from* a project into the scaffolding — that's
`grm-sync-from-source`. Do not run it inside the scaffolding repo itself.

---

## Anti-patterns

- `--force` onto a dirty tree to "just get it done" — defeats the protection.
- Committing a file that still has `<<<<<<<` conflict markers — resolve first.
- `--adopt-base` to *skip* a real reconciliation — it declares "local already
  matches upstream"; only use it when that is true.
- Forgetting to re-specialize a `NEW` generic file — it will carry raw
  `{placeholder}` tokens until you do.
- Running it inside the scaffolding repo itself (wrong direction — use
  `grm-sync-from-source`).
- Deleting local-only files to "match upstream" — the sync is additive; your
  project-specific files are not upstream's concern.
### Stale-upstream rename detection (non-destructive)

The scaffolding repo was renamed `agentic-scaffolding` → `grimoire-framework`.
A project pinned before that rename also predates the multi-paradigm system, so
on every run the script checks `UPSTREAM_REPO` and, **if it still contains the
substring `agentic-scaffolding`**, prints a pre-sync notice that:

- names the rename and gives the exact new URL
  (`https://github.com/rhohn94/grimoire-framework.git`) plus the one-line
  repoint instruction (edit `UPSTREAM_REPO` in `.scaffold-upstream.conf`);
- points at the **paradigm system** now available for pre-paradigm scaffolds —
  the `grm-work-paradigm-switch` skill and `.claude/paradigms/README.md`.

It is **non-destructive**: the conf is never rewritten silently — the notice
only reports and *offers* the exact repoint line for you to apply. It is a
**no-op** once `UPSTREAM_REPO` already targets `grimoire-framework`, and it does
not change sync results or exit codes (pre-sync notice only).

**First run on an already-customized project:** there is no base yet, so every
differing file would report `REVIEW` (kept local, not merged). Once you have
confirmed the project is reconciled with a known upstream commit, record that
commit as the base so future syncs can 3-way merge:

```bash
.claude/skills/grm-sync-from-upstream/sync-from-upstream.sh --adopt-base
```

`--adopt-base` snapshots the current upstream into `.scaffold-base/` and
**touches no local file**.

---

### Recognized sync artifact — `.claude/component-registry.json`

The versioned **component registry** (`.claude/component-registry.json`, schema
in `docs/design/component-catalog-architecture-design.md` Pillar 1) is a
**recognized, merged sync artifact** — Pillar 4 (Distribution) of the
component-catalog architecture. It distributes over **this existing sync channel,
with no hosted endpoint**.

- It is **not excluded** (it is not in `is_excluded`), so the file-merge walk
  carries it like any other managed file: a `NEW` registry from upstream is
  added; a registry both sides changed is **3-way merged** against the recorded
  base, so **local components are preserved and upstream components are
  added/updated** — never clobbered. A genuine same-region collision (e.g. both
  sides edited the same component entry) surfaces as a `CONFLICT` for hand
  resolution, exactly like any other file.
- Because the JSON is a `components` map keyed by component-id, disjoint
  additions on each side merge cleanly (`MERGED`); the merge is *by version*
  through the normal diff — re-syncing an **unchanged** upstream registry is a
  **no-op**.
- The **derived matrix** (`.claude/cache/component-compatibility.json`) is
  **not** distributed — `.claude/cache/` is gitignored and regenerable from the
  registry by the `grm-component-registry` skill after a sync changes it.
- No `feature-manifest.md` row is added here. A `grm-component-registry` adopt row
  (idempotent adopt step) is owned by **D2** (the closeout/flavor-mirror item);
  see the report. Until that row lands, the registry still distributes via the
  file-merge walk above — the manifest row only adds the post-sync *adopt/regen*
  prompt.

---

### What the script tells you

The script prints the `framework-version` recorded in
`.claude/grimoire-config.json` (or notes it is absent), emits the manifest
path, and summarizes the evaluation procedure. It does **not** run `detect`
predicates itself — that is your job as the agent.

### How to evaluate the manifest

1. Read `.claude/skills/grm-sync-from-upstream/feature-manifest.md`.
2. **Delta computation:**
   - *With `framework-version`*: collect entries where `introduced-in` >
     `framework-version`. Run each entry's `detect` predicate; skip entries
     where `detect` returns true (already adopted).
   - *Without `framework-version`*: collect **all** entries. Run each
     `detect`; skip entries that return true.
3. Sort remaining entries by `introduced-in` ascending (oldest first —
   later features may depend on config set by earlier ones).

### Advancing `framework-version`

After the adopt loop completes without errors:

1. Determine the upstream's current version (e.g. from the manifest's highest
   `introduced-in` value, or from the upstream release tag).
2. If every feature up to that version was adopted successfully or
   `detect`-confirmed as already-adopted, write:
   ```json
   "framework-version": "<upstream-version>"
   ```
   into `.claude/grimoire-config.json`. **This is the only code path that
   writes `framework-version`** — the file-merge walk never touches it
   (`.claude/grimoire-config.json` is excluded from the sync walk).
3. If any feature errored or was skipped due to failure, advance
   `framework-version` only to the last fully-adopted version boundary. The
   next sync run will re-evaluate the failed feature by `detect` and resume.
4. User declining an optional adoption does **not** block `framework-version`
   advancement (the user made a conscious choice).

### Paradigm-file update caveat

If any file under `.claude/paradigms/` was `UPDATE`d during this sync, the
active paradigm content in its live paths (installed by `grm-work-paradigm-switch`)
may be stale. After the adoption phase, remind the user:

> Paradigm files updated. Re-run `grm-work-paradigm-switch` to re-install the
> active paradigm (`<paradigm-name>`) into its live paths.

This is a reminder, not an automated action.

### When the adoption phase is a no-op

If `detect` returns true for every manifest entry (all features already
adopted), print:

> Adoption phase: all features up to vX.Y are already adopted.

Then advance `framework-version` as above.

---

