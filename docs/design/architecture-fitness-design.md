# Architecture-fitness enforcement

> **Up:** [↑ Design docs](README.md)


> Design gate for v3.18, third release of the v3.16–v3.21 **project
> code-quality** program. Adds *deterministic* architecture enforcement —
> machine-readable fitness functions for dependency-direction, layering, and
> module-boundary rules — on top of the existing agent-driven audit-hints in
> [architecture-guidelines.md](../architecture-guidelines.md). Introduces a focused `grm-architecture-audit` skill
> and a declarative `.claude/architecture-rules.json` rule format.

## Motivation

[architecture-guidelines.md](../architecture-guidelines.md) carries strong prose plus four `audit:` hints
(decoupled fe/be, modularity, genericity, layer-separation), and
`grm-coding-practices-audit` reasons over them. But that pass is **agent-driven and
narrative** — it cannot mechanically prove "the view layer never imports the
persistence layer" or "no dependency cycle exists between modules." Architecture
drift (a controller importing the store, a cycle between subsystems, a utility
reaching into a feature) is exactly the class of regression that a *fitness
function* — a cheap, repeatable, pass/fail check over the import graph — catches
deterministically. Grimoire has no such mechanism today.

## Goals

- A declarative **`.claude/architecture-rules.json`** describing the project's
  layers, allowed dependency edges, and forbidden imports — machine-readable,
  reviewable without executing.
- A focused **`grm-architecture-audit`** skill that evaluates those rules as fitness
  functions against the project's import statements and reports each violation
  (`file:line — rule`), with an optional gate reusing the v1.26 `code-quality`
  dials.
- **Two new audit-hints** in [architecture-guidelines.md](../architecture-guidelines.md) (dependency-direction
  / no-cycles, public-surface-only) so the narrative audit and the deterministic
  audit reference the same rule ids.
- Degrades gracefully: absent rules file → the skill reports "no architecture
  rules declared" and exits clean (never fails a project that hasn't opted in).

## Non-goals

- A language-specific AST/type-graph analyzer — fitness functions are evaluated
  over import/use statements via language-appropriate greps, not a compiler.
- Replacing `grm-coding-practices-audit` — this is the deterministic complement to
  its narrative architecture pass.
- Auto-fixing violations or rewriting imports.
- Mandating a layering for every project — the rules file is opt-in per project.

## Design

### 1. `.claude/architecture-rules.json` (the fitness-function source)

```jsonc
{
  "schema-version": 1,
  "layers": {                         // name → glob(s) that belong to the layer
    "presentation": ["src/ui/**", "src/views/**"],
    "application":  ["src/services/**"],
    "domain":       ["src/domain/**"],
    "persistence":  ["src/store/**", "src/db/**"]
  },
  "allowed-edges": [                  // directed; anything not listed is denied
    ["presentation", "application"],
    ["application", "domain"],
    ["application", "persistence"],
    ["persistence", "domain"]
  ],
  "forbidden-imports": [              // explicit deny rules with a rule id
    { "id": "no-sql-in-view", "from": "presentation", "pattern": "sql|knex|prisma|sqlx", "severity": "error" },
    { "id": "no-internal-reach", "pattern": "/internal/|/_private/", "severity": "warn" }
  ],
  "forbid-cycles": true              // any layer/module import cycle is a violation
}
```

Rules are **data**, read without execution (the
`recipes.json`/audit-hint philosophy). `allowed-edges` is an allow-list:
a presentation→persistence import is a violation because that edge is absent.

### 2. The `grm-architecture-audit` skill

Steps: (1) read `.claude/architecture-rules.json` — if absent, report
"no rules declared" and exit clean; (2) for each source file, resolve its layer
by glob and extract its imports; (3) evaluate the fitness functions —
disallowed-edge, forbidden-import pattern, and (if `forbid-cycles`) a cycle
detection over the layer/module edge set; (4) emit a report (machine block +
human table of `file:line — rule-id — message`); (5) optional `--gate` escalates
per the v1.26 `code-quality` `audit-gate` dial (warn/block). Read-only; never
edits source.

### 3. Audit-hint alignment

[architecture-guidelines.md](../architecture-guidelines.md) gains:
- `arch-dependency-direction` — one direction between modules; no cycles
  (the deterministic counterpart is `forbid-cycles` + `allowed-edges`).
- `arch-public-surface` — modules expose a public surface; internals stay
  private (counterpart: the `no-internal-reach` forbidden-import).

So the narrative pass (`grm-coding-practices-audit`) and the deterministic pass
(`grm-architecture-audit`) cite the same rule vocabulary.

### 4. Merge-gate integration

No new dial. `architecture-audit --gate` consults the existing v1.26
`code-quality` `audit-gate`; `warn` reports, `block` stops the merge.

## Self-consistency pass (program requirement, architecture scope)

- The **module-boundary** rule appears in [architecture-guidelines.md](../architecture-guidelines.md)
  (§Modularity by design) *and* `coding-standards/rust.md` (§Module & package
  structure, re-export discipline). Confirmed consistent — the Rust doc is the
  language-specific realization the guidelines explicitly ask sub-docs to
  provide. No contradiction.
- `grm-coding-practices-audit` (narrative) vs `grm-architecture-audit` (deterministic)
  could be read as overlapping. Resolved by scoping: the design and both skills'
  descriptions state the narrative-vs-deterministic split explicitly, so they
  complement rather than duplicate.

## Validation / Idempotency

- Absent `architecture-rules.json` → skill exits clean ("no rules declared").
- A declared ruleset is evaluated deterministically: same source + same rules →
  same violation list (idempotent, order-stable).
- `grep -c 'audit: id=' architecture-guidelines.md` rises from 4 to 6.
- `grm-doc-assurance` reports no new flavor-parity / link / house-layout findings.

## Flavor parity

[architecture-guidelines.md](../architecture-guidelines.md), this design doc, and the `grm-architecture-audit`
skill are mirrored: root + `claude-code/.claude/skills/grm-architecture-audit/` +
`copilot/.github/prompts/architecture-audit.prompt.md`. The rules-file format is
identical across flavors.
