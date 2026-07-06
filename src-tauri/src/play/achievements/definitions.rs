//! The trigger-definition format [`super::host::AchievementRuntime`] loads a
//! set from (W370). Deliberately a simple, serde-friendly JSON shape rather
//! than anything RA-API-specific: W371's `RetroAchievementsClient` decodes
//! RA's richer achievement-set response into exactly this struct, so the
//! runtime never depends on RA's wire format — only on rcheevos' own
//! trigger-string mini-language (`memaddr`, e.g. `"0xH0010=1"`), which is
//! unrelated to and predates the JSON transport used to carry it here.

use serde::{Deserialize, Serialize};

/// One achievement's rcheevos trigger definition, keyed by RA's numeric
/// achievement id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AchievementDefinition {
    /// RA's achievement id — the identifier unlock events are reported
    /// under, and the primary key `achievement_unlocks` (W372) persists
    /// against.
    pub id: u32,
    /// A human-readable title, carried through purely for future UI use
    /// (W372's toast/list) — the runtime itself never reads it.
    pub title: String,
    /// The rcheevos trigger string (RA's "MemAddr" condition mini-language),
    /// e.g. `"0xH0010=1"`. Opaque to this crate — handed to
    /// `rc_runtime_activate_achievement` unparsed; rcheevos owns the syntax.
    pub trigger: String,
}

/// A loadable achievement set for one game: the hash it was fetched for
/// (W371 caches sets keyed by this) plus its achievement definitions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AchievementSet {
    /// The RA hash (see [`super::hash::hash_rom`]) this set applies to.
    /// Carried alongside the definitions for cache-key round-tripping and
    /// diagnostics; the runtime does not itself re-validate it against the
    /// currently loaded ROM (the session loader is the single source of
    /// truth for "which hash is this session").
    pub hash: String,
    pub achievements: Vec<AchievementDefinition>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json() {
        let set = AchievementSet {
            hash: "deadbeef00000000000000000000000".into(),
            achievements: vec![AchievementDefinition {
                id: 1,
                title: "First Steps".into(),
                trigger: "0xH0010=1".into(),
            }],
        };
        let json = serde_json::to_string(&set).expect("serialize");
        let back: AchievementSet = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(set, back);
    }

    #[test]
    fn empty_set_deserializes() {
        let json = r#"{"hash":"","achievements":[]}"#;
        let set: AchievementSet = serde_json::from_str(json).expect("deserialize");
        assert!(set.achievements.is_empty());
    }
}
