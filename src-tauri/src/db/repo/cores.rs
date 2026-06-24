//! Cores repository (W3): CRUD for `cores` plus active-core selection.
//!
//! Exactly one core may be active per system. `set_active` clears the prior
//! active core for that system and sets the new one in a single transaction; the
//! `idx_cores_one_active` partial-unique index is the database-level backstop.

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Row};

/// A core entry (`cores` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Core {
    pub id: i64,
    pub system: String,
    pub core_id: String,
    pub installed_path: Option<String>,
    pub version: Option<String>,
    pub last_modified: Option<i64>,
    pub active: bool,
}

/// New-core input (no id; assigned by SQLite).
pub struct NewCore {
    pub system: String,
    pub core_id: String,
    pub installed_path: Option<String>,
    pub version: Option<String>,
    pub last_modified: Option<i64>,
    pub active: bool,
}

/// Repository over the `cores` table.
pub struct CoresRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for CoresRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_core(row: &Row) -> rusqlite::Result<Core> {
    Ok(Core {
        id: row.get("id")?,
        system: row.get("system")?,
        core_id: row.get("core_id")?,
        installed_path: row.get("installed_path")?,
        version: row.get("version")?,
        last_modified: row.get("last_modified")?,
        active: row.get::<_, i64>("active")? != 0,
    })
}

impl CoresRepo<'_> {
    /// Insert a core, returning its assigned id. Duplicate `(system, core_id)`
    /// surfaces as a conflict.
    pub fn add(&self, core: &NewCore) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO cores (system, core_id, installed_path, version, \
                 last_modified, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    core.system,
                    core.core_id,
                    core.installed_path,
                    core.version,
                    core.last_modified,
                    core.active as i64,
                ],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a core by id (NotFound if absent).
    pub fn get(&self, id: i64) -> AppResult<Core> {
        self.db.with_conn(|c| {
            c.query_row("SELECT * FROM cores WHERE id = ?1", params![id], map_core)
                .map_err(require_found)
        })
    }

    /// List cores, optionally filtered by system. `None` lists all.
    pub fn list(&self, system: Option<&str>) -> AppResult<Vec<Core>> {
        self.db.with_conn(|c| {
            let collect = |stmt: &mut rusqlite::Statement, p: &[&dyn rusqlite::ToSql]| {
                stmt.query_map(p, map_core)
                    .map_err(map_sqlite)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(map_sqlite)
            };
            match system {
                Some(s) => {
                    let mut stmt = c
                        .prepare("SELECT * FROM cores WHERE system = ?1 ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[&s])
                }
                None => {
                    let mut stmt = c
                        .prepare("SELECT * FROM cores ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[])
                }
            }
        })
    }

    /// Record the installed dylib path/version for a core (NotFound if absent).
    pub fn set_installed(
        &self,
        id: i64,
        installed_path: Option<&str>,
        version: Option<&str>,
        last_modified: Option<i64>,
    ) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE cores SET installed_path = ?1, version = ?2, \
                     last_modified = ?3 WHERE id = ?4",
                    params![installed_path, version, last_modified, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Make `id` the active core for its system, clearing any prior active core
    /// for that system in the same transaction. NotFound if `id` is absent.
    pub fn set_active(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let system: String = c
                .query_row("SELECT system FROM cores WHERE id = ?1", params![id], |r| {
                    r.get(0)
                })
                .map_err(require_found)?;
            // SQLite connections are not Send-shared here; emulate a transaction
            // via explicit statements on the locked connection.
            c.execute_batch("BEGIN").map_err(map_sqlite)?;
            let result = (|| {
                c.execute(
                    "UPDATE cores SET active = 0 WHERE system = ?1 AND active = 1",
                    params![system],
                )
                .map_err(map_sqlite)?;
                c.execute("UPDATE cores SET active = 1 WHERE id = ?1", params![id])
                    .map_err(map_sqlite)?;
                Ok::<(), AppError>(())
            })();
            match result {
                Ok(()) => {
                    c.execute_batch("COMMIT").map_err(map_sqlite)?;
                    Ok(())
                }
                Err(e) => {
                    let _ = c.execute_batch("ROLLBACK");
                    Err(e)
                }
            }
        })
    }

    /// The active core for `system`, if any.
    pub fn get_active(&self, system: &str) -> AppResult<Option<Core>> {
        self.db.with_conn(|c| {
            let core = c
                .query_row(
                    "SELECT * FROM cores WHERE system = ?1 AND active = 1",
                    params![system],
                    map_core,
                )
                .map(Some)
                .or_else(|e| match e {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(map_sqlite(other)),
                })?;
            Ok(core)
        })
    }

    /// Delete a core (NotFound if absent).
    pub fn delete(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM cores WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core(system: &str, core_id: &str, active: bool) -> NewCore {
        NewCore {
            system: system.to_string(),
            core_id: core_id.to_string(),
            installed_path: None,
            version: None,
            last_modified: None,
            active,
        }
    }

    #[test]
    fn core_crud_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = CoresRepo::new(&db);
        let id = repo.add(&core("nes", "mesen", false)).unwrap();
        assert_eq!(repo.get(id).unwrap().core_id, "mesen");
        repo.set_installed(id, Some("/cores/mesen.dylib"), Some("1.0"), Some(42))
            .unwrap();
        let got = repo.get(id).unwrap();
        assert_eq!(got.installed_path.as_deref(), Some("/cores/mesen.dylib"));
        assert_eq!(got.version.as_deref(), Some("1.0"));
        assert_eq!(repo.list(Some("nes")).unwrap().len(), 1);
        repo.delete(id).unwrap();
        assert!(matches!(repo.get(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn duplicate_system_core_id_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = CoresRepo::new(&db);
        repo.add(&core("nes", "mesen", false)).unwrap();
        assert!(matches!(
            repo.add(&core("nes", "mesen", false)),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn set_active_clears_prior_active_for_system() {
        let db = Db::open_in_memory().unwrap();
        let repo = CoresRepo::new(&db);
        let a = repo.add(&core("nes", "mesen", false)).unwrap();
        let b = repo.add(&core("nes", "nestopia", false)).unwrap();
        repo.set_active(a).unwrap();
        assert_eq!(repo.get_active("nes").unwrap().unwrap().id, a);
        // Switching to b must clear a, satisfying the one-active partial index.
        repo.set_active(b).unwrap();
        assert_eq!(repo.get_active("nes").unwrap().unwrap().id, b);
        assert!(!repo.get(a).unwrap().active);
        assert!(repo.get(b).unwrap().active);
    }

    #[test]
    fn active_cores_are_independent_across_systems() {
        let db = Db::open_in_memory().unwrap();
        let repo = CoresRepo::new(&db);
        let nes = repo.add(&core("nes", "mesen", false)).unwrap();
        let snes = repo.add(&core("snes", "snes9x", false)).unwrap();
        repo.set_active(nes).unwrap();
        repo.set_active(snes).unwrap();
        assert!(repo.get(nes).unwrap().active);
        assert!(repo.get(snes).unwrap().active);
    }

    #[test]
    fn partial_unique_index_blocks_two_active_per_system() {
        // Direct DB-level proof the guard exists: inserting two active rows for
        // the same system without clearing must fail with a constraint conflict.
        let db = Db::open_in_memory().unwrap();
        let repo = CoresRepo::new(&db);
        repo.add(&core("nes", "mesen", true)).unwrap();
        assert!(matches!(
            repo.add(&core("nes", "nestopia", true)),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn get_active_none_when_unset() {
        let db = Db::open_in_memory().unwrap();
        let repo = CoresRepo::new(&db);
        repo.add(&core("nes", "mesen", false)).unwrap();
        assert!(repo.get_active("nes").unwrap().is_none());
    }
}
