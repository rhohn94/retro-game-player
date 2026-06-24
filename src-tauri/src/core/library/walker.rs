//! Recursive content-folder walker (W6).
//!
//! Walks a content folder, yielding every regular file whose extension Harmony
//! recognizes as a ROM (see [`super::mapper`]). Symlinks are not followed and
//! unreadable entries are skipped rather than aborting the whole scan — a single
//! bad file should never sink an otherwise-good library scan.

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
}
