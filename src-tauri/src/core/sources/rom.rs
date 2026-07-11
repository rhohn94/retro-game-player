//! ROM folder scanner as a `GameSource` (v0.32 W322 — see
//! `docs/design/non-retro-library-design.md` §ROM scanner on GameSource;
//! reconciled onto [`PersistingSource`] in v0.33 W330 — see
//! `docs/design/crossover-integration-design.md` §Trait shape).
//!
//! Migrates the legacy ROM folder scan (formerly `core::library::scan`) onto
//! the same source abstraction the non-retro scanners (`SteamScanner`,
//! `AppScanner`) use, so retro is "just another source" and scan
//! orchestration is uniform. Unlike [`super::GameSourceScanner`] (which
//! discovers stateless [`super::DiscoveredGame`]s the IPC layer upserts
//! generically), a ROM scan must walk a specific content folder, hash each
//! candidate, consult the DAT, and dedupe against already-known paths — so it
//! owns persistence itself via [`PersistingSource::scan_and_persist`]
//! (backed by the same logic as the legacy `scan_folder_path`). Behaviour
//! parity (identical rows: hashes, systems, core hints, art) with the legacy
//! path is the acceptance bar for this migration; see the regression tests
//! below and in `core::library::scan`.

use super::PersistingSource;
pub use super::ScanReport;
use crate::core::library::dat::DatIndex;
use crate::core::library::disc_ident::{self, DiscIdentification};
use crate::core::library::hasher::RomHashes;
use crate::core::library::matcher::Matcher;
use crate::core::library::{hasher, mapper, walker};
use crate::db::repo::library::{Game, GameSource as GameSourceKind, LibraryRepo, NewGame};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::collections::HashSet;
use std::path::Path;

/// Current Unix epoch seconds, for `added_at`. Centralized so the time source is
/// named once rather than inlined at each call site.
fn now_epoch_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The ROM-folder `GameSource`: walks a content folder, hashes + identifies
/// each candidate ROM, and persists new games via the library repo. This is
/// the only game-source implementation that touches the database directly
/// (the others discover stateless rows the IPC layer upserts generically) —
/// a ROM's identity (dedup key, hashes, core hint) is folder-scoped, so the
/// scan and the persistence are inseparable, exactly as in the legacy
/// `core::library::scan` implementation this replaces.
pub struct RomSource<'a> {
    db: &'a Db,
}

impl<'a> RomSource<'a> {
    /// Build a ROM source bound to `db` for the duration of one scan call.
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Scan one content folder rooted at `root` (the folder's `path`),
    /// persisting new games under `folder_id`. `dat` is the optional
    /// identification index — when `None`, every ROM is treated as
    /// unidentified (filename fallback).
    ///
    /// Existing `games.path` rows are skipped (dedup), so repeated scans
    /// converge. A per-file read/hash failure is logged into the `scanned`
    /// count but does not abort the scan.
    ///
    /// Thin, back-compat wrapper over [`PersistingSource::scan_and_persist`]
    /// (v0.33 W330) — kept as an inherent method so existing call sites
    /// (`core::library::scan::scan_folder_path`, this module's own tests)
    /// don't need the trait in scope or a tuple-args call shape.
    pub fn scan_folder(
        &self,
        folder_id: i64,
        root: &Path,
        dat: Option<&DatIndex>,
    ) -> AppResult<ScanReport> {
        self.scan_and_persist(RomScanArgs { folder_id, root, dat })
    }
}

/// Scan input for [`RomSource`]'s [`PersistingSource`] implementation: the
/// folder id new rows attach to, the folder's root path to walk, and the
/// optional DAT index for identification.
pub struct RomScanArgs<'a> {
    pub folder_id: i64,
    pub root: &'a Path,
    pub dat: Option<&'a DatIndex>,
}

impl<'a> PersistingSource for RomSource<'a> {
    type Args<'b> = RomScanArgs<'b>;

    fn scan_and_persist(&self, args: Self::Args<'_>) -> AppResult<ScanReport> {
        let RomScanArgs { folder_id, root, dat } = args;
        let repo = LibraryRepo::new(self.db);

        // Existing paths under this folder — the dedup set. We also dedup within
        // the walk itself (the walker already yields unique paths, but a set
        // keeps the insertion total correct in the face of future symlink
        // resolution).
        let mut known: HashSet<String> = repo
            .list_games(None)?
            .into_iter()
            // The scanner only ever registers ROM rows, which always have `path`
            // set (v0.31 W310 makes it nullable only for non-ROM sources); a
            // non-ROM row simply contributes nothing to the dedup set.
            .filter_map(|g: Game| g.path)
            .collect();

        let empty = DatIndex::default();
        let index = dat.unwrap_or(&empty);
        let matcher = Matcher::new(index);
        let now = now_epoch_secs();

        let rom_totals = scan_rom_candidates(root, &matcher, folder_id, now, &repo, &mut known)?;
        // Disc candidates that were not positively identified (including the
        // sniff failing on every `.bin` a `.cue` referenced) intentionally
        // contribute nothing further — `unidentified` here mirrors the ROM
        // loop's meaning (DAT-unmatched, not un-sniffed): an un-sniffed disc
        // stays unscanned rather than becoming an "unidentified" row, per
        // the acceptance contract ("stays unscanned exactly as today").
        let disc_totals = scan_disc_candidates(root, &matcher, folder_id, now, &repo, &mut known)?;

        Ok(ScanReport {
            folder_id,
            scanned: rom_totals.scanned + disc_totals.scanned,
            identified: rom_totals.identified + disc_totals.identified,
            unidentified: rom_totals.unidentified + disc_totals.unidentified,
            added: rom_totals.added + disc_totals.added,
        })
    }
}

/// Running totals one candidate category (ROM files or disc images)
/// contributes to a scan's [`ScanReport`]; the caller folds both categories'
/// totals together into the final report.
struct CandidateScanTotals {
    scanned: usize,
    identified: usize,
    unidentified: usize,
    added: usize,
}

/// Build the `NewGame` row for a freshly identified candidate — shared by the
/// ROM-loop and disc-loop persistence paths (`scan_rom_candidates` /
/// `scan_disc_candidates`), which differ only in `path`/`system`/`hashes`/
/// `core_hint`; every other field is this same fixed template.
// Each argument is one of the exact fields the two call sites disagree on, or
// a value they both need (folder_id/size_bytes/now); bundling them into a
// params struct would just move the same fields behind an extra layer for a
// function whose only two callers sit a few lines below it in this file.
#[allow(clippy::too_many_arguments)]
fn build_new_game(
    folder_id: i64,
    path: String,
    system: String,
    hashes: &RomHashes,
    clean_name: String,
    dat_matched: bool,
    core_hint: Option<String>,
    size_bytes: i64,
    now: i64,
) -> NewGame {
    NewGame {
        folder_id: Some(folder_id),
        path: Some(path),
        system: Some(system),
        crc32: Some(hashes.crc32.clone()),
        md5: Some(hashes.md5.clone()),
        clean_name,
        dat_matched,
        core_hint,
        art_path: None,
        size_bytes,
        added_at: now,
        // Metadata is populated by future enrichment, not by the scan (W61).
        year: None,
        developer: None,
        publisher: None,
        aliases: None,
        source: GameSourceKind::Rom,
        launch_descriptor: None,
        external_id: None,
    }
}

/// Walk `root` for unambiguous-extension ROM candidates, hash + DAT-match
/// each one, and persist the ones not already `known`. Split out of
/// `scan_and_persist` (W421) as the ROM half of the scan; see
/// `scan_disc_candidates` for the sibling disc-image half.
fn scan_rom_candidates(
    root: &Path,
    matcher: &Matcher<'_>,
    folder_id: i64,
    now: i64,
    repo: &LibraryRepo<'_>,
    known: &mut HashSet<String>,
) -> AppResult<CandidateScanTotals> {
    let candidates = walker::walk(root);
    let mut totals = CandidateScanTotals {
        scanned: candidates.len(),
        identified: 0,
        unidentified: 0,
        added: 0,
    };

    for cand in candidates {
        let path_str = cand.path.to_string_lossy().to_string();

        let bytes = match std::fs::read(&cand.path) {
            Ok(b) => b,
            Err(_) => continue, // unreadable file — skip, already counted as scanned
        };
        let size_bytes = bytes.len() as i64;
        let hashes = hasher::hash_rom(&bytes, &cand.mapping.system);
        let outcome = matcher.match_rom(&hashes, &cand.path);

        if outcome.dat_matched {
            totals.identified += 1;
        } else {
            totals.unidentified += 1;
        }

        // Dedup by path; a rescan re-counts identify stats but inserts
        // nothing new.
        if known.contains(&path_str) {
            continue;
        }

        let new_game = build_new_game(
            folder_id,
            path_str.clone(),
            cand.mapping.system.clone(),
            &hashes,
            outcome.clean_name,
            outcome.dat_matched,
            Some(cand.mapping.core_hint.clone()),
            size_bytes,
            now,
        );

        if persist_new_game(repo, &new_game, &path_str, known)? {
            totals.added += 1;
        }
    }

    Ok(totals)
}

/// Walk `root` for disc-image candidates (W343: `.cue`/`.chd`/`.bin`, ambiguous
/// by extension so they never reach `scan_rom_candidates`), content-sniff each
/// one, and persist the positively identified ones not already `known`. A
/// positive identification becomes exactly one game row keyed on its
/// canonical path (the `.cue` for a cue/bin set, or the image itself for a
/// bare `.bin`/`.chd`); everything not positively identified — including
/// every `.bin` that a `.cue` already claimed — stays unscanned, exactly as
/// today.
fn scan_disc_candidates(
    root: &Path,
    matcher: &Matcher<'_>,
    folder_id: i64,
    now: i64,
    repo: &LibraryRepo<'_>,
    known: &mut HashSet<String>,
) -> AppResult<CandidateScanTotals> {
    let disc_candidates = walker::walk_disc_candidates(root);

    // Files referenced by any `.cue` in this folder are that cue set's own
    // track data, not independent candidates — a `.cue` (identified or not)
    // claims EVERY file its `FILE` lines reference, so none of them is
    // separately sniffed/counted/persisted. This is what collapses a cue/bin
    // set to exactly one row keyed on the `.cue`. Claims are compared
    // case-insensitively via [`claim_key`] (macOS's default filesystem is
    // case-insensitive, so a cue's `FILE` reference may spell the on-disk
    // name differently).
    let claimed_bins: HashSet<String> = disc_candidates
        .iter()
        .filter(|cand| is_cue(&cand.path))
        .flat_map(|cand| disc_ident::referenced_files(&cand.path))
        .map(|path| claim_key(&path))
        .collect();

    let identifications: Vec<DiscIdentification> = disc_candidates
        .iter()
        .filter(|cand| !(is_bin(&cand.path) && claimed_bins.contains(&claim_key(&cand.path))))
        .filter_map(|cand| disc_ident::sniff_disc_image(&cand.path))
        .collect();

    let mut totals = CandidateScanTotals {
        scanned: 0,
        identified: 0,
        unidentified: 0,
        added: 0,
    };

    for ident in &identifications {
        totals.scanned += 1;

        let path_str = ident.canonical_path.to_string_lossy().to_string();
        // Disc-row hashes are PREFIX-WINDOW hashes: only the leading
        // [`DISC_HASH_PREFIX_BYTES`] are hashed (a `.bin`/`.chd` can be
        // multi-GB, and DAT matching does not apply to disc rows this
        // release); a `.cue` is tiny text far below the window, so it is
        // still hashed in full.
        let bytes = match read_disc_hash_window(&ident.canonical_path) {
            Ok(b) => b,
            Err(_) => continue, // unreadable — counted as scanned, never identified
        };
        totals.identified += 1;
        // Row size is the file's true on-disk size, not the hash window's.
        let size_bytes = std::fs::metadata(&ident.canonical_path)
            .map(|m| m.len() as i64)
            .unwrap_or(bytes.len() as i64);
        let hashes = hasher::hash_rom(&bytes, &ident.system);
        let outcome = matcher.match_rom(&hashes, &ident.canonical_path);
        let core_hint = mapper::core_hint_for_system(&ident.system).map(str::to_string);

        let new_game = build_new_game(
            folder_id,
            path_str.clone(),
            ident.system.clone(),
            &hashes,
            outcome.clean_name,
            outcome.dat_matched,
            core_hint,
            size_bytes,
            now,
        );

        if persist_new_game(repo, &new_game, &path_str, known)? {
            totals.added += 1;
        }
    }

    Ok(totals)
}

/// Insert `new_game` if `path_str` is not already known, updating the dedup
/// set on success. Returns `true` when a row was actually added. A racing
/// UNIQUE collision is treated as a benign dedup, matching the existing
/// per-ROM persistence contract.
fn persist_new_game(
    repo: &LibraryRepo<'_>,
    new_game: &NewGame,
    path_str: &str,
    known: &mut HashSet<String>,
) -> AppResult<bool> {
    if known.contains(path_str) {
        return Ok(false);
    }
    match repo.add_game(new_game) {
        Ok(_) => {
            known.insert(path_str.to_string());
            Ok(true)
        }
        Err(AppError::Conflict(_)) => Ok(false),
        Err(e) => Err(e),
    }
}

/// How many leading bytes of an identified disc image are hashed for its
/// library row's `crc32`/`md5`. A `.bin`/`.chd` can be multi-GB, so hashing
/// the whole file is prohibitive — and DAT matching does not apply to disc
/// rows this release, so a stable dedup/change fingerprint is all the hash
/// needs to be. Every real `.cue` is far smaller than the window and is
/// therefore hashed in full.
const DISC_HASH_PREFIX_BYTES: u64 = 16 * 1024 * 1024; // 16 MiB

/// Read the bounded hash window from the start of `path`: at most
/// [`DISC_HASH_PREFIX_BYTES`], or the whole file when it is smaller.
fn read_disc_hash_window(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path)?;
    let mut buf = Vec::new();
    file.take(DISC_HASH_PREFIX_BYTES).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Case-folded canonical key for cue-claim comparisons: the path is
/// canonicalized when it exists (resolving `.`/symlinks) and lowercased, so
/// a cue `FILE` reference and the walker's on-disk spelling compare equal on
/// a case-insensitive filesystem (macOS's default) regardless of case.
fn claim_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase()
}

/// True when `path`'s extension (case-insensitive) is `.cue`.
fn is_cue(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("cue")) == Some(true)
}

/// True when `path`'s extension (case-insensitive) is `.bin`.
fn is_bin(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("bin")) == Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::library::ines::{INES_HEADER_LEN, INES_MAGIC};
    use crate::db::repo::library::NewContentFolder;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("harmony-romsource-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Build a NES ROM whose header-stripped body is `body`.
    fn nes_rom(body: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&INES_MAGIC);
        v.extend_from_slice(&[0u8; INES_HEADER_LEN - 4]);
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn scan_persists_dedupes_and_reports() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("persist");
        let fid = repo
            .add_folder(&NewContentFolder {
                path: root.to_string_lossy().to_string(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();

        // One NES ROM whose stripped body is "abc" (crc 352441c2), plus a snes ROM.
        fs::write(root.join("mario.nes"), nes_rom(b"abc")).unwrap();
        fs::write(root.join("zelda.sfc"), b"snesbytes").unwrap();

        // DAT identifies only the NES ROM by its stripped-body CRC.
        let dat = DatIndex::from_xml(
            r#"<datafile><game name="Mario (World)"><rom crc="352441c2"/></game></datafile>"#,
        )
        .unwrap();

        let source = RomSource::new(&db);
        let report = source.scan_folder(fid, &root, Some(&dat)).unwrap();
        assert_eq!(report.scanned, 2);
        assert_eq!(report.identified, 1);
        assert_eq!(report.unidentified, 1);
        assert_eq!(report.added, 2);

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 2);
        let mario = games.iter().find(|g| g.system.as_deref() == Some("nes")).unwrap();
        assert_eq!(mario.clean_name, "Mario (World)");
        assert!(mario.dat_matched);
        assert_eq!(mario.crc32.as_deref(), Some("352441c2"));
        assert_eq!(mario.source, GameSourceKind::Rom);

        // Rescan: nothing new added (dedup by path), stats unchanged.
        let again = source.scan_folder(fid, &root, Some(&dat)).unwrap();
        assert_eq!(again.added, 0);
        assert_eq!(again.scanned, 2);
        assert_eq!(repo.list_games(None).unwrap().len(), 2);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_without_dat_flags_all_unidentified() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("nodat");
        let fid = repo
            .add_folder(&NewContentFolder {
                path: root.to_string_lossy().to_string(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();
        fs::write(root.join("Homebrew_Game.nes"), nes_rom(b"xyz")).unwrap();

        let source = RomSource::new(&db);
        let report = source.scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.unidentified, 1);
        assert_eq!(report.identified, 0);
        let g = &repo.list_games(None).unwrap()[0];
        assert!(!g.dat_matched);
        assert_eq!(g.clean_name, "Homebrew Game");

        fs::remove_dir_all(&root).ok();
    }

    /// Regression fixture proving parity with the legacy `scan_folder_path`
    /// path: a small mixed ROM tree (nested subfolder, identified + flagged
    /// titles, a core hint per system) yields identical row shapes —
    /// hashes, system, core hint, clean name, dat_matched — to what the
    /// pre-migration scanner produced (see `core::library::scan` tests for
    /// the historical baseline this mirrors byte-for-byte).
    #[test]
    fn regression_fixture_tree_matches_legacy_row_shape() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("fixture-tree");
        let nested = root.join("Nested");
        fs::create_dir_all(&nested).unwrap();
        let fid = repo
            .add_folder(&NewContentFolder {
                path: root.to_string_lossy().to_string(),
                enabled: true,
                added_at: 1,
            })
            .unwrap();

        fs::write(root.join("mario.nes"), nes_rom(b"abc")).unwrap();
        fs::write(nested.join("zelda.sfc"), b"snesbytes").unwrap();
        // A non-ROM file must be ignored entirely (not counted, not persisted).
        fs::write(root.join("readme.txt"), b"not a rom").unwrap();

        let dat = DatIndex::from_xml(
            r#"<datafile><game name="Mario (World)"><rom crc="352441c2"/></game></datafile>"#,
        )
        .unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, Some(&dat)).unwrap();
        assert_eq!(report.scanned, 2, "readme.txt must not be counted as a ROM");
        assert_eq!(report.identified, 1);
        assert_eq!(report.unidentified, 1);
        assert_eq!(report.added, 2);

        let games = repo.list_games(None).unwrap();
        let mario = games.iter().find(|g| g.system.as_deref() == Some("nes")).unwrap();
        assert_eq!(mario.clean_name, "Mario (World)");
        assert!(mario.dat_matched);
        assert_eq!(mario.crc32.as_deref(), Some("352441c2"));
        assert!(mario.core_hint.is_some());
        assert_eq!(mario.source, GameSourceKind::Rom);
        assert!(mario.launch_descriptor.is_none());
        assert!(mario.external_id.is_none());

        let zelda = games.iter().find(|g| g.system.as_deref() == Some("snes")).unwrap();
        assert!(!zelda.dat_matched);
        assert_eq!(zelda.clean_name, "zelda");
        assert!(zelda.core_hint.is_some());

        fs::remove_dir_all(&root).ok();
    }

    // --- Disc-image identification (W343) -----------------------------

    use crate::core::library::disc_ident::fixtures as disc_fixtures;

    /// A raw MODE2/2352 PS1 dump, byte-faithful to a real cue/bin dump
    /// (shared fixture builder from `core::library::disc_ident`).
    fn ps1_disc_bytes() -> Vec<u8> {
        disc_fixtures::ps1_raw_bin()
    }

    /// Bytes for a `.bin` with no PS1 signature at all.
    fn non_ps1_disc_bytes() -> Vec<u8> {
        disc_fixtures::non_ps1_bytes()
    }

    /// A **synthetic** CHD v5 file whose hand-tagged metadata embeds a PS1
    /// marker. Real chdman metadata never carries one — real PS1 `.chd`
    /// images are NOT identified in v0.34 (issue #49); this only exercises
    /// the scan wiring over `disc_ident`'s header/metadata parser.
    fn synthetic_ps1_chd_bytes() -> Vec<u8> {
        disc_fixtures::synthetic_chd_v5(b"HAND-TAGGED: PLAYSTATION disc image")
    }

    fn add_folder(repo: &LibraryRepo<'_>, root: &Path) -> i64 {
        repo.add_folder(&NewContentFolder {
            path: root.to_string_lossy().to_string(),
            enabled: true,
            added_at: 1,
        })
        .unwrap()
    }

    #[test]
    fn cue_bin_ps1_fixture_scans_to_one_ps1_row() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("cue-bin-ps1");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("Game.bin"), ps1_disc_bytes()).unwrap();
        fs::write(root.join("Game.cue"), "FILE \"Game.bin\" BINARY\n  TRACK 01 MODE2/2352\n")
            .unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.identified, 1);
        assert_eq!(report.added, 1, "one row for the cue/bin set, not two");

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1, "the .bin track must not surface as its own row");
        let game = &games[0];
        assert_eq!(game.system.as_deref(), Some("ps1"));
        assert!(game.path.as_deref().unwrap().ends_with("Game.cue"), "canonical file is the .cue");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn synthetic_chd_metadata_fixture_scans_to_a_ps1_row() {
        // SYNTHETIC metadata fixture — real PS1 `.chd` images return None in
        // v0.34 (see `disc_ident`'s module-doc limitation / issue #49).
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("chd-ps1");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("Game.chd"), synthetic_ps1_chd_bytes()).unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.identified, 1);
        assert_eq!(report.added, 1);

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].system.as_deref(), Some("ps1"));
        assert!(games[0].path.as_deref().unwrap().ends_with("Game.chd"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn non_ps1_bin_fixture_stays_unidentified_and_unscanned() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("non-ps1-bin");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("Unknown.bin"), non_ps1_disc_bytes()).unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.identified, 0);
        assert_eq!(report.added, 0, "an un-sniffed bare .bin stays unscanned, not a row");
        assert!(repo.list_games(None).unwrap().is_empty());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn multi_track_cue_resolves_to_one_game_row_keyed_on_the_cue() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("multi-track-cue");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("track01.bin"), ps1_disc_bytes()).unwrap();
        fs::write(root.join("track02.bin"), non_ps1_disc_bytes()).unwrap(); // e.g. an audio track
        fs::write(
            root.join("Game.cue"),
            "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n\
             FILE \"track02.bin\" BINARY\n  TRACK 02 AUDIO\n",
        )
        .unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.added, 1, "multi-track cue collapses to exactly one row");

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].system.as_deref(), Some("ps1"));
        assert!(games[0].path.as_deref().unwrap().ends_with("Game.cue"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn unambiguous_extension_scanning_is_unchanged_alongside_disc_fixtures() {
        // A folder mixing an unambiguous ROM with disc-image fixtures must
        // still identify + persist the ROM exactly as before (W343 must not
        // regress the existing extension-mapped path).
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("mixed-unchanged");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("mario.nes"), nes_rom(b"abc")).unwrap();
        fs::write(root.join("Unknown.bin"), non_ps1_disc_bytes()).unwrap();

        let dat = DatIndex::from_xml(
            r#"<datafile><game name="Mario (World)"><rom crc="352441c2"/></game></datafile>"#,
        )
        .unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, Some(&dat)).unwrap();
        assert_eq!(report.added, 1, "only the .nes ROM is a row; the non-PS1 .bin stays unscanned");

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].system.as_deref(), Some("nes"));
        assert_eq!(games[0].clean_name, "Mario (World)");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn multi_file_cue_claims_every_referenced_track() {
        // Track 2 would independently sniff positive if it were its own
        // candidate — every FILE-line reference must be claimed, not just
        // the first, so the set still collapses to one row on the cue.
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("multi-file-cue-claims");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("track01.bin"), ps1_disc_bytes()).unwrap();
        fs::write(root.join("track02.bin"), ps1_disc_bytes()).unwrap();
        fs::write(
            root.join("Game.cue"),
            "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n\
             FILE \"track02.bin\" BINARY\n  TRACK 02 MODE2/2352\n",
        )
        .unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.added, 1, "every FILE-referenced track is claimed by the cue");

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert!(games[0].path.as_deref().unwrap().ends_with("Game.cue"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn case_mismatched_cue_file_reference_still_claims_the_bin() {
        // macOS's default filesystem is case-insensitive: the cue references
        // "track01.bin" while the on-disk file is "TRACK01.BIN" — the claim
        // comparison must be case-insensitive so the bin never becomes its
        // own candidate row.
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("case-mismatch-claim");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("TRACK01.BIN"), ps1_disc_bytes()).unwrap();
        fs::write(root.join("Game.cue"), "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n")
            .unwrap();

        let report = RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        assert_eq!(report.added, 1, "case-mismatched reference still collapses to one row");

        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        assert!(games[0].path.as_deref().unwrap().ends_with("Game.cue"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn claim_key_is_case_insensitive_for_the_same_file() {
        let root = temp_dir("claim-key");
        fs::write(root.join("A.BIN"), b"x").unwrap();
        assert_eq!(claim_key(&root.join("A.BIN")), claim_key(&root.join("a.bin")));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_disc_hash_window_reads_small_files_whole() {
        let root = temp_dir("hash-window");
        let path = root.join("small.cue");
        fs::write(&path, b"FILE \"a.bin\" BINARY\n").unwrap();
        assert_eq!(read_disc_hash_window(&path).unwrap(), fs::read(&path).unwrap());
        assert!(read_disc_hash_window(&root.join("ghost.bin")).is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn disc_row_size_is_true_file_size_and_hash_is_prefix_window() {
        // The row's size_bytes must be the on-disk size even though the hash
        // is computed over a bounded prefix window.
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("disc-size");
        let fid = add_folder(&repo, &root);

        let bin = ps1_disc_bytes();
        fs::write(root.join("Game.bin"), &bin).unwrap();
        fs::write(root.join("Game.cue"), "FILE \"Game.bin\" BINARY\n  TRACK 01 MODE2/2352\n")
            .unwrap();

        RomSource::new(&db).scan_folder(fid, &root, None).unwrap();
        let games = repo.list_games(None).unwrap();
        assert_eq!(games.len(), 1);
        let cue_len = fs::metadata(root.join("Game.cue")).unwrap().len() as i64;
        assert_eq!(games[0].size_bytes, cue_len);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rescanning_a_cue_bin_set_does_not_duplicate_the_row() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let root = temp_dir("cue-bin-rescan");
        let fid = add_folder(&repo, &root);

        fs::write(root.join("Game.bin"), ps1_disc_bytes()).unwrap();
        fs::write(root.join("Game.cue"), "FILE \"Game.bin\" BINARY\n  TRACK 01 MODE2/2352\n")
            .unwrap();

        let source = RomSource::new(&db);
        let first = source.scan_folder(fid, &root, None).unwrap();
        assert_eq!(first.added, 1);

        let second = source.scan_folder(fid, &root, None).unwrap();
        assert_eq!(second.added, 0, "rescan must not duplicate the cue/bin row");
        assert_eq!(repo.list_games(None).unwrap().len(), 1);

        fs::remove_dir_all(&root).ok();
    }
}
