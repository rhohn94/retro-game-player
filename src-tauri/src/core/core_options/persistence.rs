//! Persistence for per-core option values (W282, core-options-design.md).
//!
//! Reuses the existing `settings` key/value table (`db::repo::settings`)
//! rather than a new storage mechanism — the design doc's explicit
//! instruction. A `(system, core, option_key)` triple is encoded into one
//! namespaced settings key so [`crate::db::repo::settings::SettingsRepo`]
//! needs no schema change; the value is the raw libretro option value string
//! (already a "scalar" in the settings table's own JSON-encoded-scalar
//! convention — quoted so it round-trips as valid JSON like every other
//! settings entry).

use crate::db::repo::settings::SettingsRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// Namespace prefix for every core-option settings key, keeping this
/// feature's keys visually grouped and collision-free against unrelated
/// settings (theme, retroarch_path, ...).
const KEY_PREFIX: &str = "core_option";

/// Builds the namespaced settings key for one `(system, core, option_key)`
/// triple. `::` is not a legal libretro option-key character in practice
/// (they're C identifiers), so this encoding is unambiguous to decode were
/// that ever needed.
fn settings_key(system: &str, core_id: &str, option_key: &str) -> String {
    format!("{KEY_PREFIX}::{system}::{core_id}::{option_key}")
}

/// Reads the persisted value for one option, or `None` if nothing has ever
/// been saved for this `(system, core, option_key)` — callers fall back to
/// the core's own declared default (never a blank/crashing value).
pub fn get_persisted_value(
    db: &Db,
    system: &str,
    core_id: &str,
    option_key: &str,
) -> AppResult<Option<String>> {
    let repo = SettingsRepo::new(db);
    match repo.get(&settings_key(system, core_id, option_key)) {
        Ok(json) => Ok(Some(decode_value(&json)?)),
        Err(AppError::NotFound(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Persists one option's value, upserting over any prior value for the same
/// `(system, core, option_key)`.
pub fn set_persisted_value(
    db: &Db,
    system: &str,
    core_id: &str,
    option_key: &str,
    value: &str,
) -> AppResult<()> {
    let repo = SettingsRepo::new(db);
    repo.set(&settings_key(system, core_id, option_key), &encode_value(value))
}

/// Encodes a raw option value as the settings table's JSON-scalar convention
/// (a quoted JSON string) — matching how every other `settings` row stores
/// its value (see `settings.rs`'s own `"dark"`/path examples).
fn encode_value(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Decodes a settings value back to the raw option string. Malformed JSON
/// (should never happen for a value this module wrote) surfaces as
/// `AppError::Internal` rather than silently returning garbage.
fn decode_value(json: &str) -> AppResult<String> {
    serde_json::from_str(json).map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Db {
        Db::open_in_memory().unwrap()
    }

    #[test]
    fn get_persisted_value_is_none_when_nothing_was_ever_saved() {
        let db = memory_db();
        let got = get_persisted_value(&db, "nes", "fceumm", "fceumm_region").unwrap();
        assert_eq!(got, None);
    }

    #[test]
    fn set_then_get_round_trips_the_value() {
        let db = memory_db();
        set_persisted_value(&db, "nes", "fceumm", "fceumm_region", "pal").unwrap();
        let got = get_persisted_value(&db, "nes", "fceumm", "fceumm_region").unwrap();
        assert_eq!(got, Some("pal".to_string()));
    }

    #[test]
    fn set_twice_overwrites_rather_than_conflicting() {
        let db = memory_db();
        set_persisted_value(&db, "nes", "fceumm", "fceumm_region", "pal").unwrap();
        set_persisted_value(&db, "nes", "fceumm", "fceumm_region", "ntsc").unwrap();
        let got = get_persisted_value(&db, "nes", "fceumm", "fceumm_region").unwrap();
        assert_eq!(got, Some("ntsc".to_string()));
    }

    #[test]
    fn different_systems_cores_and_keys_do_not_collide() {
        let db = memory_db();
        set_persisted_value(&db, "nes", "fceumm", "fceumm_region", "pal").unwrap();
        set_persisted_value(&db, "nes", "mesen", "fceumm_region", "ntsc").unwrap();
        set_persisted_value(&db, "snes", "fceumm", "fceumm_region", "auto").unwrap();
        set_persisted_value(&db, "nes", "fceumm", "fceumm_sprite_limit", "enabled").unwrap();

        assert_eq!(
            get_persisted_value(&db, "nes", "fceumm", "fceumm_region").unwrap(),
            Some("pal".to_string())
        );
        assert_eq!(
            get_persisted_value(&db, "nes", "mesen", "fceumm_region").unwrap(),
            Some("ntsc".to_string())
        );
        assert_eq!(
            get_persisted_value(&db, "snes", "fceumm", "fceumm_region").unwrap(),
            Some("auto".to_string())
        );
        assert_eq!(
            get_persisted_value(&db, "nes", "fceumm", "fceumm_sprite_limit").unwrap(),
            Some("enabled".to_string())
        );
    }

    #[test]
    fn settings_key_is_namespaced_and_collision_free() {
        assert_eq!(
            settings_key("nes", "fceumm", "fceumm_region"),
            "core_option::nes::fceumm::fceumm_region"
        );
        assert_ne!(
            settings_key("nes", "fceumm", "a"),
            settings_key("nes", "mesen", "a")
        );
    }
}
