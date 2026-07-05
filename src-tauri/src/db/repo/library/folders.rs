//! `content_folders` CRUD (query-domain submodule of [`super::LibraryRepo`]).

use super::model::{map_folder, ContentFolder, NewContentFolder};
use super::LibraryRepo;
use crate::db::repo::{map_sqlite, require_affected, require_found};
use crate::error::AppResult;
use rusqlite::{params, OptionalExtension};

impl LibraryRepo<'_> {
    /// Insert a content folder, returning its assigned id.
    pub fn add_folder(&self, folder: &NewContentFolder) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO content_folders (path, enabled, added_at) VALUES (?1, ?2, ?3)",
                params![folder.path, folder.enabled as i64, folder.added_at],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a folder by id (NotFound if absent).
    pub fn get_folder(&self, id: i64) -> AppResult<ContentFolder> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM content_folders WHERE id = ?1",
                params![id],
                map_folder,
            )
            .map_err(require_found)
        })
    }

    /// Fetch a folder by its exact path, or `None` if not registered. Uses the
    /// `content_folders.path` UNIQUE index — O(log n), not a full scan.
    pub fn get_folder_by_path(&self, path: &str) -> AppResult<Option<ContentFolder>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM content_folders WHERE path = ?1",
                params![path],
                map_folder,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// List all folders ordered by id.
    pub fn list_folders(&self) -> AppResult<Vec<ContentFolder>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT * FROM content_folders ORDER BY id")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], map_folder)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Toggle a folder's enabled flag (NotFound if absent).
    pub fn set_folder_enabled(&self, id: i64, enabled: bool) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE content_folders SET enabled = ?1 WHERE id = ?2",
                    params![enabled as i64, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a folder (cascades to its games). NotFound if absent.
    pub fn delete_folder(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM content_folders WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::db::repo::library::test_support::folder;
    use crate::db::repo::library::LibraryRepo;
    use crate::db::repo::Repository;
    use crate::db::Db;
    use crate::error::AppError;

    #[test]
    fn folder_crud_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let id = repo.add_folder(&folder("/roms")).unwrap();
        let got = repo.get_folder(id).unwrap();
        assert_eq!(got.path, "/roms");
        assert!(got.enabled);
        repo.set_folder_enabled(id, false).unwrap();
        assert!(!repo.get_folder(id).unwrap().enabled);
        assert_eq!(repo.list_folders().unwrap().len(), 1);
        repo.delete_folder(id).unwrap();
        assert!(matches!(repo.get_folder(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn duplicate_folder_path_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        repo.add_folder(&folder("/roms")).unwrap();
        assert!(matches!(
            repo.add_folder(&folder("/roms")),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn lookup_folder_by_path() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        assert_eq!(repo.get_folder_by_path("/roms").unwrap().unwrap().id, fid);
        assert!(repo.get_folder_by_path("/nope").unwrap().is_none());
    }
}
