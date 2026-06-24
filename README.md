# Claude Code Scaffold

A starter kit for AI-assisted development using **Claude Code**. Provides a
structured workflow for planning, distributing, integrating, and releasing work
across parallel agent sessions, with enforcement via Claude Code's `PreToolUse`
hooks.

> Looking for the GitHub Copilot variant? See `../copilot/`.

## What's included

```
CLAUDE.md                          ← task-agent + integration-master guide
.claude/
  settings.json                    ← hooks wiring (PreToolUse)
  hooks/
    protected-branch-guard.sh      ← deny-by-default commits/merges on dev/main/version/*
    no-push-guard.sh               ← block the agent from pushing (humans push)
    release-plan-guard.sh          ← lock agreed release scope §§1-4
    worktree-guard.sh              ← prevent cross-worktree edits
  skills/
    repo-init/                     ← initialize git: main/dev, branch model, push guard
    design-doc-scaffold/           ← create a new docs/design/{feature}-design.md
    worktree-preflight/            ← verify a spawned worktree is rooted on dev/version before committing
    repo-reference/                ← model/effort table + doc location map
    release-planning/              ← generate work-items report for next version
    release-agreement/             ← lock scope, create version/{X.Y} staging branch
    release-phase/                 ← generate copy-paste subagent prompts
    release-phase-merge/           ← merge completed branches, tick ledger
    release-agent-tracker/         ← track which agents are done
    ledger-tick/                   ← update §5 ledger in release-planning doc
    project-release/               ← promote dev→main and tag
    source-to-design-docs/         ← generate design docs from existing source code
    workflow-bootstrap/            ← guided install/restore + project interview
      golden/                      ← self-contained pristine copies (restore source)
      manifest.md                  ← canonical skill set + placeholder registry
    workflow-snapshot/             ← re-baseline golden from live skills (manual sync)
    sync-from-source/              ← pull skills/hooks/docs from a source project
docs/
  integration-workflow.md          ← integration-master map (skill sequence)
  version-design.md                ← versioning conventions + release procedure
  coding-standards.md              ← cross-language standards + per-tech sub-docs
  coding-standards/                ← per-language standards (html, css, …)
  architecture-guidelines.md       ← generic architectural principles
  roadmap.md                       ← product roadmap (template)
  design/README.md                 ← design-doc conventions and index
```

## Setup

1. Copy this folder's contents into your project root (merge with an existing
   `.claude/` if present).
2. Make hooks executable: `chmod +x .claude/hooks/*.sh` — a non-executable hook
   silently fails to run.
3. Run the **`workflow-bootstrap`** skill. It restores any missing skills/hooks
   from `golden/`, then runs a guided interview to fill the project-specific
   placeholders (test/build/release commands, version file, doc-location map,
   branch names, first roadmap entry).
4. If your project already has source code, run **`source-to-design-docs`** to
   bootstrap `docs/design/` from the existing code.
5. To start a fresh repo from scratch, run **`repo-init`** (sets up `main`/`dev`
   and the branch model).

After deliberately improving a skill, run **`workflow-snapshot`** to make it the
new restore baseline (optional — there is no perpetual-sync obligation).

## Branch model

```
version/<number>  →  dev  →  main
```

Protected branches (`main`, `dev`, `version/*`) are mutated only by the
integration master (the worktree carrying the `.claude/integration-allow.local`
marker). Enforcement is hook-based; see `docs/integration-workflow.md`.

## Workflow overview

```
release-planning → release-agreement → release-phase
      ↓ (agents work in parallel worktrees)
release-agent-tracker → release-phase-merge → project-release
```
