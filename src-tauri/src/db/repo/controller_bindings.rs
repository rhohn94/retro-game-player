//! Controller-bindings repository (W3): CRUD over `controller_bindings`.
//!
//! Each `(device_family, action)` pair is unique; `set_button` upserts the button
//! for a pair. Row shape mirrors the `ControllerBinding` TS DTO (architecture §2).

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, Row};

/// A controller binding (`controller_bindings` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ControllerBinding {
    pub id: i64,
    pub device_family: String,
    pub action: String,
    pub button: String,
}

/// Repository over the `controller_bindings` table.
pub struct ControllerBindingsRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for ControllerBindingsRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_binding(row: &Row) -> rusqlite::Result<ControllerBinding> {
    Ok(ControllerBinding {
        id: row.get("id")?,
        device_family: row.get("device_family")?,
        action: row.get("action")?,
        button: row.get("button")?,
    })
}

impl ControllerBindingsRepo<'_> {
    /// Upsert the button bound to `(device_family, action)`, returning the row id.
    pub fn set_button(
        &self,
        device_family: &str,
        action: &str,
        button: &str,
    ) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO controller_bindings (device_family, action, button) \
                 VALUES (?1, ?2, ?3) \
                 ON CONFLICT(device_family, action) DO UPDATE SET button = excluded.button",
                params![device_family, action, button],
            )
            .map_err(map_sqlite)?;
            c.query_row(
                "SELECT id FROM controller_bindings WHERE device_family = ?1 AND action = ?2",
                params![device_family, action],
                |r| r.get(0),
            )
            .map_err(require_found)
        })
    }

    /// Fetch a binding by id (NotFound if absent).
    pub fn get(&self, id: i64) -> AppResult<ControllerBinding> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM controller_bindings WHERE id = ?1",
                params![id],
                map_binding,
            )
            .map_err(require_found)
        })
    }

    /// List bindings, optionally filtered by device family. `None` lists all.
    pub fn list(&self, device_family: Option<&str>) -> AppResult<Vec<ControllerBinding>> {
        self.db.with_conn(|c| {
            let collect = |stmt: &mut rusqlite::Statement, p: &[&dyn rusqlite::ToSql]| {
                stmt.query_map(p, map_binding)
                    .map_err(map_sqlite)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(map_sqlite)
            };
            match device_family {
                Some(f) => {
                    let mut stmt = c
                        .prepare(
                            "SELECT * FROM controller_bindings WHERE device_family = ?1 \
                             ORDER BY id",
                        )
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[&f])
                }
                None => {
                    let mut stmt = c
                        .prepare("SELECT * FROM controller_bindings ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[])
                }
            }
        })
    }

    /// Delete a binding by id (NotFound if absent).
    pub fn delete(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM controller_bindings WHERE id = ?1", params![id])
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
        let repo = ControllerBindingsRepo::new(&db);
        let id = repo.set_button("xbox", "confirm", "a").unwrap();
        assert_eq!(repo.get(id).unwrap().button, "a");
        // Upserting the same pair overwrites the button, keeping one row.
        let id2 = repo.set_button("xbox", "confirm", "b").unwrap();
        assert_eq!(id, id2);
        assert_eq!(repo.get(id).unwrap().button, "b");
        repo.set_button("playstation", "confirm", "cross").unwrap();
        assert_eq!(repo.list(Some("xbox")).unwrap().len(), 1);
        assert_eq!(repo.list(None).unwrap().len(), 2);
        repo.delete(id).unwrap();
        assert!(matches!(repo.get(id), Err(AppError::NotFound(_))));
    }
}
