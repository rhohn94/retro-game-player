# Architecture

> **Up:** [↑ Architecture](README.md)

Cross-cutting module boundaries, layering, and dependency rules for the
current app (v0.39). Distinct from
[../architecture-design.md](../architecture-design.md), which is a **frozen
v0.1 "Foundation" snapshot** (module map, schema, and IPC surface as scoped at
launch) — this doc describes the layering as it stands today, generically
enough that it doesn't need rewriting every release. Per-feature behavior
lives in the feature docs indexed at [../README.md](../README.md); generic
principles this doc applies live in
[../../architecture-guidelines.md](../../architecture-guidelines.md).

## Motivation

Capture the project's system-level architecture in one place: the module
boundaries, layering, and dependency rules that individual feature design docs
assume but should not each re-derive. Without this, a new contributor has to
reverse-engineer "where does this kind of change go" from 49 feature docs and
299+163 source files.

## Scope

Cross-cutting architectural structure and decisions: the frontend/backend
layer split, the IPC boundary, Rust internal layering (commands → core → db),
frontend module boundaries (features/ipc/lib/hooks), and dependency-direction
rules. Not a substitute for per-feature design docs — those live beside this
one and link back here. Not a duplicate of
[../architecture-design.md](../architecture-design.md)'s point-in-time module
map, schema DDL, or IPC command tables.

## Design

### Layers and their responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (src/, React 19 + TypeScript)                       │
│                                                                │
│  features/<domain>/   screens + feature-local state/hooks     │
│  components/          cross-feature presentational components │
│  hooks/, lib/         generic, app-agnostic utilities          │
│  ipc/                 typed invoke() wrappers — the ONLY door  │
└───────────────────────────┬────────────────────────────────┘
                             │ Tauri invoke (typed, AppError-mapped)
┌───────────────────────────▼────────────────────────────────┐
│ Backend (src-tauri/src/, Rust)                                │
│                                                                │
│  commands/<domain>.rs   thin #[tauri::command] adapters        │
│                         (arg validation, AppError mapping)      │
│  core/<domain>/         business logic — pure, unit-testable   │
│  db/repo/<domain>/      persistence — SQL confined here         │
└─────────────────────────────────────────────────────────────┘
```

**Frontend.** `src/ipc/invoke.ts` is the single chokepoint — the frontend
never calls Tauri's `invoke()` directly outside `src/ipc/`; every domain gets
a typed wrapper module (`src/ipc/<domain>.ts`). `src/features/<name>/` owns
one screen or cross-cutting concern per directory (library, consoles,
controller, core-options, cores, play, search, settings, shell, tv).
`src/hooks/` and `src/lib/` hold framework-level utilities with no
domain/business knowledge baked in (e.g. `useCancellableEffect`,
`useFetchOnMount`, `lib/motion.ts` presets) — feature code depends on them,
never the reverse.

**Backend.** `commands/<domain>.rs` files are thin IPC adapters: they decode
args, call into `core/<domain>/`, and map results/errors into the unified
`AppError` (see [../architecture-design.md §2](../architecture-design.md)).
Business logic and orchestration live in `core/<domain>/`, which is pure Rust
with no `tauri::command` attributes and no direct SQL — persistence goes
through `db/repo/<domain>/`, which is the only layer allowed to hold SQL
literals. `main.rs` is a 7-line entry point that hands off immediately to
`lib.rs::run()`; `lib.rs::harmony_setup` wires managed state (DB, config,
telemetry, play server, fleet) once at startup.

### Dependency direction

- `src/ipc/` never imports from `src/features/**` — features depend on ipc,
  never the reverse. No cycles.
- Rust: `commands/` depends on `core/`; `core/` depends on `db/repo/`; neither
  `core/` nor `db/repo/` depends back up into `commands/`.
- Most features expose a public surface via `index.ts` (`library`, `tv`,
  `controller`, `play`, `consoles`, `cores`) that other code imports through,
  rather than reaching into feature-internal files. `core-options`, `search`,
  `settings`, and `shell` currently lack that barrel — no deep-import
  violation exists today (nothing reaches into their internals from outside),
  but it's an inconsistency worth closing before those features grow.

### What this buys

A change request routes deterministically: new user-facing behavior → touch a
`features/<domain>/` screen + its `ipc/<domain>.ts` wrapper; new persisted
data → a migration + `db/repo/<domain>/` method, exposed through a
`commands/<domain>.rs` adapter and a matching `core/<domain>/` function if
there's real logic involved; a UI-only tweak with no new data never needs to
touch `src-tauri/` at all.

## Acceptance

- A new contributor can place a change (new screen, new persisted field, new
  IPC command) in the correct layer without asking, using this doc plus the
  relevant feature doc.
- `grm-coding-practices-audit`'s architecture checks
  (`arch-decoupled-fe-be`, `arch-layer-separation`, `arch-dependency-direction`)
  pass clean against this layering — verified 2026-07-09: no direct `invoke()`
  calls outside `src/ipc/`, no SQL outside `db/repo/`, no import cycles.

## Open questions

- Whether to add `index.ts` barrels to `core-options`, `search`, `settings`,
  and `shell` now (closing the `arch-public-surface` gap) or defer until a
  consumer actually needs to reach past their current entry points.
- Whether to formalize this layering as a deterministic fitness function via
  `.claude/architecture-rules.json` + `grm-architecture-audit` (no rules file
  exists yet in this project) rather than relying on agent-driven audits.

## Follow-ups

- Wire up `.claude/architecture-rules.json` (layers + allowed edges +
  forbid-cycles) if/when `grm-architecture-audit` is adopted for this project.
