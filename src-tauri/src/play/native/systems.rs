//! The table of systems the native libretro host can play, and resolution of
//! each system's installed core `.dylib` — reusing the **existing**
//! `CoresRepo::installed_path` lookup ([`crate::core::cores::install`], v0.7
//! "Forge") rather than a new download/bundling mechanism.
//!
//! v0.21 "Bedrock" (W213) hard-wired a single `NATIVE_SYSTEM: &str = "nes"`
//! constant. W340 (v0.34 "Engines") replaces it with [`NATIVE_SYSTEMS`], a
//! table of [`NativeSystemSupport`] rows — one per system the host can play —
//! so later work items (W341's handheld/Wii cohort, W344's PS1 enable, W345's
//! N64 enable) only ever need to append a row, never touch the hosting
//! machinery in `host.rs`/`runtime.rs`/`callbacks.rs`. See
//! docs/design/native-emulation-design.md, "Multi-system engine".

use crate::db::repo::cores::CoresRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::path::PathBuf;

/// One native-hostable system: which libretro core plays it. Video geometry
/// and timing are never part of this table — they are read from the loaded
/// core's own `retro_get_system_av_info` at boot (and, for geometry,
/// re-read on `RETRO_ENVIRONMENT_SET_GEOMETRY`), never assumed from a
/// per-system constant. See [`super::host::LibretroCore::av_info`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeSystemSupport {
    /// The system key as used everywhere else in Harmony (library rows,
    /// `CoresRepo`, the console catalog) — e.g. `"nes"`.
    pub system: &'static str,
    /// The curated libretro core id for this system — e.g. `"fceumm"`.
    pub core_id: &'static str,
}

/// The native-hostable system table. v0.34 "Engines" (W340) shipped the one
/// row v0.21 "Bedrock" already proved out (NES via `fceumm`) — the
/// **acceptance-mandated regression floor** ("NES behaves exactly as
/// today") — while making the machinery general enough for later items to
/// append rows without touching it. W342 appends the software-render cohort:
/// SNES, Genesis, Master System, GB/GBC, GBA, Atari 2600, and PC Engine — all
/// pure software renderers (no `RETRO_ENVIRONMENT_SET_HW_RENDER`, no disk
/// control), so each is just a new row here, never a change to
/// `host.rs`/`runtime.rs`/`callbacks.rs`. W345 appends `n64`
/// (`mupen64plus_next`) last, per the release plan's conflict map (W342's
/// rows land first) — N64 is the table's first HW-render row (§HW-render,
/// native-emulation-design.md): a core is only asked to negotiate
/// `RETRO_ENVIRONMENT_SET_HW_RENDER` if it wants to, so appending it here
/// changes nothing about how every earlier (software-rendered) row hosts.
/// Order is insertion order; lookups are linear over this short, curated
/// list (never more than a handful of systems), matching the existing
/// curated-catalog convention (`core::cores::install`).
///
/// Each `core_id` is the same **recommended-default** core
/// `core::cores::system_map::cores_for(system)[0]` already lists for that
/// system (`every_native_row_is_a_recommended_default_core` guards this) —
/// the native host never resolves a different core than the one the Cores
/// screen recommends installing first.
pub const NATIVE_SYSTEMS: &[NativeSystemSupport] = &[
    NativeSystemSupport {
        system: "nes",
        core_id: "fceumm",
    },
    // W342 software-render cohort (v0.34 "Engines" Pass 2). PS1 (disc-image,
    // W344) lands separately — see native-emulation-design.md's Multi-system
    // engine table for why.
    NativeSystemSupport {
        system: "snes",
        core_id: "snes9x",
    },
    NativeSystemSupport {
        system: "genesis",
        core_id: "genesis_plus_gx",
    },
    NativeSystemSupport {
        system: "mastersystem",
        core_id: "genesis_plus_gx",
    },
    NativeSystemSupport {
        system: "gb",
        core_id: "gambatte",
    },
    NativeSystemSupport {
        system: "gbc",
        core_id: "gambatte",
    },
    NativeSystemSupport {
        system: "gba",
        core_id: "mgba",
    },
    NativeSystemSupport {
        system: "atari2600",
        core_id: "stella",
    },
    NativeSystemSupport {
        system: "pcengine",
        core_id: "mednafen_pce",
    },
    // W345: the table's first HW-render row (§HW-render,
    // native-emulation-design.md), appended last per the release plan's
    // conflict map.
    NativeSystemSupport {
        system: "n64",
        core_id: "mupen64plus_next",
    },
];

/// Backward-compatible aliases for the pre-W340 single-system constants —
/// still meaningful today (NES/`fceumm` is still the only shipped row) and
/// kept so call sites that only ever cared about "the" native system (the
/// core-options GUI, which is NES-only in this release) don't need to change.
pub const NATIVE_SYSTEM: &str = NATIVE_SYSTEMS[0].system;
pub const NATIVE_CORE_ID: &str = NATIVE_SYSTEMS[0].core_id;

/// Looks up `system`'s native-hosting row, if any.
pub fn native_support_for(system: &str) -> Option<NativeSystemSupport> {
    NATIVE_SYSTEMS.iter().copied().find(|row| row.system == system)
}

/// Whether `system` is in the native-hostable table at all (independent of
/// whether its core is actually installed — see [`resolve_native_core_path`]
/// for that check). The frontend capability list (`list_native_systems`
/// command) is built from this predicate over every row.
pub fn is_native_capable(system: &str) -> bool {
    native_support_for(system).is_some()
}

/// Resolves the installed core `.dylib` path for `system`. Returns
/// [`AppError::Unsupported`] for a system with no row in [`NATIVE_SYSTEMS`]
/// at all, and [`AppError::NotFound`] (never installs silently) for a
/// known-native system whose core isn't installed yet — callers surface the
/// latter as a prompt into the existing Cores install flow rather than
/// treating it as an unexpected failure.
pub fn resolve_native_core_path(db: &Db, system: &str) -> AppResult<PathBuf> {
    let support = native_support_for(system).ok_or_else(|| {
        AppError::Unsupported(format!("{system} is not a natively-hostable system"))
    })?;
    let repo = CoresRepo::new(db);
    let installed_path = repo
        .list(Some(support.system))?
        .into_iter()
        .find(|c| c.core_id == support.core_id)
        .and_then(|c| c.installed_path)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "{} core for {} is not installed — install it from the Cores screen \
                 before using native playback",
                support.core_id, support.system
            ))
        })?;
    Ok(PathBuf::from(installed_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::cores::install;
    use crate::db::repo::cores::NewCore;

    fn memory_db() -> Db {
        Db::open_in_memory().expect("open in-memory db")
    }

    #[test]
    fn resolves_the_installed_fceumm_path() {
        let db = memory_db();
        let repo = CoresRepo::new(&db);
        repo.add(&NewCore {
            system: NATIVE_SYSTEM.into(),
            core_id: NATIVE_CORE_ID.into(),
            installed_path: Some("/cores/nes/fceumm_libretro.dylib".into()),
            version: None,
            last_modified: None,
            active: true,
        })
        .expect("seed installed core");

        let path = resolve_native_core_path(&db, NATIVE_SYSTEM).expect("resolves");
        assert_eq!(path, PathBuf::from("/cores/nes/fceumm_libretro.dylib"));
    }

    #[test]
    fn missing_core_row_is_not_found_not_a_silent_install() {
        let db = memory_db();
        let err = resolve_native_core_path(&db, NATIVE_SYSTEM).expect_err("no fceumm row at all");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn known_but_not_yet_installed_core_is_not_found() {
        let db = memory_db();
        let repo = CoresRepo::new(&db);
        repo.add(&NewCore {
            system: NATIVE_SYSTEM.into(),
            core_id: NATIVE_CORE_ID.into(),
            installed_path: None, // catalog-known but never installed
            version: None,
            last_modified: None,
            active: false,
        })
        .expect("seed catalog-known core");

        let err = resolve_native_core_path(&db, NATIVE_SYSTEM).expect_err("installed_path is None");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn other_cores_for_a_native_system_are_not_matched() {
        let db = memory_db();
        let repo = CoresRepo::new(&db);
        repo.add(&NewCore {
            system: NATIVE_SYSTEM.into(),
            core_id: "mesen".into(), // a different NES core, not fceumm
            installed_path: Some("/cores/nes/mesen_libretro.dylib".into()),
            version: None,
            last_modified: None,
            active: true,
        })
        .expect("seed a different installed core");

        let err = resolve_native_core_path(&db, NATIVE_SYSTEM)
            .expect_err("fceumm specifically isn't installed");
        assert!(matches!(err, AppError::NotFound(_)));
    }

    /// A system with no row in the table at all (e.g. a future/unreleased
    /// cohort system) is `Unsupported`, distinct from a known-native system
    /// whose core just isn't installed yet (`NotFound`) — the frontend/IPC
    /// layer treats these differently (`Unsupported` never prompts an
    /// install; `NotFound` does).
    #[test]
    fn a_system_outside_the_table_is_unsupported_not_not_found() {
        let db = memory_db();
        let err = resolve_native_core_path(&db, "gamecube").expect_err("not in the table yet");
        assert!(matches!(err, AppError::Unsupported(_)));
    }

    #[test]
    fn is_native_capable_reflects_table_membership() {
        assert!(is_native_capable(NATIVE_SYSTEM));
        assert!(!is_native_capable("gamecube"));
    }

    #[test]
    fn native_support_for_returns_the_matching_row() {
        let row = native_support_for(NATIVE_SYSTEM).expect("nes is in the table");
        assert_eq!(row.system, "nes");
        assert_eq!(row.core_id, "fceumm");
        assert!(native_support_for("gamecube").is_none());
    }

    /// Sanity check that every table row is still a real, curated pair in the
    /// v0.7 catalog this module reuses — guards against the table drifting
    /// out of sync with `system_map`.
    #[test]
    fn every_native_row_is_a_real_curated_core() {
        for row in NATIVE_SYSTEMS {
            assert!(
                install::list_available(&memory_db(), Some(row.system))
                    .expect("catalog lookup")
                    .iter()
                    .any(|c| c.core_id == row.core_id),
                "{} / {} is not in the curated catalog",
                row.system,
                row.core_id
            );
        }
    }

    /// W342: every cohort row's core must be the system's **recommended
    /// default** (`system_map::cores_for(system)[0]`) — the native host never
    /// hosts a different core than the one the Cores screen recommends
    /// installing first for that system. NES is the one pre-existing
    /// exception (`fceumm`, not `system_map`'s recommended `mesen`) — a v0.21
    /// "Bedrock" decision predating this table (see the module doc), left
    /// untouched by this pass, so it's excluded from this specific check.
    #[test]
    fn every_cohort_row_is_a_recommended_default_core() {
        use crate::core::cores::system_map;
        for row in NATIVE_SYSTEMS.iter().filter(|r| r.system != "nes") {
            let cores = system_map::cores_for(row.system)
                .unwrap_or_else(|_| panic!("{} missing from system_map", row.system));
            assert_eq!(
                cores[0], row.core_id,
                "{}'s native row should use the recommended default core",
                row.system
            );
        }
    }

    /// W342 acceptance: the software-render cohort (SNES, Genesis, Master
    /// System, GB/GBC, GBA, Atari 2600, PC Engine) is enabled alongside NES,
    /// and W345 adds N64 (the first hardware-render row) — ten rows total.
    /// PS1 (disc-image identification, W343/W344) is deliberately excluded.
    #[test]
    fn the_software_render_cohort_and_n64_are_enabled_alongside_nes() {
        assert_eq!(NATIVE_SYSTEMS.len(), 10);
        for system in [
            "nes",
            "snes",
            "genesis",
            "mastersystem",
            "gb",
            "gbc",
            "gba",
            "atari2600",
            "pcengine",
            "n64",
        ] {
            assert!(is_native_capable(system), "{system} should be native-capable");
        }
        // Explicitly out of scope this pass.
        assert!(!is_native_capable("ps1"));
    }

    /// W345: n64 is the LAST row (per the release plan's conflict map — the
    /// W342 software cohort lands first) and maps to the recommended-default
    /// `mupen64plus_next` core.
    #[test]
    fn n64_is_the_last_row_and_uses_mupen64plus_next() {
        let last = NATIVE_SYSTEMS.last().expect("table is non-empty");
        assert_eq!(last.system, "n64");
        assert_eq!(last.core_id, "mupen64plus_next");
    }
}
