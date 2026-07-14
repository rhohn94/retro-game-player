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
//! Auto-import (docs/design/auto-import-download-design.md): if the first GET
//! returns an HTML page, we scan it for direct file links (`.zip` / ROM
//! extensions and download-ish paths), optionally HEAD-probe top candidates,
//! download the best file, and import that into the library.
//!
//! Phase 1 lander signals: `Content-Type`, `Content-Disposition` filename,
//! magic-byte sniff, query/title-aware candidate scoring, and short HEAD
//! preflight before the second hop.
//!
//! Safeguards mirror `fetch.rs`'s philosophy: scheme allow-list, streaming
//! size cap, timeouts, staging-dir + atomic rename (an interrupted download
//! never lands anywhere the importer looks), and cancellation checked per
//! chunk. Landing reuses the v0.12 import pipeline (`core/library/import.rs`)
//! including its hash dedupe.

use crate::core::library::{import_file, mapper::map_extension, ImportOutcome};
use crate::core::search::fetch::unwrap_redirect_wrapper;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use scraper::{Html, Selector};
use std::collections::HashSet;
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

/// Short timeout for HEAD / range preflight of hop-2 candidates.
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

/// How many top-scored candidates to HEAD before picking hop-2.
const MAX_HEAD_PROBES: usize = 5;

/// Chunk size for the streaming copy (also the cancel/progress granularity).
const CHUNK: usize = 64 * 1024;

const USER_AGENT: &str = concat!(
    "Harmony/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/rhohn94/harmony)"
);

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
    Unrecognized {
        staged_path: PathBuf,
        /// Human-readable reason (e.g. HTML page with no file link).
        reason: String,
    },
}

/// A direct file URL discovered on an HTML detail page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileCandidate {
    pub url: String,
    pub score: i32,
    /// Suggested filename from the URL path (may be empty).
    pub filename: String,
    /// True when the URL path already has a zip/ROM extension.
    pub has_importable_ext: bool,
}

/// Metadata captured from the response headers during a streaming GET.
#[derive(Debug, Clone, Default)]
pub struct StreamMeta {
    pub bytes: u64,
    pub content_type: Option<String>,
    pub disposition_filename: Option<String>,
}

/// Outcome of a cheap HEAD (or range-GET fallback) on a hop-2 candidate.
#[derive(Debug, Clone, Default)]
pub struct CandidateProbe {
    pub looks_like_file: bool,
    pub looks_like_html: bool,
    pub content_type: Option<String>,
    pub disposition_filename: Option<String>,
    pub content_length: Option<u64>,
}

/// Magic-byte / content classification of a payload prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MagicKind {
    Html,
    Zip,
    Rar,
    SevenZ,
    Gzip,
    Nes,
    Unknown,
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
    let Ok(entries) = std::fs::read_dir(downloads_dir) else {
        return;
    };
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
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Extension from a URL path (no query), lowercased, no dot — or `None`.
pub fn url_path_extension(url: &str) -> Option<String> {
    let name = url_filename(url);
    Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty())
}

/// True when `ext` can be landed into the library (zip or a mapped ROM ext).
pub fn is_importable_extension(ext: &str) -> bool {
    let e = ext.trim_start_matches('.').to_ascii_lowercase();
    e == "zip" || map_extension(&e).is_some()
}

/// Parse `Content-Disposition` for a filename (supports `filename=` and
/// RFC 5987 `filename*=UTF-8''…`).
pub fn parse_content_disposition_filename(header: &str) -> Option<String> {
    let h = header.trim();
    if h.is_empty() {
        return None;
    }
    // Prefer filename*= (charset'lang'value)
    for part in h.split(';') {
        let part = part.trim();
        let lower = part.to_ascii_lowercase();
        if lower.starts_with("filename*") {
            let Some(eq) = part.find('=') else {
                continue;
            };
            let raw = part[eq + 1..].trim().trim_matches('"');
            if let Some(decoded) = decode_rfc5987_filename(raw) {
                if !decoded.is_empty() {
                    return Some(sanitize_filename_component(&decoded));
                }
            }
        }
    }
    for part in h.split(';') {
        let part = part.trim();
        let lower = part.to_ascii_lowercase();
        if !lower.starts_with("filename") || lower.starts_with("filename*") {
            continue;
        }
        let Some(eq) = part.find('=') else {
            continue;
        };
        let mut val = part[eq + 1..].trim();
        if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
            val = &val[1..val.len() - 1];
        }
        if val.is_empty() {
            continue;
        }
        return Some(sanitize_filename_component(val));
    }
    None
}

fn decode_rfc5987_filename(value: &str) -> Option<String> {
    // charset'lang'percent-encoded-value
    let mut parts = value.splitn(3, '\'');
    let _charset = parts.next()?;
    let _lang = parts.next()?;
    let encoded = parts.next()?.trim_matches('"');
    let decoded = percent_encoding::percent_decode_str(encoded).decode_utf8().ok()?;
    Some(decoded.into_owned())
}

fn sanitize_filename_component(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

/// True when `Content-Type` looks like HTML.
pub fn is_html_content_type(ct: &str) -> bool {
    let base = ct.split(';').next().unwrap_or(ct).trim().to_ascii_lowercase();
    base == "text/html" || base == "application/xhtml+xml" || base.ends_with("+html")
}

/// True when `Content-Type` looks like a downloadable archive/ROM payload.
pub fn is_file_content_type(ct: &str) -> bool {
    let base = ct.split(';').next().unwrap_or(ct).trim().to_ascii_lowercase();
    matches!(
        base.as_str(),
        "application/zip"
            | "application/x-zip-compressed"
            | "application/x-zip"
            | "application/octet-stream"
            | "binary/octet-stream"
            | "application/force-download"
            | "application/x-download"
            | "application/gzip"
            | "application/x-gzip"
            | "application/x-7z-compressed"
            | "application/x-rar-compressed"
            | "application/vnd.rar"
            | "application/nes-rom"
            | "application/x-nes-rom"
    ) || base.starts_with("application/x-") && (base.contains("rom") || base.contains("zip"))
}

/// Classify the first bytes of a payload.
pub fn classify_magic(bytes: &[u8]) -> MagicKind {
    if bytes.is_empty() {
        return MagicKind::Unknown;
    }
    // Zip local / empty / spanned
    if bytes.len() >= 2 && bytes[0] == b'P' && bytes[1] == b'K' {
        return MagicKind::Zip;
    }
    // RAR
    if bytes.starts_with(b"Rar!") || bytes.starts_with(b"Rar\x1a") {
        return MagicKind::Rar;
    }
    // 7z
    if bytes.starts_with(b"7z\xbc\xaf\x27\x1c") {
        return MagicKind::SevenZ;
    }
    // gzip
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        return MagicKind::Gzip;
    }
    // iNES
    if bytes.starts_with(b"NES\x1a") {
        return MagicKind::Nes;
    }
    // HTML (BOM-tolerant text)
    let mut slice = bytes;
    if slice.starts_with(&[0xEF, 0xBB, 0xBF]) {
        slice = &slice[3..];
    }
    let head = String::from_utf8_lossy(slice).to_ascii_lowercase();
    let trimmed = head.trim_start();
    if trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || (trimmed.contains("<html") && trimmed.contains("<head"))
        || (trimmed.starts_with('<') && trimmed.contains("<body"))
    {
        return MagicKind::Html;
    }
    MagicKind::Unknown
}

/// Extension implied by magic bytes, when known.
pub fn magic_to_extension(kind: MagicKind) -> Option<&'static str> {
    match kind {
        MagicKind::Zip => Some("zip"),
        MagicKind::Rar => Some("rar"),
        MagicKind::SevenZ => Some("7z"),
        MagicKind::Gzip => Some("gz"),
        MagicKind::Nes => Some("nes"),
        MagicKind::Html | MagicKind::Unknown => None,
    }
}

/// True when the staged bytes look like HTML (BOM-tolerant, case-insensitive).
pub fn looks_like_html(path: &Path) -> bool {
    read_magic_prefix(path)
        .map(|b| classify_magic(&b) == MagicKind::Html)
        .unwrap_or(false)
}

/// True when bytes look like a zip archive (PK\x03\x04 or empty PK\x05\x06).
pub fn looks_like_zip(path: &Path) -> bool {
    read_magic_prefix(path)
        .map(|b| classify_magic(&b) == MagicKind::Zip)
        .unwrap_or(false)
}

fn read_magic_prefix(path: &Path) -> Option<Vec<u8>> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = [0u8; 512];
    let n = f.read(&mut buf).ok()?;
    if n == 0 {
        return None;
    }
    Some(buf[..n].to_vec())
}

/// Whether the staged file should be treated as an HTML detail page (hop).
pub fn should_treat_as_html(path: &Path, content_type: Option<&str>) -> bool {
    let magic = read_magic_prefix(path)
        .map(|b| classify_magic(&b))
        .unwrap_or(MagicKind::Unknown);
    match magic {
        MagicKind::Zip | MagicKind::Nes | MagicKind::Rar | MagicKind::SevenZ | MagicKind::Gzip => {
            return false;
        }
        MagicKind::Html => return true,
        MagicKind::Unknown => {}
    }
    content_type.is_some_and(is_html_content_type)
}

/// Ensure `filename` has a usable extension when we can sniff the payload or
/// infer from content-type.
pub fn ensure_filename_extension(path: &Path, filename: String) -> String {
    let has_importable = Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(is_importable_extension);
    if has_importable {
        return filename;
    }
    if let Some(ext) = read_magic_prefix(path)
        .map(|b| classify_magic(&b))
        .and_then(magic_to_extension)
    {
        // Only attach importable / known lander extensions
        if is_importable_extension(ext) || ext == "rar" || ext == "7z" || ext == "gz" {
            if filename.contains('.') {
                return format!("{filename}.{ext}");
            }
            return format!("{filename}.{ext}");
        }
    }
    if looks_like_zip(path) {
        return if filename.contains('.') {
            format!("{filename}.zip")
        } else {
            format!("{filename}.zip")
        };
    }
    filename
}

/// Prefer disposition filename, then URL path name.
pub fn resolve_download_filename(
    url: &str,
    disposition: Option<&str>,
    path: &Path,
) -> String {
    let base = disposition
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| url_filename(url));
    ensure_filename_extension(path, base)
}

/// Lowercase alphanumeric tokens of `s` (for query-aware scoring).
pub fn hint_tokens(s: &str) -> Vec<String> {
    let lower = s.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            cur.push(c);
        } else if !cur.is_empty() {
            if cur.len() > 1 && !is_hint_stopword(&cur) {
                out.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
        }
    }
    if cur.len() > 1 && !is_hint_stopword(&cur) {
        out.push(cur);
    }
    out
}

fn is_hint_stopword(t: &str) -> bool {
    matches!(
        t,
        "a" | "an"
            | "the"
            | "of"
            | "and"
            | "or"
            | "for"
            | "to"
            | "in"
            | "on"
            | "at"
            | "by"
            | "with"
            | "from"
            | "vs"
            | "versus"
            | "rom"
            | "roms"
            | "zip"
            | "download"
            | "game"
            | "games"
    )
}

/// True when a URL looks like a download endpoint even without a file extension
/// (`/download?id=`, `/get/file`, `?attachment=1`, …).
pub fn is_download_ish_url(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else {
        return false;
    };
    let path = u.path().to_ascii_lowercase();
    let query = u.query().unwrap_or("").to_ascii_lowercase();
    let hay = format!("{path}?{query}");
    // Exclude obvious non-file pages
    if path.ends_with(".html")
        || path.ends_with(".htm")
        || path.ends_with(".php") && !hay.contains("download") && !hay.contains("dl=")
    {
        // still allow php with download keywords below
    }
    const KEYS: &[&str] = &[
        "download",
        "/dl/",
        "/dl?",
        "getfile",
        "get_file",
        "get-rom",
        "file=",
        "attachment",
        "content-disposition",
        ".zip",
        "romfile",
        "rom_file",
    ];
    KEYS.iter().any(|k| hay.contains(k))
        || path.contains("/download")
        || path.ends_with("/download")
        || query.contains("download")
}

/// Parse `meta http-equiv=refresh` content for a target URL.
/// Accepts forms like `0;url=https://…` and `5; URL='/file.zip'`.
pub fn parse_meta_refresh_url(content: &str) -> Option<String> {
    let lower = content.to_ascii_lowercase();
    let idx = lower.find("url=")?;
    let mut rest = content[idx + 4..].trim();
    // Strip optional surrounding quotes
    if (rest.starts_with('"') && rest.ends_with('"'))
        || (rest.starts_with('\'') && rest.ends_with('\''))
    {
        rest = &rest[1..rest.len() - 1];
    }
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }
    Some(rest.to_string())
}

/// Best-effort `location = '…'` / `location.href = "…"` extraction from inline JS.
pub fn extract_js_location_urls(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    // Markers end before optional whitespace and `=` / `(` so `location = "…"` works.
    for marker in [
        "window.location.href",
        "window.location",
        "location.href",
        "location.replace",
        "location.assign",
    ] {
        let mut search_from = 0;
        while let Some(rel) = lower[search_from..].find(marker) {
            let after_marker = search_from + rel + marker.len();
            let rest = html.get(after_marker..).unwrap_or("");
            // Skip whitespace, then optional '=' or '(', then whitespace, then quote.
            let mut chars = rest.char_indices().peekable();
            // skip ws
            while matches!(chars.peek(), Some((_, c)) if c.is_whitespace()) {
                chars.next();
            }
            match chars.peek().map(|(_, c)| *c) {
                Some('=') | Some('(') => {
                    chars.next();
                }
                _ => {
                    search_from = after_marker + 1;
                    continue;
                }
            }
            while matches!(chars.peek(), Some((_, c)) if c.is_whitespace()) {
                chars.next();
            }
            let Some((_, q)) = chars.next() else {
                search_from = after_marker + 1;
                continue;
            };
            if q != '"' && q != '\'' {
                search_from = after_marker + 1;
                continue;
            }
            let start = chars.peek().map(|(i, _)| *i).unwrap_or(rest.len());
            if let Some(end_rel) = rest[start..].find(q) {
                let url = rest[start..start + end_rel].trim();
                if url.starts_with("http://")
                    || url.starts_with("https://")
                    || url.starts_with('/')
                {
                    out.push(url.to_string());
                }
            }
            search_from = after_marker + 1;
            if search_from >= lower.len() {
                break;
            }
        }
    }
    out
}

/// Score and collect file / download-ish links from an HTML page.
///
/// `hint` is the result title or search query — used to prefer links that
/// match the game the user clicked.
///
/// Phase 2 also pulls **meta-refresh** targets and simple JS `location`
/// assignments when they look like files or download endpoints.
pub fn extract_file_download_candidates(
    html: &str,
    page_url: &str,
    hint: Option<&str>,
) -> Vec<FileCandidate> {
    let base = reqwest::Url::parse(page_url).ok();
    let page_host = base
        .as_ref()
        .and_then(|u| u.host_str())
        .map(str::to_string);
    let doc = Html::parse_document(html);
    let Ok(selector) = Selector::parse("a[href]") else {
        return Vec::new();
    };
    let hint_terms = hint.map(hint_tokens).unwrap_or_default();
    let mut out: Vec<FileCandidate> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Meta-refresh and JS location hops (often used by "download" interstitial pages).
    let mut soft_hrefs: Vec<(String, i32, &'static str)> = Vec::new();
    // Case-insensitive http-equiv (HTML attribute names are case-insensitive).
    if let Ok(meta_sel) = Selector::parse("meta") {
        for el in doc.select(&meta_sel) {
            let equiv = el
                .value()
                .attrs()
                .find(|(k, _)| k.eq_ignore_ascii_case("http-equiv"))
                .map(|(_, v)| v.to_ascii_lowercase())
                .unwrap_or_default();
            if equiv != "refresh" {
                continue;
            }
            let content = el
                .value()
                .attrs()
                .find(|(k, _)| k.eq_ignore_ascii_case("content"))
                .map(|(_, v)| v);
            if let Some(content) = content {
                if let Some(u) = parse_meta_refresh_url(content) {
                    soft_hrefs.push((u, 70, "meta-refresh"));
                }
            }
        }
    }
    for u in extract_js_location_urls(html) {
        soft_hrefs.push((u, 55, "js-location"));
    }

    for (href, base_score, _src) in soft_hrefs {
        push_file_candidate(
            &mut out,
            &mut seen,
            href.trim(),
            base.as_ref(),
            page_host.as_deref(),
            &hint_terms,
            base_score,
            "",
            false,
        );
    }

    for el in doc.select(&selector) {
        let Some(href) = el.value().attr("href").map(str::trim) else {
            continue;
        };
        if href.is_empty() || href.starts_with('#') {
            continue;
        }
        let text = el.text().collect::<String>();
        let has_download_attr = el.value().attr("download").is_some();
        push_file_candidate(
            &mut out,
            &mut seen,
            href,
            base.as_ref(),
            page_host.as_deref(),
            &hint_terms,
            if has_download_attr { 30 } else { 10 },
            &text,
            has_download_attr,
        );
    }
    out.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.url.cmp(&b.url)));
    out
}

/// Shared candidate construction for anchors, meta-refresh, and JS location.
#[allow(clippy::too_many_arguments)]
fn push_file_candidate(
    out: &mut Vec<FileCandidate>,
    seen: &mut HashSet<String>,
    href: &str,
    base: Option<&reqwest::Url>,
    page_host: Option<&str>,
    hint_terms: &[String],
    base_score: i32,
    link_text: &str,
    has_download_attr: bool,
) {
    let lower_href = href.to_ascii_lowercase();
    if lower_href.starts_with("javascript:")
        || lower_href.starts_with("mailto:")
        || lower_href.starts_with("data:")
    {
        return;
    }
    let resolved = match reqwest::Url::parse(href) {
        Ok(u) => u,
        Err(_) => match base.and_then(|b| b.join(href).ok()) {
            Some(u) => u,
            None => return,
        },
    };
    if !matches!(resolved.scheme(), "http" | "https") {
        return;
    }
    let url = unwrap_redirect_wrapper(resolved.to_string());
    let ext = url_path_extension(&url);
    let has_importable_ext = ext.as_deref().is_some_and(is_importable_extension);
    let download_ish = is_download_ish_url(&url);
    if !has_importable_ext && !download_ish {
        return;
    }
    if !seen.insert(url.clone()) {
        return;
    }
    let filename = url_filename(&url);
    let mut score: i32 = base_score;
    if has_importable_ext {
        if ext.as_deref() == Some("zip") {
            score += 50;
        } else {
            score += 40;
        }
    } else {
        score += 8;
    }
    let path_l = resolved.path().to_ascii_lowercase();
    if path_l.contains("download") || path_l.contains("/dl/") || path_l.contains("file") {
        score += 15;
    }
    let text = link_text.to_ascii_lowercase();
    if text.contains("download") || text.contains("zip") || text.contains("rom") {
        score += 10;
    }
    if has_download_attr {
        score += 20;
    }
    if let (Some(ph), Some(h)) = (page_host, resolved.host_str()) {
        if ph.eq_ignore_ascii_case(h) {
            score += 12;
        }
    }
    if filename.len() > 12 && !filename.eq_ignore_ascii_case("download.zip") {
        score += 5;
    }
    if filename.eq_ignore_ascii_case("download.zip")
        || filename.eq_ignore_ascii_case("file.zip")
        || filename.eq_ignore_ascii_case("game.zip")
        || filename.eq_ignore_ascii_case("download.bin")
    {
        score -= 15;
    }
    if !hint_terms.is_empty() {
        let hay = format!("{} {} {}", filename.to_ascii_lowercase(), text, path_l);
        let mut matched = 0;
        for t in hint_terms {
            if hay.contains(t) {
                matched += 1;
                score += 20;
            }
        }
        if matched == hint_terms.len() {
            score += 25;
        }
    }
    out.push(FileCandidate {
        url,
        score,
        filename,
        has_importable_ext,
    });
}

/// Pick the highest-scoring file candidate, if any (no network).
pub fn pick_best_file_candidate(candidates: &[FileCandidate]) -> Option<&FileCandidate> {
    candidates.first()
}

/// HEAD (or Range GET fallback) a candidate URL for file vs HTML signals.
pub fn probe_candidate(url: &str) -> CandidateProbe {
    let mut out = CandidateProbe::default();
    if validate_scheme(url).is_err() {
        return out;
    }
    let client = match reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
    {
        Ok(c) => c,
        Err(_) => return out,
    };

    // Prefer HEAD; some hosts reject it (405) — fall back to Range GET.
    let resp = match client.head(url).send() {
        Ok(r) if r.status().as_u16() == 405 || r.status().as_u16() == 501 => client
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-511")
            .send()
            .ok(),
        Ok(r) => Some(r),
        Err(_) => client
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-511")
            .send()
            .ok(),
    };
    let Some(resp) = resp else {
        return out;
    };
    if !(resp.status().is_success() || resp.status().as_u16() == 206) {
        // 3xx should already be followed by reqwest; other codes → unknown
        return out;
    }

    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let cd = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_disposition_filename);
    let len = resp.content_length().filter(|&n| n > 0);

    out.content_type = ct.clone();
    out.disposition_filename = cd.clone();
    out.content_length = len;

    if let Some(ref name) = cd {
        if Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(is_importable_extension)
        {
            out.looks_like_file = true;
        }
    }
    if let Some(ref t) = ct {
        if is_html_content_type(t) {
            out.looks_like_html = true;
        }
        if is_file_content_type(t) {
            out.looks_like_file = true;
        }
    }
    if url_path_extension(url).is_some_and(|e| is_importable_extension(&e)) {
        out.looks_like_file = true;
    }
    // If both file and html claimed, prefer file only when disposition/ext says so
    if out.looks_like_file && out.looks_like_html {
        out.looks_like_html = false;
    }
    out
}

/// Probe the top-N candidates and return the best URL to fetch for hop-2,
/// plus an optional disposition filename from the winning probe.
///
/// When the top-scoring candidate already has a zip/ROM path extension we
/// skip the network probe (extension is strong enough, and HEAD on fragile
/// local/fixture hosts can stall keep-alive connections). HEAD is used when
/// the leaders are extension-less download-ish URLs that need confirmation.
pub fn select_best_candidate_url(
    candidates: &[FileCandidate],
) -> Option<(String, Option<String>, bool)> {
    if candidates.is_empty() {
        return None;
    }

    // Fast path: best-ranked candidate already looks like a file by extension.
    if let Some(c) = candidates.first() {
        if c.has_importable_ext {
            return Some((c.url.clone(), None, false));
        }
    }
    // Prefer any high-ranked importable-ext candidate without probing when the
    // absolute top is only download-ish (soft). Still probe soft leaders so a
    // confirmed /download?id= can beat a lower-scoring .zip if needed — but if
    // any importable-ext exists among top-N soft leaders, keep it as fallback.
    let fallback_ext = candidates
        .iter()
        .find(|c| c.has_importable_ext)
        .map(|c| c.url.clone());

    let n = candidates.len().min(MAX_HEAD_PROBES);
    let mut best_file: Option<(usize, i32, Option<String>)> = None; // idx, score, disp
    let mut best_non_html: Option<(usize, i32, Option<String>)> = None;

    for (i, c) in candidates.iter().take(n).enumerate() {
        // Skip probe for clear file extensions; score them as confirmed files.
        if c.has_importable_ext {
            let score = c.score + 100;
            match best_file {
                Some((_, s, _)) if s >= score => {}
                _ => best_file = Some((i, score, None)),
            }
            match best_non_html {
                Some((_, s, _)) if s >= score => {}
                _ => best_non_html = Some((i, score, None)),
            }
            continue;
        }
        let probe = probe_candidate(&c.url);
        if probe.looks_like_html && !probe.looks_like_file {
            continue;
        }
        let boost = if probe.looks_like_file { 100 } else { 0 };
        let score = c.score + boost;
        if probe.looks_like_file {
            match best_file {
                Some((_, s, _)) if s >= score => {}
                _ => best_file = Some((i, score, probe.disposition_filename.clone())),
            }
        }
        match best_non_html {
            Some((_, s, _)) if s >= score => {}
            _ => best_non_html = Some((i, score, probe.disposition_filename.clone())),
        }
    }

    if let Some((i, _, disp)) = best_file {
        return Some((candidates[i].url.clone(), disp, true));
    }
    if let Some((i, _, disp)) = best_non_html {
        return Some((candidates[i].url.clone(), disp, false));
    }
    if let Some(url) = fallback_ext {
        return Some((url, None, false));
    }
    candidates
        .first()
        .map(|c| (c.url.clone(), None, false))
}

const HTML_NO_FILE_REASON: &str = "This link is a web page, not a ROM file, and no downloadable \
game file (.zip / ROM) was found on the page. Open it in your browser to download the game, \
then drag the file into Retro Game Player.";

const HTML_STILL_HTML_REASON: &str = "Followed a download link from the page, but the server \
still returned a web page instead of a game file. Open the link in your browser to finish \
the download, then drag the file into Retro Game Player.";

/// Full auto-import path: GET `url` → if HTML, resolve file link → import.
///
/// `id` is the download job id (used for `.part` staging names).
/// `hint` is optional result title / query text for hop-2 ranking.
pub fn download_and_auto_import(
    url: &str,
    staging_dir: &Path,
    id: u64,
    hooks: &DownloadHooks<'_>,
    db: &Db,
    games_dir: &Path,
    hint: Option<&str>,
) -> AppResult<DownloadLanding> {
    let part = part_path(staging_dir, id);
    let meta = stream_to_staging(url, &part, hooks)?;

    if should_treat_as_html(&part, meta.content_type.as_deref()) {
        let html = std::fs::read_to_string(&part).unwrap_or_default();
        let candidates = extract_file_download_candidates(&html, url, hint);
        if let Some((file_url, probe_disp, _confirmed)) = select_best_candidate_url(&candidates) {
            // Drop the HTML page; fetch the real file into a fresh part path.
            let _ = std::fs::remove_file(&part);
            let file_part = part_path(staging_dir, id);
            let file_meta = stream_to_staging(&file_url, &file_part, hooks)?;
            if should_treat_as_html(&file_part, file_meta.content_type.as_deref()) {
                let name = resolve_download_filename(
                    &file_url,
                    file_meta
                        .disposition_filename
                        .as_deref()
                        .or(probe_disp.as_deref()),
                    &file_part,
                );
                let staged = staging_dir.join(name);
                let _ = std::fs::rename(&file_part, &staged);
                return Ok(DownloadLanding::Unrecognized {
                    staged_path: staged,
                    reason: HTML_STILL_HTML_REASON.to_string(),
                });
            }
            let filename = resolve_download_filename(
                &file_url,
                file_meta
                    .disposition_filename
                    .as_deref()
                    .or(probe_disp.as_deref()),
                &file_part,
            );
            return land_download(db, games_dir, staging_dir, &file_part, &filename);
        }
        // No file candidate — keep HTML for Reveal with a clear reason.
        let name = {
            let base = meta
                .disposition_filename
                .clone()
                .unwrap_or_else(|| url_filename(url));
            if base.contains('.') {
                base
            } else {
                format!("{base}.html")
            }
        };
        let staged = staging_dir.join(name);
        let _ = std::fs::rename(&part, &staged);
        return Ok(DownloadLanding::Unrecognized {
            staged_path: staged,
            reason: HTML_NO_FILE_REASON.to_string(),
        });
    }

    let filename = resolve_download_filename(url, meta.disposition_filename.as_deref(), &part);
    land_download(db, games_dir, staging_dir, &part, &filename)
}

/// Streams `url` into `dest_part`, enforcing the cap, reporting progress, and
/// honoring cancellation. On any failure the partial file is removed.
/// Returns header-derived metadata (type, disposition filename).
pub fn stream_to_staging(
    url: &str,
    dest_part: &Path,
    hooks: &DownloadHooks<'_>,
) -> AppResult<StreamMeta> {
    validate_scheme(url)?;
    let run = || -> AppResult<StreamMeta> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| AppError::Network(format!("download client: {e}")))?;
        let mut resp = client
            .get(url)
            .send()
            .map_err(|e| AppError::Network(format!("GET {url}: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Network(format!("GET {url}: {e}")))?;

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let disposition_filename = resp
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_disposition_filename);

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
        Ok(StreamMeta {
            bytes: received,
            content_type,
            disposition_filename,
        })
    };
    match run() {
        Ok(m) => Ok(m),
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
            return Ok(DownloadLanding::Unrecognized {
                staged_path: staged,
                reason: "The zip archive did not contain any recognized ROM files."
                    .to_string(),
            });
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

    // Last chance: magic says zip but the name still has no usable extension
    // (headers were missing). Rename once and import as zip.
    if looks_like_zip(&staged) && ext != "zip" {
        let stem = Path::new(filename)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "download".into());
        let zip_name = format!("{stem}.zip");
        let renamed = staging_dir.join(&zip_name);
        if renamed != staged {
            std::fs::rename(&staged, &renamed)?;
        }
        let roms = extract_rom_entries(&renamed, staging_dir)?;
        if roms.is_empty() {
            return Ok(DownloadLanding::Unrecognized {
                staged_path: renamed,
                reason: "The zip archive did not contain any recognized ROM files."
                    .to_string(),
            });
        }
        let mut first: Option<ImportOutcome> = None;
        for rom in &roms {
            let outcome = import_file(db, games_dir, rom, None)?;
            let _ = std::fs::remove_file(rom);
            first.get_or_insert(outcome);
        }
        let _ = std::fs::remove_file(&renamed);
        let outcome = first.expect("non-empty roms imported");
        return Ok(DownloadLanding::Imported {
            game_id: outcome.game_id,
            already_present: outcome.already_present,
            file_path: outcome.stored_path,
        });
    }

    Ok(DownloadLanding::Unrecognized {
        staged_path: staged,
        reason: format!(
            "Downloaded file is not a recognized ROM or zip (name: {filename}). \
             Try a different link, or download the game in your browser and drag the file in."
        ),
    })
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
        assert_eq!(
            url_filename("https://x/roms/Super%20Mario.nes?dl=1"),
            "Super Mario.nes"
        );
        assert_eq!(url_filename("https://x/a/b/game.zip#frag"), "game.zip");
        assert_eq!(url_filename("https://x/"), "download.bin");
        assert_eq!(url_filename("https://x/..%2f..%2fetc"), "_.._etc"); // leading dots trimmed
    }

    #[test]
    fn parse_content_disposition_basic_and_quoted() {
        assert_eq!(
            parse_content_disposition_filename("attachment; filename=\"Sonic (USA).zip\""),
            Some("Sonic (USA).zip".into())
        );
        assert_eq!(
            parse_content_disposition_filename("attachment; filename=game.nes"),
            Some("game.nes".into())
        );
        assert_eq!(
            parse_content_disposition_filename(
                "attachment; filename*=UTF-8''Sonic%20the%20Hedgehog.zip"
            ),
            Some("Sonic the Hedgehog.zip".into())
        );
    }

    #[test]
    fn classify_magic_zip_nes_html() {
        assert_eq!(classify_magic(b"PK\x03\x04rest"), MagicKind::Zip);
        assert_eq!(classify_magic(b"NES\x1aDATA"), MagicKind::Nes);
        assert_eq!(
            classify_magic(b"<!doctype html><html>"),
            MagicKind::Html
        );
        assert_eq!(classify_magic(b"Rar!\x1a\x07"), MagicKind::Rar);
    }

    #[test]
    fn content_type_helpers() {
        assert!(is_html_content_type("text/html; charset=utf-8"));
        assert!(is_file_content_type("application/zip"));
        assert!(is_file_content_type("application/octet-stream"));
        assert!(!is_file_content_type("text/html"));
    }

    #[test]
    fn is_download_ish_detects_endpoints() {
        assert!(is_download_ish_url("https://x.com/download?id=12"));
        assert!(is_download_ish_url("https://x.com/getfile.php?rom=1"));
        assert!(is_download_ish_url("https://x.com/dl/abc"));
        assert!(!is_download_ish_url("https://x.com/about"));
        assert!(!is_download_ish_url("https://x.com/games/sonic"));
    }

    #[test]
    fn hint_tokens_drop_stopwords() {
        let t = hint_tokens("Sonic the Hedgehog");
        assert!(t.contains(&"sonic".into()));
        assert!(t.contains(&"hedgehog".into()));
        assert!(!t.iter().any(|x| x == "the"));
    }

    #[test]
    fn streams_a_body_to_the_part_file() {
        let (port, join) = fixture_server(b"HELLO-ROM".to_vec());
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), 1);
        let (progress, cont) = hooks();
        let meta = stream_to_staging(
            &format!("http://127.0.0.1:{port}/x.nes"),
            &part,
            &DownloadHooks {
                on_progress: progress,
                should_continue: cont,
            },
        )
        .unwrap();
        join.join().unwrap();
        assert_eq!(meta.bytes, 9);
        assert_eq!(std::fs::read(&part).unwrap(), b"HELLO-ROM");
    }

    #[test]
    fn stream_captures_disposition_filename() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let join = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let body = b"PK\x03\x04fakezip";
            let _ = write!(
                sock,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/zip\r\n\
                 Content-Disposition: attachment; filename=\"FromHeader.zip\"\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(body);
        });
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), 42);
        let (progress, cont) = hooks();
        let meta = stream_to_staging(
            &format!("http://127.0.0.1:{port}/dl?id=1"),
            &part,
            &DownloadHooks {
                on_progress: progress,
                should_continue: cont,
            },
        )
        .unwrap();
        join.join().unwrap();
        assert_eq!(meta.disposition_filename.as_deref(), Some("FromHeader.zip"));
        assert!(meta.content_type.as_deref().unwrap_or("").contains("zip"));
        assert!(looks_like_zip(&part));
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
            &DownloadHooks {
                on_progress: progress,
                should_continue: &|| false,
            },
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
            &DownloadHooks {
                on_progress: progress,
                should_continue: cont,
            },
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
        let err = land_download(&db, tmp.path(), tmp.path(), &part, "game.rar").unwrap_err();
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
        let landing = land_download(&db, tmp.path(), &staging, &part, "mystery.dat").unwrap();
        match landing {
            DownloadLanding::Unrecognized {
                staged_path,
                reason,
            } => {
                assert!(staged_path.exists());
                assert!(staged_path.ends_with("mystery.dat"));
                assert!(!reason.is_empty());
            }
            other => panic!("expected Unrecognized, got {other:?}"),
        }
    }

    #[test]
    fn looks_like_html_detects_doctype() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("page");
        std::fs::write(&p, b"<!doctype html><html><body>x</body></html>").unwrap();
        assert!(looks_like_html(&p));
        std::fs::write(&p, b"NES\x1aROMDATA").unwrap();
        assert!(!looks_like_html(&p));
    }

    #[test]
    fn extract_file_candidates_finds_zip_and_rom_links() {
        let html = r#"
          <html><body>
            <a href="/nav">Home</a>
            <a href="/files/Sonic%20(USA).md">Play now</a>
            <a href="https://cdn.example.com/dl/pack.zip">Download ZIP</a>
            <a href="/other/page">More</a>
          </body></html>
        "#;
        let c = extract_file_download_candidates(
            html,
            "https://roms.example.com/game/sonic",
            None,
        );
        assert!(c.len() >= 2, "{c:?}");
        // zip should rank at or above bare ROM
        assert!(c[0].url.contains("pack.zip") || c.iter().any(|x| x.url.contains("pack.zip")));
        assert!(c.iter().any(|x| x.url.contains("Sonic")));
        assert!(c.iter().all(|x| x.has_importable_ext
            || is_importable_extension(url_path_extension(&x.url).as_deref().unwrap_or(""))));
    }

    #[test]
    fn extract_prefers_hint_matching_filename() {
        let html = r#"
          <html><body>
            <a href="/files/OtherGame.zip">Other</a>
            <a href="/files/Sonic%20the%20Hedgehog%20(USA).zip">Sonic pack</a>
            <a href="/download?id=99">Generic DL</a>
          </body></html>
        "#;
        let c = extract_file_download_candidates(
            html,
            "https://roms.example.com/game/page",
            Some("Sonic the Hedgehog"),
        );
        assert!(!c.is_empty());
        assert!(
            c[0].url.contains("Sonic") || c[0].filename.to_ascii_lowercase().contains("sonic"),
            "expected Sonic first, got {:?}",
            c[0]
        );
        // download-ish without ext should still appear
        assert!(c.iter().any(|x| x.url.contains("download?id=99")));
    }

    #[test]
    fn parse_meta_refresh_extracts_url() {
        assert_eq!(
            parse_meta_refresh_url("0;url=https://cdn.example.com/pack.zip"),
            Some("https://cdn.example.com/pack.zip".into())
        );
        assert_eq!(
            parse_meta_refresh_url("5; URL='/download?id=1'"),
            Some("/download?id=1".into())
        );
    }

    #[test]
    fn extract_includes_meta_refresh_file_target() {
        let html = r#"
          <html><head>
            <meta http-equiv="refresh" content="0;url=https://cdn.example.com/files/Sonic.zip">
          </head><body><p>Redirecting…</p></body></html>
        "#;
        let c = extract_file_download_candidates(html, "https://roms.example.com/dl", None);
        assert!(
            c.iter().any(|x| x.url.contains("Sonic.zip")),
            "meta-refresh zip missing: {c:?}"
        );
    }

    #[test]
    fn extract_js_location_finds_assignment() {
        let html = r#"<script>window.location = "https://cdn.example.com/get/game.nes";</script>"#;
        let urls = extract_js_location_urls(html);
        assert!(urls.iter().any(|u| u.contains("game.nes")), "{urls:?}");
    }

    #[test]
    fn auto_import_follows_html_to_zip_rom() {
        // Two fixture servers: page then zip. Top candidate has .zip so no HEAD.
        let zip_bytes = zip_with(&[("Auto Import.nes", b"AUTO-IMPORT-ROM-BYTES")]);
        let zip_server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let zip_port = zip_server.server_addr().to_ip().unwrap().port();
        let zip_bytes_clone = zip_bytes.clone();
        let zip_join = std::thread::spawn(move || {
            if let Ok(req) = zip_server.recv() {
                let _ = req.respond(tiny_http::Response::from_data(zip_bytes_clone));
            }
        });

        let page_html = format!(
            r#"<!doctype html><html><body>
               <a href="http://127.0.0.1:{zip_port}/pack.zip">Download ZIP</a>
               </body></html>"#
        );
        let page_server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let page_port = page_server.server_addr().to_ip().unwrap().port();
        let page_join = std::thread::spawn(move || {
            if let Ok(req) = page_server.recv() {
                let _ = req.respond(tiny_http::Response::from_data(page_html.into_bytes()));
            }
        });

        let db = Db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let games = tmp.path().join("games");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&games).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        let (progress, cont) = hooks();
        let landing = download_and_auto_import(
            &format!("http://127.0.0.1:{page_port}/game/sonic"),
            &staging,
            99,
            &DownloadHooks {
                on_progress: progress,
                should_continue: cont,
            },
            &db,
            &games,
            Some("Auto Import"),
        )
        .expect("auto import");
        page_join.join().unwrap();
        zip_join.join().unwrap();

        match landing {
            DownloadLanding::Imported {
                game_id,
                already_present,
                file_path,
            } => {
                assert!(game_id > 0);
                assert!(!already_present);
                assert!(
                    file_path.contains("Auto Import") || file_path.ends_with(".nes"),
                    "{file_path}"
                );
            }
            other => panic!("expected Imported, got {other:?}"),
        }
    }

    #[test]
    fn auto_import_follows_download_ish_via_head_probe() {
        // Page links only to /download?id=1 (no extension). HEAD says zip +
        // disposition name; second GET returns a zip with a ROM.
        let zip_bytes = zip_with(&[("Probed Game.nes", b"PROBED-ROM-BYTES-XX")]);
        let zip_server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let zip_port = zip_server.server_addr().to_ip().unwrap().port();
        let zip_bytes_clone = zip_bytes.clone();
        let zip_join = std::thread::spawn(move || {
            // HEAD then GET (and maybe retries)
            for _ in 0..6 {
                match zip_server.recv_timeout(std::time::Duration::from_secs(3)) {
                    Ok(Some(req)) => {
                        let body = zip_bytes_clone.clone();
                        let response = tiny_http::Response::from_data(body)
                            .with_header(
                                "Content-Type: application/zip"
                                    .parse::<tiny_http::Header>()
                                    .unwrap(),
                            )
                            .with_header(
                                "Content-Disposition: attachment; filename=\"ProbedGame.zip\""
                                    .parse::<tiny_http::Header>()
                                    .unwrap(),
                            );
                        let _ = req.respond(response);
                    }
                    _ => break,
                }
            }
        });

        let page_html = format!(
            r#"<!doctype html><html><body>
               <a href="http://127.0.0.1:{zip_port}/download?id=1">Download</a>
               </body></html>"#
        );
        let page_server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let page_port = page_server.server_addr().to_ip().unwrap().port();
        let page_join = std::thread::spawn(move || {
            if let Ok(req) = page_server.recv() {
                let _ = req.respond(tiny_http::Response::from_data(page_html.into_bytes()));
            }
        });

        let db = Db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let games = tmp.path().join("games");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&games).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        let (progress, cont) = hooks();
        let landing = download_and_auto_import(
            &format!("http://127.0.0.1:{page_port}/game"),
            &staging,
            55,
            &DownloadHooks {
                on_progress: progress,
                should_continue: cont,
            },
            &db,
            &games,
            Some("Probed Game"),
        )
        .expect("auto import via download-ish");
        page_join.join().unwrap();
        let _ = zip_join.join();

        match landing {
            DownloadLanding::Imported { game_id, .. } => assert!(game_id > 0),
            other => panic!("expected Imported, got {other:?}"),
        }
    }

    #[test]
    fn auto_import_html_without_file_link_is_unrecognized_with_reason() {
        let html = b"<!doctype html><html><body><a href='/about'>About</a></body></html>";
        let (port, join) = fixture_server(html.to_vec());
        let db = Db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let games = tmp.path().join("games");
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&games).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        let (progress, cont) = hooks();
        let landing = download_and_auto_import(
            &format!("http://127.0.0.1:{port}/page"),
            &staging,
            7,
            &DownloadHooks {
                on_progress: progress,
                should_continue: cont,
            },
            &db,
            &games,
            None,
        )
        .unwrap();
        join.join().unwrap();
        match landing {
            DownloadLanding::Unrecognized {
                staged_path,
                reason,
            } => {
                assert!(staged_path.exists());
                assert!(reason.contains("web page") || reason.contains("ROM"));
            }
            other => panic!("expected Unrecognized, got {other:?}"),
        }
    }

    #[test]
    fn probe_candidate_detects_file_headers() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let join = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut req = [0u8; 1024];
            let _ = sock.read(&mut req);
            let _ = write!(
                sock,
                "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\n\
                 Content-Disposition: attachment; filename=\"probed.zip\"\r\n\
                 Content-Length: 4\r\n\r\nPK\x03\x04"
            );
        });
        let probe = probe_candidate(&format!("http://127.0.0.1:{port}/download?id=1"));
        join.join().unwrap();
        assert!(probe.looks_like_file, "{probe:?}");
        assert!(!probe.looks_like_html);
        assert_eq!(probe.disposition_filename.as_deref(), Some("probed.zip"));
    }
}
