//! Recursive content-folder walker (W6; extended in W343 for disc images).
//!
//! Walks a content folder, yielding every regular file whose extension Harmony
//! recognizes as a ROM (see [`super::mapper`]). Symlinks are not followed and
//! unreadable entries are skipped rather than aborting the whole scan — a single
//! bad file should never sink an otherwise-good library scan.
//!
//! Ambiguous disc-container extensions (`.cue`/`.chd`/`.bin`, see
//! [`super::disc_ident`]) are collected separately from unambiguous ROM
//! candidates: they cannot be mapped to a system by extension alone, so they
//! are surfaced via [`walk_disc_candidates`] for the scanner to content-sniff.

use super::disc_ident::is_ambiguous_disc_extension;
use super::mapper::{is_rom_extension, map_extension, SystemMapping};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// A ROM file the walker found, with its resolved system mapping pre-computed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RomCandidate {
    /// Absolute path to the ROM file.
    pub path: PathBuf,
    /// System + suggested core resolved from the extension.
    pub mapping: SystemMapping,
}

/// A disc-container file (`.cue`/`.chd`/`.bin`) the walker found, not yet
/// identified — the scanner content-sniffs it via [`super::disc_ident`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscCandidate {
    /// Absolute path to the container file.
    pub path: PathBuf,
}

/// Lowercase extension (no dot) of `path`, or `None` if it has none.
fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

/// Recursively collect ROM candidates under `root`. Non-ROM files, directories,
/// and unreadable entries are skipped. The result is sorted by path for stable,
/// deterministic scans (and deterministic tests).
pub fn walk(root: &Path) -> Vec<RomCandidate> {
    let mut found: Vec<RomCandidate> = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let ext = extension_of(entry.path())?;
            if !is_rom_extension(&ext) {
                return None;
            }
            let mapping = map_extension(&ext)?;
            Some(RomCandidate {
                path: entry.path().to_path_buf(),
                mapping,
            })
        })
        .collect();
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

/// Recursively collect ambiguous disc-container candidates (`.cue`/`.chd`/
/// `.bin`) under `root`, for the scanner to content-sniff via
/// [`super::disc_ident::sniff_disc_image`]. Sorted by path for deterministic
/// scans, same as [`walk`].
pub fn walk_disc_candidates(root: &Path) -> Vec<DiscCandidate> {
    let mut found: Vec<DiscCandidate> = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let ext = extension_of(entry.path())?;
            if !is_ambiguous_disc_extension(&ext) {
                return None;
            }
            Some(DiscCandidate {
                path: entry.path().to_path_buf(),
            })
        })
        .collect();
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::library::mapper::{SYSTEM_NES, SYSTEM_SNES};
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "harmony-walk-{tag}-{}-{}",
            std::process::id(),
            tag
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_roms_recursively_and_skips_non_roms() {
        let root = temp_dir("recursive");
        let sub = root.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(root.join("a.nes"), b"x").unwrap();
        fs::write(sub.join("b.sfc"), b"y").unwrap();
        fs::write(root.join("notes.txt"), b"z").unwrap();

        let mut found = walk(&root);
        assert_eq!(found.len(), 2);
        found.sort_by(|a, b| a.mapping.system.cmp(&b.mapping.system));
        assert_eq!(found[0].mapping.system, SYSTEM_NES);
        assert_eq!(found[1].mapping.system, SYSTEM_SNES);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_folder_yields_nothing() {
        let root = temp_dir("empty");
        assert!(walk(&root).is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn walk_ignores_ambiguous_disc_extensions() {
        // .cue/.chd/.bin are not unambiguous ROM extensions — `walk` (the
        // by-extension path) must skip them entirely; they are only
        // surfaced via `walk_disc_candidates`.
        let root = temp_dir("disc-ignored");
        fs::write(root.join("game.cue"), b"x").unwrap();
        fs::write(root.join("game.bin"), b"y").unwrap();
        fs::write(root.join("game.chd"), b"z").unwrap();
        fs::write(root.join("mario.nes"), b"w").unwrap();

        let found = walk(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].mapping.system, SYSTEM_NES);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn walk_disc_candidates_finds_ambiguous_extensions_recursively() {
        let root = temp_dir("disc-candidates");
        let sub = root.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(root.join("game.cue"), b"x").unwrap();
        fs::write(sub.join("game.chd"), b"y").unwrap();
        fs::write(root.join("track01.bin"), b"z").unwrap();
        fs::write(root.join("mario.nes"), b"w").unwrap(); // must be excluded

        let found = walk_disc_candidates(&root);
        assert_eq!(found.len(), 3);
        let names: Vec<String> = found
            .iter()
            .map(|c| c.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"game.cue".to_string()));
        assert!(names.contains(&"game.chd".to_string()));
        assert!(names.contains(&"track01.bin".to_string()));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn walk_disc_candidates_empty_folder_yields_nothing() {
        let root = temp_dir("disc-empty");
        assert!(walk_disc_candidates(&root).is_empty());
        fs::remove_dir_all(&root).ok();
    }
}
