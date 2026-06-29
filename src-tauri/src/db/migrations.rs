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
