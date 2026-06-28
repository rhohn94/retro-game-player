//! File → system → suggested-core mapping (W6; broadened in v0.10 to gen 1–6).
//!
//! The system is inferred from a ROM's file extension; the suggested core
//! (`core_hint`) is the default libretro core Harmony recommends for that
//! system. Every value lives in the single [`SYSTEMS`] table — adding a system
//! is a one-line edit, never a new code branch, and no magic strings are
//! scattered through the scanner.
//!
//! Scope note (v0.10): this table covers the systems whose ROMs carry a
//! *distinct, unambiguous* file extension, so a scan can identify them by name.
//! CD-based systems (Saturn, 3DO, PS2, Odyssey²) share container formats
//! (`.cue`/`.chd`/`.iso`/`.bin`) that cannot identify a system on their own, so
//! they are NOT auto-scanned here — but they ARE discoverable in the core
//! catalog (`core/cores/system_map.rs`), which is the broader source of truth
//! for which systems Harmony offers cores for. Each `default_core` below is the
//! recommended (first) core for that system in that catalog; the consistency
//! test pins the two together.

/// Canonical system id for the Nintendo Entertainment System.
pub const SYSTEM_NES: &str = "nes";
/// Canonical system id for the Super Nintendo Entertainment System.
pub const SYSTEM_SNES: &str = "snes";
/// Canonical system id for the Nintendo 64.
pub const SYSTEM_N64: &str = "n64";

/// One scan-mappable system: its canonical key, the recommended default core,
/// and the lowercased, dot-less ROM extensions that uniquely identify it.
struct SystemDef {
    system: &'static str,
    default_core: &'static str,
    extensions: &'static [&'static str],
}

/// The scan map — one row per system that has a distinct ROM extension. Ordered
/// by console generation. `default_core` mirrors the recommended core in
/// `core/cores/system_map.rs` (verified by `default_cores_match_catalog`).
const SYSTEMS: &[SystemDef] = &[
    // Gen 3–5 originals (v0.1).
    SystemDef { system: SYSTEM_NES, default_core: "mesen", extensions: &["nes", "fds"] },
    SystemDef { system: SYSTEM_SNES, default_core: "snes9x", extensions: &["snes", "smc", "sfc"] },
    SystemDef { system: SYSTEM_N64, default_core: "mupen64plus_next", extensions: &["n64", "z64", "v64"] },
    // Gen 2.
    SystemDef { system: "atari2600", default_core: "stella", extensions: &["a26"] },
    SystemDef { system: "atari5200", default_core: "a5200", extensions: &["a52"] },
    SystemDef { system: "atari7800", default_core: "prosystem", extensions: &["a78"] },
    SystemDef { system: "intellivision", default_core: "freeintv", extensions: &["int"] },
    SystemDef { system: "colecovision", default_core: "gearcoleco", extensions: &["col"] },
    // Gen 3.
    SystemDef { system: "mastersystem", default_core: "genesis_plus_gx", extensions: &["sms"] },
    // Gen 4.
    SystemDef { system: "genesis", default_core: "genesis_plus_gx", extensions: &["md", "gen", "smd"] },
    SystemDef { system: "pcengine", default_core: "mednafen_pce", extensions: &["pce"] },
    SystemDef { system: "neogeo", default_core: "fbneo", extensions: &["neo"] },
    // Gen 5.
    SystemDef { system: "ps1", default_core: "pcsx_rearmed", extensions: &["pbp"] },
    SystemDef { system: "jaguar", default_core: "virtualjaguar", extensions: &["j64", "jag"] },
    // Gen 6.
    SystemDef { system: "dreamcast", default_core: "flycast", extensions: &["gdi", "cdi"] },
    SystemDef { system: "gamecube", default_core: "dolphin", extensions: &["rvz", "gcm"] },
];

/// The resolved mapping for a recognized ROM file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemMapping {
    /// Canonical system id (the `system` key of a [`SYSTEMS`] row).
    pub system: String,
    /// Suggested core id for that system.
    pub core_hint: String,
}

/// Normalize an extension to lowercase, no leading dot.
fn normalize_ext(ext: &str) -> String {
    ext.trim_start_matches('.').to_ascii_lowercase()
}

/// True when `ext` (lowercased, no dot) is a ROM extension Harmony recognizes.
pub fn is_rom_extension(ext: &str) -> bool {
    let n = normalize_ext(ext);
    SYSTEMS.iter().any(|s| s.extensions.contains(&n.as_str()))
}

/// Suggested core id for a known system, or `None` for an unknown / non-scanned
/// system.
pub fn core_hint_for_system(system: &str) -> Option<&'static str> {
    SYSTEMS
        .iter()
        .find(|s| s.system == system)
        .map(|s| s.default_core)
}

/// Map a file extension (case-insensitive, with or without a leading dot) to its
/// system + suggested core. Returns `None` for unrecognized extensions.
pub fn map_extension(ext: &str) -> Option<SystemMapping> {
    let normalized = normalize_ext(ext);
    let def = SYSTEMS
        .iter()
        .find(|s| s.extensions.contains(&normalized.as_str()))?;
    Some(SystemMapping {
        system: def.system.to_string(),
        core_hint: def.default_core.to_string(),
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

    #[test]
    fn maps_gen_1_through_6_systems() {
        // A representative ROM extension from each newly-added generation maps
        // to the right system + its recommended core.
        assert_eq!(map_extension("a26").unwrap().system, "atari2600");
        assert_eq!(map_extension("a78").unwrap().core_hint, "prosystem");
        assert_eq!(map_extension("sms").unwrap().system, "mastersystem");
        assert_eq!(map_extension("md").unwrap().system, "genesis");
        assert_eq!(map_extension(".PCE").unwrap().system, "pcengine");
        assert_eq!(map_extension("neo").unwrap().system, "neogeo");
        assert_eq!(map_extension("pbp").unwrap().system, "ps1");
        assert_eq!(map_extension("j64").unwrap().system, "jaguar");
        assert_eq!(map_extension("gdi").unwrap().system, "dreamcast");
        assert_eq!(map_extension("rvz").unwrap().system, "gamecube");
    }

    #[test]
    fn extensions_are_unique_across_systems() {
        // No extension may identify two systems, or the scan would be ambiguous.
        let mut seen = std::collections::HashSet::new();
        for s in SYSTEMS {
            for ext in s.extensions {
                assert!(seen.insert(*ext), "duplicate extension mapping: {ext}");
            }
        }
    }

    #[test]
    fn default_cores_match_catalog() {
        // Each scan-mapped system's suggested core must be the recommended
        // (first) core for that system in the core catalog, so a scanned ROM
        // never suggests a core the catalog would not install. Test-only
        // cross-domain check (production modules stay decoupled).
        use crate::core::cores::system_map::cores_for;
        for s in SYSTEMS {
            let catalog = cores_for(s.system)
                .unwrap_or_else(|_| panic!("system '{}' missing from core catalog", s.system));
            assert_eq!(
                catalog[0], s.default_core,
                "default core for '{}' drifted from the catalog's recommended core",
                s.system
            );
        }
    }
}
