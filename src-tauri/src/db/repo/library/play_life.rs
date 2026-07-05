//! "Library life" queries (v0.26 W264, query-domain submodule of
//! [`super::LibraryRepo`]): favoriting and play-session recency/counts.

use super::model::{map_game, Game};
use super::LibraryRepo;
use crate::db::repo::{map_sqlite, require_affected};
use crate::error::AppResult;
use rusqlite::params;

impl LibraryRepo<'_> {
    /// Set (or clear) a game's favorite flag (v0.26 "library life", W264).
    /// NotFound if absent.
    pub fn set_favorite(&self, id: i64, favorite: bool) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET favorite = ?1 WHERE id = ?2",
                    params![favorite as i64, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Record the end of a completed play session (v0.26 "library life",
    /// W264): sets `last_played_at` to `ended_at` (Unix epoch seconds),
    /// increments `play_count`, and accumulates `duration_ms` into
    /// `total_play_time_ms`. Called once per session, after the session's
    /// server-measured duration is known (never a frontend-supplied clock —
    /// see `commands::play_stats`). NotFound if the game is absent.
    pub fn record_play_session(&self, id: i64, ended_at: i64, duration_ms: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET \
                     last_played_at = ?1, \
                     play_count = play_count + 1, \
                     total_play_time_ms = total_play_time_ms + ?2 \
                     WHERE id = ?3",
                    params![ended_at, duration_ms, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// List games that have been played at least once, most-recently-played
    /// first (v0.26 "library life", W264). Games with a `NULL` last-played
    /// timestamp are never played and are excluded rather than sorted last —
    /// callers wanting "never played" games use `list_games` instead.
    pub fn list_recently_played(&self, limit: i64) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare(
                    "SELECT * FROM games WHERE last_played_at IS NOT NULL \
                     ORDER BY last_played_at DESC LIMIT ?1",
                )
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![limit], map_game)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// List favorited games, ordered by display title (v0.26 "library life",
    /// W264).
    pub fn list_favorites(&self, limit: i64) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare(
                    "SELECT * FROM games WHERE favorite = 1 \
                     ORDER BY clean_name COLLATE NOCASE LIMIT ?1",
                )
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![limit], map_game)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::db::repo::library::test_support::{folder, game};
    use crate::db::repo::library::LibraryRepo;
    use crate::db::repo::Repository;
    use crate::db::Db;
    use crate::error::AppError;

    #[test]
    fn a_scanned_game_starts_with_library_life_defaults() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/fresh.nes")).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert!(!got.favorite);
        assert_eq!(got.last_played_at, None);
        assert_eq!(got.play_count, 0);
        assert_eq!(got.total_play_time_ms, 0);
    }

    #[test]
    fn favorite_toggle_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/fav.nes")).unwrap();
        assert!(!repo.get_game(gid).unwrap().favorite);
        repo.set_favorite(gid, true).unwrap();
        assert!(repo.get_game(gid).unwrap().favorite);
        repo.set_favorite(gid, false).unwrap();
        assert!(!repo.get_game(gid).unwrap().favorite);
    }

    #[test]
    fn set_favorite_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.set_favorite(999, true),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn record_play_session_updates_recency_count_and_duration() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/play.nes")).unwrap();

        repo.record_play_session(gid, 1_000, 5_000).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert_eq!(got.last_played_at, Some(1_000));
        assert_eq!(got.play_count, 1);
        assert_eq!(got.total_play_time_ms, 5_000);

        // A second session accumulates rather than replacing.
        repo.record_play_session(gid, 2_000, 3_000).unwrap();
        let got2 = repo.get_game(gid).unwrap();
        assert_eq!(got2.last_played_at, Some(2_000));
        assert_eq!(got2.play_count, 2);
        assert_eq!(got2.total_play_time_ms, 8_000);
    }

    #[test]
    fn record_play_session_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.record_play_session(999, 1, 1),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn list_recently_played_orders_by_last_played_desc_and_excludes_unplayed() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let never = repo.add_game(&game(fid, "/roms/never.nes")).unwrap();
        let older = repo.add_game(&game(fid, "/roms/older.nes")).unwrap();
        let newer = repo.add_game(&game(fid, "/roms/newer.nes")).unwrap();

        repo.record_play_session(older, 100, 1).unwrap();
        repo.record_play_session(newer, 200, 1).unwrap();

        let recent = repo.list_recently_played(10).unwrap();
        let ids: Vec<i64> = recent.iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![newer, older], "most-recent first");
        assert!(!ids.contains(&never), "never-played games are excluded");
    }

    #[test]
    fn list_recently_played_respects_limit() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        for i in 0..5 {
            let gid = repo
                .add_game(&game(fid, &format!("/roms/g{i}.nes")))
                .unwrap();
            repo.record_play_session(gid, 100 + i, 1).unwrap();
        }
        assert_eq!(repo.list_recently_played(2).unwrap().len(), 2);
    }

    #[test]
    fn list_favorites_orders_by_clean_name_and_excludes_non_favorites() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();

        let mut zelda = game(fid, "/roms/zelda.nes");
        zelda.clean_name = "Zelda".to_string();
        let zelda_id = repo.add_game(&zelda).unwrap();

        let mut mario = game(fid, "/roms/mario.nes");
        mario.clean_name = "Mario".to_string();
        let mario_id = repo.add_game(&mario).unwrap();

        let not_fav = repo.add_game(&game(fid, "/roms/other.nes")).unwrap();

        repo.set_favorite(zelda_id, true).unwrap();
        repo.set_favorite(mario_id, true).unwrap();

        let favorites = repo.list_favorites(10).unwrap();
        let ids: Vec<i64> = favorites.iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![mario_id, zelda_id], "alphabetical by clean_name");
        assert!(!ids.contains(&not_fav));
    }
}
