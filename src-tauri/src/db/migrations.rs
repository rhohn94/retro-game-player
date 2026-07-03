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
}

/// The ordered migration set shipped with this build. Append new entries with
/// strictly increasing `version`; never edit a released migration's `sql`.
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: include_str!("migrations/001_init.sql"),
    },
    Migration {
        version: 2,
        sql: include_str!("migrations/002_game_metadata.sql"),
    },
    Migration {
        version: 3,
        sql: include_str!("migrations/003_seed_search_providers.sql"),
    },
    Migration {
        version: 4,
        sql: include_str!("migrations/004_search_provider_kind.sql"),
    },
    Migration {
        version: 5,
        sql: include_str!("migrations/005_game_description_and_rom_providers.sql"),
    },
    Migration {
        version: 6,
        sql: include_str!("migrations/006_console_meta.sql"),
    },
    Migration {
        version: 7,
        sql: include_str!("migrations/007_search_provider_direct_download.sql"),
    },
    Migration {
        version: 8,
        sql: include_str!("migrations/008_search_provider_compose_filters.sql"),
    },
    Migration {
        version: 9,
        sql: include_str!("migrations/009_seed_legal_search_providers.sql"),
    },
    Migration {
        version: 10,
        sql: include_str!("migrations/010_library_life.sql"),
    },
    Migration {
        version: 11,
        sql: include_str!("migrations/011_repair_renamed_app_paths.sql"),
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

/// Apply every pending migration in order. Idempotent: migrations at or below
/// the stored `user_version` are skipped, so a second call does nothing and the
/// version is unchanged. Each migration runs in its own transaction so a failure
/// leaves the database at the last good version.
pub fn run(conn: &mut Connection) -> AppResult<()> {
    let mut version = current_version(conn)?;
    for migration in MIGRATIONS {
        if migration.version <= version {
            continue;
        }
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.execute_batch(migration.sql)
            .map_err(|e| AppError::Db(e.to_string()))?;
        tx.commit().map_err(|e| AppError::Db(e.to_string()))?;
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
}
