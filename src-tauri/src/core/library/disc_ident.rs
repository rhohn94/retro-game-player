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
//! Bare `.iso` files are **not** in scope: the dispatcher routes only the
//! three ambiguous extensions above.
//!
//! A PS1 match always requires a **`SYSTEM.CNF` `BOOT` line** (real files
//! read `BOOT = cdrom:\SLUS_xxx.xx;1`; PS2's boot key is `BOOT2`, which is
//! explicitly rejected) **plus one** corroborating Sony signature:
//!
//!   1. the ISO9660 Primary Volume Descriptor's **System Identifier** field
//!      (PVD bytes 8–39) containing `PLAYSTATION`. The PVD sits at sector 16
//!      and is located under BOTH real-world dump layouts: cooked 2048-byte
//!      sectors (PVD at byte 32768, e.g. an extracted data track) and raw
//!      MODE2/2352 sectors as cue/bin dumps store them (PVD user data at
//!      byte 16·2352 + 24, the Mode 2 Form 1 raw-header offset) — the
//!      `CD001` magic at PVD byte offset 1 confirms whichever layout; or
//!   2. the system-area licence text `Licensed by Sony Computer
//!      Entertainment`, matched whitespace-insensitively because real discs
//!      master it with irregular runs of spaces.
//!
//! The pairing exists because PS2 CD discs also carry `PLAYSTATION` in the
//! System Identifier field — the `BOOT`-vs-`BOOT2` line is the actual PS1
//! discriminator.
//!
//! ## Known limitation (v0.34): real `.chd` images are NOT identified
//!
//! `.chd` (MAME's Compressed Hunks of Data format) stores its sector data in
//! compressed hunks; [`sniff_chd_file`] parses the **header + metadata
//! only** and never decompresses hunks. Real chdman-produced CD metadata
//! (`CHT2`/`CHTR` tags) carries only track-geometry text (`TRACK:N TYPE:…
//! FRAMES:…`) — never a `PLAYSTATION` marker or a `SYSTEM.CNF` boot line —
//! so **real-world PS1 `.chd` files return [`None`] in v0.34** and stay
//! unscanned. Identifying them requires hunk decompression (a codec
//! dependency plus real I/O + CPU cost per scanned file), which is out of
//! scope this release; tracked as rhohn94/retro-game-player#49.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Canonical system id this sniffer can positively identify.
pub const SYSTEM_PS1: &str = "ps1";

/// Bytes of user data in one cooked CD-ROM sector (the layout of an
/// extracted data track: no sync/header bytes, 2048 bytes of user data
/// per sector).
const COOKED_SECTOR_SIZE: usize = 2048;

/// Bytes in one raw CD-ROM sector as cue/bin dumps store it (sync pattern +
/// header + subheader + user data + EDC/ECC, per ECMA-130).
const RAW_SECTOR_SIZE: usize = 2352;

/// Byte offset of user data within a raw Mode 2 Form 1 sector: 12-byte sync
/// pattern + 3-byte MSF address + 1-byte mode + 8-byte CD-XA subheader.
const RAW_MODE2_FORM1_DATA_OFFSET: usize = 24;

/// Sector index of the ISO9660 Primary Volume Descriptor (fixed by the
/// standard: 16 system-area sectors precede the volume descriptor set).
const ISO_PVD_SECTOR: usize = 16;

/// ISO9660 volume-descriptor standard identifier, at byte offset 1 of the
/// Primary Volume Descriptor.
const ISO_STANDARD_ID: &[u8] = b"CD001";

/// Byte offset of the PVD's System Identifier field within the PVD's user
/// data, and that field's fixed length (ISO9660 §8.4.5: a-characters,
/// space-padded).
const PVD_SYSTEM_IDENTIFIER_OFFSET: usize = 8;
const PVD_SYSTEM_IDENTIFIER_LEN: usize = 32;

/// The System Identifier value Sony stamps into the PVD of PS1 (and PS2 CD)
/// discs. Never sufficient alone — see [`has_ps1_boot_line`].
const PS1_PVD_SYSTEM_IDENTIFIER: &[u8] = b"PLAYSTATION";

/// The system-area licence text on real PS1 discs, in whitespace-normalized
/// form (real masters pad it with irregular runs of spaces — see
/// [`normalize_whitespace`]).
const PS1_SYSTEM_AREA_LICENCE_TEXT: &[u8] = b"Licensed by Sony Computer Entertainment";

/// The PS1 boot key in `SYSTEM.CNF` (`BOOT = cdrom:\…`). PS2 uses `BOOT2`,
/// which [`has_ps1_boot_line`] explicitly rejects.
const PS1_BOOT_KEY: &[u8] = b"BOOT";

/// The device scheme a PS1 `BOOT` line points at (matched case-insensitively).
const CDROM_DEVICE: &[u8] = b"cdrom";

/// How many leading bytes of a `.bin` image we scan for signatures. Real PS1
/// discs place the PVD at sector 16 (< 40 KiB even raw) and master
/// `SYSTEM.CNF` among the first files on the disc, so a bounded read keeps
/// sniffing cheap even for multi-hundred-MB images.
const SNIFF_WINDOW_BYTES: usize = 4 * 1024 * 1024; // 4 MiB

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

/// Sniff a disc-image byte stream (a `.bin` data track, cooked or raw) for a
/// positive PS1 signature. Callers hand at most [`SNIFF_WINDOW_BYTES`], so
/// this is cheap even for a multi-gigabyte disc image.
///
/// Returns `true` only when a PS1 `SYSTEM.CNF` `BOOT` line is present
/// ([`has_ps1_boot_line`] — `BOOT2` is rejected) **and** either the PVD
/// System Identifier says `PLAYSTATION` or the system-area Sony licence text
/// is present. Anything else (including a truncated or unreadable file)
/// yields `false` — a boot line alone, or the PlayStation system identifier
/// alone (shared with PS2 CDs), is never sufficient.
pub fn sniff_bin_bytes(bytes: &[u8]) -> bool {
    if !has_ps1_boot_line(bytes) {
        return false;
    }
    let pvd_is_playstation = locate_pvd(bytes)
        .is_some_and(|pvd_offset| pvd_has_playstation_system_identifier(bytes, pvd_offset));
    pvd_is_playstation || has_system_area_licence_text(bytes)
}

/// Locate the ISO9660 Primary Volume Descriptor's user data at sector 16
/// under either real-world dump layout, returning its byte offset: cooked
/// 2048-byte sectors (offset 32768) or raw MODE2/2352 sectors (offset
/// 16·2352 + 24). The layout is confirmed by the `CD001` magic at PVD byte
/// offset 1; `None` when neither layout matches.
fn locate_pvd(bytes: &[u8]) -> Option<usize> {
    let cooked = ISO_PVD_SECTOR * COOKED_SECTOR_SIZE;
    if bytes.get(cooked + 1..cooked + 1 + ISO_STANDARD_ID.len()) == Some(ISO_STANDARD_ID) {
        return Some(cooked);
    }
    let raw = ISO_PVD_SECTOR * RAW_SECTOR_SIZE + RAW_MODE2_FORM1_DATA_OFFSET;
    if bytes.get(raw + 1..raw + 1 + ISO_STANDARD_ID.len()) == Some(ISO_STANDARD_ID) {
        return Some(raw);
    }
    None
}

/// True when the PVD (whose user data starts at `pvd_offset`) carries
/// `PLAYSTATION` in its System Identifier field (PVD bytes 8–39). Note PS2
/// CD discs carry the same value — this is a PlayStation-*family* signal,
/// not a PS1 discriminator on its own.
fn pvd_has_playstation_system_identifier(bytes: &[u8], pvd_offset: usize) -> bool {
    let start = pvd_offset + PVD_SYSTEM_IDENTIFIER_OFFSET;
    bytes
        .get(start..start + PVD_SYSTEM_IDENTIFIER_LEN)
        .is_some_and(|field| contains_subslice(field, PS1_PVD_SYSTEM_IDENTIFIER))
}

/// True when `bytes` contains a PS1 `SYSTEM.CNF` boot line: `BOOT`, optional
/// spaces/tabs, `=`, optional spaces/tabs, then `cdrom` (case-insensitive) —
/// matching the real on-disc form `BOOT = cdrom:\SLUS_xxx.xx;1`. `BOOT2`
/// (the PS2 boot key) is explicitly rejected. The `SYSTEM.CNF` text is tiny
/// and never straddles a sector boundary, so a flat scan over the raw window
/// works for both cooked and raw sector layouts.
fn has_ps1_boot_line(bytes: &[u8]) -> bool {
    let mut from = 0;
    while let Some(pos) = find_subslice(bytes, PS1_BOOT_KEY, from) {
        from = pos + 1;
        let mut i = pos + PS1_BOOT_KEY.len();
        // `BOOT2` is PS2's boot key — explicitly not a PS1 signal.
        if bytes.get(i) == Some(&b'2') {
            continue;
        }
        while matches!(bytes.get(i), Some(b' ' | b'\t')) {
            i += 1;
        }
        if bytes.get(i) != Some(&b'=') {
            continue;
        }
        i += 1;
        while matches!(bytes.get(i), Some(b' ' | b'\t')) {
            i += 1;
        }
        let device_matches = bytes
            .get(i..i + CDROM_DEVICE.len())
            .is_some_and(|s| s.eq_ignore_ascii_case(CDROM_DEVICE));
        if device_matches {
            return true;
        }
    }
    false
}

/// True when the pre-PVD system area contains the Sony licence text. Real
/// discs master it with irregular runs of spaces ("Licensed  by          Sony
/// Computer Entertainment …"), so both haystack and needle are compared in
/// whitespace-normalized form. The scan is bounded by the raw-layout system
/// area (16 raw sectors), which also covers the smaller cooked-layout one.
fn has_system_area_licence_text(bytes: &[u8]) -> bool {
    let end = bytes.len().min(ISO_PVD_SECTOR * RAW_SECTOR_SIZE);
    contains_subslice(&normalize_whitespace(&bytes[..end]), PS1_SYSTEM_AREA_LICENCE_TEXT)
}

/// Collapse every run of ASCII whitespace (space, tab, CR, LF) into a single
/// space, leaving all other bytes untouched — so licence text mastered with
/// irregular padding compares equal to its canonical single-spaced form.
fn normalize_whitespace(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut in_whitespace = false;
    for &b in bytes {
        if matches!(b, b' ' | b'\t' | b'\r' | b'\n') {
            if !in_whitespace {
                out.push(b' ');
            }
            in_whitespace = true;
        } else {
            out.push(b);
            in_whitespace = false;
        }
    }
    out
}

/// Find `needle` in `haystack` at or after byte index `from`, returning the
/// match's start index. Naive linear search — every scan this module runs is
/// bounded (by [`SNIFF_WINDOW_BYTES`] or a metadata blob), so this is plenty
/// fast and keeps the module dependency-free.
fn find_subslice(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() || from > haystack.len() - needle.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&i| &haystack[i..i + needle.len()] == needle)
}

/// True when `haystack` contains `needle` anywhere.
fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    find_subslice(haystack, needle, 0).is_some()
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

/// Sniff a bare `.bin` file on disk for a positive PS1 signature.
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

/// Parse a cue sheet, returning **every** file referenced by its `FILE`
/// lines, resolved relative to the cue's own directory, in sheet order.
/// Multi-track cue sheets list one `FILE` per track (or reuse one `FILE`
/// for several `TRACK`s); the first entry is always the data track carrying
/// the disc's boot sector / filesystem. An unreadable or `FILE`-less sheet
/// yields an empty list.
pub fn referenced_files(cue_path: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(cue_path) else {
        return Vec::new();
    };
    let base_dir = cue_path.parent().unwrap_or_else(|| Path::new("."));
    text.lines()
        .filter_map(parse_cue_file_line)
        .map(|name| base_dir.join(name))
        .collect()
}

/// Extract the referenced filename from a cue sheet `FILE <name> [TYPE]`
/// line, or `None` if `line` is not a `FILE` directive. Tolerant of
/// real-world sheets: the keyword is case-insensitive, separators may be
/// spaces or tabs, and the filename may be quoted or bare (a bare filename
/// runs to the next whitespace).
fn parse_cue_file_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let keyword = trimmed.get(..4)?;
    if !keyword.eq_ignore_ascii_case("FILE") {
        return None;
    }
    let rest = &trimmed[4..];
    let is_separator = |c: char| c == ' ' || c == '\t';
    // The keyword must be followed by at least one separator ("FILEX" is not
    // a FILE directive).
    if !rest.starts_with(is_separator) {
        return None;
    }
    let rest = rest.trim_start_matches(is_separator);
    if let Some(after_quote) = rest.strip_prefix('"') {
        let end = after_quote.find('"')?;
        Some(&after_quote[..end])
    } else {
        let end = rest.find(is_separator).unwrap_or(rest.len());
        let name = &rest[..end];
        (!name.is_empty()).then_some(name)
    }
}

/// Sniff a `.cue` sheet: resolve its first referenced file (the data track,
/// relative to the cue's directory) and sniff that file's content. On a
/// positive match the identification's canonical path is the **`.cue`
/// itself** — never the `.bin` — so a multi-track set collapses to one
/// library row keyed on the cue sheet, and the individual `.bin` tracks
/// never surface as their own rows (the scan-integration layer is
/// responsible for excluding them).
///
/// Returns `None` when the cue sheet cannot be parsed, its referenced `.bin`
/// is missing/unreadable, or the referenced track has no positive signature.
pub fn sniff_cue_file(cue_path: &Path) -> Option<DiscIdentification> {
    let bin_path = referenced_files(cue_path).into_iter().next()?;
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

/// True when a CHD metadata blob positively marks the disc as PS1: a
/// `PLAYSTATION` substring or a PS1 `BOOT` line in the metadata text.
///
/// **Real chdman CD metadata never satisfies this** — its `CHT2`/`CHTR`
/// entries carry only track geometry (`TRACK:N TYPE:… FRAMES:…`), so this
/// only fires for hand-tagged/synthetic CHDs; see the module-doc limitation
/// (rhohn94/retro-game-player#49).
fn metadata_has_ps1_marker(metadata: &[u8]) -> bool {
    contains_subslice(metadata, PS1_PVD_SYSTEM_IDENTIFIER) || has_ps1_boot_line(metadata)
}

/// Sniff a `.chd` file's **header + metadata only** for a positive PS1
/// signature. Never decompresses hunks: a v5 CHD header is parsed for its
/// `metaoffset`, the metadata chain is walked, and the concatenated metadata
/// bytes are scanned for a PlayStation marker. Any parse failure (wrong tag,
/// unsupported version, truncated file) or a metadata blob with no positive
/// marker yields `None`.
///
/// **v0.34 limitation:** real chdman CD metadata never contains such a
/// marker, so real-world PS1 `.chd` images are not identified this release
/// (see the module doc; rhohn94/retro-game-player#49).
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
/// `.cue` → [`sniff_cue_file`], `.chd` → [`sniff_chd_file`], `.bin` →
/// [`sniff_bin_file`]. Any other extension (including bare `.iso`, which is
/// out of scope this release) is not this module's concern and yields
/// `None`.
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

/// Test-only fixture builders that mirror **real dump byte layouts** — raw
/// MODE2/2352 sectors with the ECMA-130 sync pattern, an ISO9660 PVD with a
/// proper System Identifier field, canonical `SYSTEM.CNF` text, and the
/// real (irregularly spaced) system-area licence text — so the tests
/// demonstrate the real-world format, not the implementation. Shared with
/// `core::sources::rom`'s integration tests.
#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;

    /// Canonical PS1 `SYSTEM.CNF` content as mastered on real discs: spaces
    /// around `=`, a `cdrom:`-scheme boot executable, CRLF line endings.
    pub const SYSTEM_CNF_PS1: &[u8] =
        b"BOOT = cdrom:\\SLUS_005.94;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801fff00\r\n";

    /// A PS2 `SYSTEM.CNF` (`BOOT2` + `cdrom0:`) — the near-miss the sniffer
    /// must reject even when the PVD says `PLAYSTATION`.
    pub const SYSTEM_CNF_PS2: &[u8] =
        b"BOOT2 = cdrom0:\\SLUS_200.02;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n";

    /// System-area licence text as real NTSC-U PS1 discs master it — the
    /// irregular run-length spacing is faithful to the real bytes.
    pub const LICENCE_TEXT: &[u8] =
        b"          Licensed  by          Sony Computer Entertainment Amer  ica ";

    /// Sector index where the fixture places the `SYSTEM.CNF` file content
    /// (real discs master it among the first files after the directories).
    const SYSTEM_CNF_SECTOR: usize = 23;
    /// System-area sector index carrying the licence text on real discs.
    const LICENCE_SECTOR: usize = 4;
    /// Total sectors in the synthetic images (system area + PVD + a few
    /// filesystem sectors).
    const FIXTURE_SECTORS: usize = 24;
    /// MSF addresses count from 00:02:00 — a 2-second (150-frame) pregap
    /// precedes LBA 0 (ECMA-130).
    const MSF_PREGAP_FRAMES: usize = 150;

    /// Binary-coded-decimal encoding for raw-sector MSF address bytes.
    fn bcd(value: u8) -> u8 {
        ((value / 10) << 4) | (value % 10)
    }

    /// Wrap up to 2048 bytes of user data in one raw 2352-byte Mode 2 Form 1
    /// sector: 12-byte ECMA-130 sync pattern, BCD MSF address, mode byte
    /// (2), duplicated CD-XA Form 1 subheader, user data; EDC/ECC left
    /// zeroed (never inspected by the sniffer).
    pub fn raw_mode2_form1_sector(lba: usize, user_data: &[u8]) -> Vec<u8> {
        assert!(user_data.len() <= COOKED_SECTOR_SIZE);
        let mut sector = vec![0u8; RAW_SECTOR_SIZE];
        sector[0] = 0x00;
        sector[1..11].fill(0xFF);
        sector[11] = 0x00;
        let frames = lba + MSF_PREGAP_FRAMES;
        sector[12] = bcd((frames / (60 * 75)) as u8);
        sector[13] = bcd(((frames / 75) % 60) as u8);
        sector[14] = bcd((frames % 75) as u8);
        sector[15] = 0x02; // Mode 2
        sector[16..24].copy_from_slice(&[0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x00]);
        sector[RAW_MODE2_FORM1_DATA_OFFSET..RAW_MODE2_FORM1_DATA_OFFSET + user_data.len()]
            .copy_from_slice(user_data);
        sector
    }

    /// 2048 bytes of ISO9660 Primary Volume Descriptor user data: type 1,
    /// `CD001`, version 1, and the given System Identifier space-padded into
    /// the 32-byte field at offset 8.
    pub fn pvd_user_data(system_identifier: &str) -> Vec<u8> {
        assert!(system_identifier.len() <= PVD_SYSTEM_IDENTIFIER_LEN);
        let mut pvd = vec![0u8; COOKED_SECTOR_SIZE];
        pvd[0] = 1; // volume-descriptor type: primary
        pvd[1..6].copy_from_slice(ISO_STANDARD_ID);
        pvd[6] = 1; // volume-descriptor version
        let mut field = [b' '; PVD_SYSTEM_IDENTIFIER_LEN];
        field[..system_identifier.len()].copy_from_slice(system_identifier.as_bytes());
        pvd[PVD_SYSTEM_IDENTIFIER_OFFSET..PVD_SYSTEM_IDENTIFIER_OFFSET + PVD_SYSTEM_IDENTIFIER_LEN]
            .copy_from_slice(&field);
        pvd
    }

    /// The per-sector user data of a synthetic disc: licence text in the
    /// system area, PVD at sector 16, `SYSTEM.CNF` content after the
    /// filesystem sectors, zero-fill elsewhere.
    fn sector_user_data(
        lba: usize,
        system_identifier: &str,
        licence_text: Option<&[u8]>,
        system_cnf: Option<&[u8]>,
    ) -> Vec<u8> {
        match lba {
            LICENCE_SECTOR => licence_text.map(<[u8]>::to_vec).unwrap_or_default(),
            ISO_PVD_SECTOR => pvd_user_data(system_identifier),
            SYSTEM_CNF_SECTOR => system_cnf.map(<[u8]>::to_vec).unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    /// A raw MODE2/2352 disc image, byte-faithful to a real cue/bin dump's
    /// sector layout.
    pub fn raw_image(
        system_identifier: &str,
        licence_text: Option<&[u8]>,
        system_cnf: Option<&[u8]>,
    ) -> Vec<u8> {
        (0..FIXTURE_SECTORS)
            .flat_map(|lba| {
                raw_mode2_form1_sector(
                    lba,
                    &sector_user_data(lba, system_identifier, licence_text, system_cnf),
                )
            })
            .collect()
    }

    /// A cooked 2048-byte-sector disc image (an extracted data track).
    pub fn cooked_image(
        system_identifier: &str,
        licence_text: Option<&[u8]>,
        system_cnf: Option<&[u8]>,
    ) -> Vec<u8> {
        (0..FIXTURE_SECTORS)
            .flat_map(|lba| {
                let user = sector_user_data(lba, system_identifier, licence_text, system_cnf);
                let mut sector = vec![0u8; COOKED_SECTOR_SIZE];
                sector[..user.len()].copy_from_slice(&user);
                sector
            })
            .collect()
    }

    /// A real-layout raw PS1 dump: `PLAYSTATION` System Identifier, Sony
    /// licence text, canonical PS1 `SYSTEM.CNF`.
    pub fn ps1_raw_bin() -> Vec<u8> {
        raw_image("PLAYSTATION", Some(LICENCE_TEXT), Some(SYSTEM_CNF_PS1))
    }

    /// A cooked-sector PS1 data track with the same content as
    /// [`ps1_raw_bin`].
    pub fn ps1_cooked_bin() -> Vec<u8> {
        cooked_image("PLAYSTATION", Some(LICENCE_TEXT), Some(SYSTEM_CNF_PS1))
    }

    /// A raw PS2 CD image: same `PLAYSTATION` System Identifier and licence
    /// text, but a `BOOT2` boot line — must NOT identify as PS1.
    pub fn ps2_raw_bin() -> Vec<u8> {
        raw_image("PLAYSTATION", Some(LICENCE_TEXT), Some(SYSTEM_CNF_PS2))
    }

    /// A non-disc filler buffer with no signature at all.
    pub fn non_ps1_bytes() -> Vec<u8> {
        vec![0xAAu8; 8192]
    }

    /// A minimal, sparse **synthetic** CHD v5 file: a valid header pointing
    /// at one metadata entry whose data payload is `metadata_payload`. Real
    /// chdman output never embeds a PS1 marker in metadata (see the module
    /// doc's v0.34 limitation) — this exists to exercise the header/metadata
    /// parser, not to model a real PS1 CHD.
    pub fn synthetic_chd_v5(metadata_payload: &[u8]) -> Vec<u8> {
        let mut file = vec![0u8; CHD_V5_HEADER_LEN];
        file[0..8].copy_from_slice(CHD_TAG);
        file[8..12].copy_from_slice(&(CHD_V5_HEADER_LEN as u32).to_be_bytes());
        file[12..16].copy_from_slice(&CHD_V5_VERSION.to_be_bytes());
        let metaoffset = file.len() as u64;
        file[CHD_V5_METAOFFSET_OFFSET..CHD_V5_METAOFFSET_OFFSET + 8]
            .copy_from_slice(&metaoffset.to_be_bytes());

        // One metadata entry: tag (e.g. "CHT2"), length/flags (payload
        // length in the low 24 bits), next = 0 (end of chain).
        file.extend_from_slice(b"CHT2");
        let length_and_flags = metadata_payload.len() as u32 & CHD_META_LENGTH_MASK;
        file.extend_from_slice(&length_and_flags.to_be_bytes());
        file.extend_from_slice(&0u64.to_be_bytes()); // next
        file.extend_from_slice(metadata_payload);
        file
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures;
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

    // --- sniff_bin_bytes over real dump layouts ------------------------

    #[test]
    fn raw_mode2_2352_ps1_dump_is_identified() {
        assert!(sniff_bin_bytes(&fixtures::ps1_raw_bin()));
    }

    #[test]
    fn cooked_2048_ps1_image_is_identified() {
        assert!(sniff_bin_bytes(&fixtures::ps1_cooked_bin()));
    }

    #[test]
    fn ps2_disc_with_playstation_system_id_is_rejected() {
        // PS2 CDs carry PLAYSTATION in the PVD System Identifier too; the
        // BOOT2 (vs BOOT) line is the discriminator.
        assert!(!sniff_bin_bytes(&fixtures::ps2_raw_bin()));
    }

    #[test]
    fn generic_iso9660_disc_is_rejected() {
        // A valid CD001 PVD with a non-PlayStation System Identifier and no
        // boot config (e.g. a data CD) must not be misidentified.
        assert!(!sniff_bin_bytes(&fixtures::raw_image("LINUX", None, None)));
        assert!(!sniff_bin_bytes(&fixtures::cooked_image("LINUX", None, None)));
    }

    #[test]
    fn licence_text_plus_boot_line_without_valid_pvd_is_identified() {
        // Second acceptance path: system-area licence text + BOOT line, even
        // when the PVD magic is unreadable/corrupt.
        let mut image = fixtures::ps1_raw_bin();
        let pvd = ISO_PVD_SECTOR * RAW_SECTOR_SIZE + RAW_MODE2_FORM1_DATA_OFFSET;
        image[pvd + 1..pvd + 6].copy_from_slice(b"XXXXX");
        assert!(sniff_bin_bytes(&image));
    }

    #[test]
    fn boot_line_alone_without_corroboration_is_rejected() {
        // No PLAYSTATION System Identifier, no licence text: a bare BOOT
        // line is not sufficient.
        assert!(!sniff_bin_bytes(&fixtures::raw_image(
            "LINUX",
            None,
            Some(fixtures::SYSTEM_CNF_PS1)
        )));
        assert!(!sniff_bin_bytes(fixtures::SYSTEM_CNF_PS1));
    }

    #[test]
    fn playstation_system_id_without_boot_line_is_rejected() {
        assert!(!sniff_bin_bytes(&fixtures::raw_image(
            "PLAYSTATION",
            Some(fixtures::LICENCE_TEXT),
            None
        )));
    }

    #[test]
    fn non_ps1_bytes_stay_unidentified() {
        assert!(!sniff_bin_bytes(&fixtures::non_ps1_bytes()));
    }

    #[test]
    fn truncated_image_is_not_a_false_positive() {
        assert!(!sniff_bin_bytes(b"tiny"));
    }

    // --- PVD location + System Identifier ------------------------------

    #[test]
    fn locate_pvd_finds_cooked_layout() {
        assert_eq!(
            locate_pvd(&fixtures::ps1_cooked_bin()),
            Some(ISO_PVD_SECTOR * COOKED_SECTOR_SIZE)
        );
    }

    #[test]
    fn locate_pvd_finds_raw_mode2_layout() {
        assert_eq!(
            locate_pvd(&fixtures::ps1_raw_bin()),
            Some(ISO_PVD_SECTOR * RAW_SECTOR_SIZE + RAW_MODE2_FORM1_DATA_OFFSET)
        );
    }

    #[test]
    fn locate_pvd_none_without_cd001() {
        assert_eq!(locate_pvd(&fixtures::non_ps1_bytes()), None);
        assert_eq!(locate_pvd(b"short"), None);
    }

    #[test]
    fn pvd_system_identifier_field_is_checked() {
        let image = fixtures::ps1_cooked_bin();
        let pvd = locate_pvd(&image).unwrap();
        assert!(pvd_has_playstation_system_identifier(&image, pvd));

        let other = fixtures::cooked_image("LINUX", None, None);
        let pvd = locate_pvd(&other).unwrap();
        assert!(!pvd_has_playstation_system_identifier(&other, pvd));
    }

    // --- SYSTEM.CNF boot line -------------------------------------------

    #[test]
    fn boot_line_with_spaces_matches() {
        assert!(has_ps1_boot_line(b"BOOT = cdrom:\\SLUS_005.94;1\r\n"));
    }

    #[test]
    fn boot_line_without_spaces_matches() {
        assert!(has_ps1_boot_line(b"BOOT=cdrom:\\SCUS_941.63;1"));
    }

    #[test]
    fn boot_line_tabs_and_uppercase_device_match() {
        assert!(has_ps1_boot_line(b"BOOT\t=\tCDROM:\\SLPS_000.01;1"));
    }

    #[test]
    fn boot2_line_is_rejected() {
        assert!(!has_ps1_boot_line(b"BOOT2 = cdrom0:\\SLUS_200.02;1"));
        assert!(!has_ps1_boot_line(fixtures::SYSTEM_CNF_PS2));
    }

    #[test]
    fn boot_line_without_cdrom_device_is_rejected() {
        assert!(!has_ps1_boot_line(b"BOOT = host:\\main.exe"));
        assert!(!has_ps1_boot_line(b"BOOT cdrom:\\NO_EQUALS;1"));
    }

    // --- licence text + helpers ------------------------------------------

    #[test]
    fn real_spacing_licence_text_is_recognized() {
        let mut area = vec![0u8; 4096];
        area[100..100 + fixtures::LICENCE_TEXT.len()].copy_from_slice(fixtures::LICENCE_TEXT);
        assert!(has_system_area_licence_text(&area));
        assert!(!has_system_area_licence_text(&vec![0u8; 4096]));
    }

    #[test]
    fn normalize_whitespace_collapses_runs() {
        assert_eq!(normalize_whitespace(b"a  b\t\r\nc"), b"a b c".to_vec());
        assert_eq!(normalize_whitespace(b"abc"), b"abc".to_vec());
    }

    #[test]
    fn find_subslice_bounds_are_safe() {
        assert_eq!(find_subslice(b"abcabc", b"abc", 0), Some(0));
        assert_eq!(find_subslice(b"abcabc", b"abc", 1), Some(3));
        assert_eq!(find_subslice(b"abc", b"abcd", 0), None);
        assert_eq!(find_subslice(b"abc", b"", 0), None);
        assert_eq!(find_subslice(b"abc", b"c", 9), None);
    }

    // --- file-level sniffing ----------------------------------------------

    #[test]
    fn sniff_bin_file_reads_from_disk() {
        let dir = temp_dir("bin-file");
        let bin_path = dir.join("game.bin");
        fs::write(&bin_path, fixtures::ps1_raw_bin()).unwrap();

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

    // --- cue parsing -------------------------------------------------------

    #[test]
    fn parses_single_track_cue_file_line() {
        let line = r#"FILE "game.bin" BINARY"#;
        assert_eq!(parse_cue_file_line(line), Some("game.bin"));
    }

    #[test]
    fn parses_cue_file_line_case_insensitive_keyword() {
        assert_eq!(
            parse_cue_file_line(r#"file "Game (Disc 1).bin" BINARY"#),
            Some("Game (Disc 1).bin")
        );
        assert_eq!(parse_cue_file_line(r#"File "a.bin" BINARY"#), Some("a.bin"));
    }

    #[test]
    fn parses_cue_file_line_with_tabs() {
        assert_eq!(parse_cue_file_line("FILE\t\"game.bin\"\tBINARY"), Some("game.bin"));
    }

    #[test]
    fn parses_unquoted_cue_file_line() {
        assert_eq!(parse_cue_file_line("FILE track01.bin BINARY"), Some("track01.bin"));
    }

    #[test]
    fn non_file_cue_line_is_none() {
        assert_eq!(parse_cue_file_line("  TRACK 01 MODE2/2352"), None);
        assert_eq!(parse_cue_file_line(r#"FILENAME "x.bin" BINARY"#), None);
        assert_eq!(parse_cue_file_line("FILE "), None);
    }

    #[test]
    fn referenced_files_returns_every_file_line() {
        let dir = temp_dir("cue-refs");
        let cue_path = dir.join("multi.cue");
        fs::write(
            &cue_path,
            "FILE \"track01.bin\" BINARY\n  TRACK 01 MODE2/2352\n\
             file \"track02.bin\" BINARY\n  TRACK 02 AUDIO\n\
             FILE track03.bin BINARY\n  TRACK 03 AUDIO\n",
        )
        .unwrap();

        let refs = referenced_files(&cue_path);
        assert_eq!(
            refs,
            vec![
                dir.join("track01.bin"),
                dir.join("track02.bin"),
                dir.join("track03.bin")
            ]
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn referenced_files_unreadable_sheet_is_empty() {
        let dir = temp_dir("cue-refs-missing");
        assert!(referenced_files(&dir.join("ghost.cue")).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    // --- cue-level sniffing --------------------------------------------------

    #[test]
    fn sniff_cue_resolves_and_sniffs_first_bin_positively() {
        let dir = temp_dir("cue-positive");
        let bin_path = dir.join("track01.bin");
        fs::write(&bin_path, fixtures::ps1_raw_bin()).unwrap();
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
        fs::write(&bin1, fixtures::ps1_raw_bin()).unwrap();
        fs::write(&bin2, fixtures::non_ps1_bytes()).unwrap(); // an audio track, say
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
        fs::write(&bin_path, fixtures::non_ps1_bytes()).unwrap();
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

    // --- CHD (synthetic metadata only — see module-doc limitation) ---------

    #[test]
    fn synthetic_chd_metadata_with_marker_is_identified() {
        // SYNTHETIC: real chdman metadata never carries a PS1 marker (see
        // the module doc / issue #49); this exercises the header+metadata
        // parser only.
        let dir = temp_dir("chd-positive");
        let chd_path = dir.join("game.chd");
        let payload = b"HAND-TAGGED: PLAYSTATION disc image";
        fs::write(&chd_path, fixtures::synthetic_chd_v5(payload)).unwrap();

        let ident = sniff_chd_file(&chd_path).expect("should identify from metadata");
        assert_eq!(ident.system, SYSTEM_PS1);
        assert_eq!(ident.canonical_path, chd_path);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn realistic_chdman_cd_metadata_is_not_identified() {
        // Documents the v0.34 limitation (issue #49): real chdman CHT2
        // metadata is pure track geometry, so a real PS1 CHD returns None.
        let dir = temp_dir("chd-realistic");
        let chd_path = dir.join("real.chd");
        let payload =
            b"TRACK:1 TYPE:MODE2_RAW SUBTYPE:NONE FRAMES:220950 PREGAP:0 PGTYPE:MODE1 PGSUB:NONE POSTGAP:0";
        fs::write(&chd_path, fixtures::synthetic_chd_v5(payload)).unwrap();

        assert!(sniff_chd_file(&chd_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chd_metadata_without_marker_stays_unidentified() {
        let dir = temp_dir("chd-negative");
        let chd_path = dir.join("other.chd");
        let payload = b"TRACK:1 TYPE:AUDIO some other disc";
        fs::write(&chd_path, fixtures::synthetic_chd_v5(payload)).unwrap();

        assert!(sniff_chd_file(&chd_path).is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chd_wrong_tag_is_none() {
        let dir = temp_dir("chd-badtag");
        let chd_path = dir.join("bad.chd");
        let mut bytes = fixtures::synthetic_chd_v5(b"PLAYSTATION");
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

    // --- dispatch ------------------------------------------------------------

    #[test]
    fn dispatch_routes_by_extension() {
        let dir = temp_dir("dispatch");
        let bin_path = dir.join("game.bin");
        fs::write(&bin_path, fixtures::ps1_raw_bin()).unwrap();
        assert!(sniff_disc_image(&bin_path).is_some());

        // Neither .txt nor bare .iso is routed (bare .iso is out of scope).
        for other in ["game.txt", "game.iso"] {
            let path = dir.join(other);
            fs::write(&path, fixtures::ps1_raw_bin()).unwrap();
            assert!(sniff_disc_image(&path).is_none());
        }

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ambiguous_extension_predicate() {
        assert!(is_ambiguous_disc_extension("cue"));
        assert!(is_ambiguous_disc_extension(".CHD"));
        assert!(is_ambiguous_disc_extension("bin"));
        assert!(!is_ambiguous_disc_extension("nes"));
        assert!(!is_ambiguous_disc_extension("iso"));
    }
}
