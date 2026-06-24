//! In-memory enrichment-result cache (W12).
//!
//! Enrichment is comparatively expensive (a network round-trip to an AI service),
//! so results are cached keyed by game id for the lifetime of the process. The
//! cache is a thin `Mutex<HashMap>` wrapper; it holds the enriched `clean_name`
//! (and any future enrichment fields) so a repeated `enrich_game` for the same id
//! returns instantly without re-hitting the Familiar.

use std::collections::HashMap;
use std::sync::Mutex;

/// The enrichment payload produced by the Familiar for one game. Kept minimal for
/// v0.1 (the disambiguated title); extend as enrichment grows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enrichment {
    /// The disambiguated / corrected clean name the Familiar resolved.
    pub clean_name: String,
}

/// Process-lifetime cache of enrichment results keyed by game id.
#[derive(Default)]
pub struct EnrichmentCache {
    entries: Mutex<HashMap<i64, Enrichment>>,
}

impl EnrichmentCache {
    /// Construct an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return a cached enrichment for `game_id`, if present.
    pub fn get(&self, game_id: i64) -> Option<Enrichment> {
        self.entries.lock().unwrap().get(&game_id).cloned()
    }

    /// Insert/replace the enrichment for `game_id`.
    pub fn put(&self, game_id: i64, enrichment: Enrichment) {
        self.entries.lock().unwrap().insert(game_id, enrichment);
    }

    /// Number of cached entries (diagnostics / tests).
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn miss_then_hit() {
        let cache = EnrichmentCache::new();
        assert!(cache.get(1).is_none());
        cache.put(
            1,
            Enrichment {
                clean_name: "Super Mario Bros.".to_string(),
            },
        );
        assert_eq!(cache.get(1).unwrap().clean_name, "Super Mario Bros.");
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn put_replaces() {
        let cache = EnrichmentCache::new();
        cache.put(1, Enrichment { clean_name: "a".into() });
        cache.put(1, Enrichment { clean_name: "b".into() });
        assert_eq!(cache.get(1).unwrap().clean_name, "b");
        assert_eq!(cache.len(), 1);
    }
}
