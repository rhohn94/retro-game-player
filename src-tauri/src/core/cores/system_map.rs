//! Curated system → libretro-core map (W5). The buildbot core ids here are the
//! exact filename stems used by `<core>_libretro.dylib.zip` on the buildbot, so
//! the buildbot client can build a URL straight from a `(system, core_id)` pair.
//!
//! This is the single source of truth for which cores Harmony offers per system;
//! no magic strings elsewhere — callers ask [`cores_for`] / [`is_known`].

use crate::error::{AppError, AppResult};

/// One curated entry: a system key and the buildbot core ids offered for it.
/// The first id is the recommended default for that system.
struct SystemEntry {
    /// System key, matching the `system` column persisted by the cores repo.
    system: &'static str,
    /// Buildbot core-id filename stems (e.g. `mesen` → `mesen_libretro.dylib`).
    cores: &'static [&'static str],
}

/// The curated map. Adding a system or core is a one-line edit here — no other
/// module hard-codes core ids. Ordered by console generation (gen 1–6 home
/// consoles, v0.10). Every core id below is a real `<core>_libretro.dylib` the
/// libretro buildbot ships for `apple/osx/arm64`, so each pair downloads. The
/// first id in each list is the recommended default.
///
/// Coverage notes: Gen 1 dedicated/Pong consoles have no cartridge-ROM
/// emulation path and are omitted; the original Xbox has no libretro core and is
/// omitted. CD-based systems are listed here (their cores are installable) even
/// though `core/library/mapper.rs` cannot auto-scan their shared container
/// formats by extension.
const SYSTEM_CORES: &[SystemEntry] = &[
    // Gen 3–5 originals (v0.1).
    SystemEntry { system: "nes", cores: &["mesen", "fceumm", "nestopia", "quicknes"] },
    SystemEntry { system: "snes", cores: &["snes9x", "bsnes", "snes9x2010"] },
    SystemEntry { system: "n64", cores: &["mupen64plus_next", "parallel_n64"] },
    // Gen 2.
    SystemEntry { system: "atari2600", cores: &["stella", "stella2014"] },
    SystemEntry { system: "atari5200", cores: &["a5200", "atari800"] },
    SystemEntry { system: "atari7800", cores: &["prosystem"] },
    SystemEntry { system: "intellivision", cores: &["freeintv"] },
    SystemEntry { system: "colecovision", cores: &["gearcoleco", "bluemsx"] },
    SystemEntry { system: "odyssey2", cores: &["o2em"] },
    // Gen 3.
    SystemEntry { system: "mastersystem", cores: &["genesis_plus_gx", "smsplus", "gearsystem"] },
    // Gen 4.
    SystemEntry { system: "genesis", cores: &["genesis_plus_gx", "picodrive"] },
    SystemEntry { system: "pcengine", cores: &["mednafen_pce", "mednafen_pce_fast", "geargrafx"] },
    SystemEntry { system: "neogeo", cores: &["fbneo", "fbalpha2012_neogeo", "neocd"] },
    // Gen 5.
    SystemEntry { system: "ps1", cores: &["pcsx_rearmed", "swanstation", "mednafen_psx_hw"] },
    SystemEntry { system: "saturn", cores: &["mednafen_saturn", "yabasanshiro", "yabause"] },
    SystemEntry { system: "3do", cores: &["opera"] },
    SystemEntry { system: "jaguar", cores: &["virtualjaguar"] },
    // Gen 6.
    SystemEntry { system: "dreamcast", cores: &["flycast"] },
    SystemEntry { system: "ps2", cores: &["play"] },
    SystemEntry { system: "gamecube", cores: &["dolphin"] },
];

/// The buildbot core ids offered for `system`, or [`AppError::Unsupported`] if
/// the system is not in the curated map.
pub fn cores_for(system: &str) -> AppResult<&'static [&'static str]> {
    SYSTEM_CORES
        .iter()
        .find(|e| e.system == system)
        .map(|e| e.cores)
        .ok_or_else(|| AppError::Unsupported(format!("unknown system: {system}")))
}

/// Every curated `(system, core_id)` pair, optionally filtered to one system.
/// Drives `list_available_cores`. Filtering to an unknown system is an error.
pub fn available(system: Option<&str>) -> AppResult<Vec<(&'static str, &'static str)>> {
    match system {
        Some(s) => {
            let cores = cores_for(s)?;
            Ok(cores.iter().map(|c| (lookup_system(s), *c)).collect())
        }
        None => Ok(SYSTEM_CORES
            .iter()
            .flat_map(|e| e.cores.iter().map(move |c| (e.system, *c)))
            .collect()),
    }
}

/// Resolve the `'static` system key for a borrowed system string (the caller
/// already validated it via [`cores_for`]). Keeps returned tuples `'static`.
fn lookup_system(system: &str) -> &'static str {
    SYSTEM_CORES
        .iter()
        .find(|e| e.system == system)
        .map(|e| e.system)
        .unwrap_or("")
}

/// True iff `(system, core_id)` is a curated, installable pair.
pub fn is_known(system: &str, core_id: &str) -> bool {
    cores_for(system)
        .map(|cores| cores.contains(&core_id))
        .unwrap_or(false)
}

/// Validate a `(system, core_id)` pair, returning [`AppError::Unsupported`] when
/// the system is unknown or the core is not offered for that system.
pub fn require_known(system: &str, core_id: &str) -> AppResult<()> {
    let cores = cores_for(system)?;
    if cores.contains(&core_id) {
        Ok(())
    } else {
        Err(AppError::Unsupported(format!(
            "core '{core_id}' is not offered for system '{system}'"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nes_recommends_mesen_first_and_offers_more() {
        let nes = cores_for("nes").unwrap();
        assert_eq!(nes[0], "mesen"); // first id is the recommended default
        assert!(nes.contains(&"fceumm"));
        assert!(nes.contains(&"nestopia"));
    }

    #[test]
    fn snes_recommends_snes9x_first_and_offers_more() {
        let snes = cores_for("snes").unwrap();
        assert_eq!(snes[0], "snes9x");
        assert!(snes.contains(&"bsnes"));
    }

    #[test]
    fn n64_recommends_mupen_first_and_offers_more() {
        let n64 = cores_for("n64").unwrap();
        assert_eq!(n64[0], "mupen64plus_next");
        assert!(n64.contains(&"parallel_n64"));
    }

    #[test]
    fn unknown_system_is_unsupported() {
        assert!(matches!(cores_for("gameboy"), Err(AppError::Unsupported(_))));
    }

    #[test]
    fn is_known_validates_pairs() {
        assert!(is_known("nes", "mesen"));
        assert!(is_known("snes", "bsnes"));
        assert!(is_known("nes", "nestopia")); // now curated (v0.7 broadened catalog)
        assert!(!is_known("nes", "snes9x")); // wrong system
        assert!(!is_known("nes", "atari800")); // not curated
        assert!(!is_known("xyz", "mesen")); // unknown system
    }

    #[test]
    fn require_known_rejects_mismatched_pair() {
        assert!(require_known("nes", "mesen").is_ok());
        assert!(matches!(
            require_known("nes", "snes9x"),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn available_all_lists_every_pair() {
        let all = available(None).unwrap();
        assert_eq!(all.len(), 40); // 20 systems, gen 1–6 home consoles (v0.10)
        assert!(all.contains(&("nes", "mesen")));
        assert!(all.contains(&("nes", "quicknes")));
        assert!(all.contains(&("n64", "parallel_n64")));
        assert!(all.contains(&("genesis", "genesis_plus_gx")));
        assert!(all.contains(&("ps1", "pcsx_rearmed")));
        assert!(all.contains(&("dreamcast", "flycast")));
    }

    #[test]
    fn catalog_covers_gen_1_through_6_home_consoles() {
        // Every expected gen 2–6 home console is curated with ≥1 core, and the
        // recommended (first) core is the expected default.
        for (system, recommended) in [
            ("atari2600", "stella"),
            ("atari5200", "a5200"),
            ("atari7800", "prosystem"),
            ("intellivision", "freeintv"),
            ("colecovision", "gearcoleco"),
            ("odyssey2", "o2em"),
            ("mastersystem", "genesis_plus_gx"),
            ("genesis", "genesis_plus_gx"),
            ("pcengine", "mednafen_pce"),
            ("neogeo", "fbneo"),
            ("ps1", "pcsx_rearmed"),
            ("saturn", "mednafen_saturn"),
            ("3do", "opera"),
            ("jaguar", "virtualjaguar"),
            ("dreamcast", "flycast"),
            ("ps2", "play"),
            ("gamecube", "dolphin"),
        ] {
            let cores = cores_for(system)
                .unwrap_or_else(|_| panic!("system '{system}' missing from catalog"));
            assert!(!cores.is_empty(), "system '{system}' has no cores");
            assert_eq!(cores[0], recommended, "wrong default core for '{system}'");
        }
    }

    #[test]
    fn catalog_has_twenty_systems() {
        let mut systems: Vec<&str> = SYSTEM_CORES.iter().map(|e| e.system).collect();
        systems.sort_unstable();
        systems.dedup();
        assert_eq!(systems.len(), 20, "expected 20 distinct gen 1–6 systems");
    }

    #[test]
    fn available_filtered_to_one_system() {
        let snes = available(Some("snes")).unwrap();
        assert_eq!(
            snes,
            vec![("snes", "snes9x"), ("snes", "bsnes"), ("snes", "snes9x2010")]
        );
    }

    #[test]
    fn available_unknown_system_errors() {
        assert!(matches!(available(Some("xyz")), Err(AppError::Unsupported(_))));
    }
}
