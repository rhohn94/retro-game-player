//! DAT matcher (W6): ROM hashes → clean No-Intro name, or a filename fallback.
//!
//! Given a ROM's computed [`RomHashes`] and its original filename, the matcher
//! consults a [`DatIndex`] (CRC32 first, SHA1 not computed in v0.1 so CRC32 is
//! the sole key) and yields a [`MatchOutcome`]: either an identified clean name
//! (`dat_matched = true`) or an unidentified entry flagged for the UI, whose
//! display name falls back to the sanitized filename stem.

use super::dat::DatIndex;
use super::hasher::RomHashes;
use std::path::Path;

/// The result of matching one ROM against the DAT.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchOutcome {
    /// Display name: the No-Intro clean name when matched, else the filename stem.
    pub clean_name: String,
    /// True when the ROM was found in the DAT (drives the `dat_matched` column
    /// and the "unidentified" UI flag — unmatched ⇒ `false`).
    pub dat_matched: bool,
}

/// Matches ROMs against a borrowed DAT index. Holds no state beyond the index so
/// it is cheap to construct per scan.
pub struct Matcher<'a> {
    index: &'a DatIndex,
}

impl<'a> Matcher<'a> {
    /// Construct a matcher over a parsed DAT index.
    pub fn new(index: &'a DatIndex) -> Self {
        Self { index }
    }

    /// Match a ROM by its hashes, falling back to `file_path`'s stem when the DAT
    /// has no entry. The fallback name keeps unidentified ROMs usable in the grid.
    pub fn match_rom(&self, hashes: &RomHashes, file_path: &Path) -> MatchOutcome {
        if let Some(entry) = self.index.by_crc32(&hashes.crc32) {
            return MatchOutcome {
                clean_name: entry.name.clone(),
                dat_matched: true,
            };
        }
        MatchOutcome {
            clean_name: fallback_name(file_path),
            dat_matched: false,
        }
    }
}

/// Derive a human-ish display name from a file path: the file stem with
/// underscores turned into spaces and surrounding whitespace trimmed. Empty or
/// extension-less paths degrade to `"Unknown"` so the name is never blank.
pub fn fallback_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .replace('_', " ");
    // Strip leading dots so a dotfile like `.nes` (whose stem is `.nes`) does not
    // surface a leading-dot display name; then trim surrounding whitespace.
    let trimmed = stem.trim_start_matches('.').trim();
    if trimmed.is_empty() {
        "Unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::library::dat::DatIndex;

    const DAT: &str = r#"
        <datafile>
          <game name="Super Mario Bros. (World)">
            <rom name="smb.nes" crc="3337ec46"/>
          </game>
        </datafile>
    "#;

    fn hashes(crc: &str) -> RomHashes {
        RomHashes {
            crc32: crc.to_string(),
            md5: "0".repeat(32),
        }
    }

    #[test]
    fn matched_rom_uses_clean_name() {
        let idx = DatIndex::from_xml(DAT).unwrap();
        let m = Matcher::new(&idx);
        let out = m.match_rom(&hashes("3337ec46"), Path::new("/roms/whatever.nes"));
        assert!(out.dat_matched);
        assert_eq!(out.clean_name, "Super Mario Bros. (World)");
    }

    #[test]
    fn unmatched_rom_falls_back_to_filename_and_flags_unidentified() {
        let idx = DatIndex::from_xml(DAT).unwrap();
        let m = Matcher::new(&idx);
        let out = m.match_rom(&hashes("ffffffff"), Path::new("/roms/Cool_Hack.nes"));
        assert!(!out.dat_matched);
        assert_eq!(out.clean_name, "Cool Hack");
    }

    #[test]
    fn leading_dots_are_stripped_from_fallback() {
        // `.nes` has stem `.nes`; the leading dot is dropped for display.
        assert_eq!(fallback_name(Path::new("/roms/.nes")), "nes");
    }

    #[test]
    fn no_file_name_degrades_to_unknown() {
        assert_eq!(fallback_name(Path::new("/")), "Unknown");
    }
}
