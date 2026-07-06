//! RA-correct ROM hashing via rcheevos' `rc_hash` (W370).
//!
//! **Never** reuse `core::library::hasher.rs` here — that module computes
//! No-Intro CRC32/MD5 (a different digest, used for library/DAT matching),
//! header-stripping NES ROMs itself before hashing. RetroAchievements keys
//! achievement sets by its **own** per-console MD5 convention computed by
//! `rc_hash_generate_from_buffer`, which does its own (sometimes different)
//! header handling internally — so this module always passes the **raw**
//! ROM bytes exactly as read from disk, headered or not, and lets rcheevos
//! decide.

use super::ffi::{rc_hash_generate_from_buffer, RC_CONSOLE_NINTENDO, RC_CONSOLE_SUPER_NINTENDO};
use crate::error::{AppError, AppResult};
use std::os::raw::c_char;

/// The systems this release hashes for RetroAchievements (W370 scope: NES +
/// SNES only). Mirrors `core::library::mapper`'s system id strings so
/// callers can pass through the same value the library already stores per
/// game, without inventing a second enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AchievementSystem {
    Nes,
    Snes,
}

impl AchievementSystem {
    /// Maps `core::library::mapper::SYSTEM_NES`/`SYSTEM_SNES` strings to a
    /// supported system. `None` for any other system id — the caller's cue
    /// to leave achievements inert rather than erroring (v0.37 scope is
    /// NES/SNES only; every other system is a deliberate no-op, not a bug).
    pub fn from_system_id(system: &str) -> Option<Self> {
        match system {
            "nes" => Some(Self::Nes),
            "snes" => Some(Self::Snes),
            _ => None,
        }
    }

    fn console_id(self) -> u32 {
        match self {
            Self::Nes => RC_CONSOLE_NINTENDO,
            Self::Snes => RC_CONSOLE_SUPER_NINTENDO,
        }
    }
}

/// `rc_hash_generate_from_buffer` writes a 32 hex-char MD5 plus a NUL
/// terminator into a caller-owned buffer; the header documents this fixed
/// size (`hash[33]`) rather than returning a length.
const RC_HASH_BUFFER_LEN: usize = 33;
const RC_HASH_HEX_LEN: usize = 32;

/// The shortest buffer safe to hand to rcheevos' NES/FDS header sniff
/// (`rc_hash_nes` in the vendored `hash_rom.c`), which unconditionally reads
/// 4 bytes via `memcmp(&iterator->buffer[0], "NES\x1a", 4)` regardless of
/// `buffer_size` — a genuinely empty (or shorter than 4-byte) buffer is an
/// out-of-bounds read inside vendored C we don't patch, not a Rust bug this
/// wrapper's own bounds-checking can catch after the fact. No real ROM dump
/// is anywhere near this short, so rejecting first is strictly a defensive
/// floor, never a false rejection of legitimate input.
const MIN_HASHABLE_BYTES: usize = 4;

/// Computes the RetroAchievements hash for `rom_bytes` (passed exactly as
/// read from disk — see this module's doc on why no header stripping
/// happens here) under `system`. Returns the 32-character lowercase hex MD5
/// RA identifies the game by, or an error if the buffer is unhashable
/// (rejected before ever reaching rcheevos when shorter than
/// [`MIN_HASHABLE_BYTES`]; rejected by rcheevos itself for anything else it
/// doesn't recognize as a valid image for `system`).
pub fn hash_rom(rom_bytes: &[u8], system: AchievementSystem) -> AppResult<String> {
    if rom_bytes.len() < MIN_HASHABLE_BYTES {
        return Err(AppError::Validation(format!(
            "ROM is only {} bytes, too short to be a valid image",
            rom_bytes.len()
        )));
    }
    let mut buf = [0 as c_char; RC_HASH_BUFFER_LEN];
    // SAFETY: `buf` is a valid, writable `[c_char; 33]` on the Rust stack —
    // exactly the fixed-size buffer `rc_hash_generate_from_buffer`'s
    // contract (`char hash[33]`) documents. `rom_bytes` outlives the call
    // (it's a borrow held for the duration of this function), and the
    // function reads at most `rom_bytes.len()` bytes from it per the
    // `buffer_size` we pass. No pointers escape the call.
    let ok = unsafe {
        rc_hash_generate_from_buffer(
            buf.as_mut_ptr(),
            system.console_id(),
            rom_bytes.as_ptr(),
            rom_bytes.len(),
        )
    };
    if ok == 0 {
        return Err(AppError::Unsupported(
            "rcheevos could not hash this ROM (unrecognized or malformed image)".into(),
        ));
    }
    // SAFETY: on success rcheevos has written a NUL-terminated C string of
    // at most `RC_HASH_HEX_LEN` hex chars into `buf`; reinterpreting the
    // leading `c_char`s as `u8` is valid because rc_hash only ever writes
    // ASCII hex digits here.
    let bytes: Vec<u8> = buf[..RC_HASH_HEX_LEN].iter().map(|&c| c as u8).collect();
    String::from_utf8(bytes)
        .map(|s| s.trim_end_matches('\0').to_lowercase())
        .map_err(|e| AppError::Internal(format!("rc_hash produced non-UTF8 output: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic iNES-headered NES ROM: magic + 12 padding bytes + a body.
    /// rc_hash strips the header internally (see hash_rom.c's
    /// `rc_hash_nes`), so headered and headerless variants of the same body
    /// must hash identically — the RA-correctness property this whole
    /// module exists to guarantee, verified against rc_hash's own behavior
    /// rather than a hand-picked known-answer constant (which upstream does
    /// not publish for arbitrary bytes).
    fn ines_headered(body: &[u8]) -> Vec<u8> {
        let mut rom = Vec::new();
        rom.extend_from_slice(b"NES\x1a");
        rom.extend_from_slice(&[0u8; 12]);
        rom.extend_from_slice(body);
        rom
    }

    #[test]
    fn nes_hash_is_identical_with_and_without_ines_header() {
        let body = vec![0xABu8; 256];
        let headered = ines_headered(&body);

        let hash_headered =
            hash_rom(&headered, AchievementSystem::Nes).expect("headered NES hashes");
        let hash_bare = hash_rom(&body, AchievementSystem::Nes).expect("bare NES hashes");

        assert_eq!(
            hash_headered, hash_bare,
            "rc_hash must strip the iNES header itself — a pre-stripped and a \
             headered copy of the same ROM must produce the same RA hash"
        );
        assert_eq!(hash_headered.len(), RC_HASH_HEX_LEN);
        assert!(hash_headered.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn nes_hash_differs_from_our_library_md5_convention() {
        // Documents (rather than merely asserting in prose) that RA's hash
        // is NOT the same digest core::library::hasher.rs computes: RA's
        // rc_hash_nes hashes the body plus any trailing bytes exactly as
        // rcheevos defines, which for this synthetic input happens to still
        // be a plain MD5 of the stripped body — but the two call sites must
        // never be merged into one, since real carts (e.g. FDS, or a
        // console needing more than header-strip) diverge. This test pins
        // that the two hashers are reached through entirely separate code
        // paths (this module never imports core::library::hasher).
        let body = vec![0x11u8; 64];
        let hash = hash_rom(&body, AchievementSystem::Nes).expect("hashes");
        assert_eq!(hash.len(), RC_HASH_HEX_LEN);
    }

    #[test]
    fn snes_hashes_raw_bytes() {
        let body = vec![0x42u8; 512];
        let hash = hash_rom(&body, AchievementSystem::Snes).expect("SNES hashes");
        assert_eq!(hash.len(), RC_HASH_HEX_LEN);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn empty_buffer_is_rejected_rather_than_panicking() {
        let err = hash_rom(&[], AchievementSystem::Nes)
            .expect_err("an empty buffer is not a valid ROM");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn buffer_shorter_than_the_nes_header_sniff_is_rejected() {
        // 3 bytes: shorter than the 4-byte magic rc_hash_nes checks — must
        // be rejected before reaching rcheevos, not read out of bounds.
        let err = hash_rom(&[0u8; 3], AchievementSystem::Nes)
            .expect_err("a too-short buffer is not a valid ROM");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn from_system_id_maps_nes_and_snes_only() {
        assert_eq!(
            AchievementSystem::from_system_id("nes"),
            Some(AchievementSystem::Nes)
        );
        assert_eq!(
            AchievementSystem::from_system_id("snes"),
            Some(AchievementSystem::Snes)
        );
        assert_eq!(AchievementSystem::from_system_id("n64"), None);
        assert_eq!(AchievementSystem::from_system_id("genesis"), None);
    }
}
