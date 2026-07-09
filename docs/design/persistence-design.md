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
                         #   default_db_path() — legacy, unused-in-production
                         #   resolver kept only for its own unit test (see
                         #   "App-support DB path and the W4 seam" below)
  migrations.rs          # versioned, idempotent PRAGMA user_version runner
  migrations/
    001_init.sql .. 016_achievement_unlocks.sql  # 16 numbered, additive-only
                         #   migrations; 001 is the EXACT D1 DDL
                         #   (architecture-design.md §3), 002+ extend it
  repo/
    mod.rs               # Repository trait + shared error mapping helpers
    library/              # content_folders + games + collections + play-life stats
      mod.rs              #   LibraryRepo struct + Repository impl
      model.rs             #   ContentFolder, Game, NewGame, Collection, … row structs
      folders.rs           #   content_folders CRUD
      games.rs              #   games CRUD, source/hash lookups, enrichment
      play_life.rs          #   favorite/last-played/play-count/play-time
      collections.rs        #   collections + collection_games membership
    cores.rs              # cores (installed/active, one-active-per-system)
    settings.rs           # settings key/value
    controller_bindings.rs
    search_providers.rs
    art_cache.rs
    console_meta.rs       # per-system console art metadata
    achievement_unlocks.rs # RetroAchievements unlock persistence
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
`NNN_*.sql` with a strictly higher version and a new `Migration` entry; never
edit a released migration. Sixteen migrations ship as of this writing, taking
the schema from the original 7-table D1 baseline through game metadata,
descriptions, ROM-site/legal search-provider seeding, console art metadata,
library "life" stats (favorite/play-count/last-played), a ROM-less library
model (Steam/GOG/itch/CrossOver/manual sources via `launch_descriptor`), an
app-support-path repair migration, collections, and RetroAchievements unlock
persistence.

A `Migration` entry also carries a `requires_fk_off` flag. A handful of later
migrations (the ROM-less-library rebuild and its follow-ons) rebuild a table
that other tables reference via `ON DELETE CASCADE`, using the standard
SQLite 12-step `ALTER TABLE` pattern; `PRAGMA foreign_keys` can only be
toggled outside an active transaction, so the runner flips it off around such
a migration's transaction (never inside the migration's own SQL) and restores
it via a scope guard that fires on every exit path — success, early error
return, or unwind — so a mid-migration failure can never leave the connection
permanently in `foreign_keys = OFF` state.

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

The W4 seam has since been reconciled: `harmony_setup` (`lib.rs`) resolves the
DB path via `config::paths::Paths::app_support()` + `paths.db_file()` — the
single authority for every on-disk location (architecture §4.1), covering W3
db, W8 art, W10 blur, W11 fleet, and telemetry alike. That resolver lives at
`~/Library/Application Support/com.retro-game-player.app/harmony.db` (the
bundle id changed from `com.harmony.app` in the W269 Harmony → Retro Game
Player rename; `config::migrate` moves an existing user's app-support
directory to the new root on first launch of a build that knows the new id).

`db::default_db_path()` and its private `app_support_dir()` helper still exist
in `db/mod.rs`, resolving the same layout independently via `$HOME` and the
now-stale local `BUNDLE_ID = "com.harmony.app"` constant, but neither is
called from production code anymore — `db::Db::open` always receives its path
from the caller (`harmony_setup`, or a `db_path` threaded through worker
closures in `commands/*`), never from `default_db_path`. The function is kept
only because its own unit test still exercises it. Treat it as legacy/dead
code: any future cleanup should either delete it or rewire it to call
`crate::config::paths::Paths::app_support()` so it can't drift from the real
resolver again.

## Testing

Every repo has CRUD unit tests against an in-memory database
(`Db::open_in_memory`), plus: migrations apply and set `user_version`;
migrations are idempotent (run twice → no error, version unchanged); the
original seven D1 tables are created, and each later migration has its own
"table/column exists" and additive-upgrade-from-a-pre-migration-fixture-DB
tests (schema now spans eleven tables: `content_folders`, `games`, `cores`,
`settings`, `controller_bindings`, `search_providers`, `art_cache`,
`console_meta`, `collections`, `collection_games`, `achievement_unlocks`); FK
cascades (folder→games, game→art_cache, game→achievement_unlocks,
collection↔game via `collection_games`) work and never cascade the wrong
direction (e.g. deleting a collection never deletes its games); the
one-active-core partial-unique constraint is enforced; the `games` table's
either-rom-or-launch_descriptor `CHECK` and `(source, external_id)` uniqueness
are enforced; foreign keys are on, including immediately after a
`requires_fk_off` migration fails partway through; and `default_db_path`
resolves under (the legacy, now-unused-in-production) app-support layout.

## Cross-links

- [architecture-design.md §3](architecture-design.md#3-sqlite-schema) — schema (D1, authoritative)
- [architecture-design.md §4.1](architecture-design.md#41-macos-app-support-layout) — app-support layout
