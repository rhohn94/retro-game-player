//! File → system → suggested-core mapping (W6).
//!
//! v0.1 supports three systems (architecture-design.md §3 `games.system`). The
//! system is inferred from the file extension; the suggested core (`core_hint`)
//! is the default libretro core Harmony recommends for that system. All values
//! are named constants — no magic strings scattered through the scanner.

/// Canonical system id for the Nintendo Entertainment System.
pub const SYSTEM_NES: &str = "nes";
/// Canonical system id for the Super Nintendo Entertainment System.
pub const SYSTEM_SNES: &str = "snes";
/// Canonical system id for the Nintendo 64.
pub const SYSTEM_N64: &str = "n64";

/// Default suggested libretro core ids per system (`cores.core_id`, §3).
const CORE_HINT_NES: &str = "mesen";
const CORE_HINT_SNES: &str = "snes9x";
const CORE_HINT_N64: &str = "mupen64plus_next";

/// Extension → system table. Lowercased, no leading dot. Kept as a slice so the
/// walker can also use it to decide whether a file is a candidate ROM at all.
const EXTENSION_TABLE: &[(&str, &str)] = &[
    ("nes", SYSTEM_NES),
    ("snes", SYSTEM_SNES),
    ("smc", SYSTEM_SNES),
    ("sfc", SYSTEM_SNES),
    ("n64", SYSTEM_N64),
    ("z64", SYSTEM_N64),
    ("v64", SYSTEM_N64),
];

/// The resolved mapping for a recognized ROM file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemMapping {
    /// Canonical system id (one of the `SYSTEM_*` constants).
    pub system: String,
    /// Suggested core id for that system.
    pub core_hint: String,
}

/// True when `ext` (lowercased, no dot) is a ROM extension Harmony recognizes.
pub fn is_rom_extension(ext: &str) -> bool {
    EXTENSION_TABLE.iter().any(|(e, _)| *e == ext)
}

/// Suggested core id for a known system, or `None` for an unknown system.
pub fn core_hint_for_system(system: &str) -> Option<&'static str> {
    match system {
        SYSTEM_NES => Some(CORE_HINT_NES),
        SYSTEM_SNES => Some(CORE_HINT_SNES),
        SYSTEM_N64 => Some(CORE_HINT_N64),
        _ => None,
    }
}

/// Map a file extension (case-insensitive, with or without a leading dot) to its
/// system + suggested core. Returns `None` for unrecognized extensions.
pub fn map_extension(ext: &str) -> Option<SystemMapping> {
    let normalized = ext.trim_start_matches('.').to_ascii_lowercase();
    let (_, system) = EXTENSION_TABLE.iter().find(|(e, _)| *e == normalized)?;
    let core_hint = core_hint_for_system(system)?;
    Some(SystemMapping {
        system: (*system).to_string(),
        core_hint: core_hint.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_extensions_case_insensitively() {
        assert_eq!(map_extension("nes").unwrap().system, SYSTEM_NES);
        assert_eq!(map_extension(".SFC").unwrap().system, SYSTEM_SNES);
        assert_eq!(map_extension("Z64").unwrap().system, SYSTEM_N64);
    }

    #[test]
    fn supplies_the_suggested_core() {
        assert_eq!(map_extension("snes").unwrap().core_hint, "snes9x");
        assert_eq!(map_extension("nes").unwrap().core_hint, "mesen");
    }

    #[test]
    fn unknown_extension_is_none() {
        assert!(map_extension("zip").is_none());
        assert!(map_extension("").is_none());
    }

    #[test]
    fn rom_extension_predicate() {
        assert!(is_rom_extension("nes"));
        assert!(!is_rom_extension("txt"));
    }
}
