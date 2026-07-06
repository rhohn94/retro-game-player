//! RetroAchievements unlock experience IPC (v0.37 W372,
//! retroachievements-design.md §Unlock UX + persistence). Wires together
//! Pass 1's three landed pieces:
//!   - W370's native runtime ([`crate::play::native::NativeRuntime`]),
//!     specifically `load_achievement_set`/`drain_unlocks`.
//!   - W370's RA-correct hashing ([`crate::play::achievements::hash_rom`]).
//!   - W371's client + cache ([`crate::core::retroachievements`]).
//!
//! `start_native_play` ([`crate::commands::native_play`]) calls
//! [`arm_for_session`] once a session is up; the frontend calls
//! [`poll_achievement_unlocks`] on the same cadence it already polls frames
//! (draining unlocks, persisting each idempotently via
//! [`crate::db::repo::achievement_unlocks::AchievementUnlocksRepo`], and
//! returning display-ready DTOs for the overlay toast) and
//! [`get_achievement_summary`] once per detail-page mount for the "N of M"
//! count.
//!
//! **No credential ⇒ zero network calls, and no set loaded ⇒ every poll is a
//! cheap no-op** — [`arm_for_session`] returns early the moment either the
//! credential or the RA hash is unavailable, matching W371's own contract.

use crate::config::{paths::Paths, AppConfig};
use crate::core::familiar::keychain::{KeyStore, KeychainStore};
use crate::core::retroachievements::cache::AchievementSetCache;
use crate::core::retroachievements::client::RetroAchievementsClient;
use crate::core::retroachievements::{achievement_set, RA_KEY_ACCOUNT};
use crate::db::repo::achievement_unlocks::AchievementUnlocksRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
use crate::play::achievements::{self as native_achievements, AchievementSystem};
use crate::play::native::NativeRuntime;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Build the Keychain-backed store for the RA Web API key — mirrors
/// `commands::retroachievements::keystore` exactly (kept as its own copy
/// rather than `pub(crate)`-exposing that module's private helper, matching
/// this crate's existing per-module convention for this one-liner).
fn keystore() -> KeychainStore {
    KeychainStore::for_account(RA_KEY_ACCOUNT)
}

/// Translate a fetched [`achievement_set::AchievementSet`] (W371's richer,
/// display-carrying shape) into the trigger-only shape W370's runtime loads
/// ([`native_achievements::AchievementSet`]) — the two modules deliberately
/// don't share a struct (see each module's own doc), so this is the one
/// place that bridges them.
fn to_runtime_set(hash: &str, fetched: &achievement_set::AchievementSet) -> native_achievements::AchievementSet {
    native_achievements::AchievementSet {
        hash: hash.to_string(),
        achievements: fetched
            .achievements
            .iter()
            .filter_map(|a| {
                // RA ids fit comfortably in u32 in every real set. A
                // hypothetical id overflowing it is skipped entirely rather
                // than clamped to a sentinel (e.g. u32::MAX) — clamping two
                // distinct oversized ids would silently collide them into
                // the same runtime id, corrupting both the toast lookup and
                // unlock persistence for whichever one "wins".
                let id = u32::try_from(a.id).ok()?;
                Some(native_achievements::AchievementDefinition {
                    id,
                    title: a.title.clone(),
                    trigger: a.trigger.clone(),
                })
            })
            .collect(),
    }
}

/// Holds the currently-armed achievement set for the in-flight native
/// session, if any — the poll-time lookup [`poll_achievement_unlocks`] needs
/// to turn a bare [`native_achievements::UnlockEvent`] (just an id) back
/// into a display-ready title/description/points/badge. Reset by
/// [`arm_for_session`] every session start (mirroring
/// `NativeSession`'s own "one session at a time, replace on start"
/// contract) so a stale mapping from a previous game never survives.
#[derive(Default)]
pub struct ActiveAchievementSet(Mutex<Option<(i64, achievement_set::AchievementSet)>>);

fn lock(state: &ActiveAchievementSet) -> std::sync::MutexGuard<'_, Option<(i64, achievement_set::AchievementSet)>> {
    state.0.lock().unwrap_or_else(|p| p.into_inner())
}

/// Clears any previously-armed set — called at the top of every
/// `start_native_play` so a session that turns out to have no RA set (wrong
/// system, no credential, unrecognized hash) never leaves a stale mapping
/// from the PREVIOUS game's session reachable by [`poll_achievement_unlocks`].
pub fn disarm(state: &ActiveAchievementSet) {
    *lock(state) = None;
}

/// Best-effort: compute the RA hash for `system`/`rom_bytes`, fetch (cache-
/// first) the achievement set for it, and load it into `runtime`. Called once
/// per session start, right after [`NativeRuntime::start`] succeeds. Every
/// failure path (no credential, unsupported system, unhashable ROM, no RA
/// set for this hash, a network/cache error) leaves the session running
/// achievement-free rather than failing the boot — RetroAchievements is
/// strictly additive to a play session, never a precondition for one.
pub fn arm_for_session(
    state: &ActiveAchievementSet,
    runtime: &NativeRuntime,
    game_id: i64,
    system: &str,
    rom_bytes: &[u8],
) {
    disarm(state);
    let Some(ra_system) = AchievementSystem::from_system_id(system) else {
        return; // v0.37 scope: NES/SNES only — every other system stays inert
    };
    let Ok(paths) = Paths::app_support() else {
        return;
    };
    let Ok(config) = AppConfig::load(&paths) else {
        return;
    };
    let Some(username) = config.retroachievements_username.filter(|u| !u.trim().is_empty()) else {
        return; // no credential ⇒ zero network calls
    };
    let Ok(Some(api_key)) = keystore().get() else {
        return;
    };
    let Ok(hash) = native_achievements::hash_rom(rom_bytes, ra_system) else {
        return;
    };

    let cache_dir = match paths.retroachievements_cache_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[rgp-achievements] cache dir unavailable, skipping this session: {e}");
            return;
        }
    };
    let cache = AchievementSetCache::new(cache_dir);
    let set = match cache.get(&hash) {
        Ok(Some(cached)) => Some(cached),
        Ok(None) => fetch_and_cache(&cache, &username, &api_key, &hash),
        Err(e) => {
            eprintln!("[rgp-achievements] cache read failed, fetching fresh: {e}");
            fetch_and_cache(&cache, &username, &api_key, &hash)
        }
    };
    let Some(set) = set else { return };
    if set.is_empty() {
        return; // a legitimate "no RA set for this game" response
    }

    let runtime_set = to_runtime_set(&hash, &set);
    if let Err(e) = runtime.load_achievement_set(runtime_set) {
        eprintln!("[rgp-achievements] failed to load achievement set into the runtime: {e}");
        return;
    }
    *lock(state) = Some((game_id, set));
}

/// Fetch a fresh set from RA and persist it to the cache. `None` on any
/// failure (network, parse, unrecognized hash) — logged, never propagated,
/// matching [`arm_for_session`]'s "achievements are additive" contract.
fn fetch_and_cache(
    cache: &AchievementSetCache,
    username: &str,
    api_key: &str,
    hash: &str,
) -> Option<achievement_set::AchievementSet> {
    let client = RetroAchievementsClient::new(username, api_key);
    match client.fetch_achievement_set(hash) {
        Ok(Some(set)) => {
            if let Err(e) = cache.put(hash, &set) {
                eprintln!("[rgp-achievements] failed to cache fetched set: {e}");
            }
            Some(set)
        }
        Ok(None) => None, // no RA set exists for this hash — not an error
        Err(e) => {
            eprintln!("[rgp-achievements] fetch failed, continuing without achievements: {e}");
            None
        }
    }
}

/// One unlock event, display-ready for the overlay toast (v0.37 W372).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockToastDto {
    pub achievement_id: u32,
    pub title: String,
    pub description: String,
    pub points: u32,
    pub badge_name: Option<String>,
}

/// Drains every unlock the native runtime has produced since the last call,
/// records each one (idempotently — a duplicate/re-triggered id lands no
/// second row), and returns the ones actually recorded this call as
/// display-ready toasts. An empty result is the common case (no session, no
/// set armed, or nothing unlocked since the last poll) — never an error.
#[tauri::command]
pub fn poll_achievement_unlocks(
    db: tauri::State<'_, Db>,
    session: tauri::State<'_, crate::commands::native_play::NativeSession>,
    active_set: tauri::State<'_, ActiveAchievementSet>,
) -> AppResult<Vec<UnlockToastDto>> {
    let Some(events) = crate::commands::native_play::drain_unlocks(&session) else {
        return Ok(Vec::new());
    };
    if events.is_empty() {
        return Ok(Vec::new());
    }
    let guard = lock(&active_set);
    let Some((game_id, set)) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    let repo = AchievementUnlocksRepo::new(&db);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut toasts = Vec::new();
    for event in events {
        let Some(def) = set.achievements.iter().find(|a| {
            u32::try_from(a.id).map(|id| id == event.achievement_id).unwrap_or(false)
        }) else {
            continue; // an id outside the armed set — nothing to report
        };
        repo.record_unlock(*game_id, event.achievement_id, now)?;
        toasts.push(UnlockToastDto {
            achievement_id: event.achievement_id,
            title: def.title.clone(),
            description: def.description.clone(),
            points: def.points,
            badge_name: def.badge_name.clone(),
        });
    }
    Ok(toasts)
}

/// Achievement progress for a game's detail page: `unlocked`/`total`, or
/// `None` when RA has never resolved a set for this game (unconfigured
/// account, unsupported system, or no RA set exists) — the detail page shows
/// nothing in that case rather than a misleading "0 of 0".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementSummaryDto {
    pub unlocked: u32,
    pub total: u32,
}

/// Reads the detail-page achievement summary for `game_id`. Cache-only (no
/// network): a set is known only if it was already fetched (and cached) by
/// some previous [`arm_for_session`] call for this exact game — this command
/// never triggers a fetch of its own, so opening the detail page is always
/// instant and offline-safe.
#[tauri::command]
pub fn get_achievement_summary(
    game_id: i64,
    db: tauri::State<'_, Db>,
) -> AppResult<Option<AchievementSummaryDto>> {
    let game = crate::db::repo::library::LibraryRepo::new(&db).get_game(game_id)?;
    let Some(system) = game.system.as_deref().and_then(AchievementSystem::from_system_id) else {
        return Ok(None);
    };
    let Some(path) = game.path.as_deref() else {
        return Ok(None);
    };
    let Ok(rom_bytes) = std::fs::read(path) else {
        return Ok(None);
    };
    let Ok(hash) = native_achievements::hash_rom(&rom_bytes, system) else {
        return Ok(None);
    };
    let Ok(paths) = Paths::app_support() else {
        return Ok(None);
    };
    let Ok(cache_dir) = paths.retroachievements_cache_dir() else {
        return Ok(None);
    };
    let cache = AchievementSetCache::new(cache_dir);
    let Ok(Some(set)) = cache.get(&hash) else {
        return Ok(None);
    };
    if set.is_empty() {
        return Ok(None);
    }

    let unlocked = AchievementUnlocksRepo::new(&db).count_unlocked(game_id)?;
    Ok(Some(AchievementSummaryDto {
        unlocked,
        total: set.achievements.len() as u32,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::retroachievements::achievement_set::AchievementDefinition;

    fn sample_fetched_set() -> achievement_set::AchievementSet {
        achievement_set::AchievementSet {
            game_id: 42,
            title: "Test Game".to_string(),
            achievements: vec![
                AchievementDefinition {
                    id: 1,
                    title: "First Steps".to_string(),
                    description: "Do the thing".to_string(),
                    points: 10,
                    trigger: "0xH0010=1".to_string(),
                    badge_name: Some("111".to_string()),
                },
                AchievementDefinition {
                    id: 2,
                    title: "Second Steps".to_string(),
                    description: "Do the other thing".to_string(),
                    points: 5,
                    trigger: "0xH0011=1".to_string(),
                    badge_name: None,
                },
            ],
        }
    }

    #[test]
    fn to_runtime_set_maps_ids_titles_and_triggers_only() {
        let fetched = sample_fetched_set();
        let runtime_set = to_runtime_set("deadbeef", &fetched);

        assert_eq!(runtime_set.hash, "deadbeef");
        assert_eq!(runtime_set.achievements.len(), 2);
        assert_eq!(runtime_set.achievements[0].id, 1);
        assert_eq!(runtime_set.achievements[0].title, "First Steps");
        assert_eq!(runtime_set.achievements[0].trigger, "0xH0010=1");
        assert_eq!(runtime_set.achievements[1].id, 2);
    }

    /// A hypothetical id too large for `u32` must be skipped, never clamped
    /// to a shared sentinel — clamping two distinct oversized ids to the
    /// same value would collide them in the runtime (see `to_runtime_set`'s
    /// doc comment).
    #[test]
    fn to_runtime_set_skips_ids_that_overflow_u32_rather_than_colliding_them() {
        let fetched = achievement_set::AchievementSet {
            game_id: 1,
            title: "Overflow Game".to_string(),
            achievements: vec![
                AchievementDefinition {
                    id: u64::from(u32::MAX) + 1,
                    title: "Too Big".to_string(),
                    description: "d".to_string(),
                    points: 1,
                    trigger: "0xH0000=1".to_string(),
                    badge_name: None,
                },
                AchievementDefinition {
                    id: 5,
                    title: "Fits Fine".to_string(),
                    description: "d".to_string(),
                    points: 1,
                    trigger: "0xH0001=1".to_string(),
                    badge_name: None,
                },
            ],
        };

        let runtime_set = to_runtime_set("hash", &fetched);

        assert_eq!(runtime_set.achievements.len(), 1);
        assert_eq!(runtime_set.achievements[0].id, 5);
    }

    #[test]
    fn disarm_clears_a_previously_armed_set() {
        let state = ActiveAchievementSet::default();
        *lock(&state) = Some((1, sample_fetched_set()));
        assert!(lock(&state).is_some());

        disarm(&state);
        assert!(lock(&state).is_none());
    }

    #[test]
    fn unlock_toast_dto_serializes_to_camel_case() {
        let toast = UnlockToastDto {
            achievement_id: 7,
            title: "Speed Runner".to_string(),
            description: "Finish fast".to_string(),
            points: 25,
            badge_name: Some("999".to_string()),
        };
        let json = serde_json::to_string(&toast).unwrap();
        assert_eq!(
            json,
            r#"{"achievementId":7,"title":"Speed Runner","description":"Finish fast","points":25,"badgeName":"999"}"#
        );
    }

    #[test]
    fn achievement_summary_dto_serializes_to_camel_case() {
        let summary = AchievementSummaryDto { unlocked: 3, total: 10 };
        assert_eq!(
            serde_json::to_string(&summary).unwrap(),
            r#"{"unlocked":3,"total":10}"#
        );
    }

    /// Reproduces `poll_achievement_unlocks`'s core matching/persistence
    /// logic against a plain `Db` + in-memory active-set state (the real
    /// command's `State<'_, ...>` params can't be constructed outside a
    /// running `tauri::App` — see this crate's established convention for
    /// testing command bodies, e.g. `commands::native_play`'s own
    /// `list_native_systems_at`).
    fn poll_unlocks_at(
        db: &Db,
        active_set: &ActiveAchievementSet,
        events: Vec<native_achievements::UnlockEvent>,
    ) -> AppResult<Vec<UnlockToastDto>> {
        if events.is_empty() {
            return Ok(Vec::new());
        }
        let guard = lock(active_set);
        let Some((game_id, set)) = guard.as_ref() else {
            return Ok(Vec::new());
        };
        let repo = AchievementUnlocksRepo::new(db);
        let mut toasts = Vec::new();
        for event in events {
            let Some(def) = set
                .achievements
                .iter()
                .find(|a| u32::try_from(a.id).map(|id| id == event.achievement_id).unwrap_or(false))
            else {
                continue;
            };
            repo.record_unlock(*game_id, event.achievement_id, 100)?;
            toasts.push(UnlockToastDto {
                achievement_id: event.achievement_id,
                title: def.title.clone(),
                description: def.description.clone(),
                points: def.points,
                badge_name: def.badge_name.clone(),
            });
        }
        Ok(toasts)
    }

    fn seed_game(db: &Db) -> i64 {
        use crate::db::repo::library::{GameSource, LibraryRepo, NewContentFolder, NewGame};
        let repo = LibraryRepo::new(db);
        let folder_id = repo
            .add_folder(&NewContentFolder {
                path: "/roms".into(),
                enabled: true,
                added_at: 0,
            })
            .expect("seed folder");
        repo.add_game(&NewGame {
            folder_id: Some(folder_id),
            path: Some("/roms/game.nes".into()),
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
    fn poll_with_no_armed_set_returns_no_toasts() {
        let db = Db::open_in_memory().unwrap();
        let active_set = ActiveAchievementSet::default();
        let toasts = poll_unlocks_at(
            &db,
            &active_set,
            vec![native_achievements::UnlockEvent { achievement_id: 1, frame: 1 }],
        )
        .unwrap();
        assert!(toasts.is_empty());
    }

    #[test]
    fn poll_with_no_events_returns_no_toasts_and_touches_nothing() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let active_set = ActiveAchievementSet::default();
        *lock(&active_set) = Some((game_id, sample_fetched_set()));

        let toasts = poll_unlocks_at(&db, &active_set, vec![]).unwrap();
        assert!(toasts.is_empty());
        assert_eq!(
            AchievementUnlocksRepo::new(&db).count_unlocked(game_id).unwrap(),
            0
        );
    }

    #[test]
    fn poll_records_and_returns_a_toast_for_a_matching_unlock() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let active_set = ActiveAchievementSet::default();
        *lock(&active_set) = Some((game_id, sample_fetched_set()));

        let toasts = poll_unlocks_at(
            &db,
            &active_set,
            vec![native_achievements::UnlockEvent { achievement_id: 1, frame: 10 }],
        )
        .unwrap();

        assert_eq!(toasts.len(), 1);
        assert_eq!(toasts[0].title, "First Steps");
        assert_eq!(toasts[0].points, 10);
        assert_eq!(
            AchievementUnlocksRepo::new(&db).count_unlocked(game_id).unwrap(),
            1
        );
    }

    #[test]
    fn poll_is_idempotent_on_a_repeated_event_for_the_same_achievement() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let active_set = ActiveAchievementSet::default();
        *lock(&active_set) = Some((game_id, sample_fetched_set()));

        poll_unlocks_at(
            &db,
            &active_set,
            vec![native_achievements::UnlockEvent { achievement_id: 1, frame: 10 }],
        )
        .unwrap();
        // A stray duplicate event for the same achievement (e.g. a
        // save-state reload replaying the triggering frame).
        let second = poll_unlocks_at(
            &db,
            &active_set,
            vec![native_achievements::UnlockEvent { achievement_id: 1, frame: 11 }],
        )
        .unwrap();

        // Still returns a toast (the frontend may reasonably show it again;
        // this command doesn't suppress the SECOND toast, only the SECOND
        // row) — but the persisted count must not double.
        assert_eq!(second.len(), 1);
        assert_eq!(
            AchievementUnlocksRepo::new(&db).count_unlocked(game_id).unwrap(),
            1
        );
    }

    #[test]
    fn poll_ignores_an_event_for_an_id_outside_the_armed_set() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let active_set = ActiveAchievementSet::default();
        *lock(&active_set) = Some((game_id, sample_fetched_set()));

        let toasts = poll_unlocks_at(
            &db,
            &active_set,
            vec![native_achievements::UnlockEvent { achievement_id: 999, frame: 1 }],
        )
        .unwrap();

        assert!(toasts.is_empty());
        assert_eq!(
            AchievementUnlocksRepo::new(&db).count_unlocked(game_id).unwrap(),
            0
        );
    }
}
