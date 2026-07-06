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
use crate::core::retroachievements::badge_cache::BadgeCache;
use crate::core::retroachievements::cache::AchievementSetCache;
use crate::core::retroachievements::client::RetroAchievementsClient;
use crate::core::retroachievements::{achievement_set, RA_KEY_ACCOUNT};
use crate::db::repo::achievement_unlocks::AchievementUnlocksRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
use crate::play::achievements::{self as native_achievements, AchievementSystem};
use crate::play::native::NativeRuntime;
use crate::telemetry::record_recoverable_error;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Bracketed source tag every [`record_recoverable_error`] call in this
/// module reports under — mirrors the ad-hoc `"[rgp-achievements] ..."`
/// prefixes the module used before W382's telemetry pass.
const TELEMETRY_SOURCE: &str = "rgp-achievements";

/// Current time as Unix epoch seconds, defensively clamped to `0` on a
/// pre-epoch clock rather than panicking (v0.37 review note — this mirrors
/// `telemetry::now_epoch_secs`'s own guard, kept as a local copy since that
/// helper is private to its module).
fn session_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

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
            record_recoverable_error(TELEMETRY_SOURCE, format!("cache dir unavailable, skipping this session: {e}"));
            return;
        }
    };
    let cache = AchievementSetCache::new(cache_dir);
    let set = match cache.get(&hash) {
        Ok(Some(cached)) => Some(cached),
        Ok(None) => fetch_and_cache(&cache, &username, &api_key, &hash),
        Err(e) => {
            record_recoverable_error(TELEMETRY_SOURCE, format!("cache read failed, fetching fresh: {e}"));
            fetch_and_cache(&cache, &username, &api_key, &hash)
        }
    };
    let Some(set) = set else { return };
    if set.is_empty() {
        return; // a legitimate "no RA set for this game" response
    }

    let runtime_set = to_runtime_set(&hash, &set);
    if let Err(e) = runtime.load_achievement_set(runtime_set) {
        record_recoverable_error(
            TELEMETRY_SOURCE,
            format!("failed to load achievement set into the runtime: {e}"),
        );
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
                record_recoverable_error(TELEMETRY_SOURCE, format!("failed to cache fetched set: {e}"));
            }
            Some(set)
        }
        Ok(None) => None, // no RA set exists for this hash — not an error
        Err(e) => {
            record_recoverable_error(TELEMETRY_SOURCE, format!("fetch failed, continuing without achievements: {e}"));
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

/// Seam [`poll_and_persist_unlocks`] persists an unlock through — narrowed to
/// just the one call it needs (`record_unlock`) rather than the whole
/// [`AchievementUnlocksRepo`], so a test can fault-inject a persist failure
/// with a minimal stub instead of standing up a repo that can be told to
/// fail. [`AchievementUnlocksRepo`] itself implements it, unchanged.
pub trait UnlockPersister {
    fn record_unlock(&self, game_id: i64, achievement_id: u32, unlocked_at: i64) -> AppResult<()>;
}

impl UnlockPersister for AchievementUnlocksRepo<'_> {
    fn record_unlock(&self, game_id: i64, achievement_id: u32, unlocked_at: i64) -> AppResult<()> {
        AchievementUnlocksRepo::record_unlock(self, game_id, achievement_id, unlocked_at)
    }
}

/// Shared body for [`poll_achievement_unlocks`] (the real command) and the
/// test-only `poll_unlocks_at` helper (the `commands::native_play::
/// list_native_systems_at` precedent: one function, two callers, instead of
/// a duplicated loop drifting between the command and its test).
///
/// Matches each drained `event` against `set`, persists it via `persister`,
/// and collects the resulting toast. A persist failure for one event is
/// telemetry-reported and that event is skipped — it does **not** abort the
/// remaining events in the batch, so a transient DB hiccup on event N no
/// longer silently drops events N+1..end (the v0.37 review finding this item
/// closes). `now` is the caller-supplied session timestamp (real command:
/// [`session_timestamp`]; test helper: whatever the test wants), so this
/// function itself has no wall-clock dependency.
fn poll_and_persist_unlocks(
    persister: &impl UnlockPersister,
    game_id: i64,
    set: &achievement_set::AchievementSet,
    events: Vec<native_achievements::UnlockEvent>,
    now: i64,
) -> Vec<UnlockToastDto> {
    let mut toasts = Vec::new();
    for event in events {
        let Some(def) = set
            .achievements
            .iter()
            .find(|a| u32::try_from(a.id).map(|id| id == event.achievement_id).unwrap_or(false))
        else {
            continue; // an id outside the armed set — nothing to report
        };
        if let Err(e) = persister.record_unlock(game_id, event.achievement_id, now) {
            // Report and move on to the next drained event rather than
            // `?`-aborting the batch: the events already drained from the
            // runtime are gone from its queue regardless, so dropping the
            // rest of the batch on one transient DB error would silently
            // lose unlocks the player did in fact earn.
            record_recoverable_error(
                TELEMETRY_SOURCE,
                format!("failed to persist unlock for achievement {}: {e}", event.achievement_id),
            );
            continue;
        }
        toasts.push(UnlockToastDto {
            achievement_id: event.achievement_id,
            title: def.title.clone(),
            description: def.description.clone(),
            points: def.points,
            badge_name: def.badge_name.clone(),
        });
    }
    toasts
}

/// Drains every unlock the native runtime has produced since the last call,
/// records each one (idempotently — a duplicate/re-triggered id lands no
/// second row), and returns the ones actually recorded this call as
/// display-ready toasts. An empty result is the common case (no session, no
/// set armed, or nothing unlocked since the last poll) — never an error. A
/// persist failure for an individual event is reported and skipped (see
/// [`poll_and_persist_unlocks`]) rather than aborting the whole poll.
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
    let toasts = poll_and_persist_unlocks(&repo, *game_id, set, events, session_timestamp());
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

/// A path's cheap identity for hash-cache invalidation: modified-time (as
/// Unix seconds, when the platform reports one) plus file size. Either
/// changing means the file on disk is no longer the file that was hashed
/// last time, so the cached hash is stale and must be recomputed — this is
/// the simplest correct invalidation scheme available without re-reading the
/// file (a content hash would defeat the point of caching the hash), and
/// matches how e.g. `make`/browser caches key on mtime+size rather than a
/// full re-read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileFingerprint {
    modified_secs: Option<i64>,
    size_bytes: u64,
}

impl FileFingerprint {
    fn read(path: &std::path::Path) -> std::io::Result<Self> {
        let meta = std::fs::metadata(path)?;
        let modified_secs = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        Ok(Self {
            modified_secs,
            size_bytes: meta.len(),
        })
    }
}

/// In-memory path→(fingerprint, hash) cache backing [`get_achievement_summary`]
/// (v0.38 W382). Detail-page mounts call this command repeatedly for the same
/// game as the user browses back and forth; without a cache, every mount
/// re-reads and re-hashes the whole ROM file. Keyed by path with the file's
/// [`FileFingerprint`] stored alongside the hash so a ROM replaced at the same
/// path (a re-download, a re-dump) invalidates automatically rather than
/// serving a stale hash forever. Managed as Tauri app state (`app.manage`),
/// so it lives for the process lifetime — unbounded growth isn't a practical
/// concern (one entry per distinct ROM path a user has opened the detail page
/// for, not per poll).
#[derive(Default)]
pub struct RomHashCache(Mutex<HashMap<PathBuf, (FileFingerprint, String)>>);

impl RomHashCache {
    /// Returns the RA hash for `path` under `system`, reading + hashing the
    /// file only on a cache miss or a fingerprint mismatch (the file changed
    /// since it was last hashed). `None` propagates any read/hash failure
    /// exactly as the uncached path did (caller treats it as "no summary").
    fn hash_for(&self, path: &std::path::Path, system: AchievementSystem) -> Option<String> {
        let fingerprint = FileFingerprint::read(path).ok()?;
        {
            let cache = self.0.lock().unwrap_or_else(|p| p.into_inner());
            if let Some((cached_fp, cached_hash)) = cache.get(path) {
                if *cached_fp == fingerprint {
                    return Some(cached_hash.clone());
                }
            }
        }
        let rom_bytes = std::fs::read(path).ok()?;
        let hash = native_achievements::hash_rom(&rom_bytes, system).ok()?;
        let mut cache = self.0.lock().unwrap_or_else(|p| p.into_inner());
        cache.insert(path.to_path_buf(), (fingerprint, hash.clone()));
        Some(hash)
    }
}

/// Shared cache-only lookup backing both [`get_achievement_summary`] and
/// [`get_achievement_list`] (v0.38 W384): resolves `game_id` to its cached
/// [`achievement_set::AchievementSet`], or `None` the moment any link in the
/// chain is missing (no RA-supported system, no path, no hash, no cache
/// entry, or an empty set) — every one of those is a legitimate "nothing to
/// show" outcome for the detail page, never an error. Never triggers a
/// network fetch of its own; the ROM's RA hash is served from `hash_cache`
/// ([`RomHashCache`]) rather than re-read + re-hashed on every mount (v0.38
/// W382).
fn cached_set_for_game(
    game_id: i64,
    db: &Db,
    hash_cache: &RomHashCache,
) -> AppResult<Option<achievement_set::AchievementSet>> {
    let game = crate::db::repo::library::LibraryRepo::new(db).get_game(game_id)?;
    let Some(system) = game.system.as_deref().and_then(AchievementSystem::from_system_id) else {
        return Ok(None);
    };
    let Some(path) = game.path.as_deref() else {
        return Ok(None);
    };
    let Some(hash) = hash_cache.hash_for(std::path::Path::new(path), system) else {
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
    Ok(Some(set))
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
    hash_cache: tauri::State<'_, RomHashCache>,
) -> AppResult<Option<AchievementSummaryDto>> {
    let Some(set) = cached_set_for_game(game_id, &db, &hash_cache)? else {
        return Ok(None);
    };
    let unlocked = AchievementUnlocksRepo::new(&db).count_unlocked(game_id)?;
    Ok(Some(AchievementSummaryDto {
        unlocked,
        total: set.achievements.len() as u32,
    }))
}

/// One achievement entry in the detail page's full achievement list (v0.38
/// W384, retroachievements-design.md §Achievement list) — joins the cached
/// set's definition with this game's local unlock row, if any.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementListEntryDto {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub points: u32,
    pub badge_name: Option<String>,
    /// Unix epoch seconds the achievement was unlocked, or `None` if still
    /// locked.
    pub unlocked_at: Option<i64>,
}

/// Orders entries unlocked-first, then by points (retroachievements-design.md
/// §Achievement list: "ordering: unlocked first, then by points") — ties
/// within the same unlocked/locked group and points value keep the set's own
/// id order for a stable sort.
fn order_achievement_list(entries: &mut [AchievementListEntryDto]) {
    entries.sort_by(|a, b| {
        b.unlocked_at
            .is_some()
            .cmp(&a.unlocked_at.is_some())
            .then(b.points.cmp(&a.points))
            .then(a.id.cmp(&b.id))
    });
}

/// Reads the full per-game achievement list for the detail page (v0.38 W384).
/// Cache-only, exactly like [`get_achievement_summary`] (no network call is
/// ever made here) — an unconfigured account / no-cached-set answers with an
/// empty list, which the frontend treats identically to "hide the section".
#[tauri::command]
pub fn get_achievement_list(
    game_id: i64,
    db: tauri::State<'_, Db>,
    hash_cache: tauri::State<'_, RomHashCache>,
) -> AppResult<Vec<AchievementListEntryDto>> {
    let Some(set) = cached_set_for_game(game_id, &db, &hash_cache)? else {
        return Ok(Vec::new());
    };
    let unlocked: HashMap<u32, i64> = AchievementUnlocksRepo::new(&db)
        .list_unlocked(game_id)?
        .into_iter()
        .collect();

    let mut entries: Vec<AchievementListEntryDto> = set
        .achievements
        .iter()
        .map(|a| {
            let unlocked_at = u32::try_from(a.id).ok().and_then(|id| unlocked.get(&id).copied());
            AchievementListEntryDto {
                id: a.id,
                title: a.title.clone(),
                description: a.description.clone(),
                points: a.points,
                badge_name: a.badge_name.clone(),
                unlocked_at,
            }
        })
        .collect();
    order_achievement_list(&mut entries);
    Ok(entries)
}

/// Session-scoped set of badge names known to have missed on the last fetch
/// attempt (v0.38 W384: "cache the miss for the session (no retry storm)").
/// Deliberately in-memory only, reset every app relaunch — a badge that was
/// missing offline should be retried on the NEXT launch (network may be back
/// by then), just not repeatedly within the same running session.
#[derive(Default)]
pub struct BadgeMissCache(Mutex<std::collections::HashSet<String>>);

/// Seam [`resolve_badge_path`] fetches a missing badge through — narrowed to
/// just the one call it needs, mirroring [`UnlockPersister`]'s "narrow trait
/// over the real client" shape so a test can inject a scripted fetch result
/// without standing up an HTTP fixture server. [`RetroAchievementsClient`]
/// itself implements it, unchanged.
pub trait BadgeFetcher {
    fn fetch_badge(&self, badge_name: &str) -> AppResult<Option<Vec<u8>>>;
}

impl BadgeFetcher for RetroAchievementsClient {
    fn fetch_badge(&self, badge_name: &str) -> AppResult<Option<Vec<u8>>> {
        RetroAchievementsClient::fetch_badge(self, badge_name)
    }
}

/// Reads (best-effort) the on-disk path for `badge_name`'s cached badge art,
/// fetching it through the RetroAchievements client on a cache miss (v0.38
/// W384). Returns `None` — never an error — for any failure: no cache dir,
/// a fetch that 404s, a network/transport failure, or a badge name already
/// known to have missed this session (`misses`, see [`BadgeMissCache`]),
/// which short-circuits without attempting the network call again. The
/// frontend degrades to a neutral placeholder glyph whenever this resolves to
/// `None` — the achievement list renders fully without any badge art either
/// way.
#[tauri::command]
pub fn get_achievement_badge_path(badge_name: String, misses: tauri::State<'_, BadgeMissCache>) -> AppResult<Option<String>> {
    if badge_name.trim().is_empty() {
        return Ok(None);
    }
    let Ok(paths) = Paths::app_support() else {
        return Ok(None);
    };
    let Ok(cache_dir) = paths.retroachievements_badge_cache_dir() else {
        return Ok(None);
    };
    let cache = BadgeCache::new(cache_dir);
    let client = RetroAchievementsClient::new("", "");
    Ok(resolve_badge_path(&badge_name, &cache, &client, &misses))
}

/// The real body behind [`get_achievement_badge_path`], separated so it takes
/// plain references instead of `tauri::State`/a hard-coded `Paths` (this
/// crate's established "command wraps a plain-argument helper" convention —
/// see `poll_and_persist_unlocks`/`poll_achievement_unlocks` above), and lets
/// a test substitute a temp-dir-backed `cache` and a scripted `fetcher`.
fn resolve_badge_path(
    badge_name: &str,
    cache: &BadgeCache,
    fetcher: &impl BadgeFetcher,
    misses: &BadgeMissCache,
) -> Option<String> {
    {
        let missed = misses.0.lock().unwrap_or_else(|p| p.into_inner());
        if missed.contains(badge_name) {
            return None; // already known-missing this session — no retry storm
        }
    }

    if let Ok(Some(_)) = cache.get(badge_name) {
        return Some(path_to_string(cache.path_for_existing(badge_name)));
    }

    match fetcher.fetch_badge(badge_name) {
        Ok(Some(bytes)) => {
            if let Err(e) = cache.put(badge_name, &bytes) {
                record_recoverable_error(TELEMETRY_SOURCE, format!("failed to cache fetched badge: {e}"));
            }
            Some(path_to_string(cache.path_for_existing(badge_name)))
        }
        Ok(None) => {
            record_miss(misses, badge_name);
            None
        }
        Err(e) => {
            record_recoverable_error(
                TELEMETRY_SOURCE,
                format!("badge fetch failed for {badge_name}, degrading to placeholder: {e}"),
            );
            record_miss(misses, badge_name);
            None
        }
    }
}

/// Records `badge_name` as missed for the rest of this session — factored out
/// so both failure branches in [`resolve_badge_path`] share one call site.
fn record_miss(misses: &BadgeMissCache, badge_name: &str) {
    let mut missed = misses.0.lock().unwrap_or_else(|p| p.into_inner());
    missed.insert(badge_name.to_string());
}

/// `PathBuf` → `String` for the frontend's `convertFileSrc` boundary — a
/// non-UTF8 path is a practical impossibility under this app's own
/// `Paths`-rooted cache directories, but degrading to `None` rather than
/// panicking matches every other path-to-string conversion in this crate
/// (e.g. `art_cache::ArtCacheService::store_with_extension`).
fn path_to_string(path: std::path::PathBuf) -> String {
    path.to_string_lossy().into_owned()
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

    /// Reproduces `poll_achievement_unlocks`'s no-session/no-set-armed short
    /// circuit against a plain `Db` + in-memory active-set state (the real
    /// command's `State<'_, ...>` params can't be constructed outside a
    /// running `tauri::App` — see this crate's established convention for
    /// testing command bodies, e.g. `commands::native_play`'s own
    /// `list_native_systems_at`). The actual per-event matching/persistence
    /// loop is [`poll_and_persist_unlocks`] itself — shared with the real
    /// command, not duplicated here.
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
        Ok(poll_and_persist_unlocks(&repo, *game_id, set, events, session_timestamp()))
    }

    /// A [`UnlockPersister`] stub that fails on a configured set of
    /// achievement ids (once each, then succeeds on any retry) and records
    /// every id it was asked to persist — lets a test prove a mid-batch
    /// persist failure no longer drops the remaining drained events.
    #[derive(Default)]
    struct FaultInjectingPersister {
        fail_once_for: Mutex<std::collections::HashSet<u32>>,
        attempted: Mutex<Vec<u32>>,
    }

    impl FaultInjectingPersister {
        fn failing_for(ids: impl IntoIterator<Item = u32>) -> Self {
            Self {
                fail_once_for: Mutex::new(ids.into_iter().collect()),
                attempted: Mutex::new(Vec::new()),
            }
        }
    }

    impl UnlockPersister for FaultInjectingPersister {
        fn record_unlock(&self, _game_id: i64, achievement_id: u32, _unlocked_at: i64) -> AppResult<()> {
            self.attempted.lock().unwrap().push(achievement_id);
            let mut pending_failures = self.fail_once_for.lock().unwrap();
            if pending_failures.remove(&achievement_id) {
                return Err(crate::error::AppError::Db("transient failure (test)".to_string()));
            }
            Ok(())
        }
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

    /// The acceptance-critical regression test: a transient persist failure
    /// on the FIRST event of a batch must not drop the remaining events —
    /// `poll_and_persist_unlocks` must accumulate per-event results rather
    /// than `?`-aborting the whole loop the moment one persist call fails.
    #[test]
    fn a_mid_batch_persist_failure_does_not_drop_the_remaining_drained_events() {
        let set = sample_fetched_set();
        // Fail only achievement 1's persist; achievement 2 must still be
        // attempted and succeed even though it's drained in the same batch.
        let persister = FaultInjectingPersister::failing_for([1]);
        let events = vec![
            native_achievements::UnlockEvent { achievement_id: 1, frame: 1 },
            native_achievements::UnlockEvent { achievement_id: 2, frame: 2 },
        ];

        let toasts = poll_and_persist_unlocks(&persister, 7, &set, events, 100);

        // Both events were attempted (the loop didn't stop after the first
        // failure)...
        assert_eq!(*persister.attempted.lock().unwrap(), vec![1, 2]);
        // ...and the one that succeeded still produced its toast, even
        // though it came after the failing event in the batch.
        assert_eq!(toasts.len(), 1);
        assert_eq!(toasts[0].achievement_id, 2);
    }

    /// Same regression, exercised through the real `Db`-backed repo (not the
    /// stub) so the persisted-row side is covered too: a transient failure
    /// reported by `UnlockPersister` for one event must not prevent a later
    /// event in the same batch from actually landing a row.
    #[test]
    fn a_failing_first_event_still_lets_a_later_event_in_the_batch_persist() {
        let db = Db::open_in_memory().unwrap();
        let game_id = seed_game(&db);
        let set = sample_fetched_set();
        let persister = FaultInjectingPersister::failing_for([1]);
        let events = vec![
            native_achievements::UnlockEvent { achievement_id: 1, frame: 1 },
            native_achievements::UnlockEvent { achievement_id: 2, frame: 2 },
        ];

        let toasts = poll_and_persist_unlocks(&persister, game_id, &set, events, 100);
        assert_eq!(toasts.len(), 1);
        assert_eq!(toasts[0].achievement_id, 2);

        // Wire the real repo in afterward to confirm event 2 (the one after
        // the failure) is the kind of event that actually persists via the
        // shared function against a real `Db`, not just the stub.
        let repo = AchievementUnlocksRepo::new(&db);
        poll_and_persist_unlocks(
            &repo,
            game_id,
            &set,
            vec![native_achievements::UnlockEvent { achievement_id: 2, frame: 2 }],
            100,
        );
        assert_eq!(repo.count_unlocked(game_id).unwrap(), 1);
    }

    #[test]
    fn file_fingerprint_changes_when_size_changes() {
        let dir = std::env::temp_dir().join(format!("rgp-fp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rom.nes");

        std::fs::write(&path, b"short").unwrap();
        let fp1 = FileFingerprint::read(&path).unwrap();
        std::fs::write(&path, b"a much longer payload than before").unwrap();
        let fp2 = FileFingerprint::read(&path).unwrap();

        assert_ne!(fp1, fp2);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The acceptance-critical cache regression test: a second `hash_for`
    /// call for the same unchanged path must not re-read the file's
    /// contents. Proven by revoking read permission (but leaving the file's
    /// metadata/stat intact — invalidation only needs a `stat`, per
    /// `RomHashCache`'s documented mtime+size scheme) between the two calls:
    /// a working cache still returns the hash from memory; a broken
    /// (re-reading) implementation would fail to read the now-unreadable
    /// file and return `None`.
    #[test]
    fn hash_for_does_not_re_read_the_file_on_a_repeat_call() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("rgp-hashcache-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rom.nes");
        std::fs::write(&path, b"pretend-nes-rom-bytes").unwrap();

        let cache = RomHashCache::default();
        let first = cache.hash_for(&path, AchievementSystem::Nes).expect("hashes on first call");

        // Revoke read permission: `stat`/`metadata` (invalidation-check) still
        // succeeds, but `std::fs::read` (the re-hash path) would now fail —
        // so this only passes if the second call serves the cached hash
        // without falling through to a re-read.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        let second = cache.hash_for(&path, AchievementSystem::Nes);

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).ok();
        assert_eq!(second, Some(first));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hash_for_returns_none_for_a_path_that_does_not_exist() {
        let cache = RomHashCache::default();
        let missing = std::path::Path::new("/nonexistent/rgp-hashcache/rom.nes");
        assert_eq!(cache.hash_for(missing, AchievementSystem::Nes), None);
    }

    #[test]
    fn hash_for_recomputes_when_the_file_at_the_path_changes() {
        let dir = std::env::temp_dir().join(format!("rgp-hashcache-invalidate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rom.nes");

        std::fs::write(&path, b"original-rom-bytes").unwrap();
        let first = RomHashCache::default();
        let hash_a = first.hash_for(&path, AchievementSystem::Nes).unwrap();

        // Simulate the same path now holding a different ROM (re-download /
        // re-dump) — size changes, so the fingerprint must miss.
        std::fs::write(&path, b"a completely different and longer rom payload").unwrap();
        let hash_b = first.hash_for(&path, AchievementSystem::Nes).unwrap();

        assert_ne!(hash_a, hash_b, "changed file must not serve the stale cached hash");
        std::fs::remove_dir_all(&dir).ok();
    }

    fn sample_entry(id: u64, points: u32, unlocked_at: Option<i64>) -> AchievementListEntryDto {
        AchievementListEntryDto {
            id,
            title: format!("Achievement {id}"),
            description: "d".to_string(),
            points,
            badge_name: None,
            unlocked_at,
        }
    }

    #[test]
    fn order_achievement_list_puts_unlocked_before_locked() {
        let mut entries = vec![sample_entry(1, 10, None), sample_entry(2, 5, Some(100))];
        order_achievement_list(&mut entries);
        assert_eq!(entries[0].id, 2);
        assert_eq!(entries[1].id, 1);
    }

    #[test]
    fn order_achievement_list_orders_by_points_within_the_same_unlock_state() {
        let mut entries = vec![sample_entry(1, 5, None), sample_entry(2, 20, None), sample_entry(3, 10, None)];
        order_achievement_list(&mut entries);
        assert_eq!(entries.iter().map(|e| e.id).collect::<Vec<_>>(), vec![2, 3, 1]);
    }

    #[test]
    fn order_achievement_list_falls_back_to_id_for_a_stable_tie_break() {
        let mut entries = vec![sample_entry(3, 10, None), sample_entry(1, 10, None), sample_entry(2, 10, None)];
        order_achievement_list(&mut entries);
        assert_eq!(entries.iter().map(|e| e.id).collect::<Vec<_>>(), vec![1, 2, 3]);
    }

    #[test]
    fn achievement_list_entry_dto_serializes_to_camel_case() {
        let entry = sample_entry(1, 10, Some(500));
        let json = serde_json::to_string(&entry).unwrap();
        assert_eq!(
            json,
            r#"{"id":1,"title":"Achievement 1","description":"d","points":10,"badgeName":null,"unlockedAt":500}"#
        );
    }

    fn temp_badge_cache(tag: &str) -> (BadgeCache, PathBuf) {
        let dir = std::env::temp_dir().join(format!("rgp-badge-resolve-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        (BadgeCache::new(&dir), dir)
    }

    /// A [`BadgeFetcher`] stub that returns a scripted result and records
    /// every badge name it was asked to fetch, so a test can assert the
    /// network seam was (or wasn't) hit.
    struct StubFetcher {
        result: AppResult<Option<Vec<u8>>>,
        calls: Mutex<Vec<String>>,
    }

    impl StubFetcher {
        fn returning(result: AppResult<Option<Vec<u8>>>) -> Self {
            Self {
                result,
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl BadgeFetcher for StubFetcher {
        fn fetch_badge(&self, badge_name: &str) -> AppResult<Option<Vec<u8>>> {
            self.calls.lock().unwrap().push(badge_name.to_string());
            match &self.result {
                Ok(v) => Ok(v.clone()),
                Err(e) => Err(crate::error::AppError::Network(e.to_string())),
            }
        }
    }

    #[test]
    fn resolve_badge_path_fetches_and_caches_on_a_miss() {
        let (cache, dir) = temp_badge_cache("miss-then-fetch");
        let fetcher = StubFetcher::returning(Ok(Some(b"png-bytes".to_vec())));
        let misses = BadgeMissCache::default();

        let path = resolve_badge_path("111", &cache, &fetcher, &misses).expect("resolves a path");
        assert!(std::path::Path::new(&path).exists());
        assert_eq!(fetcher.calls.lock().unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_badge_path_cache_hits_without_calling_the_fetcher() {
        let (cache, dir) = temp_badge_cache("cache-hit");
        cache.put("111", b"already-cached").unwrap();
        let fetcher = StubFetcher::returning(Err(crate::error::AppError::Network("must not be called".into())));
        let misses = BadgeMissCache::default();

        let path = resolve_badge_path("111", &cache, &fetcher, &misses).expect("serves from cache");
        assert!(std::path::Path::new(&path).exists());
        assert!(fetcher.calls.lock().unwrap().is_empty(), "a cache hit must never call the fetcher");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_badge_path_degrades_to_none_on_a_missing_badge_and_records_the_miss() {
        let (cache, dir) = temp_badge_cache("missing");
        let fetcher = StubFetcher::returning(Ok(None));
        let misses = BadgeMissCache::default();

        assert_eq!(resolve_badge_path("999", &cache, &fetcher, &misses), None);
        assert!(misses.0.lock().unwrap().contains("999"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_badge_path_degrades_to_none_on_a_transport_failure_and_records_the_miss() {
        let (cache, dir) = temp_badge_cache("network-failure");
        let fetcher = StubFetcher::returning(Err(crate::error::AppError::Network("boom".into())));
        let misses = BadgeMissCache::default();

        assert_eq!(resolve_badge_path("111", &cache, &fetcher, &misses), None);
        assert!(misses.0.lock().unwrap().contains("111"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_badge_path_short_circuits_on_an_already_known_miss_without_calling_the_fetcher() {
        let (cache, dir) = temp_badge_cache("known-miss");
        let fetcher = StubFetcher::returning(Ok(Some(b"should-not-be-fetched".to_vec())));
        let misses = BadgeMissCache::default();
        misses.0.lock().unwrap().insert("111".to_string());

        assert_eq!(resolve_badge_path("111", &cache, &fetcher, &misses), None);
        assert!(
            fetcher.calls.lock().unwrap().is_empty(),
            "a known miss this session must not retry the network (no retry storm)"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
