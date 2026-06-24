# Persistence Layer — Harmony v0.1 (W3)

> **Up:** [↑ Design docs](README.md) · [↑ Architecture master contract](architecture-design.md)

> **Status:** implementation detail beneath the master contract. The SQLite
> schema is owned by [architecture-design.md §3](architecture-design.md#3-sqlite-schema)
> (D1); where this doc and the master contract disagree on a table, column, or
> path, the **master contract wins**. Implemented by **W3**.

## Motivation

Every Harmony domain — library, cores, settings, controllers, search providers,
art cache — needs durable local storage. W3 provides the single SQLite database
under macOS Application Support, a versioned/idempotent migration runner, and a
thin repository per table group so the IPC adapters (W5/W6/W8/W9/W14/W15) read
and write rows without hand-rolling SQL.

## Module map (`src-tauri/src/db/`)

```
db/
  mod.rs                 # Db handle (Mutex<Connection>), open/open_in_memory,
                         #   default_db_path() app-support resolver (W4 seam)
  migrations.rs          # versioned, idempotent PRAGMA user_version runner
  migrations/
    001_init.sql         # the EXACT D1 DDL (architecture-design.md §3)
  repo/
    mod.rs               # Repository trait + shared error mapping helpers
    library.rs           # content_folders + games
    cores.rs             # cores (installed/active, one-active-per-system)
    settings.rs          # settings key/value
    controller_bindings.rs
    search_providers.rs
    art_cache.rs
```

## Connection management

`Db` owns one `rusqlite::Connection` behind a `Mutex` and is stored in Tauri app
state (`app.manage(database)` in `harmony_setup`). Repos never touch the mutex
directly — they call `Db::with_conn(|conn| …)`, which centralizes locking and
poison handling. SQLite is single-writer, so one serialized connection is the
simplest correct model; the `Mutex` can be swapped for a pool later without
changing repo signatures (they operate on `&Connection`). Every connection sets
`PRAGMA foreign_keys = ON` so the schema's cascading FKs are enforced.

## Migration strategy

`migrations.rs` reads `PRAGMA user_version`, then applies each embedded
`NNN_<name>.sql` whose number exceeds it inside its own transaction and bumps
`user_version` to that number. Migrations are embedded with `include_str!`, so
they ship in the binary. Idempotency holds at two levels: the runner skips
migrations at or below the stored version (a second `run` is a no-op), and the
DDL itself uses `CREATE TABLE/INDEX IF NOT EXISTS`. To add schema, append a
`002_*.sql` with a strictly higher version and a new `Migration` entry; never
edit a released migration.

## Repository layer

Each repo is a struct borrowing a `&Db`, constructed via the shared
`Repository::new(db)` trait, exposing CRUD that returns `AppResult<T>`. Shared
boilerplate lives in `repo/mod.rs`:

- `map_sqlite` — maps a rusqlite error into `AppError`, translating a
  UNIQUE/constraint violation into `AppError::Conflict` (typed `conflict` over
  IPC) and everything else into `AppError::Db`.
- `require_found` — maps "no rows" into `AppError::NotFound`.
- `require_affected` — maps a 0-row update/delete into `AppError::NotFound`.

Row structs (`Game`, `ContentFolder`, `Core`, …) derive `Serialize` and mirror
the TS DTOs in architecture §2, so IPC adapters serialize repo rows directly.

### One active core per system

`CoresRepo::set_active` clears the prior active core for the system and sets the
new one in a single transaction. The `idx_cores_one_active` partial-unique index
is the database-level backstop; a unit test proves that inserting two active
cores for one system without clearing is rejected as a conflict.

## App-support DB path and the W4 seam

`db::default_db_path()` resolves
`~/Library/Application Support/com.harmony.app/harmony.db`, creating the bundle
directory if needed.

**W4 SEAM (reconciliation point for the integration master):** the path is
currently resolved by a *local minimal* helper (`db::app_support_dir`, using
`$HOME`). When W4's `config/paths.rs` lands — the single authority for
app-support paths (architecture §4.1) — replace the body of `default_db_path`
with a call to `crate::config::paths::app_support_dir()` and delete the local
`app_support_dir` helper plus the `BUNDLE_ID` constant. The seam is marked with
a `// W4 SEAM` comment in `db/mod.rs` and in the `harmony_setup` block in
`lib.rs`. W3 does not hard-block on W4.

## Testing

Every repo has CRUD unit tests against an in-memory database
(`Db::open_in_memory`), plus: migrations apply and set `user_version`;
migrations are idempotent (run twice → no error, version unchanged); all seven
tables are created; FK cascade (folder→games, game→art_cache) works; the
one-active-core partial-unique constraint is enforced; foreign keys are on; and
`default_db_path` resolves under app-support.

## Cross-links

- [architecture-design.md §3](architecture-design.md#3-sqlite-schema) — schema (D1, authoritative)
- [architecture-design.md §4.1](architecture-design.md#41-macos-app-support-layout) — app-support layout
