//! Settings repository (W3): key/value CRUD over the `settings` table.
//!
//! Values are opaque strings here (JSON-encoded scalars, typed in `core/settings`
//! by W4/W15). `set` is an upsert so callers need not check existence first.

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::params;

/// Repository over the `settings` key/value table.
pub struct SettingsRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for SettingsRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

impl SettingsRepo<'_> {
    /// Upsert a setting (insert or replace the value for `key`).
    pub fn set(&self, key: &str, value: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(map_sqlite)?;
            Ok(())
        })
    }

    /// Fetch a setting value by key (NotFound if absent).
    pub fn get(&self, key: &str) -> AppResult<String> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .map_err(require_found)
        })
    }

    /// All settings as `(key, value)` pairs ordered by key.
    pub fn list(&self) -> AppResult<Vec<(String, String)>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT key, value FROM settings ORDER BY key")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Delete a setting by key (NotFound if absent).
    pub fn delete(&self, key: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM settings WHERE key = ?1", params![key])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    #[test]
    fn upsert_get_list_delete() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepo::new(&db);
        repo.set("retroarch_path", "\"/Applications/RetroArch.app\"")
            .unwrap();
        assert_eq!(
            repo.get("retroarch_path").unwrap(),
            "\"/Applications/RetroArch.app\""
        );
        // Upsert overwrites rather than conflicting.
        repo.set("retroarch_path", "\"/usr/local/bin/retroarch\"")
            .unwrap();
        assert_eq!(repo.get("retroarch_path").unwrap(), "\"/usr/local/bin/retroarch\"");
        repo.set("theme", "\"dark\"").unwrap();
        assert_eq!(repo.list().unwrap().len(), 2);
        repo.delete("theme").unwrap();
        assert!(matches!(repo.get("theme"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn delete_missing_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = SettingsRepo::new(&db);
        assert!(matches!(repo.delete("nope"), Err(AppError::NotFound(_))));
    }
}
