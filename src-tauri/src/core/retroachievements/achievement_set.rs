//! The shared achievement-set JSON shape (v0.37 W371,
//! retroachievements-design.md §Client). This is the contract between
//! [`super::client::RetroAchievementsClient::fetch_achievement_set`] and
//! W370's native rcheevos runtime: the runtime loads an [`AchievementSet`]'s
//! [`AchievementDefinition::trigger`] strings as rcheevos trigger logic
//! (`rc_runtime_activate_achievement`) keyed by [`AchievementDefinition::id`].
//!
//! Deliberately decoupled from RetroAchievements' raw wire format (see
//! `client::GameInfoResponse`) — this is the normalized shape both this
//! client and W370's runtime agree on, unit-tested independently of any one
//! HTTP response shape so the two sides can evolve without breaking each
//! other's fixtures.

use serde::{Deserialize, Serialize};

/// One achievement's rcheevos trigger definition + display metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AchievementDefinition {
    /// RetroAchievements achievement id — stable across sessions, used as
    /// the key for unlock persistence (W372's `achievement_unlocks` table).
    pub id: u64,
    /// Display title, e.g. "Speed Runner".
    pub title: String,
    /// Display description, e.g. "Finish World 1 in under 90 seconds."
    pub description: String,
    /// Points awarded on unlock (RA's own scoring; no gameplay effect).
    pub points: u32,
    /// The rcheevos trigger-logic string (RA's `MemAddr` condition syntax,
    /// e.g. `"0xH00A2=1"`) — fed to rcheevos verbatim; this client never
    /// parses or validates it, only transports it.
    pub trigger: String,
    /// Badge image name (RA convention: a bare id like `"12345"`, joined by
    /// the caller with RA's badge CDN base to form a URL) — `None` when the
    /// set response omitted it.
    #[serde(default)]
    pub badge_name: Option<String>,
}

/// A fetched achievement set for one game: RA's game id plus every
/// achievement definition. Disk-cached keyed by RA ROM hash
/// ([`super::cache::AchievementSetCache`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AchievementSet {
    /// RetroAchievements game id the set was fetched for.
    pub game_id: u64,
    /// Game title as RA has it on file.
    pub title: String,
    /// Every achievement definition for this game (RA's "core" achievement
    /// set only — no non-goal unofficial/bonus sets, per the design doc's
    /// scope).
    pub achievements: Vec<AchievementDefinition>,
}

impl AchievementSet {
    /// True when the set has no achievements — a legitimate response (some
    /// games have no RA set yet), not an error; callers treat it the same as
    /// "no set" for the runtime and detail-page count.
    pub fn is_empty(&self) -> bool {
        self.achievements.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_definition() -> AchievementDefinition {
        AchievementDefinition {
            id: 1,
            title: "Speed Runner".to_string(),
            description: "Finish World 1 in under 90 seconds.".to_string(),
            points: 10,
            trigger: "0xH00A2=1".to_string(),
            badge_name: Some("12345".to_string()),
        }
    }

    #[test]
    fn achievement_definition_round_trips_through_json() {
        let def = sample_definition();
        let json = serde_json::to_string(&def).expect("serialize");
        let back: AchievementDefinition = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, def);
    }

    #[test]
    fn achievement_definition_defaults_badge_name_when_absent() {
        let json = r#"{
            "id": 2,
            "title": "No Badge",
            "description": "d",
            "points": 5,
            "trigger": "0xH0001=1"
        }"#;
        let def: AchievementDefinition = serde_json::from_str(json).expect("deserialize");
        assert_eq!(def.badge_name, None);
    }

    #[test]
    fn achievement_set_round_trips_through_json() {
        let set = AchievementSet {
            game_id: 42,
            title: "Test Game".to_string(),
            achievements: vec![sample_definition()],
        };
        let json = serde_json::to_string(&set).expect("serialize");
        let back: AchievementSet = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, set);
    }

    #[test]
    fn is_empty_true_for_no_achievements() {
        let set = AchievementSet {
            game_id: 1,
            title: "Empty".to_string(),
            achievements: vec![],
        };
        assert!(set.is_empty());
    }

    #[test]
    fn is_empty_false_when_achievements_present() {
        let set = AchievementSet {
            game_id: 1,
            title: "Has One".to_string(),
            achievements: vec![sample_definition()],
        };
        assert!(!set.is_empty());
    }
}
