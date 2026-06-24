//! No-Intro Logiqx-XML DAT parser + lookup index (W6).
//!
//! A No-Intro DAT is Logiqx XML: a `<datafile>` of `<game>` elements, each with
//! one or more `<rom>` children carrying `name`, `crc`, `md5`, and `sha1`
//! attributes. Harmony parses the DAT into [`DatEntry`] rows and builds a
//! [`DatIndex`] keyed by lowercase CRC32 and SHA1 for O(1) matching. CRC32 is the
//! primary key (every No-Intro rom has one); SHA1 is a secondary fallback.

use crate::error::{AppError, AppResult};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

/// One ROM entry parsed from a DAT: the clean game name plus its hashes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatEntry {
    /// The clean No-Intro game name (`<game name="...">`).
    pub name: String,
    /// Lowercase CRC32 hex (always present in No-Intro DATs).
    pub crc32: String,
    /// Lowercase SHA1 hex, if the DAT carries it.
    pub sha1: Option<String>,
    /// Lowercase MD5 hex, if the DAT carries it.
    pub md5: Option<String>,
}

/// Logiqx element / attribute names — named so the parser holds no magic strings.
const EL_GAME: &[u8] = b"game";
const EL_ROM: &[u8] = b"rom";
const ATTR_NAME: &[u8] = b"name";
const ATTR_CRC: &[u8] = b"crc";
const ATTR_SHA1: &[u8] = b"sha1";
const ATTR_MD5: &[u8] = b"md5";

/// A CRC32- and SHA1-keyed lookup index over a parsed DAT.
#[derive(Debug, Default, Clone)]
pub struct DatIndex {
    by_crc32: HashMap<String, DatEntry>,
    by_sha1: HashMap<String, DatEntry>,
}

impl DatIndex {
    /// Build an index from parsed entries. Later duplicates overwrite earlier
    /// ones (a DAT should not have colliding CRCs, but we stay total).
    pub fn from_entries(entries: Vec<DatEntry>) -> Self {
        let mut idx = DatIndex::default();
        for entry in entries {
            if let Some(sha1) = &entry.sha1 {
                idx.by_sha1.insert(sha1.clone(), entry.clone());
            }
            idx.by_crc32.insert(entry.crc32.clone(), entry);
        }
        idx
    }

    /// Parse a Logiqx-XML DAT string and build the index in one step.
    pub fn from_xml(xml: &str) -> AppResult<Self> {
        Ok(Self::from_entries(parse_dat(xml)?))
    }

    /// Number of CRC32-keyed entries (primarily for tests / diagnostics).
    pub fn len(&self) -> usize {
        self.by_crc32.len()
    }

    /// True when the index holds no entries.
    pub fn is_empty(&self) -> bool {
        self.by_crc32.is_empty()
    }

    /// Look an entry up by lowercase CRC32 hex.
    pub fn by_crc32(&self, crc32: &str) -> Option<&DatEntry> {
        self.by_crc32.get(&crc32.to_ascii_lowercase())
    }

    /// Look an entry up by lowercase SHA1 hex.
    pub fn by_sha1(&self, sha1: &str) -> Option<&DatEntry> {
        self.by_sha1.get(&sha1.to_ascii_lowercase())
    }
}

/// Parse a Logiqx-XML DAT into its ROM entries. The current `<game name>` is
/// carried down to its `<rom>` children. Malformed XML yields [`AppError::Io`].
pub fn parse_dat(xml: &str) -> AppResult<Vec<DatEntry>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut entries: Vec<DatEntry> = Vec::new();
    let mut current_game: Option<String> = None;
    let mut buf = Vec::new();

    loop {
        match reader
            .read_event_into(&mut buf)
            .map_err(|e| AppError::Io(format!("malformed DAT XML: {e}")))?
        {
            Event::Start(e) if e.name().as_ref() == EL_GAME => {
                current_game = attr(&e, ATTR_NAME);
            }
            Event::End(e) if e.name().as_ref() == EL_GAME => {
                current_game = None;
            }
            // `<rom .../>` is usually empty; handle both empty and start forms.
            Event::Empty(e) | Event::Start(e) if e.name().as_ref() == EL_ROM => {
                if let Some(game) = &current_game {
                    if let Some(crc) = attr(&e, ATTR_CRC) {
                        entries.push(DatEntry {
                            name: game.clone(),
                            crc32: crc.to_ascii_lowercase(),
                            sha1: attr(&e, ATTR_SHA1).map(|s| s.to_ascii_lowercase()),
                            md5: attr(&e, ATTR_MD5).map(|s| s.to_ascii_lowercase()),
                        });
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(entries)
}

/// Extract a UTF-8 attribute value by name from an XML start/empty tag.
fn attr(e: &quick_xml::events::BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .filter_map(|a| a.ok())
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| String::from_utf8(a.value.into_owned()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DAT: &str = r#"
        <?xml version="1.0"?>
        <datafile>
          <header><name>NES</name></header>
          <game name="Super Mario Bros. (World)">
            <rom name="smb.nes" size="40976" crc="3337EC46" md5="811B027E" sha1="ABCDEF01"/>
          </game>
          <game name="Metroid (USA)">
            <rom name="metroid.nes" size="131088" crc="9DCD9d9d"/>
          </game>
        </datafile>
    "#;

    #[test]
    fn parses_games_and_lowercases_hashes() {
        let entries = parse_dat(SAMPLE_DAT).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "Super Mario Bros. (World)");
        assert_eq!(entries[0].crc32, "3337ec46");
        assert_eq!(entries[0].sha1.as_deref(), Some("abcdef01"));
    }

    #[test]
    fn index_looks_up_by_crc_and_sha1_case_insensitively() {
        let idx = DatIndex::from_xml(SAMPLE_DAT).unwrap();
        assert_eq!(idx.len(), 2);
        assert_eq!(
            idx.by_crc32("3337ec46").unwrap().name,
            "Super Mario Bros. (World)"
        );
        // Uppercase query still resolves.
        assert_eq!(
            idx.by_crc32("9DCD9D9D").unwrap().name,
            "Metroid (USA)"
        );
        assert_eq!(idx.by_sha1("ABCDEF01").unwrap().name, "Super Mario Bros. (World)");
        assert!(idx.by_crc32("00000000").is_none());
    }

    #[test]
    fn empty_dat_parses_to_no_entries() {
        let idx = DatIndex::from_xml("<datafile></datafile>").unwrap();
        assert!(idx.is_empty());
    }

    #[test]
    fn malformed_xml_errors() {
        assert!(parse_dat("<datafile><game").is_err());
    }
}
