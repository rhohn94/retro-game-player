//! Bounded on-disk cache of fetched [`AchievementSet`]s, keyed by RA ROM
//! hash (v0.37 W371, retroachievements-design.md §Client + accounts: "Set
//! fetch … cached on disk under app-support keyed by hash (bounded, JSON)").
//!
//! One JSON file per hash under `Paths::retroachievements_cache_dir()` —
//! mirroring `core::metadata::art_cache`'s "one file per identity" layout,
//! but file-backed rather than SQLite-backed since a set is a single small
//! JSON blob with no relational structure worth a table. "Bounded" here means
//! one entry per hash (an unconditional overwrite on re-fetch), not an
//! unbounded append log — there is nothing to prune since the file count is
//! naturally capped at one per distinct game hash ever played.

use super::achievement_set::AchievementSet;
use crate::error::AppResult;
use std::path::PathBuf;

/// Disk-backed cache for [`AchievementSet`]s, rooted at a cache directory
/// (normally `Paths::retroachievements_cache_dir()`).
pub struct AchievementSetCache {
    dir: PathBuf,
}

impl AchievementSetCache {
    /// Build a cache rooted at `dir` (created by the caller — mirrors every
    /// other `Paths::*_dir()` accessor's "ensures it exists" contract).
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The on-disk file path for `hash` — not required to exist.
    fn path_for(&self, hash: &str) -> PathBuf {
        self.dir.join(format!("{}.json", sanitize_hash(hash)))
    }

    /// Read a cached set for `hash`, or `None` if never fetched (a cache
    /// miss is not an error).
    pub fn get(&self, hash: &str) -> AppResult<Option<AchievementSet>> {
        let path = self.path_for(hash);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(&path)?;
        let set: AchievementSet = serde_json::from_slice(&bytes)?;
        Ok(Some(set))
    }

    /// Persist (overwrite) the cached set for `hash`.
    pub fn put(&self, hash: &str, set: &AchievementSet) -> AppResult<()> {
        let path = self.path_for(hash);
        let json = serde_json::to_vec_pretty(set)?;
        std::fs::write(&path, json)?;
        Ok(())
    }
}

/// A RA hash is already a plain hex/alnum string in practice, but any
/// path-hostile character is defensively swapped for `_` so a malformed hash
/// can never escape the cache directory or collide with a reserved filename.
fn sanitize_hash(hash: &str) -> String {
    hash.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::retroachievements::achievement_set::AchievementDefinition;

    fn temp_dir(tag: &str) -> (PathBuf, PathBuf) {
        let tmp = std::env::temp_dir().join(format!("rgp-ra-cache-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).expect("create tmp dir");
        (tmp.clone(), tmp)
    }

    fn sample_set() -> AchievementSet {
        AchievementSet {
            game_id: 42,
            title: "Test Game".to_string(),
            achievements: vec![AchievementDefinition {
                id: 1,
                title: "First".to_string(),
                description: "d".to_string(),
                points: 5,
                trigger: "0xH0001=1".to_string(),
                badge_name: None,
            }],
        }
    }

    #[test]
    fn get_on_a_miss_returns_none() {
        let (dir, tmp) = temp_dir("miss");
        let cache = AchievementSetCache::new(dir);
        assert_eq!(cache.get("deadbeef").unwrap(), None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn put_then_get_round_trips() {
        let (dir, tmp) = temp_dir("roundtrip");
        let cache = AchievementSetCache::new(dir);
        let set = sample_set();
        cache.put("deadbeef", &set).expect("put");

        let loaded = cache.get("deadbeef").expect("get").expect("present");
        assert_eq!(loaded, set);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn put_overwrites_an_existing_entry() {
        let (dir, tmp) = temp_dir("overwrite");
        let cache = AchievementSetCache::new(dir);
        cache.put("deadbeef", &sample_set()).expect("put first");

        let mut updated = sample_set();
        updated.title = "Updated Title".to_string();
        cache.put("deadbeef", &updated).expect("put second");

        let loaded = cache.get("deadbeef").expect("get").expect("present");
        assert_eq!(loaded.title, "Updated Title");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn different_hashes_are_independent_entries() {
        let (dir, tmp) = temp_dir("independent");
        let cache = AchievementSetCache::new(dir);
        let mut set_b = sample_set();
        set_b.game_id = 99;

        cache.put("hash-a", &sample_set()).expect("put a");
        cache.put("hash-b", &set_b).expect("put b");

        assert_eq!(cache.get("hash-a").unwrap().unwrap().game_id, 42);
        assert_eq!(cache.get("hash-b").unwrap().unwrap().game_id, 99);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn sanitize_hash_replaces_path_hostile_characters() {
        assert_eq!(sanitize_hash("abc123"), "abc123");
        assert_eq!(sanitize_hash("../../etc/passwd"), "______etc_passwd");
    }
}
