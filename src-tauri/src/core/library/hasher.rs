//! ROM hashing (W6): CRC32 + MD5 over (optionally header-stripped) ROM bytes.
//!
//! No-Intro DATs key entries by CRC32 (and SHA1); Harmony persists CRC32 + MD5
//! per game (schema §3). Both digests are computed from the **same** byte slice
//! so an NES ROM is hashed over its header-stripped body (see [`super::ines`]).

use super::ines::strip_ines_header;
use crc32fast::Hasher as Crc32Hasher;
use md5::{Digest, Md5};

/// The pair of digests Harmony stores for a ROM, both lowercase hex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RomHashes {
    /// CRC32 as 8 lowercase hex chars.
    pub crc32: String,
    /// MD5 as 32 lowercase hex chars.
    pub md5: String,
}

/// Compute CRC32 + MD5 over `bytes` exactly as given (no header handling).
pub fn hash_bytes(bytes: &[u8]) -> RomHashes {
    let mut crc = Crc32Hasher::new();
    crc.update(bytes);
    let crc32 = format!("{:08x}", crc.finalize());

    let mut md5 = Md5::new();
    md5.update(bytes);
    let md5 = format!("{:032x}", md5.finalize());

    RomHashes { crc32, md5 }
}

/// Hash ROM `bytes` for a given system, stripping the iNES header first when the
/// system is NES. Other systems hash the raw bytes. This is the entry point the
/// scanner uses so header handling lives in exactly one place.
pub fn hash_rom(bytes: &[u8], system: &str) -> RomHashes {
    let payload = if system == super::mapper::SYSTEM_NES {
        strip_ines_header(bytes)
    } else {
        bytes
    };
    hash_bytes(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::library::ines::{INES_HEADER_LEN, INES_MAGIC};
    use crate::core::library::mapper::{SYSTEM_NES, SYSTEM_SNES};

    /// Known-answer vectors for the empty input pin the implementation.
    #[test]
    fn empty_input_known_digests() {
        let h = hash_bytes(&[]);
        assert_eq!(h.crc32, "00000000");
        assert_eq!(h.md5, "d41d8cd98f00b204e9800998ecf8427e");
    }

    /// "abc" against published CRC32 + MD5 reference values.
    #[test]
    fn abc_known_digests() {
        let h = hash_bytes(b"abc");
        assert_eq!(h.crc32, "352441c2");
        assert_eq!(h.md5, "900150983cd24fb0d6963f7d28e17f72");
    }

    /// A NES ROM hashes over its stripped body — same digests as the bare body.
    #[test]
    fn nes_strips_header_before_hashing() {
        let body = b"abc";
        let mut rom = Vec::new();
        rom.extend_from_slice(&INES_MAGIC);
        rom.extend_from_slice(&[0u8; INES_HEADER_LEN - 4]);
        rom.extend_from_slice(body);

        let headered = hash_rom(&rom, SYSTEM_NES);
        let bare = hash_bytes(body);
        assert_eq!(headered, bare);
    }

    /// Non-NES systems hash raw bytes (no stripping).
    #[test]
    fn non_nes_hashes_raw() {
        let bytes = b"snesrom";
        assert_eq!(hash_rom(bytes, SYSTEM_SNES), hash_bytes(bytes));
    }
}
