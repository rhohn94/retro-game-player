//! Versioned, idempotent migration runner (W3, architecture-design.md §3).
//!
//! Each migration is an embedded `NNN_<name>.sql` file with a monotonically
//! increasing number. The runner reads `PRAGMA user_version`, applies every
//! migration whose number exceeds it inside a single transaction, then bumps
//! `user_version` to that number. Running twice is a no-op: already-applied
//! migrations are skipped because their number is `<= user_version`.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;

/// A single ordered schema migration. `version` is the target `user_version`
/// after `sql` is applied; `sql` is a self-contained, idempotent DDL script.
struct Migration {
    version: i64,
    sql: &'static str,
    /// Whether this migration rebuilds a table that other tables reference
    /// via `ON DELETE CASCADE` (the standard SQLite 12-step `ALTER TABLE`
    /// pattern — see 012_romless_games.sql). `PRAGMA foreign_keys` can only
    /// be changed OUTSIDE an active transaction (SQLite silently ignores the
    /// pragma mid-transaction), so the runner toggles it around such a
    /// migration's transaction rather than relying on the migration's own
    /// SQL to do so — otherwise `DROP TABLE` on the rebuilt table cascades
    /// and silently deletes every referencing row (e.g. `art_cache`).
    requires_fk_off: bool,
}

/// The ordered migration set shipped with this build. Append new entries with
/// strictly increasing `version`; never edit a released migration's `sql`.
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: include_str!("migrations/001_init.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 2,
        sql: include_str!("migrations/002_game_metadata.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 3,
        sql: include_str!("migrations/003_seed_search_providers.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 4,
        sql: include_str!("migrations/004_search_provider_kind.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 5,
        sql: include_str!("migrations/005_game_description_and_rom_providers.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 6,
        sql: include_str!("migrations/006_console_meta.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 7,
        sql: include_str!("migrations/007_search_provider_direct_download.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 8,
        sql: include_str!("migrations/008_search_provider_compose_filters.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 9,
        sql: include_str!("migrations/009_seed_legal_search_providers.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 10,
        sql: include_str!("migrations/010_library_life.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 11,
        sql: include_str!("migrations/011_repair_renamed_app_paths.sql"),
        requires_fk_off: false,
    },
    Migration {
        version: 12,
        sql: include_str!("migrations/012_romless_games.sql"),
        requires_fk_off: true,
    },
    Migration {
        version: 13,
        sql: include_str!("migrations/013_gog_itch_sources.sql"),
        requires_fk_off: true,
    },
];

/// Read the database's current schema version (`PRAGMA user_version`, default 0).
fn current_version(conn: &Connection) -> AppResult<i64> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| AppError::Db(e.to_string()))
}

/// Set `PRAGMA user_version`. Takes a trusted integer (never user input), so
/// inlining is safe — PRAGMA does not accept bound parameters.
fn set_version(conn: &Connection, version: i64) -> AppResult<()> {
    conn.execute_batch(&format!("PRAGMA user_version = {version};"))
        .map_err(|e| AppError::Db(e.to_string()))
}

/// Set `PRAGMA foreign_keys`. Must be called OUTSIDE an active transaction —
/// SQLite silently ignores this pragma mid-transaction, which is exactly why
/// [`run`] toggles it here rather than inside a migration's own SQL.
fn set_foreign_keys(conn: &Connection, on: bool) -> AppResult<()> {
    conn.pragma_update(None, "foreign_keys", on)
        .map_err(|e| AppError::Db(e.to_string()))
}

/// Scope-guard that unconditionally restores `PRAGMA foreign_keys = ON` when
/// dropped (W324 hardening rider). A `requires_fk_off` migration turns FK
/// enforcement off for the duration of its transaction; without this guard, a
/// failure partway through that transaction (the `?`-propagated error from
/// `tx.execute_batch` / `tx.commit`) would return early from [`apply`] and
/// leave the connection permanently in `foreign_keys = OFF` state. The
/// guard's `Drop` impl re-enables FKs on every exit path — success, early
/// return, or panic-driven unwind — so the FKs-on invariant holds even when a
/// migration fails.
///
/// Holds a raw pointer rather than `&Connection` solely so the guard can stay
/// alive across the immediately-following `conn.transaction()` call, which
/// needs `&mut Connection` and would otherwise conflict with a borrowing
/// guard. Sound because: single-threaded, synchronous use only; the guard
/// never outlives the `conn: &mut Connection` it was engaged from (its only
/// caller is [`apply`], within one stack frame); and `Connection` is never
/// moved or dropped while the guard is alive.
struct ForeignKeyOffGuard {
    conn: *const Connection,
}

impl ForeignKeyOffGuard {
    /// Turn foreign keys off and arm the guard that will turn them back on.
    fn engage(conn: &Connection) -> AppResult<Self> {
        set_foreign_keys(conn, false)?;
        Ok(Self { conn })
    }
}

impl Drop for ForeignKeyOffGuard {
    fn drop(&mut self) {
        // Safety: see the struct-level comment — `conn` is still valid for
        // the guard's entire lifetime. Best-effort: a Drop impl cannot
        // propagate a Result, and this path only runs after a migration
        // already failed, so a second error here must not panic
        // (double-panic would abort the process).
        let conn = unsafe { &*self.conn };
        let _ = set_foreign_keys(conn, true);
    }
}

/// Apply every pending migration in order. Idempotent: migrations at or below
/// the stored `user_version` are skipped, so a second call does nothing and the
/// version is unchanged. Each migration runs in its own transaction so a failure
/// leaves the database at the last good version.
///
/// A migration that rebuilds a cascade-referenced table
/// ([`Migration::requires_fk_off`]) has FK enforcement turned off for the
/// duration of its transaction and restored immediately after — both
/// OUTSIDE the transaction itself, since `PRAGMA foreign_keys` is a no-op
/// once a transaction is open. The restore is scope-guarded
/// ([`ForeignKeyOffGuard`]) so it happens even if the migration's transaction
/// fails partway through (W324): the FKs-on invariant must hold on every exit
/// path, not just the success path.
pub fn run(conn: &mut Connection) -> AppResult<()> {
    apply(conn, MIGRATIONS)
}

/// Shared implementation behind [`run`], parameterized over the migration set
/// so tests can inject a deliberately-failing [`Migration`] and observe the
/// FKs-on invariant ([`ForeignKeyOffGuard`]) hold on the error path — the same
/// code path production traffic runs through.
fn apply(conn: &mut Connection, migrations: &[Migration]) -> AppResult<()> {
    let mut version = current_version(conn)?;
    for migration in migrations {
        if migration.version <= version {
            continue;
        }
        let _fk_guard = if migration.requires_fk_off {
            Some(ForeignKeyOffGuard::engage(&*conn)?)
        } else {
            None
        };
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.execute_batch(migration.sql)
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.commit().map_err(|e| AppError::Db(e.to_string()))?;
        drop(_fk_guard);
        set_version(conn, migration.version)?;
        version = migration.version;
    }
    Ok(())
}

/// The highest migration version this build knows about (the expected
/// `user_version` of a fully-migrated database).
pub fn latest_version() -> i64 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_set_version() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        assert_eq!(current_version(&conn).unwrap(), latest_version());
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("first migrate");
        // Running again must not error and must leave the version untouched.
        run(&mut conn).expect("second migrate");
        assert_eq!(current_version(&conn).unwrap(), latest_version());
    }

    #[test]
    fn migration_creates_all_tables() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN \
                 ('content_folders','games','cores','settings','controller_bindings',\
                 'search_providers','art_cache')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 7);
    }

    #[test]
    fn games_table_has_metadata_columns() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(games)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        for c in ["year", "developer", "publisher", "aliases"] {
            assert!(cols.iter().any(|x| x == c), "missing column {c}");
        }
    }

    #[test]
    fn games_table_has_description_columns() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(games)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        for c in ["description", "wikipedia_url"] {
            assert!(cols.iter().any(|x| x == c), "missing column {c}");
        }
    }

    #[test]
    fn console_meta_table_exists() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='console_meta'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "console_meta table should exist after migration 006");
    }

    #[test]
    fn rom_site_download_providers_are_seeded() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        // v0.12: a curated set of ROM-site download providers is seeded (links only).
        let downloads: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_providers WHERE kind = 'download'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(downloads >= 6, "expected v0.11 + v0.12 download providers, got {downloads}");
        // Every download provider is a link-only https {query} template.
        let bad: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_providers WHERE kind = 'download' \
                 AND (url_template NOT LIKE 'https://%' OR url_template NOT LIKE '%{query}%')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bad, 0, "download providers must be https {{query}} links");
    }

    #[test]
    fn legal_v019_providers_are_seeded_as_https_query_links() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        // v0.19 "Reach": the vetted legal/server-rendered providers are present,
        // every one a links-only https {query} template (the no-download contract).
        for name in [
            "Steam",
            "PDRoms",
            "Demozoo",
            "Pouet",
            "Lemon Amiga",
            "Zophar's Domain",
            "ROMhacking.net",
        ] {
            let tmpl: String = conn
                .query_row(
                    "SELECT url_template FROM search_providers WHERE name = ?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| panic!("provider {name} should be seeded"));
            assert!(
                tmpl.starts_with("https://") && tmpl.contains("{query}"),
                "{name} must be an https {{query}} link, got {tmpl}"
            );
        }
    }

    #[test]
    fn games_table_has_library_life_columns_on_a_fresh_db() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(games)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        for c in ["favorite", "last_played_at", "play_count", "total_play_time_ms"] {
            assert!(cols.iter().any(|x| x == c), "missing column {c}");
        }
    }

    #[test]
    fn library_life_columns_default_correctly_on_a_fresh_row() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        conn.execute(
            "INSERT INTO content_folders (path, enabled, added_at) VALUES ('/roms', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (folder_id, path, system, clean_name, dat_matched, \
             size_bytes, added_at) VALUES (1, '/roms/a.nes', 'nes', 'A', 0, 1, 0)",
            [],
        )
        .unwrap();
        let (favorite, last_played_at, play_count, total_play_time_ms): (
            i64,
            Option<i64>,
            i64,
            i64,
        ) = conn
            .query_row(
                "SELECT favorite, last_played_at, play_count, total_play_time_ms FROM games",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(favorite, 0);
        assert_eq!(last_played_at, None);
        assert_eq!(play_count, 0);
        assert_eq!(total_play_time_ms, 0);
    }

    #[test]
    fn migration_010_applies_to_an_existing_db_without_data_loss() {
        // Simulate an upgrading user: apply only migrations 1-9, insert a real
        // row, THEN apply migration 10 — the additive-only contract must leave
        // the existing row's data untouched while adding the new columns.
        let mut conn = Connection::open_in_memory().expect("open");
        for migration in MIGRATIONS.iter().filter(|m| m.version < 10) {
            conn.execute_batch(migration.sql).expect("pre-010 migrate");
        }
        set_version(&conn, 9).unwrap();
        conn.execute(
            "INSERT INTO content_folders (path, enabled, added_at) VALUES ('/roms', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (folder_id, path, system, clean_name, dat_matched, \
             size_bytes, added_at) VALUES (1, '/roms/old.nes', 'nes', 'Old Game', 1, 4096, 100)",
            [],
        )
        .unwrap();

        run(&mut conn).expect("apply remaining migrations including 010");

        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let (clean_name, favorite, play_count): (String, i64, i64) = conn
            .query_row(
                "SELECT clean_name, favorite, play_count FROM games WHERE path = '/roms/old.nes'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(clean_name, "Old Game", "pre-existing data must survive");
        assert_eq!(favorite, 0);
        assert_eq!(play_count, 0);
    }

    /// Old and new app-support roots as they appear inside stored absolute
    /// paths (W271, v0.26.2 — see 011_repair_renamed_app_paths.sql).
    const OLD_ROOT: &str = "/Users/u/Library/Application Support/com.harmony.app";
    const NEW_ROOT: &str = "/Users/u/Library/Application Support/com.retro-game-player.app";

    /// The version migration 011 upgrades FROM (a machine that ran W269's
    /// directory move but still carries old-prefix rows).
    const PRE_REPAIR_VERSION: i64 = 10;

    /// Build a database at `PRE_REPAIR_VERSION` seeded with the exact stale
    /// state W271 repairs: old-prefix absolute paths in all four affected
    /// columns, plus already-new-prefix, unrelated-path, and NULL rows that
    /// the migration must leave untouched.
    fn seed_pre_repair_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        for migration in MIGRATIONS.iter().filter(|m| m.version <= PRE_REPAIR_VERSION) {
            conn.execute_batch(migration.sql).expect("pre-011 migrate");
        }
        set_version(&conn, PRE_REPAIR_VERSION).unwrap();
        conn.execute(
            "INSERT INTO content_folders (path, enabled, added_at) VALUES ('/roms', 1, 0)",
            [],
        )
        .unwrap();
        // games.art_path: stale, already-repaired, user-owned, and NULL rows.
        conn.execute_batch(&format!(
            "INSERT INTO games (id, folder_id, path, system, clean_name, dat_matched, \
             size_bytes, added_at, art_path) VALUES \
             (1, 1, '/roms/a.nes', 'nes', 'A', 0, 1, 0, '{OLD_ROOT}/art-cache/boxart/1.png'), \
             (2, 1, '/roms/b.nes', 'nes', 'B', 0, 1, 0, '{NEW_ROOT}/art-cache/boxart/2.png'), \
             (3, 1, '/roms/c.nes', 'nes', 'C', 0, 1, 0, '/Users/u/my-art/c.png'), \
             (4, 1, '/roms/d.nes', 'nes', 'D', 0, 1, 0, NULL);",
        ))
        .unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO art_cache (game_id, tier, path, fetched_at) VALUES \
             (1, 'boxart', '{OLD_ROOT}/art-cache/boxart/1.png', 0), \
             (2, 'title',  '{NEW_ROOT}/art-cache/title/2.png', 0);",
        ))
        .unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO console_meta (key, image_path, fetched_at) VALUES \
             ('nes',  '{OLD_ROOT}/console-art/nes.jpg', 0), \
             ('snes', NULL, 0);",
        ))
        .unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO cores (system, core_id, installed_path) VALUES \
             ('nes', 'mesen', '{OLD_ROOT}/cores/mesen_libretro.dylib'), \
             ('snes', 'snes9x', NULL);",
        ))
        .unwrap();
        conn
    }

    /// Fetch a single nullable TEXT column via the given query.
    fn text_col(conn: &Connection, query: &str) -> Option<String> {
        conn.query_row(query, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn migration_011_rewrites_old_prefix_paths_in_all_four_columns() {
        let mut conn = seed_pre_repair_db();
        run(&mut conn).expect("apply migration 011");
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        // Only the identifier segment changes; the rest of each path is
        // byte-identical (same filename, same subdirectory).
        assert_eq!(
            text_col(&conn, "SELECT art_path FROM games WHERE id = 1"),
            Some(format!("{NEW_ROOT}/art-cache/boxart/1.png")),
        );
        assert_eq!(
            text_col(&conn, "SELECT path FROM art_cache WHERE game_id = 1"),
            Some(format!("{NEW_ROOT}/art-cache/boxart/1.png")),
        );
        assert_eq!(
            text_col(&conn, "SELECT image_path FROM console_meta WHERE key = 'nes'"),
            Some(format!("{NEW_ROOT}/console-art/nes.jpg")),
        );
        assert_eq!(
            text_col(&conn, "SELECT installed_path FROM cores WHERE core_id = 'mesen'"),
            Some(format!("{NEW_ROOT}/cores/mesen_libretro.dylib")),
        );
        // Nothing still carries the old identifier segment anywhere.
        let stale: i64 = conn
            .query_row(
                "SELECT (SELECT count(*) FROM games WHERE art_path LIKE '%/com.harmony.app/%') \
                 + (SELECT count(*) FROM art_cache WHERE path LIKE '%/com.harmony.app/%') \
                 + (SELECT count(*) FROM console_meta WHERE image_path LIKE '%/com.harmony.app/%') \
                 + (SELECT count(*) FROM cores WHERE installed_path LIKE '%/com.harmony.app/%')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stale, 0, "no old-prefix paths may survive the repair");
    }

    #[test]
    fn migration_011_leaves_new_prefix_and_unrelated_paths_untouched() {
        let mut conn = seed_pre_repair_db();
        run(&mut conn).expect("apply migration 011");
        assert_eq!(
            text_col(&conn, "SELECT art_path FROM games WHERE id = 2"),
            Some(format!("{NEW_ROOT}/art-cache/boxart/2.png")),
            "already-repaired path must not be double-rewritten",
        );
        assert_eq!(
            text_col(&conn, "SELECT path FROM art_cache WHERE game_id = 2"),
            Some(format!("{NEW_ROOT}/art-cache/title/2.png")),
        );
        assert_eq!(
            text_col(&conn, "SELECT art_path FROM games WHERE id = 3"),
            Some("/Users/u/my-art/c.png".to_string()),
            "a user-owned path outside the app-support root must be untouched",
        );
    }

    #[test]
    fn migration_011_preserves_null_path_columns() {
        let mut conn = seed_pre_repair_db();
        run(&mut conn).expect("apply migration 011");
        assert_eq!(text_col(&conn, "SELECT art_path FROM games WHERE id = 4"), None);
        assert_eq!(
            text_col(&conn, "SELECT image_path FROM console_meta WHERE key = 'snes'"),
            None,
        );
        assert_eq!(
            text_col(&conn, "SELECT installed_path FROM cores WHERE core_id = 'snes9x'"),
            None,
        );
    }

    #[test]
    fn migration_011_sql_is_idempotent_when_applied_twice() {
        // The runner never re-applies a migration, but the SQL itself is also
        // idempotent (the LIKE guard skips repaired rows) — apply it twice
        // directly to prove a second pass changes nothing.
        let conn = seed_pre_repair_db();
        let repair_sql = MIGRATIONS
            .iter()
            .find(|m| m.version == 11)
            .expect("migration 011 registered")
            .sql;
        conn.execute_batch(repair_sql).expect("first apply");
        conn.execute_batch(repair_sql).expect("second apply");
        assert_eq!(
            text_col(&conn, "SELECT art_path FROM games WHERE id = 1"),
            Some(format!("{NEW_ROOT}/art-cache/boxart/1.png")),
            "a second pass must not rewrite an already-repaired path",
        );
    }

    // --- v0.31 W310: ROM-less library model (migration 012) ---

    /// Acceptance: "migration applies to a v0.30 DB". v0.30 shipped through
    /// migration 011, so seed exactly that shape (with a real ROM row), then
    /// apply the rest and confirm 012 lands cleanly.
    #[test]
    fn migration_012_applies_to_a_v0_30_shaped_db() {
        let mut conn = Connection::open_in_memory().expect("open");
        for migration in MIGRATIONS.iter().filter(|m| m.version <= 11) {
            conn.execute_batch(migration.sql).expect("pre-012 migrate");
        }
        set_version(&conn, 11).unwrap();
        conn.execute(
            "INSERT INTO content_folders (path, enabled, added_at) VALUES ('/roms', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (folder_id, path, system, clean_name, dat_matched, \
             size_bytes, added_at) VALUES (1, '/roms/old.nes', 'nes', 'Old Game', 1, 4096, 100)",
            [],
        )
        .unwrap();

        run(&mut conn).expect("apply migration 012 on a v0.30-shaped db");

        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(games)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        for c in ["source", "launch_descriptor", "external_id"] {
            assert!(cols.iter().any(|x| x == c), "missing column {c}");
        }
    }

    /// Acceptance: "and is idempotent" — re-running the full migration set a
    /// second time on an already-migrated database must not error or change
    /// the version.
    #[test]
    fn migration_012_is_idempotent() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("first migrate");
        run(&mut conn).expect("second migrate must not error");
        assert_eq!(current_version(&conn).unwrap(), latest_version());
    }

    /// Acceptance: "ROM rows untouched" — a pre-existing row's data (and its
    /// pre-v0.31 identity columns) must survive the migration byte-for-byte,
    /// and it must be tagged `source = 'rom'` by the additive default.
    #[test]
    fn migration_012_leaves_existing_rom_rows_untouched() {
        let mut conn = Connection::open_in_memory().expect("open");
        for migration in MIGRATIONS.iter().filter(|m| m.version <= 11) {
            conn.execute_batch(migration.sql).expect("pre-012 migrate");
        }
        set_version(&conn, 11).unwrap();
        conn.execute(
            "INSERT INTO content_folders (path, enabled, added_at) VALUES ('/roms', 1, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (folder_id, path, system, crc32, clean_name, dat_matched, \
             size_bytes, added_at) VALUES \
             (1, '/roms/old.nes', 'nes', 'deadbeef', 'Old Game', 1, 4096, 100)",
            [],
        )
        .unwrap();

        run(&mut conn).expect("apply migration 012");

        let (folder_id, path, system, crc32, clean_name, source, launch_descriptor, external_id): (
            i64,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT folder_id, path, system, crc32, clean_name, source, \
                 launch_descriptor, external_id FROM games WHERE path = '/roms/old.nes'",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(folder_id, 1);
        assert_eq!(path, "/roms/old.nes");
        assert_eq!(system, "nes");
        assert_eq!(crc32, "deadbeef");
        assert_eq!(clean_name, "Old Game");
        assert_eq!(source, "rom", "pre-existing rows default to source='rom'");
        assert_eq!(launch_descriptor, None);
        assert_eq!(external_id, None);
    }

    /// Acceptance: "either-rom-or-descriptor CHECK invariant enforced" — a
    /// row with neither a rom identity (`path` + `system`) nor a
    /// `launch_descriptor` must be rejected by the schema itself.
    #[test]
    fn migration_012_check_rejects_a_row_with_neither_identity() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let result = conn.execute(
            "INSERT INTO games (clean_name, added_at) VALUES ('Bad Row', 0)",
            [],
        );
        assert!(
            result.is_err(),
            "a row with no rom identity and no launch_descriptor must violate the CHECK"
        );
    }

    /// A non-ROM row (launch_descriptor set, no path/system) is the whole
    /// point of W310 — it must be accepted.
    #[test]
    fn migration_012_check_accepts_a_launch_descriptor_only_row() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        conn.execute(
            "INSERT INTO games (clean_name, added_at, source, launch_descriptor, external_id) \
             VALUES ('Portal 2', 0, 'steam', '{\"kind\":\"steam\",\"appid\":\"620\"}', '620')",
            [],
        )
        .expect("a launch_descriptor-only row must be accepted");
    }

    /// `(source, external_id)` uniqueness (the re-scan dedup key) is
    /// enforced by the schema, not just by application code.
    #[test]
    fn migration_012_enforces_source_external_id_uniqueness() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        conn.execute(
            "INSERT INTO games (clean_name, added_at, source, launch_descriptor, external_id) \
             VALUES ('Portal 2', 0, 'steam', '{}', '620')",
            [],
        )
        .unwrap();
        let dup = conn.execute(
            "INSERT INTO games (clean_name, added_at, source, launch_descriptor, external_id) \
             VALUES ('Portal 2 Dup', 0, 'steam', '{}', '620')",
            [],
        );
        assert!(dup.is_err(), "duplicate (source, external_id) must be rejected");
    }

    /// Acceptance (v0.32 W320): the `source` CHECK list is extended to accept
    /// `'gog'` and `'itch'` without disturbing the existing values.
    #[test]
    fn migration_013_check_accepts_gog_and_itch_sources() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        conn.execute(
            "INSERT INTO games (clean_name, added_at, source, launch_descriptor, external_id) \
             VALUES ('Gwent', 0, 'gog', '{\"kind\":\"app\",\"bundle_path\":\"/Applications/Gwent.app\"}', 'gog-1')",
            [],
        )
        .expect("a 'gog' source row must be accepted");
        conn.execute(
            "INSERT INTO games (clean_name, added_at, source, launch_descriptor, external_id) \
             VALUES ('Celeste', 0, 'itch', '{\"kind\":\"app\",\"bundle_path\":\"/Applications/Celeste.app\"}', 'itch-1')",
            [],
        )
        .expect("an 'itch' source row must be accepted");
    }

    /// The CHECK list is still exhaustive: an unrecognized `source` value
    /// must keep being rejected after the 013 rebuild.
    #[test]
    fn migration_013_check_still_rejects_unknown_sources() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let result = conn.execute(
            "INSERT INTO games (clean_name, added_at, source, launch_descriptor, external_id) \
             VALUES ('Bad Source', 0, 'epic', '{}', 'x')",
            [],
        );
        assert!(result.is_err(), "an unrecognized source value must violate the CHECK");
    }

    #[test]
    fn built_in_providers_are_seeded() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let n: i64 = conn
            .query_row("SELECT count(*) FROM search_providers", [], |r| r.get(0))
            .unwrap();
        assert!(n >= 4, "expected built-in providers to be seeded, got {n}");
        // v0.11: at least one download-kind provider is seeded (links only).
        let downloads: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_providers WHERE kind = 'download'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(downloads >= 2, "expected seeded download providers, got {downloads}");
        // Idempotent: re-running must not duplicate them.
        run(&mut conn).expect("re-migrate");
        let n2: i64 = conn
            .query_row("SELECT count(*) FROM search_providers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, n2);
    }

    // --- W324: FKs-on invariant holds even when a requires_fk_off migration fails ---

    /// A `requires_fk_off` migration whose SQL fails must still leave
    /// `PRAGMA foreign_keys` restored to ON — the whole point of
    /// [`ForeignKeyOffGuard`]. Drives the real [`apply`] code path (not a
    /// reimplementation) with a deliberately-broken migration appended after
    /// the real set, so the guard is exercised exactly as production would.
    #[test]
    fn foreign_keys_are_restored_when_a_requires_fk_off_migration_fails() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("apply the real migration set first");

        let broken_migration = Migration {
            version: latest_version() + 1,
            sql: "THIS IS NOT VALID SQL;",
            requires_fk_off: true,
        };
        let result = apply(&mut conn, std::slice::from_ref(&broken_migration));
        assert!(result.is_err(), "the broken migration must fail");

        let fk_state: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            fk_state, 1,
            "foreign_keys must be back ON after a requires_fk_off migration fails"
        );
    }

    /// Same failure mode, but the break happens at `tx.commit()` time rather
    /// than at `execute_batch` time — a duplicate `PRIMARY KEY` insert makes
    /// the batch itself succeed-then-fail deep inside SQLite's execution,
    /// covering a different point of the `?`-propagated early return.
    #[test]
    fn foreign_keys_are_restored_when_a_requires_fk_off_migration_batch_partially_fails() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("apply the real migration set first");

        let broken_migration = Migration {
            version: latest_version() + 1,
            sql: "CREATE TABLE w324_probe(id INTEGER PRIMARY KEY); \
                  INSERT INTO w324_probe(id) VALUES (1); \
                  INSERT INTO w324_probe(id) VALUES (1);",
            requires_fk_off: true,
        };
        let result = apply(&mut conn, std::slice::from_ref(&broken_migration));
        assert!(result.is_err(), "the duplicate-key batch must fail");

        let fk_state: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            fk_state, 1,
            "foreign_keys must be back ON even when the failure occurs mid-batch"
        );
    }

    /// The success path must, of course, also leave FKs on — guards against a
    /// change that only restores FKs on the error path.
    #[test]
    fn foreign_keys_remain_on_after_a_successful_requires_fk_off_migration() {
        let mut conn = Connection::open_in_memory().expect("open");
        run(&mut conn).expect("migrate");
        let fk_state: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk_state, 1, "foreign_keys must be ON after a clean migration run");
    }
}
