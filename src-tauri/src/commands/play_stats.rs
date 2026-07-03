//! Library-life play-session tracking (v0.26 "library life", W264;
//! docs/design/library-life-design.md). Backs favorites, recently-played, and
//! play-time aggregates across all three play paths (in-page EmulatorJS,
//! native libretro hosting, external RetroArch).
//!
//! A session is a start/end pair keyed by an opaque `session_id`: the
//! frontend (or the external-launch glue) calls `record_play_start` when a
//! game becomes active and `record_play_end` when it stops. Duration is
//! measured server-side via [`std::time::Instant`] — the frontend clock is
//! never trusted, since it can be paused, throttled, or simply lie. A session
//! that never ends (e.g. the app crashes mid-play) is silently dropped on
//! restart, since the in-memory map isn't persisted; this only affects the
//! aggregate for that one session, which is an acceptable tradeoff noted in
//! the design doc's Open Questions.

use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::State;

/// Current Unix epoch seconds, used to stamp `last_played_at` at session end.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Tauri-free in-memory session tracker: assigns opaque session ids and
/// records each session's `(game_id, start Instant)` until it ends. Kept
/// separate from the `#[tauri::command]` wrappers below so it is
/// unit-testable without constructing Tauri `State` (mirrors the
/// `create_games_folder_inner` pattern in `commands::library`).
#[derive(Default)]
pub struct SessionTracker {
    next_id: AtomicI64,
    sessions: Mutex<HashMap<i64, (i64, Instant)>>,
}

impl SessionTracker {
    /// Start tracking a new session for `game_id`, returning its session id.
    pub fn start(&self, game_id: i64) -> i64 {
        // Ordering::Relaxed suffices: this is a monotonically-increasing local
        // counter with no other memory to synchronize — every session id only
        // needs to be distinct, never to establish a happens-before relation.
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        sessions.insert(id, (game_id, Instant::now()));
        id
    }

    /// End `session_id`, returning its `(game_id, duration_ms)` — or `None`
    /// if the session id is unknown (already ended, or never started, e.g.
    /// after a restart dropped the in-memory map). Removing the entry makes
    /// ending a session idempotent: a stray duplicate `record_play_end` call
    /// is a harmless no-op rather than double-counting play time.
    pub fn end(&self, session_id: i64) -> Option<(i64, i64)> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        let (game_id, started_at) = sessions.remove(&session_id)?;
        let duration_ms = started_at.elapsed().as_millis() as i64;
        Some((game_id, duration_ms))
    }
}

/// Holds the process-wide session tracker (managed Tauri state).
#[derive(Default)]
pub struct PlayStatsState(pub SessionTracker);

/// Starts tracking a play session for `game_id`. Called by each play path on
/// entry (in-page player mount, native session start, external RetroArch
/// spawn) — see the design doc's "Design" section for the exact hook points.
/// Returns an opaque `session_id` the caller passes back to
/// [`record_play_end`].
#[tauri::command]
pub fn record_play_start(game_id: i64, state: State<'_, PlayStatsState>) -> AppResult<i64> {
    Ok(state.0.start(game_id))
}

/// Ends `session_id`: computes its server-measured duration and persists the
/// aggregate update (`last_played_at`, `play_count`, `total_play_time_ms`) via
/// [`LibraryRepo::record_play_session`]. A no-op (not an error) if the session
/// id is unknown — the caller should never treat a stray end as fatal.
#[tauri::command]
pub fn record_play_end(
    session_id: i64,
    state: State<'_, PlayStatsState>,
    db: State<'_, Db>,
) -> AppResult<()> {
    let Some((game_id, duration_ms)) = state.0.end(session_id) else {
        return Ok(());
    };
    LibraryRepo::new(&db).record_play_session(game_id, now_epoch_secs(), duration_ms)
}

/// Sets (or clears) a game's favorite flag — the detail-page heart toggle.
#[tauri::command]
pub fn set_favorite(game_id: i64, favorite: bool, db: State<'_, Db>) -> AppResult<()> {
    LibraryRepo::new(&db).set_favorite(game_id, favorite)
}

/// The maximum `limit` accepted by [`list_recently_played`] / [`list_favorites`]
/// — a defensive ceiling against an accidental unbounded query from a bad
/// caller; every real caller today asks for a shelf-sized page (single/low
/// double digits).
const MAX_LIST_LIMIT: i64 = 500;

/// Clamp a caller-supplied list limit to `(0, MAX_LIST_LIMIT]`, defaulting a
/// non-positive value to `MAX_LIST_LIMIT` (treat "no meaningful limit given"
/// as "give me the ceiling", never an empty result).
fn clamp_limit(limit: i64) -> i64 {
    if limit <= 0 {
        MAX_LIST_LIMIT
    } else {
        limit.min(MAX_LIST_LIMIT)
    }
}

/// Lists games played at least once, most-recently-played first, for TV/home
/// "Continue playing" shelves.
#[tauri::command]
pub fn list_recently_played(
    limit: i64,
    db: State<'_, Db>,
) -> AppResult<Vec<crate::commands::library::GameDto>> {
    Ok(LibraryRepo::new(&db)
        .list_recently_played(clamp_limit(limit))?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Lists favorited games, ordered by display title.
#[tauri::command]
pub fn list_favorites(
    limit: i64,
    db: State<'_, Db>,
) -> AppResult<Vec<crate::commands::library::GameDto>> {
    Ok(LibraryRepo::new(&db)
        .list_favorites(clamp_limit(limit))?
        .into_iter()
        .map(Into::into)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_then_end_returns_the_game_id_and_a_nonnegative_duration() {
        let tracker = SessionTracker::default();
        let session_id = tracker.start(42);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let (game_id, duration_ms) = tracker.end(session_id).expect("session should be found");
        assert_eq!(game_id, 42);
        assert!(duration_ms >= 5, "expected at least 5ms, got {duration_ms}");
    }

    #[test]
    fn ending_an_unknown_session_returns_none() {
        let tracker = SessionTracker::default();
        assert!(tracker.end(999).is_none());
    }

    #[test]
    fn ending_a_session_twice_is_a_noop_the_second_time() {
        let tracker = SessionTracker::default();
        let session_id = tracker.start(7);
        assert!(tracker.end(session_id).is_some());
        assert!(
            tracker.end(session_id).is_none(),
            "a session can only be ended once"
        );
    }

    #[test]
    fn session_ids_are_distinct_across_starts() {
        let tracker = SessionTracker::default();
        let a = tracker.start(1);
        let b = tracker.start(1);
        assert_ne!(a, b);
    }

    #[test]
    fn concurrent_sessions_for_different_games_are_tracked_independently() {
        let tracker = SessionTracker::default();
        let s1 = tracker.start(1);
        let s2 = tracker.start(2);
        let (g2, _) = tracker.end(s2).unwrap();
        let (g1, _) = tracker.end(s1).unwrap();
        assert_eq!(g1, 1);
        assert_eq!(g2, 2);
    }

    #[test]
    fn clamp_limit_defaults_nonpositive_to_the_ceiling() {
        assert_eq!(clamp_limit(0), MAX_LIST_LIMIT);
        assert_eq!(clamp_limit(-5), MAX_LIST_LIMIT);
    }

    #[test]
    fn clamp_limit_passes_through_a_reasonable_value() {
        assert_eq!(clamp_limit(10), 10);
    }

    #[test]
    fn clamp_limit_caps_an_oversized_value() {
        assert_eq!(clamp_limit(MAX_LIST_LIMIT + 1000), MAX_LIST_LIMIT);
    }
}
