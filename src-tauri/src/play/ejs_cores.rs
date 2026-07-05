//! On-demand EmulatorJS WASM core acquisition (v0.24 W241, #17).
//!
//! v0.15 embeds exactly one in-page core (NES `fceumm`) in the binary; this
//! module extends in-page play to the rest of the high-value catalog without
//! growing the bundle. A static curated catalog pins each core's
//! version-locked CDN URL and SHA-256; [`install`] downloads + verifies +
//! atomically caches the core archive and its report JSON under
//! `app-support/ejs-cores/<ejs-version>/`, and the play server serves that
//! cache ahead of the embedded bundle so the EmulatorJS loader can't tell
//! the tiers apart. Design: docs/design/in-page-play-design.md §7.

use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

/// The vendored EmulatorJS version (matches `vendor/emulatorjs/version.json`).
/// Cores are downloaded from the version-pinned CDN path so runtime/core
/// compatibility is frozen together; bumping the vendored runtime forces
/// re-curation of every hash below by construction.
pub const EJS_VERSION: &str = "4.2.3";

/// Version-pinned CDN base for core archives + reports (https-only).
const CDN_BASE: &str = "https://cdn.emulatorjs.org/4.2.3/data/cores/";

/// Upper bound on a downloaded core archive — the largest curated core is
/// ~1.5 MiB; 8 MiB leaves generous headroom while bounding a misbehaving
/// response.
const ARCHIVE_CAP: usize = 8 * 1024 * 1024;

/// One curated on-demand core. `core` doubles as the `EJS_core` value the
/// player page receives (an explicit core name — EmulatorJS resolves it
/// as-is when it isn't a system alias).
pub struct EjsCoreEntry {
    /// EmulatorJS core name (e.g. `snes9x`).
    pub core: &'static str,
    /// Harmony system keys this core covers (`Game.system` values).
    pub systems: &'static [&'static str],
    /// SHA-256 (lowercase hex) of `<core>-wasm.data`, pinned 2026-07-01.
    pub archive_sha256: &'static str,
    /// SHA-256 (lowercase hex) of `reports/<core>.json`, pinned 2026-07-01.
    pub report_sha256: &'static str,
    /// Approximate archive size, for the UI's "Get core · N MB" affordance.
    pub size_bytes: u64,
    /// Upstream license (surfaced in THIRD-PARTY-NOTICES.md).
    pub license: &'static str,
}

impl EjsCoreEntry {
    /// The archive filename the EmulatorJS loader requests.
    pub fn archive_name(&self) -> String {
        format!("{}-wasm.data", self.core)
    }

    /// The report path (relative to the `cores/` URL segment) the loader
    /// requests before the archive.
    pub fn report_name(&self) -> String {
        format!("reports/{}.json", self.core)
    }
}

/// The curated catalog. NES (`fceumm`) is *not* here — it ships embedded in
/// the binary (v0.15) and needs no acquisition. All entries are
/// single-threaded cores (no COOP/COEP / `SharedArrayBuffer` requirement).
pub const CATALOG: &[EjsCoreEntry] = &[
    EjsCoreEntry {
        core: "snes9x",
        systems: &["snes"],
        archive_sha256: "eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee",
        report_sha256: "dc7ac963eb7935a7ac78956235ac0b8912ec785c57026336825aa2ed8031b3ad",
        size_bytes: 1_093_765,
        license: "Snes9x (non-commercial)",
    },
    EjsCoreEntry {
        core: "genesis_plus_gx",
        systems: &["genesis", "mastersystem"],
        archive_sha256: "190297a6f86757405090f1a2266f67dfe1a570a528c583434ed3641a5664f768",
        report_sha256: "5936a8ce8d7f010d5bfdd8c3bba2b2414f103b3a703121e56f2724b24dbe7ff3",
        size_bytes: 1_203_661,
        license: "Genesis-Plus-GX (non-commercial)",
    },
    EjsCoreEntry {
        core: "mupen64plus_next",
        systems: &["n64"],
        archive_sha256: "2da1cbce9fda395e3ae83ca5787353baa159142d45ef3ea90f108b92524f76cc",
        report_sha256: "270105553cec57fd1058c50e0541b8b89dbd30b2323fd70682036f6919b805cc",
        size_bytes: 1_451_795,
        license: "GPL-3.0",
    },
    EjsCoreEntry {
        core: "pcsx_rearmed",
        systems: &["ps1"],
        archive_sha256: "fe5515f6c29f093f0e8c01824b213804f1f76eb9cb4c97c72fe2cc17606bfbc2",
        report_sha256: "93b99266955ab16e9aa0faa0d6338f4a29b50c197764dd48be945573a5b449c1",
        size_bytes: 1_039_627,
        license: "GPL-2.0",
    },
    EjsCoreEntry {
        core: "stella2014",
        systems: &["atari2600"],
        archive_sha256: "6c96c6b1746f3f05ca599066abe131a36c77ca61fc20a9e2a7560540457c487d",
        report_sha256: "c9920b95db48f678294daa72a289c19846e74ba69ca6d6094a76fb9f560fb39a",
        size_bytes: 1_051_659,
        license: "GPL-2.0",
    },
    EjsCoreEntry {
        core: "mednafen_pce",
        systems: &["pcengine"],
        archive_sha256: "29cebda0c7a93bbcb5e67e97fe28a1886bd030715d5a25224e7d9175d1d985c3",
        report_sha256: "3c82092f1433cc2cf0d9265e137f44c5a80f5a7dfbfcb712ef659797299a67ca",
        size_bytes: 994_844,
        license: "GPL-2.0",
    },
    // Handhelds (v0.34, W341) — pinned 2026-07-05 against the same
    // version-locked CDN. Wii has no EJS entry (external launch only).
    EjsCoreEntry {
        core: "gambatte",
        systems: &["gb", "gbc"],
        archive_sha256: "ad67c7bf57f8f8b62606048e6ea498afac5b5abc76ad8de5f9dfc2a6719374bb",
        report_sha256: "a240a47bd6b2a38a6c46ee63c80bdcd24befbd50474453df4898d49282bd5f57",
        size_bytes: 967_156,
        license: "GPLv2+",
    },
    EjsCoreEntry {
        core: "mgba",
        systems: &["gba"],
        archive_sha256: "01fcaf6d4296ef1db6676e0c69400c4474e24572d0b2b99cc097e4ae885e02d7",
        report_sha256: "08219f6c855a9d996f04ed21169bb0c5ac64d469a8a536468b9876205b5c268d",
        size_bytes: 1_055_616,
        license: "MPL-2.0",
    },
];

/// The catalog entry covering `system`, if any.
pub fn entry_for_system(system: &str) -> Option<&'static EjsCoreEntry> {
    CATALOG.iter().find(|e| e.systems.contains(&system))
}

/// The versioned cache dir under the app-support `ejs-cores/` root.
pub fn version_dir(ejs_cores_root: &Path) -> PathBuf {
    ejs_cores_root.join(EJS_VERSION)
}

/// Whether `entry`'s archive **and** report are both cached on disk.
pub fn is_installed(ejs_cores_root: &Path, entry: &EjsCoreEntry) -> bool {
    let dir = version_dir(ejs_cores_root);
    dir.join(entry.archive_name()).is_file() && dir.join(entry.report_name()).is_file()
}

/// Resolves a `cores/…`-relative URL path (as requested by the EmulatorJS
/// loader under `/emulatorjs/cores/`) to a cached file on disk, if present.
/// Rejects any path with a non-normal component (`..`, absolute, …) before
/// touching the filesystem.
pub fn cached_file(ejs_cores_root: &Path, rel: &str) -> Option<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    let candidate = version_dir(ejs_cores_root).join(rel_path);
    candidate.is_file().then_some(candidate)
}

/// Downloads, verifies, and caches `entry` (archive + report). Idempotent —
/// an already-installed core returns `Ok` without touching the network. A
/// hash or size failure leaves no partial cache behind.
pub fn install(ejs_cores_root: &Path, entry: &EjsCoreEntry) -> AppResult<()> {
    if is_installed(ejs_cores_root, entry) {
        return Ok(());
    }
    let archive = fetch_verified(&entry.archive_name(), entry.archive_sha256)?;
    let report = fetch_verified(&entry.report_name(), entry.report_sha256)?;
    let dir = version_dir(ejs_cores_root);
    write_atomic(&dir.join(entry.report_name()), &report)?;
    write_atomic(&dir.join(entry.archive_name()), &archive)?;
    Ok(())
}

/// GET `CDN_BASE + name`, capped at [`ARCHIVE_CAP`], verified against
/// `expected_sha256` before returning.
fn fetch_verified(name: &str, expected_sha256: &str) -> AppResult<Vec<u8>> {
    use std::io::Read;
    let url = format!("{CDN_BASE}{name}");
    let response = reqwest::blocking::get(&url)
        .map_err(|e| AppError::Network(format!("GET {url}: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Network(format!("GET {url}: {e}")))?;
    let mut bytes = Vec::new();
    response
        .take((ARCHIVE_CAP + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| AppError::Network(format!("reading {url}: {e}")))?;
    if bytes.len() > ARCHIVE_CAP {
        return Err(AppError::Validation(format!(
            "core download exceeds the {ARCHIVE_CAP}-byte cap: {name}"
        )));
    }
    let actual = hex_sha256(&bytes);
    if actual != expected_sha256 {
        return Err(AppError::Validation(format!(
            "core download hash mismatch for {name}: expected {expected_sha256}, got {actual}"
        )));
    }
    Ok(bytes)
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// tmp-then-rename write, creating parent dirs — a crash mid-write never
/// leaves a partial file where [`cached_file`] would serve it.
fn write_atomic(dest: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::Internal(format!("no parent dir for {}", dest.display())))?;
    std::fs::create_dir_all(parent)?;
    let tmp = dest.with_extension("tmp-download");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_entries_are_well_formed_and_unique() {
        let mut seen_cores = std::collections::HashSet::new();
        let mut seen_systems = std::collections::HashSet::new();
        for entry in CATALOG {
            assert!(seen_cores.insert(entry.core), "duplicate core {}", entry.core);
            assert_eq!(entry.archive_sha256.len(), 64, "{}: bad archive hash", entry.core);
            assert_eq!(entry.report_sha256.len(), 64, "{}: bad report hash", entry.core);
            assert!(entry.size_bytes > 0 && entry.size_bytes < ARCHIVE_CAP as u64);
            assert!(!entry.systems.is_empty());
            for system in entry.systems {
                assert!(seen_systems.insert(*system), "system {system} mapped twice");
            }
        }
    }

    #[test]
    fn entry_for_system_finds_shared_core_systems() {
        assert_eq!(entry_for_system("snes").unwrap().core, "snes9x");
        assert_eq!(entry_for_system("genesis").unwrap().core, "genesis_plus_gx");
        assert_eq!(entry_for_system("mastersystem").unwrap().core, "genesis_plus_gx");
        assert!(entry_for_system("nes").is_none()); // embedded, not on-demand
        assert!(entry_for_system("dreamcast").is_none());
    }

    #[test]
    fn entry_for_system_covers_handhelds_and_excludes_wii() {
        // v0.34: gb/gbc share gambatte; gba gets mgba. Wii is external-launch
        // only and must resolve to no on-demand entry.
        assert_eq!(entry_for_system("gb").unwrap().core, "gambatte");
        assert_eq!(entry_for_system("gbc").unwrap().core, "gambatte");
        assert_eq!(entry_for_system("gba").unwrap().core, "mgba");
        assert!(entry_for_system("wii").is_none());
    }

    #[test]
    fn cached_file_rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(cached_file(tmp.path(), "../secrets.txt").is_none());
        assert!(cached_file(tmp.path(), "/etc/passwd").is_none());
        assert!(cached_file(tmp.path(), "reports/../../x").is_none());
    }

    #[test]
    fn cached_file_resolves_only_existing_files() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(cached_file(tmp.path(), "snes9x-wasm.data").is_none());
        let dir = version_dir(tmp.path()).join("reports");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("snes9x.json"), b"{}").unwrap();
        let hit = cached_file(tmp.path(), "reports/snes9x.json").unwrap();
        assert!(hit.ends_with("4.2.3/reports/snes9x.json"));
    }

    #[test]
    fn is_installed_requires_both_archive_and_report() {
        let tmp = tempfile::tempdir().unwrap();
        let entry = &CATALOG[0];
        assert!(!is_installed(tmp.path(), entry));
        let dir = version_dir(tmp.path());
        std::fs::create_dir_all(dir.join("reports")).unwrap();
        std::fs::write(dir.join(entry.archive_name()), b"x").unwrap();
        assert!(!is_installed(tmp.path(), entry)); // report still missing
        std::fs::write(dir.join(entry.report_name()), b"{}").unwrap();
        assert!(is_installed(tmp.path(), entry));
    }

    #[test]
    fn write_atomic_creates_parents_and_leaves_no_tmp() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("a/b/c.bin");
        write_atomic(&dest, b"data").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"data");
        assert!(!dest.with_extension("tmp-download").exists());
    }

    /// Manual, network-hitting verification of the full install path against
    /// the real pinned CDN (not run by `cargo test`):
    ///
    /// ```text
    /// cargo test -p harmony manual_install_verifies_and_caches -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore]
    fn manual_install_verifies_and_caches_a_real_core() {
        let tmp = tempfile::tempdir().unwrap();
        let entry = entry_for_system("atari2600").unwrap(); // smallest-ish core
        install(tmp.path(), entry).expect("install should download + verify");
        assert!(is_installed(tmp.path(), entry));
        let archive = version_dir(tmp.path()).join(entry.archive_name());
        let size = std::fs::metadata(&archive).unwrap().len();
        println!("installed {} ({size} bytes)", entry.core);
        assert_eq!(size, entry.size_bytes);
        // Idempotent: a second call is a no-op success.
        install(tmp.path(), entry).expect("re-install should be a no-op");
    }

    #[test]
    fn hex_sha256_matches_known_vector() {
        // sha256("abc") — FIPS 180-2 test vector.
        assert_eq!(
            hex_sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
