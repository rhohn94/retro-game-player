//! On-disk art cache manager.
//!
//! Bridges the CDN client and the art_cache SQLite repo. Responsibilities:
//!   - Determine the on-disk file path for a game/tier entry under `art-cache/`.
//!   - Write fetched PNG bytes to disk (idempotent).
//!   - Persist the entry via [`crate::db::repo::art_cache::ArtCacheRepo`].
//!   - Update `games.art_path` via [`crate::db::repo::library::LibraryRepo`] so
//!     the grid can read it without joining art_cache.
//!   - Return the highest-tier cached path for a game (read path).
//!
//! The DB tier key values are defined in [`super::cdn_client::ArtTier::db_key`].

use crate::config::paths::Paths;
use crate::db::repo::art_cache::ArtCacheRepo;
use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tier priority order — highest display priority first.
///
/// Used when selecting the best cached tier to surface as `games.art_path`.
const TIER_PRIORITY: &[&str] = &["boxart", "title", "snap"];

/// Art cache service. Wraps the repo layer and manages on-disk files.
pub struct ArtCacheService<'a> {
    db: &'a Db,
    paths: &'a Paths,
}

impl<'a> ArtCacheService<'a> {
    /// Construct the service over a borrowed DB handle and path resolver.
    pub fn new(db: &'a Db, paths: &'a Paths) -> Self {
        Self { db, paths }
    }

    /// Return the highest-priority cached art path for `game_id`, or `None` if
    /// nothing has been fetched yet.
    pub fn best_cached_path(&self, game_id: i64) -> AppResult<Option<String>> {
        let repo = ArtCacheRepo::new(self.db);
        let entries = repo.list_for_game(game_id)?;
        for tier_key in TIER_PRIORITY {
            if let Some(e) = entries.iter().find(|e| e.tier == *tier_key) {
                return Ok(Some(e.path.clone()));
            }
        }
        Ok(None)
    }

    /// Persist a downloaded art image for `(game_id, tier_key)` under the
    /// `art-cache/<system>/<clean_name>.png` layout.
    ///
    /// Steps:
    /// 1. Compute on-disk path (`art_cache_dir/<system>/<sanitized_name>_<tier>.png`).
    /// 2. Write `bytes` to disk (creates parent dir if needed).
    /// 3. Upsert the `art_cache` row.
    /// 4. If this is the highest-priority tier fetched so far, update `games.art_path`.
    ///
    /// Returns the on-disk path as a `String`.
    pub fn store(
        &self,
        game_id: i64,
        system: &str,
        sanitized_name: &str,
        tier_key: &str,
        bytes: &[u8],
    ) -> AppResult<String> {
        let art_dir = self.paths.art_cache_dir()?.join(system);
        std::fs::create_dir_all(&art_dir)?;

        let filename = format!("{}_{}.png", sanitized_name, tier_key);
        let on_disk: PathBuf = art_dir.join(&filename);
        std::fs::write(&on_disk, bytes)?;

        let path_str = on_disk
            .to_str()
            .ok_or_else(|| AppError::Internal("art path is not valid UTF-8".to_string()))?
            .to_string();

        let now = epoch_secs();
        let art_repo = ArtCacheRepo::new(self.db);
        art_repo.upsert(game_id, tier_key, &path_str, now)?;

        // Update games.art_path to the best available tier.
        if let Ok(Some(best)) = self.best_cached_path(game_id) {
            let lib_repo = LibraryRepo::new(self.db);
            lib_repo.set_game_art(game_id, Some(&best))?;
        }

        Ok(path_str)
    }
}

/// Current Unix epoch in seconds.
fn epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::library::{LibraryRepo, NewContentFolder, NewGame};

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
            path: "/roms/mario.nes".into(),
            system: "nes".into(),
            crc32: None,
            md5: None,
            clean_name: "Super Mario Bros.".into(),
            dat_matched: true,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: 1,
        })
        .unwrap()
    }

    #[test]
    fn store_persists_and_updates_art_path() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);

        let svc = ArtCacheService::new(&db, &paths);
        let path = svc
            .store(game_id, "nes", "Super_Mario_Bros.", "boxart", b"PNG_BYTES")
            .unwrap();

        // File exists on disk.
        assert!(std::path::Path::new(&path).exists());

        // art_cache row present.
        let entries = ArtCacheRepo::new(&db).list_for_game(game_id).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tier, "boxart");

        // games.art_path updated.
        let game = LibraryRepo::new(&db).get_game(game_id).unwrap();
        assert_eq!(game.art_path.as_deref(), Some(path.as_str()));
    }

    #[test]
    fn best_cached_path_prefers_boxart_over_snap() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);

        let svc = ArtCacheService::new(&db, &paths);
        svc.store(game_id, "nes", "Game", "snap", b"snap").unwrap();
        let snap_best = svc.best_cached_path(game_id).unwrap();
        assert!(snap_best.unwrap().contains("snap"));

        svc.store(game_id, "nes", "Game", "boxart", b"boxart")
            .unwrap();
        let best = svc.best_cached_path(game_id).unwrap();
        assert!(best.unwrap().contains("boxart"));
    }

    #[test]
    fn best_cached_path_returns_none_when_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);

        let svc = ArtCacheService::new(&db, &paths);
        assert!(svc.best_cached_path(game_id).unwrap().is_none());
    }
}
