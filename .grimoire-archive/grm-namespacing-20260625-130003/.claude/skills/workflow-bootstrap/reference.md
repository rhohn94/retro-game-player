# Workflow-bootstrap — reference
Loaded on demand by `SKILL.md`.

## When to use this skill

- **New project**: scaffolding copied in, nothing customised yet.
- **Existing repo onboarding**: skills present but full of placeholders.
- **Repair**: a required skill or hook was deleted or corrupted.

Do **not** use it to push local edits back into `golden/` — that is
`workflow-snapshot`.

---

## Anti-patterns

- Overwriting a customised skill without asking — always diff and confirm.
- Substituting runtime template tokens (`{feature}`, `{model}`, …) — only
  the `manifest.md` project-config tokens are interview-fillable.
- Re-asking what's already in the repo — detect and confirm instead.
- Fabricating a `CLAUDE.md` or design docs to "complete" patching — report
  the gap and defer to the scaffolding README / `source-to-design-docs`.
- Treating `golden/` as authoritative over a user's deliberate edits — it
  is a restore baseline, not a style enforcer.
- Committing. This skill only reads, copies, and edits; the user commits.
### Grimoire Framework URL (`.scaffold-upstream.conf`)

1. Check whether `.scaffold-upstream.conf` exists at the project root.
2. If absent → copy `golden/.scaffold-upstream.conf` into place (as part of
   the Step 2 restore). The file is already in the golden manifest; this step
   is a no-op if the restore already wrote it.
3. If present → read `UPSTREAM_REPO`. If it is non-empty → **no-op** (preserve
   the existing value; forks that point at their own upstream must not be
   overwritten). If empty or absent → set `UPSTREAM_REPO` to the default:

   ```
   UPSTREAM_REPO=https://github.com/rhohn94/grimoire-framework.git
   UPSTREAM_REF=main
   ```

   Add the lines in place; do not rewrite the rest of the file. (The golden
   `.scaffold-upstream.conf` already carries this exact value — step 2 normally
   covers it; this is the explicit fallback if the file exists but is empty.)

**Default Grimoire URL:** `https://github.com/rhohn94/grimoire-framework.git`
(ref `main`). The legacy `agentic-scaffolding.git` name is auto-detected and
repointed by `sync-from-upstream` (the v1.22 rename-migration note).

Fork override: a project (or org fork) with its own upstream sets
`UPSTREAM_REPO` in `.scaffold-upstream.conf`. The idempotency check ensures
the fork's value is never overwritten by a subsequent `workflow-bootstrap` run.

### Aura design language URL (`docs/design/ux/design-language.md`)

For GUI projects only (Step 3 answer = "Yes"):

1. When the golden `docs/design/ux/design-language.md` stub is written (new
   project) or already present — confirm `source-url:` in the front-matter is
   set to the Aura default:

   ```
   source-url: https://github.com/rhohn94/design-language
   ```

   > **NOTE (CONFIRM-pending):** `https://github.com/rhohn94/design-language`
   > is a placeholder. Confirm the canonical Aura repo URL with the project owner
   > before the first `design-language-adapt` run. If you know the correct URL
   > at bootstrap time, set `source-url:` to it now.

2. If `source-url:` is already non-empty in the live file → **no-op** (preserve
   the existing value; projects that override the default retain their URL).
3. If empty → write the default.

For GUI-absent and headless projects: skip this sub-step entirely.

---

