//! Bounded on-disk cache of fetched badge art (v0.38 W384,
//! retroachievements-design.md §Achievement list: "reuse the W371 cache
//! module's conventions and location, one file per badge name"). One PNG
//! file per RA badge name under `Paths::retroachievements_badge_cache_dir()`
//! — same "one file per identity, unconditional overwrite, naturally
//! bounded" shape as [`super::cache::AchievementSetCache`], just holding raw
//! image bytes instead of a JSON blob.

use crate::error::AppResult;
use std::path::PathBuf;

/// Disk-backed cache for badge PNG bytes, rooted at a cache directory
/// (normally `Paths::retroachievements_badge_cache_dir()`).
pub struct BadgeCache {
    dir: PathBuf,
}

impl BadgeCache {
    /// Build a cache rooted at `dir` (created by the caller — mirrors
    /// [`super::cache::AchievementSetCache::new`]'s contract).
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The on-disk file path for `badge_name` — not required to exist.
    fn path_for(&self, badge_name: &str) -> PathBuf {
        self.dir.join(format!("{}.png", sanitize_badge_name(badge_name)))
    }

    /// Read cached badge bytes for `badge_name`, or `None` on a cache miss
    /// (not an error).
    pub fn get(&self, badge_name: &str) -> AppResult<Option<Vec<u8>>> {
        let path = self.path_for(badge_name);
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(std::fs::read(&path)?))
    }

    /// Persist (overwrite) the cached badge bytes for `badge_name`.
    pub fn put(&self, badge_name: &str, bytes: &[u8]) -> AppResult<()> {
        let path = self.path_for(badge_name);
        std::fs::write(&path, bytes)?;
        Ok(())
    }

    /// The on-disk path a caller (the `get_achievement_badge_path` command)
    /// hands back to the frontend for `convertFileSrc` — only meaningful once
    /// [`Self::get`]/[`Self::put`] has confirmed the file exists.
    pub fn path_for_existing(&self, badge_name: &str) -> PathBuf {
        self.path_for(badge_name)
    }
}

/// A badge name is already a plain numeric string in practice (RA's
/// convention), but any path-hostile character is defensively swapped for
/// `_` — mirrors `cache::sanitize_hash` exactly.
fn sanitize_badge_name(badge_name: &str) -> String {
    badge_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("rgp-badge-cache-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).expect("create tmp dir");
        tmp
    }

    #[test]
    fn get_on_a_miss_returns_none() {
        let tmp = temp_dir("miss");
        let cache = BadgeCache::new(&tmp);
        assert_eq!(cache.get("111").unwrap(), None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn put_then_get_round_trips() {
        let tmp = temp_dir("roundtrip");
        let cache = BadgeCache::new(&tmp);
        cache.put("111", b"png-bytes").expect("put");

        let loaded = cache.get("111").expect("get").expect("present");
        assert_eq!(loaded, b"png-bytes".to_vec());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn put_overwrites_an_existing_entry() {
        let tmp = temp_dir("overwrite");
        let cache = BadgeCache::new(&tmp);
        cache.put("111", b"first").expect("put first");
        cache.put("111", b"second").expect("put second");

        let loaded = cache.get("111").expect("get").expect("present");
        assert_eq!(loaded, b"second".to_vec());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn different_badge_names_are_independent_entries() {
        let tmp = temp_dir("independent");
        let cache = BadgeCache::new(&tmp);
        cache.put("111", b"a").expect("put a");
        cache.put("222", b"b").expect("put b");

        assert_eq!(cache.get("111").unwrap().unwrap(), b"a".to_vec());
        assert_eq!(cache.get("222").unwrap().unwrap(), b"b".to_vec());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn sanitize_badge_name_replaces_path_hostile_characters() {
        assert_eq!(sanitize_badge_name("111"), "111");
        assert_eq!(sanitize_badge_name("../../etc/passwd"), "______etc_passwd");
    }

    #[test]
    fn path_for_existing_matches_the_put_location() {
        let tmp = temp_dir("path-for-existing");
        let cache = BadgeCache::new(&tmp);
        cache.put("111", b"bytes").expect("put");

        let path = cache.path_for_existing("111");
        assert!(path.exists());
        assert_eq!(std::fs::read(&path).unwrap(), b"bytes".to_vec());
        std::fs::remove_dir_all(&tmp).ok();
    }
}
