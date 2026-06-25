# grm- skill namespacing

> **Up:** [↑ Design index](README.md)

## Motivation

Grimoire installs its skills into a consumer project's `.claude/skills/`
directory, sharing that namespace with whatever skills the consumer (or other
tools) author. Pre-rename bare names — iterate, scout, reviewer,
config-validate — are generic enough to collide with a consumer's own skills,
and they give no visual signal of provenance. Namespacing every Grimoire skill
under a reserved `grm-` prefix makes the framework's skills self-identifying,
collision-proof against consumer skills, and trivially greppable as a set.

## Goals

- Rename every Grimoire skill directory `<name>` → `grm-<name>` across all
  flavors (root, `claude-code/`, `copilot/`) and every `grm-workflow-bootstrap`
  golden tree.
- Rewrite every reference (paths, frontmatter, prose mentions) so the framework
  remains internally consistent and every check stays green.
- Deliver the rename as a **deterministic, reusable, stdlib-only transformer**
  — the same engine the consumer migrate row (GN-3) invokes against a managed
  project's installed `.claude/skills/` tree.
- Be idempotent: a second run is a no-op; `--dry-run` and `--self-test` modes.

## Non-goals

- Renaming non-skill artifacts (hooks, MCP servers, paradigms, workflows).
- Changing any skill's behavior, logic, or interface — this is a pure rename +
  reference-rewrite, no functional edits.
- Rewriting un-backticked free prose occurrences of common-word skill names
  (the verbs/nouns iterate, scout, reviewer, researcher, reporter, verifier,
  triager) — doing so would corrupt ordinary English. See the two-tier rule.

## Scope

Covers the framework's own skill set (enumerated programmatically from the
`.claude/skills/*/` and `golden/skills/*/` directories — 64 skills as of v3.42)
and every textual reference to them under the repo, excluding `.git/`,
`.grimoire-archive/`, `dist/`, `node_modules/`, and `__pycache__/`. The
`copilot/` flavor carries only `grm-files-manifest` and `grm-regenerate-grimoire` as
real skill dirs (its other skills live in `.github/prompts/`); the transformer
renames whatever skill dirs it finds, so it adapts per-flavor automatically.

## Design

### Rename convention

Each known skill directory `<parent>/skills/<name>` is renamed to
`<parent>/skills/grm-<name>`, preserving git history (`git mv`). Each renamed
`SKILL.md`'s YAML frontmatter `name:` field is set to `grm-<name>`. A directory
already carrying the `grm-` prefix is skipped (idempotent). Skill directories
nested under another skill (e.g. `workflow-bootstrap/golden/skills`) are renamed
**deepest-first** so an outer rename never invalidates an inner parent's path.

### Two-tier reference-rewrite rule (the contract)

This is the contract both the transformer and the GN-3 consumer migrate row
implement.

**Tier 1 — PATH references (rewrite aggressively).** Every occurrence of the
substring `skills/<name>/` → `skills/grm-<name>/`, for every known `<name>`,
across all text files (`.md`, `.py`, `.sh`, `.json`, `.toml`, agent defs,
workflows, `CLAUDE.md`, docs). This single substring covers
`.claude/skills/<name>/`, golden `skills/<name>/`,
`copilot/.claude/skills/<name>/`, and every relative form — they all contain
`skills/<name>/`. A `skills/grm-<name>/` already present is not re-prefixed.

**Tier 2 — bare-name prose (rewrite conservatively).** To avoid corrupting
common-word skill names used as ordinary English, rewrite ONLY:

- **(a)** a backticked token that EXACTLY equals a known skill name:
  `` `<name>` `` → `` `grm-<name>` ``; and
- **(b)** the patterns `<name> skill`, `skill <name>`, and `<name>` immediately
  preceded by "the " and followed by " skill".

Un-backticked free occurrences of common words ("we iterate on the plan",
"scout the area") are left untouched.

### Inventory reconciliation

Three inventory surfaces are reconciled by the same rules (they themselves now
live under renamed dirs):

- `.claude/skills/grm-workflow-bootstrap/manifest.md` — restorable-skill id list
  + paths (Tier 1 paths + Tier 2a backticked ids).
- `.claude/grimoire-files.json` (all flavors) — explicit per-skill path entries
  (Tier 1); the `.claude/skills/**` glob stays valid as-is.
- `.claude/skills/grm-sync-from-upstream/feature-manifest.md` — skill-dir
  mentions in detect/adopt prose.

### The transformer (migrate engine)

`.claude/skills/grm-sync-from-upstream/grm_namespacing.py` is a stdlib-only,
class-based transformer (`GrmNamespacer`). It enumerates the known skill set
from the tree (never trusting a hardcoded list), renames directories, updates
frontmatter, then rewrites references per the two-tier rule. It is the **migrate
engine for GN-3's consumer migrate row**, which constructs `GrmNamespacer`
against a managed project's repo root and calls `run()`.

Invocation:

```bash
# preview (default): report counts + planned renames, no writes
python3 .claude/skills/grm-sync-from-upstream/grm_namespacing.py --root . --dry-run

# apply the transform
python3 .claude/skills/grm-sync-from-upstream/grm_namespacing.py --root . --apply

# built-in fixture test (seeds a fake skill + referencing file; asserts dir
# renamed, path rewritten, AND a common-word false-positive is NOT rewritten)
python3 .claude/skills/grm-sync-from-upstream/grm_namespacing.py --self-test
```

## Acceptance

- Every skill dir across root, `claude-code/`, `copilot/`, and every
  `golden/skills/` tree is `grm-`-prefixed; no un-prefixed survivor.
- No dangling old `skills/<oldname>/` references remain (excluding
  archive/dist/.git); every referenced `grm-*/<script>` exists on disk.
- `grm-doc-assurance` (`flavor-parity links docs-map release-consistency
  shipped-pointers --strict`), `grm-files-manifest --strict` (root +
  claude-code), and `grm-regenerate-grimoire --self-test` pass via the new
  paths; spot-checked skill self-tests pass.
- Each renamed `SKILL.md` frontmatter `name:` equals its directory name.
- The transformer's `--self-test` passes, proving idempotency and the
  conservative-prose guard.
