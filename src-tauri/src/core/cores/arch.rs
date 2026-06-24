//! Architecture verification (W5). A downloaded core dylib must be arm64 (Apple
//! Silicon) before Harmony installs it; a non-arm64 binary is rejected with
//! [`AppError::Unsupported`].
//!
//! Two layers:
//!   - [`is_arm64_macho`] — pure parse of the leading Mach-O header bytes (the
//!     magic + cputype, including fat/universal binaries). Unit-tested against
//!     fixture byte arrays, no filesystem or `lipo` needed.
//!   - [`verify_arm64_dylib`] — verifies a file on disk: reads its header and,
//!     when the `lipo` tool is present, cross-checks with `lipo -archs` so the
//!     result matches Apple's own toolchain.

use crate::error::{AppError, AppResult};
use std::path::Path;
use std::process::Command;

/// Mach-O magic for a 64-bit thin binary (little-endian, `MH_MAGIC_64`).
const MH_MAGIC_64: u32 = 0xFEED_FACF;
/// Mach-O magic for a 64-bit thin binary (byte-swapped, `MH_CIGAM_64`).
const MH_CIGAM_64: u32 = 0xCFFA_EDFE;
/// Magic for a fat/universal binary, big-endian on disk (`FAT_MAGIC`).
const FAT_MAGIC: u32 = 0xCAFE_BABE;
/// Magic for a fat/universal binary, byte-swapped (`FAT_CIGAM`).
const FAT_CIGAM: u32 = 0xBEBA_FECA;
/// `CPU_ARCH_ABI64` bit OR'd into 64-bit cpu types.
const CPU_ARCH_ABI64: u32 = 0x0100_0000;
/// `CPU_TYPE_ARM` base value; arm64 is `CPU_TYPE_ARM | CPU_ARCH_ABI64`.
const CPU_TYPE_ARM: u32 = 12;
/// arm64 cpu type (`CPU_TYPE_ARM64`).
const CPU_TYPE_ARM64: u32 = CPU_TYPE_ARM | CPU_ARCH_ABI64;
/// `lipo`'s textual name for the arm64 slice.
const LIPO_ARM64: &str = "arm64";

/// True iff `bytes` are the header of a Mach-O whose (only or any) slice targets
/// arm64. Handles thin 64-bit binaries (both byte orders) and fat/universal
/// binaries (scanning every architecture entry).
pub fn is_arm64_macho(bytes: &[u8]) -> bool {
    let Some(magic) = read_u32_be(bytes, 0) else {
        return false;
    };
    match magic {
        // Fat binary: arch entries follow a big-endian header.
        FAT_MAGIC | FAT_CIGAM => fat_has_arm64(bytes, magic == FAT_CIGAM),
        _ => thin_is_arm64(bytes),
    }
}

/// Inspect a thin Mach-O: its magic at offset 0 and cputype at offset 4 share
/// the file's byte order.
fn thin_is_arm64(bytes: &[u8]) -> bool {
    let Some(magic_le) = read_u32_le(bytes, 0) else {
        return false;
    };
    let swapped = magic_le == MH_CIGAM_64;
    let native = magic_le == MH_MAGIC_64;
    if !native && !swapped {
        return false;
    }
    let cputype = if swapped {
        read_u32_be(bytes, 4)
    } else {
        read_u32_le(bytes, 4)
    };
    cputype == Some(CPU_TYPE_ARM64)
}

/// Scan a fat binary's arch table (always big-endian on disk) for an arm64 slice.
fn fat_has_arm64(bytes: &[u8], _swapped: bool) -> bool {
    // fat_header: magic(4) nfat_arch(4); each fat_arch: cputype(4) cpusubtype(4)
    // offset(4) size(4) align(4) = 20 bytes. cputype is the first field.
    let Some(nfat) = read_u32_be(bytes, 4) else {
        return false;
    };
    const FAT_HEADER_LEN: usize = 8;
    const FAT_ARCH_LEN: usize = 20;
    (0..nfat as usize).any(|i| {
        let off = FAT_HEADER_LEN + i * FAT_ARCH_LEN;
        read_u32_be(bytes, off) == Some(CPU_TYPE_ARM64)
    })
}

/// Read a big-endian `u32` at `off`, or `None` if out of bounds.
fn read_u32_be(bytes: &[u8], off: usize) -> Option<u32> {
    bytes
        .get(off..off + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// Read a little-endian `u32` at `off`, or `None` if out of bounds.
fn read_u32_le(bytes: &[u8], off: usize) -> Option<u32> {
    bytes
        .get(off..off + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Verify the dylib at `path` is arm64, rejecting anything else with
/// [`AppError::Unsupported`]. Reads the Mach-O header directly; if the `lipo`
/// tool is available it additionally requires `lipo -archs` to report `arm64`,
/// matching Apple's toolchain. A read failure surfaces as [`AppError::Io`].
pub fn verify_arm64_dylib(path: &Path) -> AppResult<()> {
    let header = read_header(path)?;
    if !is_arm64_macho(&header) {
        return Err(AppError::Unsupported(format!(
            "{} is not an arm64 Mach-O dylib",
            path.display()
        )));
    }
    if let Some(archs) = lipo_archs(path) {
        if !archs.split_whitespace().any(|a| a == LIPO_ARM64) {
            return Err(AppError::Unsupported(format!(
                "lipo reports no arm64 slice in {} (archs: {})",
                path.display(),
                archs.trim()
            )));
        }
    }
    Ok(())
}

/// Read the leading header bytes needed to classify the binary (enough for a
/// fat table of several slices).
fn read_header(path: &Path) -> AppResult<Vec<u8>> {
    use std::io::Read;
    const HEADER_BYTES: usize = 4096;
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; HEADER_BYTES];
    let n = f.read(&mut buf)?;
    buf.truncate(n);
    Ok(buf)
}

/// Run `lipo -archs <path>`; `Some(stdout)` if the tool ran, `None` if `lipo`
/// is absent or failed to execute (then header parsing alone decides).
fn lipo_archs(path: &Path) -> Option<String> {
    let out = Command::new("lipo")
        .arg("-archs")
        .arg(path)
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal thin 64-bit Mach-O header (little-endian) for `cputype`.
    fn thin_header_le(cputype: u32) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&MH_MAGIC_64.to_le_bytes());
        v.extend_from_slice(&cputype.to_le_bytes());
        v.extend_from_slice(&[0u8; 24]); // remaining mach_header_64 fields
        v
    }

    /// Build a minimal fat header (big-endian) with one slice of `cputype`.
    fn fat_header(cputype: u32) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&FAT_MAGIC.to_be_bytes());
        v.extend_from_slice(&1u32.to_be_bytes()); // nfat_arch
        v.extend_from_slice(&cputype.to_be_bytes()); // fat_arch.cputype
        v.extend_from_slice(&[0u8; 16]); // rest of fat_arch
        v
    }

    #[test]
    fn thin_arm64_is_accepted() {
        assert!(is_arm64_macho(&thin_header_le(CPU_TYPE_ARM64)));
    }

    #[test]
    fn thin_x86_64_is_rejected() {
        // CPU_TYPE_X86_64 = 7 | ABI64
        let x86_64 = 7 | CPU_ARCH_ABI64;
        assert!(!is_arm64_macho(&thin_header_le(x86_64)));
    }

    #[test]
    fn byte_swapped_thin_arm64_is_accepted() {
        let mut v = Vec::new();
        v.extend_from_slice(&MH_CIGAM_64.to_le_bytes());
        v.extend_from_slice(&CPU_TYPE_ARM64.to_be_bytes()); // swapped cputype
        v.extend_from_slice(&[0u8; 24]);
        assert!(is_arm64_macho(&v));
    }

    #[test]
    fn fat_with_arm64_slice_is_accepted() {
        assert!(is_arm64_macho(&fat_header(CPU_TYPE_ARM64)));
    }

    #[test]
    fn fat_with_only_x86_64_is_rejected() {
        assert!(!is_arm64_macho(&fat_header(7 | CPU_ARCH_ABI64)));
    }

    #[test]
    fn non_macho_bytes_are_rejected() {
        assert!(!is_arm64_macho(b"not a mach-o file at all"));
        assert!(!is_arm64_macho(&[]));
        assert!(!is_arm64_macho(&[0xFE, 0xED])); // too short
    }

    #[test]
    fn verify_rejects_a_non_macho_file_on_disk() {
        let p = std::env::temp_dir().join(format!("harmony-arch-{}.bin", std::process::id()));
        std::fs::write(&p, b"#!/bin/sh\necho hi\n").unwrap();
        assert!(matches!(
            verify_arm64_dylib(&p),
            Err(AppError::Unsupported(_))
        ));
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn verify_accepts_a_thin_arm64_header_on_disk() {
        // Without lipo present (or lipo tolerating a stub) header parsing wins;
        // a real lipo on a 32-byte stub fails to execute → falls back to header.
        let p = std::env::temp_dir().join(format!("harmony-arch-ok-{}.bin", std::process::id()));
        std::fs::write(&p, thin_header_le(CPU_TYPE_ARM64)).unwrap();
        // lipo on a truncated file errors → lipo_archs returns None → header decides.
        assert!(verify_arm64_dylib(&p).is_ok());
        std::fs::remove_file(&p).ok();
    }
}
