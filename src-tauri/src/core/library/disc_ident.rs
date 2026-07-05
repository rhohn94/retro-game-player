//! Disc-image content sniffing (W343): positively identify a PS1 disc from an
//! ambiguous container — `.cue` (+ referenced `.bin`), bare `.bin`, or `.chd` —
//! by inspecting on-disk signature bytes rather than trusting the extension.
//!
//! `.cue`/`.chd`/`.bin` are container formats several CD-based systems share
//! (see [`super::mapper`]'s scope note), so they cannot be routed to a system
//! by extension alone. This module is deliberately **conservative**: it only
//! ever returns [`Some`] on a positive signature match, and [`None`] for
//! anything ambiguous, malformed, or truncated — an unidentified disc stays
//! unscanned exactly as it does today, rather than risk a wrong system.
//!
//! Two independent signature checks, either of which is sufficient:
//!
//!   1. **ISO9660 + PlayStation licence string.** The Primary Volume
//!      Descriptor at sector 16 (`CD001` at byte offset 1 of the sector) is
//!      standard ISO9660; Sony PS1 discs additionally carry the literal
//!      string `PLAYSTATION` in the system-area bytes preceding the volume
//!      descriptors (sectors 0–15). Finding both is a positive match.
//!   2. **`SYSTEM.CNF`.** A PS1 disc's root directory (reachable in v0.1 by a
//!      raw scan for the `BOOT=cdrom:` marker text, without a full ISO9660
//!      directory-tree walk) carries a `SYSTEM.CNF` file whose `BOOT=` line
//!      points at a `cdrom:`-scheme executable. Finding the marker text
//!      anywhere in the scanned image is a positive match.
//!
//! `.chd` is a compressed container (MAME's Compressed Hunks of Data
//! format); decompressing hunks to inspect sector bytes is out of scope for
//! a library scan (I/O + CPU cost, and a codec dependency this pure module
//! should not carry). Instead [`sniff_chd`] parses the **header + metadata
//! only** — a CHD v5 header plus its linked metadata-tag list — and looks
//! for a PlayStation hint embedded in metadata text (e.g. a track/description
//! tag mentioning `PLAYSTATION` or `SYSTEM.CNF`). No metadata hit ⇒ `None`,
//! never a guess.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Canonical system id this sniffer can positively identify.
pub const SYSTEM_PS1: &str = "ps1";

/// Bytes in one CD-ROM sector (Mode 1/2352 raw or the common 2048-byte cooked
/// form both start their user data on a clean boundary for our purposes; the
/// sniffer works over whichever the caller hands it as an ISO9660 image).
const ISO_SECTOR_SIZE: usize = 2048;

/// Sector index of the ISO9660 Primary Volume Descriptor (fixed by the
/// standard: 16 system-area sectors precede the volume descriptor set).
const ISO_PVD_SECTOR: usize = 16;

/// ISO9660 volume-descriptor standard identifier, at byte offset 1 of the
/// Primary Volume Descriptor sector.
const ISO_STANDARD_ID: &[u8] = b"CD001";

/// Sony PS1 licence string embedded in the system area of every PS1 disc.
const PS1_LICENCE_STRING: &[u8] = b"PLAYSTATION";

/// The boot-config marker PS1 discs carry in `SYSTEM.CNF`.
const PS1_SYSTEM_CNF_MARKER: &[u8] = b"BOOT=cdrom:";

/// How many leading bytes of a `.bin`/ISO image we scan for signatures. Real
/// PS1 discs place both signatures within the first few sectors, so a
/// bounded read keeps sniffing cheap even for multi-hundred-MB images.
const SNIFF_WINDOW_BYTES: usize = 1024 * 1024; // 1 MiB

/// CHD v5 fixed header layout (see MAME `chd.h`): 8-byte tag, then a
/// big-endian `u32` length/version pair, then further big-endian fields. We
/// only need `length` (to sanity-check the header) and `metaoffset` (to walk
/// the metadata chain) — the compressed hunk map itself is never read.
const CHD_TAG: &[u8] = b"MComprHD";
const CHD_V5_HEADER_LEN: usize = 124;
const CHD_V5_VERSION: u32 = 5;
/// Byte offset of the `metaoffset` field within a v5 header.
const CHD_V5_METAOFFSET_OFFSET: usize = 48;

/// One CHD metadata entry's fixed prefix: `tag[4]`, `length_and_flags[4]`
/// (length in the low 24 bits), `next[8]`. Entry data follows immediately.
const CHD_META_ENTRY_PREFIX_LEN: usize = 16;
/// Metadata length is encoded in the low 24 bits of the length/flags word.
const CHD_META_LENGTH_MASK: u32 = 0x00FF_FFFF;

/// A positively identified disc image, ready to become one library row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscIdentification {
    /// Canonical system id (only [`SYSTEM_PS1`] today).
    pub system: String,
    /// The file that should become the library row's canonical path: for a
    /// `.cue`/`.bin` set this is always the `.cue`; for a bare `.bin` or a
    /// `.chd` it is the image itself.
    pub canonical_path: PathBuf,
}

/// Sniff an ISO9660-shaped byte stream (a `.bin` data track or a raw `.iso`)
/// for a positive PS1 signature. Reads only [`SNIFF_WINDOW_BYTES`] up front,
/// so this is cheap even for a multi-gigabyte disc image.
///
/// Returns `true` only when **either** the ISO9660 Primary Volume Descriptor
/// carries the `PLAYSTATION` licence string in its system area, **or** the
/// image contains the `SYSTEM.CNF` boot marker — both conservative, positive
/// signals; anything else (including a truncated or unreadable file) yields
/// `false`.
pub fn sniff_bin_bytes(bytes: &[u8]) -> bool {
    has_ps1_licence_string(bytes) || has_system_cnf_marker(bytes)
}

/// True when `bytes` is at least large enough to hold an ISO9660 Primary
/// Volume Descriptor and that sector both starts with the `CD001` standard
/// identifier and the preceding system area contains the PS1 licence string.
fn has_ps1_licence_string(bytes: &[u8]) -> bool {
    let pvd_start = ISO_PVD_SECTOR * ISO_SECTOR_SIZE;
    let pvd_end = pvd_start + ISO_SECTOR_SIZE;
    if bytes.len() < pvd_end {
        return false;
    }
    // Byte 0 of a volume descriptor is its type; byte 1..6 is "CD001".
    let pvd = &bytes[pvd_start..pvd_end];
    if pvd.get(1..6) != Some(ISO_STANDARD_ID) {
        return false;
    }
    // The licence string lives in the system-area sectors (0..PVD); scan the
    // whole prefix we have (bounded by the sniff window) rather than a single
    // fixed offset, since publishers padded/positioned it inconsistently.
    let system_area_end = pvd_start.min(bytes.len());
    contains_subslice(&bytes[..system_area_end], PS1_LICENCE_STRING)
}

/// True when `bytes` contains the `SYSTEM.CNF` boot-config marker anywhere in
/// the sniffed window.
fn has_system_cnf_marker(bytes: &[u8]) -> bool {
    contains_subslice(bytes, PS1_SYSTEM_CNF_MARKER)
}

/// Naive substring search over raw bytes — the sniff window is small
/// (bounded by [`SNIFF_WINDOW_BYTES`]) so a linear scan is plenty fast and
/// keeps this module dependency-free.
fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() || haystack.len() < needle.len() {
        return false;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Read up to [`SNIFF_WINDOW_BYTES`] from the start of `path`. Any I/O error
/// (missing file, permission) yields an empty buffer so the caller's sniff
/// simply reports "not identified" rather than propagating an error — a
/// content sniffer must never fail a scan, only decline to identify.
fn read_sniff_window(path: &Path) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Ok(mut f) = File::open(path) {
        let mut limited = (&mut f).take(SNIFF_WINDOW_BYTES as u64);
        let _ = limited.read_to_end(&mut buf);
    }
    buf
}

/// Sniff a bare `.bin`/`.iso` file on disk for a positive PS1 signature.
/// Returns the identification (canonical path = `path` itself) or `None`.
pub fn sniff_bin_file(path: &Path) -> Option<DiscIdentification> {
    let bytes = read_sniff_window(path);
    if sniff_bin_bytes(&bytes) {
        Some(DiscIdentification {
            system: SYSTEM_PS1.to_string(),
            canonical_path: path.to_path_buf(),
        })
    } else {
        None
    }
}

/// Parse a cue sheet, returning the path of its **first referenced data
/// track** (the `FILE "..." BINARY` line), resolved relative to the cue's
/// own directory. Multi-track cue sheets list one `FILE` per track (or
/// reuse one `FILE` for several `TRACK`s); the first data track is always
/// where the disc's boot sector / filesystem lives, so it alone is enough
/// to sniff the whole set. Returns `None` when the cue sheet has no
/// parseable `FILE` line.
pub fn first_referenced_bin(cue_path: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(cue_path).ok()?;
    let base_dir = cue_path.parent().unwrap_or_else(|| Path::new("."));
    for line in text.lines() {
        if let Some(name) = parse_cue_file_line(line) {
            return Some(base_dir.join(name));
        }
    }
    None
}

/// Extract the quoted filename from a cue sheet `FILE "name" TYPE` line, or
/// `None` if `line` is not a `FILE` directive.
fn parse_cue_file_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let rest = trimmed
        .strip_prefix("FILE ")
        .or_else(|| trimmed.strip_prefix("file "))?;
    let first_quote = rest.find('"')?;
    let after = &rest[first_quote + 1..];
    let second_quote = after.find('"')?;
    Some(&after[..second_quote])
}

/// Sniff a `.cue` sheet: resolve its first referenced `.bin` (relative to
/// the cue's directory) and sniff that file's content. On a positive match
/// the identification's canonical path is the **`.cue` itself** — never the
/// `.bin` — so a multi-track set collapses to one library row keyed on the
/// cue sheet, and the individual `.bin` tracks never surface as their own
/// rows (the scan-integration layer is responsible for excluding them).
///
/// Returns `None` when the cue sheet cannot be parsed, its referenced `.bin`
/// is missing/unreadable, or the referenced track has no positive signature.
pub fn sniff_cue_file(cue_path: &Path) -> Option<DiscIdentification> {
    let bin_path = first_referenced_bin(cue_path)?;
    let bytes = read_sniff_window(&bin_path);
    if bytes.is_empty() {
        return None;
    }
    if sniff_bin_bytes(&bytes) {
        Some(DiscIdentification {
            system: SYSTEM_PS1.to_string(),
            canonical_path: cue_path.to_path_buf(),
        })
    } else {
        None
    }
}

/// Read a big-endian `u32` at `offset` in `bytes`, or `None` if out of range.
fn read_u32_be(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes(slice.try_into().ok()?))
}

/// Read a big-endian `u64` at `offset` in `bytes`, or `None` if out of range.
fn read_u64_be(bytes: &[u8], offset: usize) -> Option<u64> {
    let slice = bytes.get(offset..offset + 8)?;
    Some(u64::from_be_bytes(slice.try_into().ok()?))
}

/// Parse a CHD v5 header from its first [`CHD_V5_HEADER_LEN`] bytes,
/// returning the `metaoffset` field. `None` if the tag/version/length don't
/// match a v5 CHD, so callers never misread an unsupported/older CHD layout.
fn chd_v5_metaoffset(header: &[u8]) -> Option<u64> {
    if header.len() < CHD_V5_HEADER_LEN {
        return None;
    }
    if &header[0..8] != CHD_TAG {
        return None;
    }
    let length = read_u32_be(header, 8)?;
    let version = read_u32_be(header, 12)?;
    if version != CHD_V5_VERSION || (length as usize) != CHD_V5_HEADER_LEN {
        return None;
    }
    read_u64_be(header, CHD_V5_METAOFFSET_OFFSET)
}

/// Walk a CHD metadata chain starting at `metaoffset`, returning the
/// concatenated raw bytes of every metadata entry's data payload. Stops at
/// the chain end (`next == 0`), a zero offset, or a malformed/truncated
/// entry — a corrupt chain degrades to "whatever we read so far" rather than
/// erroring, consistent with this module's conservative, never-fail sniffing
/// contract.
fn read_chd_metadata_blob(file: &mut File, metaoffset: u64) -> Vec<u8> {
    let mut out = Vec::new();
    let mut offset = metaoffset;
    // A CHD with a pathological/cyclic metadata chain must not hang the
    // scanner; cap the number of entries we'll walk.
    const MAX_METADATA_ENTRIES: usize = 256;

    for _ in 0..MAX_METADATA_ENTRIES {
        if offset == 0 {
            break;
        }
        if file.seek(SeekFrom::Start(offset)).is_err() {
            break;
        }
        let mut prefix = [0u8; CHD_META_ENTRY_PREFIX_LEN];
        if file.read_exact(&mut prefix).is_err() {
            break;
        }
        let length_and_flags = u32::from_be_bytes([prefix[4], prefix[5], prefix[6], prefix[7]]);
        let length = (length_and_flags & CHD_META_LENGTH_MASK) as usize;
        let next = u64::from_be_bytes(prefix[8..16].try_into().unwrap());

        let mut data = vec![0u8; length];
        if file.read_exact(&mut data).is_err() {
            break;
        }
        out.extend_from_slice(&data);

        offset = next;
    }
    out
}

/// True when a CHD metadata blob positively marks the disc as PS1. Unlike
/// [`sniff_bin_bytes`] (which requires a full ISO9660 Primary Volume
/// Descriptor structure before trusting the licence string), CHD metadata is
/// free-form descriptive text with no fixed sector layout — a metadata tag
/// commonly carries a track-type/description string for CD-based dumps — so
/// here the same two marker strings are treated as positive on their own as
/// plain substrings.
fn metadata_has_ps1_marker(metadata: &[u8]) -> bool {
    contains_subslice(metadata, PS1_LICENCE_STRING) || contains_subslice(metadata, PS1_SYSTEM_CNF_MARKER)
}

/// Sniff a `.chd` file's **header + metadata only** for a positive PS1
/// signature. Never decompresses hunks: a v5 CHD header is parsed for its
/// `metaoffset`, the metadata chain is walked, and the concatenated metadata
/// bytes are scanned for the same PlayStation markers used for raw images
/// (metadata text commonly embeds a track description / boot string for
/// CD-based dumps). Any parse failure (wrong tag, unsupported version,
/// truncated file) or a metadata blob with no positive marker yields `None`.
pub fn sniff_chd_file(path: &Path) -> Option<DiscIdentification> {
    let mut file = File::open(path).ok()?;
    let mut header = [0u8; CHD_V5_HEADER_LEN];
    file.read_exact(&mut header).ok()?;
    let metaoffset = chd_v5_metaoffset(&header)?;
    if metaoffset == 0 {
        return None;
    }
    let metadata = read_chd_metadata_blob(&mut file, metaoffset);
    if metadata_has_ps1_marker(&metadata) {
        Some(DiscIdentification {
            system: SYSTEM_PS1.to_string(),
            canonical_path: path.to_path_buf(),
        })
    } else {
        None
    }
}

/// Dispatch on `path`'s (lowercased) extension to the matching sniffer.
/// `.cue` → [`sniff_cue_file`], `.chd` → [`sniff_chd_file`], `.bin` (and
/// bare `.iso`, offered the same treatment since it's the same container
/// shape) → [`sniff_bin_file`]. Any other extension is not this module's
/// concern and yields `None`.
pub fn sniff_disc_image(path: &Path) -> Option<DiscIdentification> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;
    match ext.as_str() {
        "cue" => sniff_cue_file(path),
        "chd" => sniff_chd_file(path),
        "bin" => sniff_bin_file(path),
        _ => None,
    }
}

/// The ambiguous container extensions this module handles — the scan
/// integration layer routes exactly these through [`sniff_disc_image`]
/// instead of the unambiguous `mapper` table.
pub const AMBIGUOUS_DISC_EXTENSIONS: &[&str] = &["cue", "chd", "bin"];

/// True when `ext` (lowercased, no dot) is one of the ambiguous disc
/// container extensions this module sniffs rather than maps directly.
pub fn is_ambiguous_disc_extension(ext: &str) -> bool {
    let normalized = ext.trim_start_matches('.').to_ascii_lowercase();
    AMBIGUOUS_DISC_EXTENSIONS.contains(&normalized.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("harmony-discident-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Build a minimal, sparse ISO9660 image carrying the PS1 licence string
    /// in its system area and a valid PVD `CD001` signature at sector 16.
    /// Far smaller than a real disc (a few KB via a sparse `Vec`), but
    /// byte-accurate at the offsets the sniffer inspects.
    fn synthetic_ps1_iso_bytes() -> Vec<u8> {
        let mut image = vec![0u8; (ISO_PVD_SECTOR + 1) * ISO_SECTOR_SIZE];
        // System area (sectors 0-15): stash the licence string near the front,
        // as real PS1 discs do.
        image[0x00..PS1_LICENCE_STRING.len()].copy_from_slice(PS1_LICENCE_STRING);
        // Primary Volume Descriptor at sector 16: type 1, then "CD001".
        let pvd_start = ISO_PVD_SECTOR * ISO_SECTOR_SIZE;
        image[pvd_start] = 1;
        image[pvd_start + 1..pvd_start + 6].copy_from_slice(ISO_STANDARD_ID);
        image
    }

    /// Build a minimal synthetic image carrying only the `SYSTEM.CNF` boot
    /// marker (no ISO9660 PVD at all) — the second, independent signature.
    fn synthetic_system_cnf_bytes() -> Vec<u8> {
        let mut image = vec![0u8; 4096];
        let marker = b"SYSTEM.CNF;1BOOT=cdrom:\\SLUS_000.01;1";
        image[0x800..0x800 + marker.len()].copy_from_slice(marker);
        image
    }

    /// A non-PS1 `.bin`: plausible disc-shaped filler bytes with neither
    /// signature present.
    fn synthetic_non_ps1_bytes() -> Vec<u8> {
        vec![0xAAu8; 8192]
    }

    #[test]
    fn sniffs_ps1_licence_string_and_pvd() {
        assert!(sniff_bin_bytes(&synthetic_ps1_iso_bytes()));
    }

    #[test]
    fn sniffs_system_cnf_marker_alone() {
        assert!(sniff_bin_bytes(&synthetic_system_cnf_bytes()));
    }

    #[test]
    fn non_ps1_bytes_stay_unidentified() {
        assert!(!sniff_bin_bytes(&synthetic_non_ps1_bytes()));
    }

    #[test]
    fn truncated_image_is_not_a_false_positive() {
        // Too short to contain sector 16 at all, and no marker text either.
        assert!(!sniff_bin_bytes(b"tiny"));
    }

    #[test]
    fn pvd_without_licence_string_is_not_identified() {
        // A valid CD001 PVD but no PLAYSTATION string anywhere: a generic
        // ISO9660 disc (e.g. some other CD-based system) must not be
        // misidentified as PS1.
        let mut image = vec![0u8; (ISO_PVD_SECTOR + 1) * ISO_SECTOR_SIZE];
        let pvd_start = ISO_PVD_SECTOR * ISO_SECTOR_SIZE;
        image[pvd_start] = 1;
        image[pvd_start + 1..pvd_start + 6].copy_from_slice(ISO_STANDARD_ID);
        assert!(!sniff_bin_bytes(&image));
    }

    #[test]
    fn sniff_bin_file_reads_from_disk() {
        let dir = temp_dir("bin-file");
        let bin_path = dir.join("game.bin");
        fs::write(&bin_path, synthetic_ps1_iso_bytes()).unwrap();

        let ident = sniff_bin_file(&bin_path).expect("should identify");
        assert_eq!(ident.system, SYSTEM_PS1);
        assert_eq!(ident.canonical_path, bin_path);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sniff_bin_file_missing_file_is_none() {
        let dir = temp_dir("bin-missing");
        assert!(sniff_bin_file(&dir.join("nope.bin")).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parses_single_track_cue_file_line() {
        let line = r#"FILE "game.bin" BINARY"#;
        assert_eq!(parse_cue_file_line(line), Some("game.bin"));
    }

    #[test]
    fn parses_cue_file_line_lowercase_keyword() {
        let line = r#"file "Game (Disc 1).bin" BINARY"#;
        assert_eq!(parse_cue_file_line(line), Some("Game (Disc 1).bin"));
    }

    #[test]
    fn non_file_cue_line_is_none() {
        assert_eq!(parse_cue_file_line("  TRACK 01 MODE2/2352"), None);
    }

    #[test]
    fn sniff_cue_resolves_and_sniffs_first_bin_positively() {
        let dir = temp_dir("cue-positive");
        let bin_path = dir.join("track01.bin");
        fs::write(&bin_path, synthetic_ps1_iso_bytes()).unwrap();
        let cue_path = dir.join("game.cue");
        fs::write(&cue_path, "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n").unwrap();

        let ident = sniff_cue_file(&cue_path).expect("should identify");
        assert_eq!(ident.system, SYSTEM_PS1);
        // Canonical path is the .cue, never the .bin.
        assert_eq!(ident.canonical_path, cue_path);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sniff_cue_multi_track_resolves_to_first_data_track_only() {
        let dir = temp_dir("cue-multitrack");
        let bin1 = dir.join("track01.bin");
        let bin2 = dir.join("track02.bin");
        fs::write(&bin1, synthetic_ps1_iso_bytes()).unwrap();
        fs::write(&bin2, synthetic_non_ps1_bytes()).unwrap(); // an audio track, say
        let cue_path = dir.join("multi.cue");
        fs::write(
            &cue_path,
            "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n\
             FILE \"track02.bin\" BINARY\n  TRACK 02 AUDIO\n",
        )
        .unwrap();

        let ident = sniff_cue_file(&cue_path).expect("should identify from first track");
        assert_eq!(ident.canonical_path, cue_path);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sniff_cue_non_ps1_bin_stays_unidentified() {
        let dir = temp_dir("cue-negative");
        let bin_path = dir.join("track01.bin");
        fs::write(&bin_path, synthetic_non_ps1_bytes()).unwrap();
        let cue_path = dir.join("other.cue");
        fs::write(&cue_path, "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n").unwrap();

        assert!(sniff_cue_file(&cue_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sniff_cue_missing_referenced_bin_is_none() {
        let dir = temp_dir("cue-dangling");
        let cue_path = dir.join("dangling.cue");
        fs::write(&cue_path, "FILE \"ghost.bin\" BINARY\n  TRACK 01 MODE2/2352\n").unwrap();

        assert!(sniff_cue_file(&cue_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sniff_cue_unparseable_sheet_is_none() {
        let dir = temp_dir("cue-unparseable");
        let cue_path = dir.join("empty.cue");
        fs::write(&cue_path, "REM just a comment\n").unwrap();

        assert!(sniff_cue_file(&cue_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    /// Build a minimal, sparse CHD v5 file: a valid header pointing at one
    /// metadata entry whose data payload embeds the PS1 licence string.
    fn synthetic_chd_v5_bytes(metadata_payload: &[u8]) -> Vec<u8> {
        let mut file = vec![0u8; CHD_V5_HEADER_LEN];
        file[0..8].copy_from_slice(CHD_TAG);
        file[8..12].copy_from_slice(&(CHD_V5_HEADER_LEN as u32).to_be_bytes());
        file[12..16].copy_from_slice(&CHD_V5_VERSION.to_be_bytes());
        let metaoffset = file.len() as u64;
        file[CHD_V5_METAOFFSET_OFFSET..CHD_V5_METAOFFSET_OFFSET + 8]
            .copy_from_slice(&metaoffset.to_be_bytes());

        // One metadata entry: tag (arbitrary, e.g. "CHT2"), length/flags
        // (payload length in the low 24 bits), next = 0 (end of chain).
        file.extend_from_slice(b"CHT2");
        let length_and_flags = metadata_payload.len() as u32 & CHD_META_LENGTH_MASK;
        file.extend_from_slice(&length_and_flags.to_be_bytes());
        file.extend_from_slice(&0u64.to_be_bytes()); // next
        file.extend_from_slice(metadata_payload);
        file
    }

    #[test]
    fn sniffs_chd_v5_header_metadata_positively() {
        let dir = temp_dir("chd-positive");
        let chd_path = dir.join("game.chd");
        let payload = b"TRACK:1 TYPE:MODE2/2352 PLAYSTATION disc image";
        fs::write(&chd_path, synthetic_chd_v5_bytes(payload)).unwrap();

        let ident = sniff_chd_file(&chd_path).expect("should identify from metadata");
        assert_eq!(ident.system, SYSTEM_PS1);
        assert_eq!(ident.canonical_path, chd_path);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chd_metadata_without_marker_stays_unidentified() {
        let dir = temp_dir("chd-negative");
        let chd_path = dir.join("other.chd");
        let payload = b"TRACK:1 TYPE:AUDIO some other disc";
        fs::write(&chd_path, synthetic_chd_v5_bytes(payload)).unwrap();

        assert!(sniff_chd_file(&chd_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chd_wrong_tag_is_none() {
        let dir = temp_dir("chd-badtag");
        let chd_path = dir.join("bad.chd");
        let mut bytes = synthetic_chd_v5_bytes(b"PLAYSTATION");
        bytes[0..8].copy_from_slice(b"NOTACHD!");
        fs::write(&chd_path, bytes).unwrap();

        assert!(sniff_chd_file(&chd_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chd_truncated_header_is_none() {
        let dir = temp_dir("chd-truncated");
        let chd_path = dir.join("short.chd");
        fs::write(&chd_path, b"MComprHD").unwrap(); // far too short for a header
        assert!(sniff_chd_file(&chd_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chd_zero_metaoffset_is_none() {
        let dir = temp_dir("chd-zero-meta");
        let chd_path = dir.join("nometa.chd");
        let mut bytes = vec![0u8; CHD_V5_HEADER_LEN];
        bytes[0..8].copy_from_slice(CHD_TAG);
        bytes[8..12].copy_from_slice(&(CHD_V5_HEADER_LEN as u32).to_be_bytes());
        bytes[12..16].copy_from_slice(&CHD_V5_VERSION.to_be_bytes());
        // metaoffset left as zero.
        fs::write(&chd_path, bytes).unwrap();

        assert!(sniff_chd_file(&chd_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dispatch_routes_by_extension() {
        let dir = temp_dir("dispatch");
        let bin_path = dir.join("game.bin");
        fs::write(&bin_path, synthetic_ps1_iso_bytes()).unwrap();
        assert!(sniff_disc_image(&bin_path).is_some());

        let txt_path = dir.join("game.txt");
        fs::write(&txt_path, synthetic_ps1_iso_bytes()).unwrap();
        assert!(sniff_disc_image(&txt_path).is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ambiguous_extension_predicate() {
        assert!(is_ambiguous_disc_extension("cue"));
        assert!(is_ambiguous_disc_extension(".CHD"));
        assert!(is_ambiguous_disc_extension("bin"));
        assert!(!is_ambiguous_disc_extension("nes"));
    }
}
