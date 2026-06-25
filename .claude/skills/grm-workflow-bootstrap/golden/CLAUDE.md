<!-- GRIMOIRE_ONBOARDING_SENTINEL -->
# CLAUDE.md

Concrete, actionable guidance for working in this repo.

## Onboarding sentinel (permanent detection instruction)

If line 1 of this file is `<!-- GRIMOIRE_ONBOARDING_SENTINEL -->`, this is
a fresh, not-yet-initialized Grimoire scaffold. **Before handling any other
part of the user's prompt**, run the Grimoire onboarding flow:

1. Check whether the first prompt contains the literal text `SKIP ONBOARDING`
   (case-sensitive). If yes → run non-interactive bootstrap (infer config
   from prompt, write `.claude/grimoire-config.json`, call `grm-repo-init` then
   `grm-workflow-bootstrap` non-interactively, remove the sentinel).
2. Otherwise → greet the user: "I see this is a fresh Grimoire project. Let
   me walk you through setup first." Defer the rest of the prompt until
   onboarding completes. Run the `grm-onboarding` skill (interactive interview →
   `grm-repo-init` → `grm-workflow-bootstrap` → remove sentinel).

**Sentinel removal (idempotent, final step of both paths):** read line 1 of
`CLAUDE.md`; if and only if it matches the sentinel literal exactly, delete
that line. If line 1 does not match, removal is a no-op (already done).

This detection instruction is permanent — it remains after the sentinel line
is removed, so it never triggers a false positive once line 1 is clean.

## Work Paradigm

The project has a selectable work paradigm — **Supervised** (default),
**Weiss** (Collaborative), or **Noir** (Autonomous) — stored in
`.claude/grimoire-config.json` as `work-paradigm.value`. Only the selected
paradigm's instruction content is installed into the active files (lean by
design); the other paradigms' content stays in `.claude/paradigms/` and is
never loaded by agents during normal operation. Switch the active paradigm via
the **`grm-work-paradigm-switch`** skill. Full design:
`docs/design/work-paradigm-design.md`.

> **Paradigm:** {ACTIVE} — one of Supervised · Weiss · Noir.
> Switch via the `grm-work-paradigm-switch` skill. See `.claude/paradigms/README.md`.

## Stealth Mode

An orthogonal operating mode (independent of the work paradigm). Switch it with
the **`grm-stealth-mode-switch`** skill; only the active state's content sits between
the sentinels below (content set in `.claude/stealth/`). Full design:
`docs/design/stealth-mode-design.md`.

<!-- STEALTH_SECTION:start -->
Stealth Mode is **off** (`stealth-mode.value: "off"`). Grimoire operates
normally — its files, branches, and commit metadata are handled as usual. To
make Grimoire leave **zero AI/agent fingerprints** in source control, activate
it via the **`grm-stealth-mode-switch`** skill. Activation discloses one trade-off
you must acknowledge: the Grimoire context becomes **ephemeral** (local-only,
never committed), so deleting the local clone loses it. Design:
`docs/design/stealth-mode-design.md`.
<!-- STEALTH_SECTION:end -->


## Which agent are you?

<!-- PARADIGM_SECTION:agent-role:start -->
- **Task agent** (common case): you're running a work-item session the
  integration master spawned (via `spawn_task`), in your own worktree —
  follow everything below.
- **Project Manager** (multi-feature releases): atop the hierarchy, owning the
  release — track components, partition features into non-colliding lanes,
  dispatch an integration master per lane, integrate, gate on QA, and ship.
  Confirm with the user at decomposition, the lane plan, each dispatch, the QA
  verdict, and the release. Guide: `.claude/skills/grm-project-manager/SKILL.md`.
- **Integration master**: implement one feature lane under a PM, or own a whole
  single-feature release standalone (no PM). Your guide is
  `.claude/skills/grm-integration-master/SKILL.md` — the `grm-release-planning` →
  `grm-release-agreement` → `grm-release-phase` → `grm-release-phase-merge` →
  `grm-project-release` skills with user-confirmed gates at scope lock, batch spawn,
  each merge, and push to origin.
- **Reporter** (optional, any paradigm): a narrow-context, own-session agent
  spawned via `spawn_task` to file feedback through `grm-feedback-to-issue`. No
  git writes; targets the configured issue tracker only. Guide:
  `.claude/skills/grm-reporter/SKILL.md`. Taxonomy + spawn template:
  `docs/grimoire/integration-workflow.md` §Filing issues with the Reporter.
<!-- PARADIGM_SECTION:agent-role:end -->

## Worktree isolation (required)

Stay in your own worktree. Branch in place from the staging ref:
`git switch -c <branch> version/{X.Y}`. Never `git worktree add`, `cd` to
another worktree, `git switch` an existing one, or edit/git-operate on a
sibling. Run **`grm-worktree-preflight`** before any `git switch -c` /
`git branch` / `git merge`.

**Never merge your own work** into `version/{X.Y}` / `dev` / `main` — only
the integration master merges (`grm-release-phase-merge`). The
`protected-branch-guard.sh` hook enforces this from any worktree without
`.claude/integration-allow.local` (fail-closed). Don't work around it;
branch in place.

*Integration-master exception (dead-worktree cleanup):* the marker-blessed
worktree may remove a sibling worktree after verifying it's merged + clean.
Preserve (or report) any uncommitted work; never silently `--force`. Full
procedure: `docs/grimoire/integration-workflow.md` §Dead-worktree cleanup.

## Task execution

<!-- PARADIGM_SECTION:task-execution:start -->
Implement to the agreed checkpoint, then review for bugs/incomplete work.
Read the relevant design docs first; add/update
`docs/design/{feature}-design.md` when the task introduces a feature
(**`grm-design-doc-scaffold`** skill). Doc-location map + subagent model/effort
table: **`grm-repo-reference`** skill.

Before committing to an approach on an ambiguous item, confirm your plan with
the user. If the acceptance criteria leave room for interpretation, surface the
options and wait for direction.

**Done-criteria for branches touching a served or UI surface:** `recipe.py smoke`
must pass (exit 0) — green tests, build, and release are necessary but not
sufficient. See `docs/grimoire/integration-workflow.md` §Runtime smoke check and
`docs/design/runtime-verification-design.md`.

**Test-quality note:** a test that asserts an injected or derived URL must also
verify it resolves against a real served route (share the constant or probe the
real server in the test). Asserting a URL string is not sufficient; the URL must
resolve on a running instance.
<!-- PARADIGM_SECTION:task-execution:end -->

## Workflows

`.claude/workflows/<name>.js` = opt-in, **billed** multi-agent fan-out for
read-heavy analysis (a complement to `spawn_task`) — run one only when the user
explicitly requests multi-agent orchestration. **Claude-Code-only** (`copilot/`
has no equivalent). Add new ones with the **`grm-workflow-scaffold`** skill.

The **write-capable tier is Noir-only**: each agent commits on an isolated
worktree branch the integration master merges, and the script fails closed off
Noir. Push stays human-gated. Full design (tiers + execution variants):
`docs/design/write-capable-workflow-design.md`;
`docs/grimoire/integration-workflow.md` §Workflow-based-orchestration.

## UX design language

GUI projects own `docs/design/ux/design-language.md` + a `ux-demo/`; non-GUI
projects defer via a `## Backlog` row in `docs/roadmap.md`. Establish/refresh
with **`grm-design-language-adapt`**; verify with **`grm-ux-demo-build`** (opt-in).

## Coding practices

Do: object-oriented design — use base classes and inheritance for shared
behaviour; generic reusable code; handle error conditions; unit-test every
function; one file per class/module; brief summary comment atop each class.
Don't: magic numbers; duplicated code.

Full standards live in `docs/coding-standards.md` (with per-language sub-docs);
architectural principles in `docs/architecture-guidelines.md`. This section is
the quick reference — those docs are authoritative.

## Project commands

| Purpose | Command |
|---|---|
| Run tests | `{test-command}` |
| Build | `{build-command}` |
| Release | `{release-command}` |
| Type-check | `{typecheck-command}` |
| Lint | `{lint-command}` |
| Coverage | `{coverage-command}` |

All three must pass cleanly before a branch is reported done or merged.
(Placeholders are filled by the **`grm-workflow-bootstrap`** skill at setup.)

## Commits

One-sentence message; atomic; only commit code that builds. The git default is
**branch-and-merge**: history-**rewriting** commands — `git rebase`,
`git cherry-pick`, `git reset --hard`, force-push (`--force` /
`--force-with-lease`), and remote-ref deletion — are **prohibited by default**
and permitted only as an explicit, human-confirmed **last resort**. They are
blocked outright on protected branches (`dev` / `main` / `version/*`) by
`protected-branch-guard.sh` (local rewrites) and `push-guard.sh` (force-push);
use `git switch -c <branch> <ref>` + `git merge --no-ff` instead, and
`git revert` to undo a landed commit. Any destructive op (`git reset --hard`,
`git push --force`, `git branch -D`) requires explicit user confirmation each
time (per-action). Task agents do not push to origin; pushing is the integration
master's job at a single post-release moment — `dev` + `main` + tag pushed
together (see `docs/grimoire/integration-workflow.md` §Git-protocol governance and
§Pushing to origin).
