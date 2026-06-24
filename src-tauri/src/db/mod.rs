//! Database handle and connection management (W3, architecture-design.md §1.2/§3).
//!
//! `Db` owns the single rusqlite [`Connection`] behind a [`Mutex`] and is stored
//! in Tauri app state. Every connection has `PRAGMA foreign_keys = ON` set so the
//! cascading FKs in the schema are enforced. Repos (see [`repo`]) borrow a locked
//! connection to run their CRUD. SQLite is single-writer, so one serialized
//! connection is the simplest correct model for a desktop app; a pool can replace
//! the `Mutex` later without changing the repo API (they take `&Connection`).

pub mod migrations;
pub mod repo;

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// macOS bundle identifier — the app-support subdirectory name (§4.1).
const BUNDLE_ID: &str = "com.harmony.app";
/// SQLite database filename under app-support (§4.1).
const DB_FILENAME: &str = "harmony.db";

/// Thread-safe handle to the application database. Stored in Tauri app state via
/// [`tauri::Manager::manage`]; repos lock [`Db::conn`] for the duration of a call.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (creating if absent) the database at `path`, enable foreign keys, and
    /// run all pending migrations. The parent directory must already exist.
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path).map_err(|e| AppError::Db(e.to_string()))?;
        Self::init(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory database (foreign keys on, migrations applied). Used by
    /// repo unit tests and any ephemeral context.
    pub fn open_in_memory() -> AppResult<Self> {
        let mut conn =
            Connection::open_in_memory().map_err(|e| AppError::Db(e.to_string()))?;
        Self::init(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Shared connection bring-up: enforce FKs, then migrate to the latest schema.
    fn init(conn: &mut Connection) -> AppResult<()> {
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| AppError::Db(e.to_string()))?;
        migrations::run(conn)?;
        Ok(())
    }

    /// Run `f` with the locked connection. Centralizes the lock so repos never
    /// touch the `Mutex` directly. A poisoned lock is reported as an internal bug.
    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let guard = self
            .conn
            .lock()
            .map_err(|e| AppError::Internal(format!("db lock poisoned: {e}")))?;
        f(&guard)
    }
}

/// Resolve the on-disk path to `harmony.db` under macOS Application Support,
/// creating the bundle directory if needed.
///
/// W4 SEAM: when W4's `config/paths.rs` resolver is merged, replace this local
/// implementation with a call to `crate::config::paths::app_support_dir()` (the
/// single authority for app-support paths, §4.1) and delete the local
/// `app_support_dir` helper below. Until then this minimal resolver keeps W3
/// unblocked. The bundle id and filename constants stay here as repo-local truth
/// only until that reconciliation.
pub fn default_db_path() -> AppResult<PathBuf> {
    let dir = app_support_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join(DB_FILENAME))
}

/// LOCAL minimal app-support resolver (W4 seam — see [`default_db_path`]).
/// Returns `~/Library/Application Support/com.harmony.app`.
fn app_support_dir() -> AppResult<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Io("HOME environment variable not set".to_string()))?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join(BUNDLE_ID))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_applies_migrations() {
        let db = Db::open_in_memory().expect("open");
        let v: i64 = db
            .with_conn(|c| {
                c.query_row("PRAGMA user_version", [], |r| r.get(0))
                    .map_err(|e| AppError::Db(e.to_string()))
            })
            .unwrap();
        assert_eq!(v, migrations::latest_version());
    }

    #[test]
    fn foreign_keys_are_enabled() {
        let db = Db::open_in_memory().expect("open");
        let on: i64 = db
            .with_conn(|c| {
                c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))
                    .map_err(|e| AppError::Db(e.to_string()))
            })
            .unwrap();
        assert_eq!(on, 1);
    }

    #[test]
    fn default_db_path_ends_with_bundle_and_filename() {
        // Drive HOME to a temp dir so the test never touches the real profile.
        let tmp = std::env::temp_dir().join("harmony_db_path_test");
        std::env::set_var("HOME", &tmp);
        let path = default_db_path().expect("resolve");
        assert!(path.ends_with("Library/Application Support/com.harmony.app/harmony.db"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
