//! Library repository (W3): CRUD for `content_folders` and `games`.
//!
//! Folders own games via a cascading FK, so deleting a folder removes its games.
//! Row shapes mirror the `ContentFolder` / `Game` TS DTOs (architecture §2).

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, Row};

/// A scanned content folder (`content_folders` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ContentFolder {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

/// A game/ROM entry (`games` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Game {
    pub id: i64,
    pub folder_id: i64,
    pub path: String,
    pub system: String,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
}

/// New-folder input (no id; assigned by SQLite).
pub struct NewContentFolder {
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

/// New-game input (no id; assigned by SQLite).
pub struct NewGame {
    pub folder_id: i64,
    pub path: String,
    pub system: String,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
}

/// Repository over the library tables.
pub struct LibraryRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for LibraryRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_folder(row: &Row) -> rusqlite::Result<ContentFolder> {
    Ok(ContentFolder {
        id: row.get("id")?,
        path: row.get("path")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        added_at: row.get("added_at")?,
    })
}

fn map_game(row: &Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        path: row.get("path")?,
        system: row.get("system")?,
        crc32: row.get("crc32")?,
        md5: row.get("md5")?,
        clean_name: row.get("clean_name")?,
        dat_matched: row.get::<_, i64>("dat_matched")? != 0,
        core_hint: row.get("core_hint")?,
        art_path: row.get("art_path")?,
        size_bytes: row.get("size_bytes")?,
        added_at: row.get("added_at")?,
    })
}

impl LibraryRepo<'_> {
    // --- content_folders ---

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

    // --- games ---

    /// Insert a game, returning its assigned id.
    pub fn add_game(&self, game: &NewGame) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO games (folder_id, path, system, crc32, md5, clean_name, \
                 dat_matched, core_hint, art_path, size_bytes, added_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    game.folder_id,
                    game.path,
                    game.system,
                    game.crc32,
                    game.md5,
                    game.clean_name,
                    game.dat_matched as i64,
                    game.core_hint,
                    game.art_path,
                    game.size_bytes,
                    game.added_at,
                ],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a game by id (NotFound if absent).
    pub fn get_game(&self, id: i64) -> AppResult<Game> {
        self.db.with_conn(|c| {
            c.query_row("SELECT * FROM games WHERE id = ?1", params![id], map_game)
                .map_err(require_found)
        })
    }

    /// List games, optionally filtered by system. `None` lists all.
    pub fn list_games(&self, system: Option<&str>) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let collect = |stmt: &mut rusqlite::Statement, p: &[&dyn rusqlite::ToSql]| {
                stmt.query_map(p, map_game)
                    .map_err(map_sqlite)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(map_sqlite)
            };
            match system {
                Some(s) => {
                    let mut stmt = c
                        .prepare("SELECT * FROM games WHERE system = ?1 ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[&s])
                }
                None => {
                    let mut stmt = c
                        .prepare("SELECT * FROM games ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[])
                }
            }
        })
    }

    /// Update a game's denormalized display art path (NotFound if absent).
    pub fn set_game_art(&self, id: i64, art_path: Option<&str>) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET art_path = ?1 WHERE id = ?2",
                    params![art_path, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Update a game's `clean_name` (W12 Familiar enrichment writes the
    /// disambiguated title here). NotFound if absent.
    pub fn set_game_clean_name(&self, id: i64, clean_name: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET clean_name = ?1 WHERE id = ?2",
                    params![clean_name, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a game (cascades to its art_cache rows). NotFound if absent.
    pub fn delete_game(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM games WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    fn folder(path: &str) -> NewContentFolder {
        NewContentFolder {
            path: path.to_string(),
            enabled: true,
            added_at: 100,
        }
    }

    fn game(folder_id: i64, path: &str) -> NewGame {
        NewGame {
            folder_id,
            path: path.to_string(),
            system: "nes".to_string(),
            crc32: Some("deadbeef".to_string()),
            md5: None,
            clean_name: "Super Game".to_string(),
            dat_matched: true,
            core_hint: Some("mesen".to_string()),
            art_path: None,
            size_bytes: 4096,
            added_at: 200,
        }
    }

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
    fn game_crud_and_cascade() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        assert_eq!(repo.get_game(gid).unwrap().clean_name, "Super Game");
        repo.set_game_art(gid, Some("/art/a.png")).unwrap();
        assert_eq!(
            repo.get_game(gid).unwrap().art_path.as_deref(),
            Some("/art/a.png")
        );
        assert_eq!(repo.list_games(Some("nes")).unwrap().len(), 1);
        assert_eq!(repo.list_games(Some("snes")).unwrap().len(), 0);
        assert_eq!(repo.list_games(None).unwrap().len(), 1);
        // Deleting the folder cascades to the game.
        repo.delete_folder(fid).unwrap();
        assert!(matches!(repo.get_game(gid), Err(AppError::NotFound(_))));
    }

    #[test]
    fn delete_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(repo.delete_game(999), Err(AppError::NotFound(_))));
    }
}
