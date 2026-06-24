//! iNES header handling for NES ROMs (W6).
//!
//! `.nes` dumps usually carry a 16-byte iNES header (`NES\x1A` magic). No-Intro
//! CRC/MD5 hashes are computed over the **header-stripped** ROM body, so the
//! matcher must strip it before hashing — otherwise an identical cartridge with
//! and without a header hashes differently and never matches the DAT.

/// The iNES header magic bytes: ASCII `NES` followed by MS-DOS EOF (`0x1A`).
pub const INES_MAGIC: [u8; 4] = [b'N', b'E', b'S', 0x1A];

/// Length in bytes of an iNES (and NES 2.0) header.
pub const INES_HEADER_LEN: usize = 16;

/// True when `bytes` begins with a valid iNES header magic.
pub fn has_ines_header(bytes: &[u8]) -> bool {
    bytes.len() >= INES_HEADER_LEN && bytes[..INES_MAGIC.len()] == INES_MAGIC
}

/// Return the ROM body with any iNES header removed. If no header is present the
/// input slice is returned unchanged, so this is safe to call unconditionally on
/// any NES ROM.
pub fn strip_ines_header(bytes: &[u8]) -> &[u8] {
    if has_ines_header(bytes) {
        &bytes[INES_HEADER_LEN..]
    } else {
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headered(body: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&INES_MAGIC);
        // 12 remaining header bytes (flags / padding) — content is irrelevant.
        v.extend_from_slice(&[0u8; INES_HEADER_LEN - 4]);
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn detects_and_strips_a_real_header() {
        let body = [1u8, 2, 3, 4, 5];
        let rom = headered(&body);
        assert!(has_ines_header(&rom));
        assert_eq!(strip_ines_header(&rom), &body);
    }

    #[test]
    fn leaves_headerless_rom_untouched() {
        let raw = [9u8, 8, 7, 6];
        assert!(!has_ines_header(&raw));
        assert_eq!(strip_ines_header(&raw), &raw);
    }

    #[test]
    fn short_input_is_not_a_header() {
        assert!(!has_ines_header(b"NES"));
        assert_eq!(strip_ines_header(b"NES"), b"NES");
    }
}
