//! Art-cache repository (W3): CRUD over `art_cache`.
//!
//! Each `(game_id, tier)` pair is unique; `upsert` records or refreshes the
//! cached file for a tier. Rows cascade-delete with their game (FK). The blur
//! pipeline (W10) and art fallback (W8) read this per-tier cache.

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, Row};

/// A cached art entry (`art_cache` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ArtCacheEntry {
    pub id: i64,
    pub game_id: i64,
    pub tier: String,
    pub path: String,
    pub fetched_at: i64,
}

/// Repository over the `art_cache` table.
pub struct ArtCacheRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for ArtCacheRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_entry(row: &Row) -> rusqlite::Result<ArtCacheEntry> {
    Ok(ArtCacheEntry {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        tier: row.get("tier")?,
        path: row.get("path")?,
        fetched_at: row.get("fetched_at")?,
    })
}

impl ArtCacheRepo<'_> {
    /// Insert or refresh the cached file for `(game_id, tier)`, returning its id.
    pub fn upsert(
        &self,
        game_id: i64,
        tier: &str,
        path: &str,
        fetched_at: i64,
    ) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO art_cache (game_id, tier, path, fetched_at) \
                 VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(game_id, tier) DO UPDATE SET \
                 path = excluded.path, fetched_at = excluded.fetched_at",
                params![game_id, tier, path, fetched_at],
            )
            .map_err(map_sqlite)?;
            c.query_row(
                "SELECT id FROM art_cache WHERE game_id = ?1 AND tier = ?2",
                params![game_id, tier],
                |r| r.get(0),
            )
            .map_err(require_found)
        })
    }

    /// Fetch a cache entry by id (NotFound if absent).
    pub fn get(&self, id: i64) -> AppResult<ArtCacheEntry> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM art_cache WHERE id = ?1",
                params![id],
                map_entry,
            )
            .map_err(require_found)
        })
    }

    /// All cache entries for a game, ordered by tier.
    pub fn list_for_game(&self, game_id: i64) -> AppResult<Vec<ArtCacheEntry>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT * FROM art_cache WHERE game_id = ?1 ORDER BY tier")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![game_id], map_entry)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Delete a cache entry by id (NotFound if absent).
    pub fn delete(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM art_cache WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::library::{LibraryRepo, NewContentFolder, NewGame};
    use crate::error::AppError;

    fn seed_game(db: &Db) -> i64 {
        let lib = LibraryRepo::new(db);
        let fid = lib
            .add_folder(&NewContentFolder {
                path: "/roms".into(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();
        lib.add_game(&NewGame {
            folder_id: fid,
            path: "/roms/a.nes".into(),
            system: "nes".into(),
            crc32: None,
            md5: None,
            clean_name: "A".into(),
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: 1,
        })
        .unwrap()
    }

    #[test]
    fn upsert_get_list_delete() {
        let db = Db::open_in_memory().unwrap();
        let gid = seed_game(&db);
        let repo = ArtCacheRepo::new(&db);
        let id = repo.upsert(gid, "boxart", "/art/box.png", 10).unwrap();
        assert_eq!(repo.get(id).unwrap().path, "/art/box.png");
        // Upserting the same tier refreshes path/time, keeping one row.
        let id2 = repo.upsert(gid, "boxart", "/art/box2.png", 20).unwrap();
        assert_eq!(id, id2);
        assert_eq!(repo.get(id).unwrap().path, "/art/box2.png");
        repo.upsert(gid, "snap", "/art/snap.png", 30).unwrap();
        assert_eq!(repo.list_for_game(gid).unwrap().len(), 2);
        repo.delete(id).unwrap();
        assert!(matches!(repo.get(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn deleting_game_cascades_to_art_cache() {
        let db = Db::open_in_memory().unwrap();
        let gid = seed_game(&db);
        let repo = ArtCacheRepo::new(&db);
        repo.upsert(gid, "boxart", "/art/box.png", 10).unwrap();
        LibraryRepo::new(&db).delete_game(gid).unwrap();
        assert!(repo.list_for_game(gid).unwrap().is_empty());
    }
}
