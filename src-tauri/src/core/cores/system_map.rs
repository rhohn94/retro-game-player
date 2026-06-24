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
/// module hard-codes core ids.
const SYSTEM_CORES: &[SystemEntry] = &[
    SystemEntry {
        system: "nes",
        cores: &["mesen", "fceumm"],
    },
    SystemEntry {
        system: "snes",
        cores: &["snes9x", "bsnes"],
    },
    SystemEntry {
        system: "n64",
        cores: &["mupen64plus_next"],
    },
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
    fn nes_maps_to_mesen_then_fceumm() {
        assert_eq!(cores_for("nes").unwrap(), &["mesen", "fceumm"]);
    }

    #[test]
    fn snes_maps_to_snes9x_then_bsnes() {
        assert_eq!(cores_for("snes").unwrap(), &["snes9x", "bsnes"]);
    }

    #[test]
    fn n64_maps_to_mupen64plus_next() {
        assert_eq!(cores_for("n64").unwrap(), &["mupen64plus_next"]);
    }

    #[test]
    fn unknown_system_is_unsupported() {
        assert!(matches!(cores_for("gameboy"), Err(AppError::Unsupported(_))));
    }

    #[test]
    fn is_known_validates_pairs() {
        assert!(is_known("nes", "mesen"));
        assert!(is_known("snes", "bsnes"));
        assert!(!is_known("nes", "snes9x")); // wrong system
        assert!(!is_known("nes", "nestopia")); // not curated
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
        assert_eq!(all.len(), 5); // 2 + 2 + 1
        assert!(all.contains(&("nes", "mesen")));
        assert!(all.contains(&("n64", "mupen64plus_next")));
    }

    #[test]
    fn available_filtered_to_one_system() {
        let snes = available(Some("snes")).unwrap();
        assert_eq!(snes, vec![("snes", "snes9x"), ("snes", "bsnes")]);
    }

    #[test]
    fn available_unknown_system_errors() {
        assert!(matches!(available(Some("xyz")), Err(AppError::Unsupported(_))));
    }
}
