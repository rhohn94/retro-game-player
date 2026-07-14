//! Direct download (v0.24 W244, #30) — the user-initiated download half of
//! the search → preview → **download** → import → play loop. Wired onto the
//! v0.16 per-provider `direct_download` opt-in seam.
//!
//! Contract (docs/design/direct-download-design.md §2): Harmony downloads a
//! file only when the user explicitly clicks Download on it, and only from a
//! provider the user has explicitly enabled direct download for. `run_search`
//! keeps its structurally-no-fetch guarantee — nothing here is reachable from
//! the search path.
//!
//! Safeguards mirror `fetch.rs`'s philosophy: scheme allow-list, streaming
//! size cap, timeouts, staging-dir + atomic rename (an interrupted download
//! never lands anywhere the importer looks), and cancellation checked per
//! chunk. Landing reuses the v0.12 import pipeline (`core/library/import.rs`)
//! including its hash dedupe.

use crate::core::library::{import_file, mapper::map_extension, ImportOutcome};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

/// Streaming download cap. Big enough for any cartridge-era ROM or zip of
/// them; a CD image over this needs the browser path.
pub const DOWNLOAD_CAP_BYTES: u64 = 256 * 1024 * 1024;

/// Connect timeout. The total-request deadline is [`TOTAL_TIMEOUT`] — coarse
/// on purpose (reqwest's blocking client has no per-read idle timeout), big
/// enough to stream the cap on a slow link, small enough that a wedged
/// transfer eventually errors instead of hanging forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Whole-request deadline (connect + headers + body streaming).
const TOTAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Chunk size for the streaming copy (also the cancel/progress granularity).
const CHUNK: usize = 64 * 1024;

/// How a finished download landed (mirrored into the `download://done` event).
#[derive(Debug)]
pub enum DownloadLanding {
    /// Imported into the library (one game; zips report the first).
    /// `file_path` is the on-disk library copy for Reveal-in-Finder verification.
    Imported {
        game_id: i64,
        already_present: bool,
        file_path: String,
    },
    /// Not a recognized ROM/zip — kept in staging for the user to resolve
    /// (Reveal / Discard); never silently deleted, never copied to games.
    Unrecognized { staged_path: PathBuf },
}

/// Progress callback: `(received_bytes, total_bytes_if_known)`. Returning
/// `false` from `should_continue` aborts (user cancel).
pub struct DownloadHooks<'a> {
    pub on_progress: &'a dyn Fn(u64, Option<u64>),
    pub should_continue: &'a dyn Fn() -> bool,
}

/// A cancellation flag shared with the UI-facing registry.
pub type CancelFlag = Arc<AtomicBool>;

/// Validates that `url` uses an allowed scheme (http/https only — no file:,
/// ftp:, data:, or anything else reaching the streaming client).
pub fn validate_scheme(url: &str) -> AppResult<()> {
    let lower = url.trim_start().to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "direct download supports only http(s) URLs: {url}"
        )))
    }
}

/// The staged filename a download id uses while in flight.
pub fn part_path(downloads_dir: &Path, id: u64) -> PathBuf {
    downloads_dir.join(format!("dl-{id}.part"))
}

/// Removes leftover `.part` files from interrupted sessions (startup sweep).
pub fn sweep_orphans(downloads_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(downloads_dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("part") {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// The filename a URL implies, sanitized to a single normal component
/// (default `download.bin` when the URL gives nothing usable).
pub fn url_filename(url: &str) -> String {
    let no_query = url.split(['?', '#']).next().unwrap_or("");
    let raw = no_query.rsplit('/').next().unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy();
    let cleaned: String = decoded
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Streams `url` into `dest_part`, enforcing the cap, reporting progress, and
/// honoring cancellation. On any failure the partial file is removed.
pub fn stream_to_staging(url: &str, dest_part: &Path, hooks: &DownloadHooks<'_>) -> AppResult<u64> {
    validate_scheme(url)?;
    let run = || -> AppResult<u64> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            .build()
            .map_err(|e| AppError::Network(format!("download client: {e}")))?;
        let mut resp = client
            .get(url)
            .send()
            .map_err(|e| AppError::Network(format!("GET {url}: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Network(format!("GET {url}: {e}")))?;
        let total = resp.content_length().filter(|&n| n > 0);
        if let Some(n) = total {
            if n > DOWNLOAD_CAP_BYTES {
                return Err(AppError::Validation(format!(
                    "file is {n} bytes — over the {DOWNLOAD_CAP_BYTES}-byte direct-download cap"
                )));
            }
        }
        if let Some(parent) = dest_part.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(dest_part)?;
        let mut received: u64 = 0;
        let mut buf = vec![0u8; CHUNK];
        loop {
            if !(hooks.should_continue)() {
                return Err(AppError::Validation("download cancelled".into()));
            }
            let n = resp
                .read(&mut buf)
                .map_err(|e| AppError::Network(format!("reading {url}: {e}")))?;
            if n == 0 {
                break;
            }
            received += n as u64;
            if received > DOWNLOAD_CAP_BYTES {
                return Err(AppError::Validation(format!(
                    "download exceeded the {DOWNLOAD_CAP_BYTES}-byte cap"
                )));
            }
            std::io::Write::write_all(&mut out, &buf[..n])?;
            (hooks.on_progress)(received, total);
        }
        Ok(received)
    };
    match run() {
        Ok(n) => Ok(n),
        Err(e) => {
            let _ = std::fs::remove_file(dest_part);
            Err(e)
        }
    }
}

/// Whether a zip entry name looks like a ROM the importer recognizes.
pub fn is_recognized_rom_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| map_extension(ext).is_some())
}

/// Extracts every recognized-ROM entry of `zip_path` into `staging_dir`,
/// returning the extracted paths. Entry names are flattened to their file
/// name (no directory traversal into staging) and size-capped cumulatively.
pub fn extract_rom_entries(zip_path: &Path, staging_dir: &Path) -> AppResult<Vec<PathBuf>> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Validation(format!("not a readable zip: {e}")))?;
    let mut extracted = Vec::new();
    let mut budget = DOWNLOAD_CAP_BYTES;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| AppError::Validation(format!("bad zip entry: {e}")))?;
        if !entry.is_file() || !is_recognized_rom_name(entry.name()) {
            continue;
        }
        let leaf = Path::new(entry.name())
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if leaf.is_empty() {
            continue;
        }
        let dest = staging_dir.join(&leaf);
        let mut out = std::fs::File::create(&dest)?;
        let copied = std::io::copy(&mut entry.take(budget + 1), &mut out)
            .map_err(|e| AppError::Io(format!("extracting {leaf}: {e}")))?;
        if copied > budget {
            let _ = std::fs::remove_file(&dest);
            for p in &extracted {
                let _ = std::fs::remove_file(p);
            }
            return Err(AppError::Validation(
                "zip contents exceed the direct-download cap".into(),
            ));
        }
        budget -= copied;
        extracted.push(dest);
    }
    Ok(extracted)
}

/// Lands a completed staged download: bare recognized ROM or zip-of-ROMs is
/// imported (staging copies removed on success); anything else is kept in
/// staging as [`DownloadLanding::Unrecognized`]. `.rar` gets a targeted
/// message (support was dropped with the GPL-incompatible UnRAR blob, #26).
pub fn land_download(
    db: &Db,
    games_dir: &Path,
    staging_dir: &Path,
    part: &Path,
    filename: &str,
) -> AppResult<DownloadLanding> {
    let staged = staging_dir.join(filename);
    std::fs::rename(part, &staged)?;
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "rar" {
        return Err(AppError::Unsupported(
            ".rar archives are not supported — Harmony ships no RAR extractor (see #26); \
             extract it yourself and import the ROM"
                .into(),
        ));
    }

    if ext == "zip" {
        let roms = extract_rom_entries(&staged, staging_dir)?;
        if roms.is_empty() {
            return Ok(DownloadLanding::Unrecognized { staged_path: staged });
        }
        let mut first: Option<ImportOutcome> = None;
        for rom in &roms {
            let outcome = import_file(db, games_dir, rom, None)?;
            let _ = std::fs::remove_file(rom);
            first.get_or_insert(outcome);
        }
        let _ = std::fs::remove_file(&staged);
        let outcome = first.expect("non-empty roms imported");
        return Ok(DownloadLanding::Imported {
            game_id: outcome.game_id,
            already_present: outcome.already_present,
            file_path: outcome.stored_path,
        });
    }

    if map_extension(&ext).is_some() {
        let outcome = import_file(db, games_dir, &staged, None)?;
        let _ = std::fs::remove_file(&staged);
        return Ok(DownloadLanding::Imported {
            game_id: outcome.game_id,
            already_present: outcome.already_present,
            file_path: outcome.stored_path,
        });
    }

    Ok(DownloadLanding::Unrecognized { staged_path: staged })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn fixture_server(body: Vec<u8>) -> (u16, std::thread::JoinHandle<()>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let handle = std::thread::spawn(move || {
            if let Ok(request) = server.recv() {
                let _ = request.respond(tiny_http::Response::from_data(body));
            }
        });
        (port, handle)
    }

    /// Test-only progress hook for `download_and_stage` calls below —
    /// factored out of `hooks()`'s return type to clear clippy's
    /// `type_complexity` lint (W383).
    type ProgressHook = &'static dyn Fn(u64, Option<u64>);
    /// Test-only "keep going?" hook paired with [`ProgressHook`] (W383).
    type ContinueHook = &'static dyn Fn() -> bool;

    fn hooks() -> (ProgressHook, ContinueHook) {
        (&|_, _| {}, &|| true)
    }

    #[test]
    fn scheme_allow_list_rejects_non_http() {
        assert!(validate_scheme("https://x/y.nes").is_ok());
        assert!(validate_scheme("http://x/y.nes").is_ok());
        assert!(validate_scheme("file:///etc/passwd").is_err());
        assert!(validate_scheme("ftp://x/y").is_err());
        assert!(validate_scheme("javascript:alert(1)").is_err());
    }

    #[test]
    fn url_filename_sanitizes_and_defaults() {
        assert_eq!(url_filename("https://x/roms/Super%20Mario.nes?dl=1"), "Super Mario.nes");
        assert_eq!(url_filename("https://x/a/b/game.zip#frag"), "game.zip");
        assert_eq!(url_filename("https://x/"), "download.bin");
        assert_eq!(url_filename("https://x/..%2f..%2fetc"), "_.._etc"); // leading dots trimmed
    }

    #[test]
    fn streams_a_body_to_the_part_file() {
        let (port, join) = fixture_server(b"HELLO-ROM".to_vec());
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), 1);
        let (progress, cont) = hooks();
        let n = stream_to_staging(
            &format!("http://127.0.0.1:{port}/x.nes"),
            &part,
            &DownloadHooks { on_progress: progress, should_continue: cont },
        )
        .unwrap();
        join.join().unwrap();
        assert_eq!(n, 9);
        assert_eq!(std::fs::read(&part).unwrap(), b"HELLO-ROM");
    }

    #[test]
    fn cancellation_aborts_and_removes_the_part_file() {
        let (port, join) = fixture_server(vec![7u8; 300 * 1024]);
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), 2);
        let (progress, _) = hooks();
        let err = stream_to_staging(
            &format!("http://127.0.0.1:{port}/x.nes"),
            &part,
            &DownloadHooks { on_progress: progress, should_continue: &|| false },
        )
        .unwrap_err();
        join.join().unwrap();
        assert!(err.to_string().contains("cancelled"), "{err}");
        assert!(!part.exists());
    }

    #[test]
    fn oversized_content_length_is_rejected_before_streaming() {
        // Hand-rolled response so Content-Length can exceed what we send.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let join = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let huge = DOWNLOAD_CAP_BYTES + 1;
            let _ = write!(sock, "HTTP/1.1 200 OK\r\nContent-Length: {huge}\r\n\r\n");
            // Hold the connection open until the client closes it; dropping the
            // socket right after the header write races the client's header
            // parse, and a connection-reset error would mask the cap rejection
            // under test (intermittent under a parallel test run).
            let mut drain = [0u8; 64];
            use std::io::Read;
            while matches!(sock.read(&mut drain), Ok(n) if n > 0) {}
        });
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), 3);
        let (progress, cont) = hooks();
        let err = stream_to_staging(
            &format!("http://127.0.0.1:{port}/big.bin"),
            &part,
            &DownloadHooks { on_progress: progress, should_continue: cont },
        )
        .unwrap_err();
        join.join().unwrap();
        assert!(err.to_string().contains("cap"), "{err}");
        assert!(!part.exists());
    }

    #[test]
    fn sweep_removes_only_part_files() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("dl-1.part"), b"x").unwrap();
        std::fs::write(tmp.path().join("keep.nes"), b"x").unwrap();
        sweep_orphans(tmp.path());
        assert!(!tmp.path().join("dl-1.part").exists());
        assert!(tmp.path().join("keep.nes").exists());
    }

    #[test]
    fn recognized_rom_names_follow_the_import_mapper() {
        assert!(is_recognized_rom_name("games/Super Mario.nes"));
        assert!(is_recognized_rom_name("x.sfc"));
        assert!(!is_recognized_rom_name("readme.txt"));
        assert!(!is_recognized_rom_name("noext"));
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            for (name, bytes) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(bytes).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn extract_pulls_only_rom_entries_flattened() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("pack.zip");
        std::fs::write(
            &zip_path,
            zip_with(&[("sub/dir/game.nes", b"ROM"), ("readme.txt", b"no")]),
        )
        .unwrap();
        let out = extract_rom_entries(&zip_path, tmp.path()).unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].ends_with("game.nes"));
        assert_eq!(std::fs::read(&out[0]).unwrap(), b"ROM");
        assert!(!tmp.path().join("sub").exists()); // flattened, no traversal
    }

    #[test]
    fn landing_a_zip_imports_and_hash_dedupes_on_redownload() {
        let db = Db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let games = tmp.path().join("games");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&games).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        let zip_bytes = zip_with(&[("Sample Game.nes", b"NES-ROM-BYTES")]);

        let part1 = part_path(&staging, 10);
        std::fs::write(&part1, &zip_bytes).unwrap();
        let first = land_download(&db, &games, &staging, &part1, "pack.zip").unwrap();
        let DownloadLanding::Imported {
            game_id,
            already_present,
            file_path,
        } = first
        else {
            panic!("expected Imported");
        };
        assert!(!already_present);
        assert!(!file_path.is_empty(), "imported path should be set for reveal");

        // Same content again — hash dedupe resolves to the same game row.
        let part2 = part_path(&staging, 11);
        std::fs::write(&part2, &zip_bytes).unwrap();
        let second = land_download(&db, &games, &staging, &part2, "pack.zip").unwrap();
        let DownloadLanding::Imported {
            game_id: id2,
            already_present: dup,
            file_path: _,
        } = second
        else {
            panic!("expected Imported");
        };
        assert_eq!(id2, game_id);
        assert!(dup);
    }

    #[test]
    fn landing_a_rar_names_the_dropped_support() {
        let db = Db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), 4);
        std::fs::write(&part, b"Rar!").unwrap();
        let err =
            land_download(&db, tmp.path(), tmp.path(), &part, "game.rar").unwrap_err();
        assert!(err.to_string().contains(".rar"), "{err}");
    }

    #[test]
    fn landing_an_unrecognized_file_keeps_it_staged() {
        let db = Db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let part = part_path(&staging, 5);
        std::fs::write(&part, b"???").unwrap();
        let landing =
            land_download(&db, tmp.path(), &staging, &part, "mystery.dat").unwrap();
        match landing {
            DownloadLanding::Unrecognized { staged_path } => {
                assert!(staged_path.exists());
                assert!(staged_path.ends_with("mystery.dat"));
            }
            other => panic!("expected Unrecognized, got {other:?}"),
        }
    }
}
