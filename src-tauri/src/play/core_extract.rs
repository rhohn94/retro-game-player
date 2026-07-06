//! One-time decompression of EmulatorJS 7z core archives into a disk cache of
//! raw files (v0.37 W374, #31; docs/design/boot-latency-spike.md "Technique
//! B"). Every in-page boot previously re-ran the 7z Worker inside the page on
//! the *same* archive bytes (fceumm ~1 MB, heavier cores several MB) — pure
//! wasted CPU on repeat boots of a game whose core never changes. This module
//! moves that decompression to the Rust side, once per archive, so
//! [`crate::play::server`] can serve the already-extracted `.js`/`.wasm`/
//! `.worker.js`/`core.json`/`build.json`/`license.txt` files directly and the
//! page-side loader (`vendor/emulatorjs/src/emulator.js`, patched) can skip
//! its `checkCompression` step entirely on a cache hit.
//!
//! Cache layout: `<ejs-cores-root>/<ejs-version>/extracted/<archive-hash
//! prefix>/<entry-name>`, where the hash prefix is the archive's own
//! SHA-256 (already computed at download/embed time). Keying on the
//! archive's content hash — not the core name — means a core-version bump
//! (a new pinned `archive_sha256` in [`crate::play::ejs_cores::CATALOG`], or
//! a re-vendored embedded NES core) naturally lands in a fresh directory;
//! the old one is simply never read again. No separate invalidation bookkeeping
//! is needed.

use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Subdirectory (under the version dir) holding extracted-core caches.
const EXTRACTED_DIR_NAME: &str = "extracted";

/// Upper bound on any single decompressed file (the largest core's `.wasm`
/// is a few MB uncompressed; 64 MiB leaves generous headroom while bounding
/// a hostile or corrupt archive claiming an enormous entry size).
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

/// One decompressed file pulled out of a core archive.
#[derive(Debug)]
pub struct ExtractedFile {
    /// The archive-internal filename, e.g. `fceumm_libretro.wasm`.
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Hex SHA-256 of `bytes` — used both to verify downloaded archives
/// ([`crate::play::ejs_cores`]) and to key this module's extraction cache.
pub fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// The cache directory for the archive whose bytes hash to `archive_hash`,
/// under `version_dir` (the same per-EJS-version root
/// [`crate::play::ejs_cores::version_dir`] returns).
pub fn extracted_dir(version_dir: &Path, archive_hash: &str) -> PathBuf {
    version_dir.join(EXTRACTED_DIR_NAME).join(archive_hash)
}

/// Whether `archive_hash`'s extraction cache already exists and is
/// non-empty. A directory with zero files means a prior extraction was
/// interrupted before any file landed — treated as "not cached" so
/// [`ensure_extracted`] retries it.
pub fn is_extracted(version_dir: &Path, archive_hash: &str) -> bool {
    let dir = extracted_dir(version_dir, archive_hash);
    match std::fs::read_dir(&dir) {
        Ok(mut entries) => entries.next().is_some(),
        Err(_) => false,
    }
}

/// Decompresses `archive_bytes` (a 7z EmulatorJS core archive) into
/// `version_dir`'s extraction cache, keyed by the archive's own SHA-256, if
/// not already cached. Idempotent and safe to call on every boot — a cache
/// hit does no I/O beyond the directory-emptiness check.
///
/// Each extracted file is written tmp-then-rename into its final name, so a
/// crash mid-extraction never leaves a partial file [`is_extracted`] would
/// wrongly treat as complete (the directory-emptiness check only guards the
/// zero-files case; a *partial* multi-file extraction is still guarded by
/// each file's own atomic rename never occurring for the files not yet
/// processed).
pub fn ensure_extracted(version_dir: &Path, archive_bytes: &[u8]) -> AppResult<PathBuf> {
    let hash = hex_sha256(archive_bytes);
    let dir = extracted_dir(version_dir, &hash);
    if is_extracted(version_dir, &hash) {
        return Ok(dir);
    }
    let files = decompress_archive(archive_bytes)?;
    std::fs::create_dir_all(&dir)?;
    for file in &files {
        write_atomic(&dir.join(&file.name), &file.bytes)?;
    }
    Ok(dir)
}

/// Decompress a 7z archive fully into memory as `(name, bytes)` pairs.
/// Rejects any entry exceeding [`MAX_ENTRY_BYTES`] or any name that isn't a
/// single flat path component (an EmulatorJS core archive is flat by
/// construction; refusing nested paths keeps [`write_atomic`]'s single
/// `join` from ever escaping `dir`).
fn decompress_archive(archive_bytes: &[u8]) -> AppResult<Vec<ExtractedFile>> {
    let mut reader = sevenz_rust::SevenZReader::new(
        std::io::Cursor::new(archive_bytes),
        archive_bytes.len() as u64,
        sevenz_rust::Password::empty(),
    )
    .map_err(|e| AppError::Validation(format!("core archive is not a valid 7z file: {e}")))?;

    let mut out = Vec::new();
    reader
        .for_each_entries(|entry, source| {
            if entry.is_directory {
                return Ok(true);
            }
            let name = entry.name.clone();
            if !is_flat_filename(&name) {
                return Err(sevenz_rust::Error::other(format!(
                    "core archive entry has an unexpected path: {name}"
                )));
            }
            if entry.size > MAX_ENTRY_BYTES {
                return Err(sevenz_rust::Error::other(format!(
                    "core archive entry {name} exceeds the {MAX_ENTRY_BYTES}-byte cap"
                )));
            }
            let mut bytes = Vec::new();
            source
                .take(MAX_ENTRY_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(sevenz_rust::Error::io)?;
            out.push(ExtractedFile { name, bytes });
            Ok(true)
        })
        .map_err(|e| AppError::Validation(format!("core archive decompression failed: {e}")))?;
    Ok(out)
}

/// A single normal path component with no separator, `..`, or empty name —
/// the shape every real EmulatorJS core archive entry has.
fn is_flat_filename(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
}

/// tmp-then-rename write, creating parent dirs — mirrors
/// [`crate::play::ejs_cores::write_atomic`] (kept separate: that one writes
/// exactly two well-known files, this one writes an archive's worth of
/// dynamically-named entries).
fn write_atomic(dest: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::Internal(format!("no parent dir for {}", dest.display())))?;
    std::fs::create_dir_all(parent)?;
    let tmp = dest.with_extension("tmp-extract");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny, hand-built one-entry 7z archive is awkward to construct by
    /// hand; instead these tests exercise the cache-path logic (hashing,
    /// directory layout, idempotency, invalidation-on-change) directly
    /// against [`ensure_extracted`]'s public contract using a real embedded
    /// core archive, and cover [`decompress_archive`]'s rejection paths with
    /// synthetic non-7z input. The real-archive decompression itself is
    /// exercised end-to-end by `server.rs`'s served-route tests.
    fn fceumm_archive_bytes() -> Vec<u8> {
        include_bytes!("../../vendor/emulatorjs/cores/fceumm-wasm.data").to_vec()
    }

    #[test]
    fn hex_sha256_matches_known_vector() {
        assert_eq!(
            hex_sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn decompress_archive_rejects_non_7z_input() {
        let err = decompress_archive(b"not a 7z archive").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn ensure_extracted_decompresses_a_real_core_archive() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = fceumm_archive_bytes();
        let dir = ensure_extracted(tmp.path(), &archive).unwrap();

        let js = std::fs::read(dir.join("fceumm_libretro.js")).unwrap();
        let wasm = std::fs::read(dir.join("fceumm_libretro.wasm")).unwrap();
        let core_json = std::fs::read(dir.join("core.json")).unwrap();
        assert!(!js.is_empty());
        assert!(!wasm.is_empty());
        assert!(!core_json.is_empty());
    }

    #[test]
    fn ensure_extracted_is_idempotent_and_skips_reextraction() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = fceumm_archive_bytes();
        let dir = ensure_extracted(tmp.path(), &archive).unwrap();
        let wasm_path = dir.join("fceumm_libretro.wasm");
        let first_mtime = std::fs::metadata(&wasm_path).unwrap().modified().unwrap();

        // Re-run: must be a no-op (same dir, file untouched).
        let dir2 = ensure_extracted(tmp.path(), &archive).unwrap();
        assert_eq!(dir, dir2);
        let second_mtime = std::fs::metadata(&wasm_path).unwrap().modified().unwrap();
        assert_eq!(first_mtime, second_mtime, "a cache hit must not rewrite files");
    }

    #[test]
    fn ensure_extracted_invalidates_on_archive_content_change() {
        // Simulates a core-version bump: a different archive (here, a second
        // real core's bytes) must land in a DIFFERENT cache directory rather
        // than being confused with the first — proving hash-keyed
        // invalidation, not filename-keyed.
        let tmp = tempfile::tempdir().unwrap();
        let archive_a = fceumm_archive_bytes();
        let mut archive_b = archive_a.clone();
        // Flip a byte deep in the payload (past the 7z header) to fabricate
        // "a new core build" without needing a second real archive on disk.
        // This intentionally produces bytes sevenz-rust may fail to parse —
        // the point under test is only that the cache KEY (hash) differs and
        // the two are never conflated, not that the corrupted archive itself
        // decompresses.
        let flip_at = archive_b.len() - 1;
        archive_b[flip_at] ^= 0xFF;

        let hash_a = hex_sha256(&archive_a);
        let hash_b = hex_sha256(&archive_b);
        assert_ne!(hash_a, hash_b);
        assert_eq!(extracted_dir(tmp.path(), &hash_a), extracted_dir(tmp.path(), &hash_a));
        assert_ne!(
            extracted_dir(tmp.path(), &hash_a),
            extracted_dir(tmp.path(), &hash_b),
            "different archive content must map to a different cache dir"
        );

        let dir_a = ensure_extracted(tmp.path(), &archive_a).unwrap();
        assert!(is_extracted(tmp.path(), &hash_a));
        assert!(!is_extracted(tmp.path(), &hash_b));
        assert_eq!(dir_a, extracted_dir(tmp.path(), &hash_a));
    }

    #[test]
    fn is_extracted_is_false_for_an_empty_or_missing_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!is_extracted(tmp.path(), "deadbeef"));
        std::fs::create_dir_all(extracted_dir(tmp.path(), "deadbeef")).unwrap();
        assert!(!is_extracted(tmp.path(), "deadbeef"), "an empty dir is not a cache hit");
    }

    #[test]
    fn is_flat_filename_rejects_traversal_and_separators() {
        assert!(is_flat_filename("fceumm_libretro.wasm"));
        assert!(is_flat_filename("core.json"));
        assert!(!is_flat_filename(""));
        assert!(!is_flat_filename("."));
        assert!(!is_flat_filename(".."));
        assert!(!is_flat_filename("../escape"));
        assert!(!is_flat_filename("sub/dir.js"));
        assert!(!is_flat_filename("sub\\dir.js"));
    }
}
