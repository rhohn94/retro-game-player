//! RetroAchievements unlock persistence repository (v0.37 W372,
//! retroachievements-design.md §Unlock UX + persistence). One row per
//! `(game_id, achievement_id)` pair recorded by [`Repository`]'s standard
//! `Db`-backed shape; idempotency comes from migration 016's own uniqueness
//! constraint (`INSERT OR IGNORE` here, not an app-level pre-check) — the
//! same "let the constraint do the work" pattern `console_meta`'s
//! `ON CONFLICT` upsert uses.

use super::{map_sqlite, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::params;

/// Repository over the `achievement_unlocks` table.
pub struct AchievementUnlocksRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for AchievementUnlocksRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

impl AchievementUnlocksRepo<'_> {
    /// Records one unlock, idempotently: a re-trigger of an
    /// already-recorded `(game_id, achievement_id)` pair is silently a
    /// no-op (`INSERT OR IGNORE` against migration 016's primary key),
    /// never a conflict error — the native runtime's rcheevos evaluator is
    /// edge-triggered and should never re-fire, but a stray duplicate event
    /// (e.g. a save-state reload replaying the triggering frame) must not
    /// crash the persistence layer.
    pub fn record_unlock(&self, game_id: i64, achievement_id: u32, unlocked_at: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT OR IGNORE INTO achievement_unlocks (game_id, achievement_id, unlocked_at) \
                 VALUES (?1, ?2, ?3)",
                params![game_id, achievement_id, unlocked_at],
            )
            .map_err(map_sqlite)?;
            Ok(())
        })
    }

    /// Count of achievements unlocked so far for `game_id` — backs the
    /// detail page's "N of M achievements" (the `N`).
    pub fn count_unlocked(&self, game_id: i64) -> AppResult<u32> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT count(*) FROM achievement_unlocks WHERE game_id = ?1",
                params![game_id],
                |row| row.get(0),
            )
            .map_err(map_sqlite)
        })
    }

    /// Every achievement id already unlocked for `game_id` — lets a session
    /// start skip re-activating (or re-toasting) triggers the player has
    /// already earned across a previous play session.
    pub fn list_unlocked_ids(&self, game_id: i64) -> AppResult<Vec<u32>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT achievement_id FROM achievement_unlocks WHERE game_id = ?1")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![game_id], |row| row.get(0))
                .map_err(map_sqlite)?;
            rows.collect::<rusqlite::Result<Vec<u32>>>().map_err(map_sqlite)
        })
    }

    /// Every `(achievement_id, unlocked_at)` pair recorded for `game_id` —
    /// backs the v0.38 W384 detail-page achievement list, which needs the
    /// unlock timestamp per entry rather than just the bare id
    /// ([`Self::list_unlocked_ids`]).
    pub fn list_unlocked(&self, game_id: i64) -> AppResult<Vec<(u32, i64)>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT achievement_id, unlocked_at FROM achievement_unlocks WHERE game_id = ?1")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![game_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(map_sqlite)?;
            rows.collect::<rusqlite::Result<Vec<(u32, i64)>>>().map_err(map_sqlite)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::library::{GameSource, LibraryRepo, NewContentFolder, NewGame};
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Disambiguates repeated `seed_game` calls within one test (both
    /// `content_folders.path` and `games.path` are UNIQUE) so a test seeding
    /// two independent games never collides on the same path.
    static SEED_COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Seeds one real game row (the FK `achievement_unlocks.game_id`
    /// references) so tests exercise the repo against a schema-accurate
    /// fixture rather than an arbitrary integer.
    fn seed_game(db: &Db) -> i64 {
        let n = SEED_COUNTER.fetch_add(1, Ordering::Relaxed);
        let repo = LibraryRepo::new(db);
        let folder_id = repo
            .add_folder(&NewContentFolder {
                path: format!("/roms-{n}"),
                enabled: true,
                added_at: 0,
            })
            .expect("seed folder");
        repo.add_game(&NewGame {
            folder_id: Some(folder_id),
            path: Some(format!("/roms-{n}/game.nes")),
            system: Some("nes".into()),
            crc32: None,
            md5: None,
            clean_name: "Game".into(),
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 1024,
            added_at: 0,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source: GameSource::Rom,
            launch_descriptor: None,
            external_id: None,
        })
        .expect("seed game")
    }

    #[test]
    fn count_unlocked_is_zero_with_no_rows() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let repo = AchievementUnlocksRepo::new(&db);
        assert_eq!(repo.count_unlocked(game_id).unwrap(), 0);
        assert!(repo.list_unlocked_ids(game_id).unwrap().is_empty());
    }

    #[test]
    fn record_unlock_then_count_reflects_it() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let repo = AchievementUnlocksRepo::new(&db);

        repo.record_unlock(game_id, 42, 1_000).unwrap();

        assert_eq!(repo.count_unlocked(game_id).unwrap(), 1);
        assert_eq!(repo.list_unlocked_ids(game_id).unwrap(), vec![42]);
    }

    #[test]
    fn record_unlock_is_idempotent_on_re_trigger() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let repo = AchievementUnlocksRepo::new(&db);

        repo.record_unlock(game_id, 42, 1_000).unwrap();
        // A re-trigger (e.g. a stray duplicate event) must not error and
        // must not create a second row.
        repo.record_unlock(game_id, 42, 2_000).unwrap();

        assert_eq!(repo.count_unlocked(game_id).unwrap(), 1);
    }

    #[test]
    fn list_unlocked_returns_ids_with_their_timestamps() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let repo = AchievementUnlocksRepo::new(&db);

        repo.record_unlock(game_id, 7, 1_500).unwrap();
        repo.record_unlock(game_id, 3, 2_500).unwrap();

        let mut unlocked = repo.list_unlocked(game_id).unwrap();
        unlocked.sort_by_key(|(id, _)| *id);
        assert_eq!(unlocked, vec![(3, 2_500), (7, 1_500)]);
    }

    #[test]
    fn list_unlocked_is_empty_with_no_rows() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let repo = AchievementUnlocksRepo::new(&db);
        assert!(repo.list_unlocked(game_id).unwrap().is_empty());
    }

    #[test]
    fn different_games_track_independent_unlock_counts() {
        let db = Db::open_in_memory().unwrap();
        let game_a = seed_game(&db);
        let game_b = seed_game(&db);
        let repo = AchievementUnlocksRepo::new(&db);

        repo.record_unlock(game_a, 1, 0).unwrap();
        repo.record_unlock(game_a, 2, 0).unwrap();
        repo.record_unlock(game_b, 1, 0).unwrap();

        assert_eq!(repo.count_unlocked(game_a).unwrap(), 2);
        assert_eq!(repo.count_unlocked(game_b).unwrap(), 1);
    }
}
