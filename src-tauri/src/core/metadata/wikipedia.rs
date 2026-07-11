//! Wikipedia enrichment client (v0.12).
//!
//! Resolves a game (or console) title to its best-matching English Wikipedia
//! article and returns the lead summary text, the canonical article URL, and a
//! thumbnail image URL. Used by the library enrichment command (cover art is the
//! libretro CDN's job; the *description* comes from here) and by the console
//! catalog (console photo + blurb).
//!
//! Two-step resolution, mirroring how the cover-art client degrades:
//!   1. a search query (`list=search`) resolves the free-text title to a real
//!      article title, biased toward the video-game / console article;
//!   2. the REST `page/summary/{title}` endpoint returns the lead extract,
//!      thumbnail, and canonical URL.
//!
//! Every network failure degrades to `Ok(None)` so enrichment is best-effort and
//! never blocks an add/import. The pure helpers (title normalization, URL
//! building, JSON parsing) are unit-tested; the network round-trip is integration
//! territory, exactly as in `cdn_client`.

use crate::error::{AppError, AppResult};
use std::time::Duration;

/// English Wikipedia API host.
const WIKI_API: &str = "https://en.wikipedia.org/w/api.php";
/// REST v1 summary endpoint base.
const WIKI_SUMMARY: &str = "https://en.wikipedia.org/api/rest_v1/page/summary";
/// A descriptive User-Agent — the Wikimedia API rejects generic/blank agents.
const USER_AGENT: &str =
    "Harmony/0.12 (Mac emulator frontend; https://github.com/rhohn94/harmony)";
/// Per-request timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// A resolved Wikipedia summary: lead text plus optional media/links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WikiSummary {
    /// The resolved article title.
    pub title: String,
    /// Plain-text lead extract (the summary paragraph).
    pub extract: String,
    /// Canonical desktop article URL, if present.
    pub page_url: Option<String>,
    /// Lead-image thumbnail URL, if the article has one.
    pub thumbnail_url: Option<String>,
}

/// Reduce a No-Intro / display title to a clean search term: drop every
/// parenthesized "(...)" and bracketed "[...]" tag group (region, revision,
/// proto, …) and collapse whitespace. "Super Mario Bros. (USA)" → "Super Mario
/// Bros.".
pub fn normalize_title(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut depth = 0i32;
    for ch in name.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => {
                if depth > 0 {
                    depth -= 1
                }
            }
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Build the `list=search` API URL for `query`, biased with `hint` (e.g. "video
/// game" or "video game console") appended to the search expression.
fn build_search_url(query: &str, hint: &str) -> String {
    let srsearch = if hint.is_empty() {
        query.to_string()
    } else {
        format!("{query} {hint}")
    };
    format!(
        "{WIKI_API}?action=query&format=json&list=search&srlimit=1&srsearch={}",
        percent_encode(&srsearch)
    )
}

/// Build the REST summary URL for an already-resolved article `title`.
fn build_summary_url(title: &str) -> String {
    // The REST endpoint takes the title as a path segment with spaces as
    // underscores; percent-encode the rest.
    let path = title.replace(' ', "_");
    format!("{WIKI_SUMMARY}/{}", percent_encode_path(&path))
}

/// Parse the first article title out of a `list=search` response, or `None`.
fn parse_search_first_title(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("query")?
        .get("search")?
        .as_array()?
        .first()?
        .get("title")?
        .as_str()
        .map(|s| s.to_string())
}

/// Parse a REST `page/summary` response into a [`WikiSummary`]. Returns `None`
/// for disambiguation pages, missing extracts, or malformed bodies.
fn parse_summary(json: &str) -> Option<WikiSummary> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    // Skip disambiguation pages — they carry no useful description.
    if v.get("type").and_then(|t| t.as_str()) == Some("disambiguation") {
        return None;
    }
    let extract = v.get("extract")?.as_str()?.trim().to_string();
    if extract.is_empty() {
        return None;
    }
    let title = v
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string();
    let page_url = v
        .get("content_urls")
        .and_then(|c| c.get("desktop"))
        .and_then(|d| d.get("page"))
        .and_then(|p| p.as_str())
        .map(|s| s.to_string());
    let thumbnail_url = v
        .get("thumbnail")
        .and_then(|t| t.get("source"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    Some(WikiSummary {
        title,
        extract,
        page_url,
        thumbnail_url,
    })
}

/// Resolve `query` to a Wikipedia summary, biasing the search with `hint`
/// ("video game" for titles, "video game console" for consoles). Best-effort:
/// any miss or transport error yields `Ok(None)`.
pub async fn fetch_summary(query: &str, hint: &str) -> AppResult<Option<WikiSummary>> {
    let normalized = normalize_title(query);
    if normalized.is_empty() {
        return Ok(None);
    }
    let client = http_client()?;

    // Step 1 — resolve the free-text title to a real article title.
    let search_body = match get_text(&client, &build_search_url(&normalized, hint)).await? {
        Some(b) => b,
        None => return Ok(None),
    };
    let Some(article) = parse_search_first_title(&search_body) else {
        return Ok(None);
    };

    // Step 2 — fetch that article's summary.
    let summary_body = match get_text(&client, &build_summary_url(&article)).await? {
        Some(b) => b,
        None => return Ok(None),
    };
    Ok(parse_summary(&summary_body))
}

/// Fetch the summary for an already-known article `title` directly (skipping the
/// search step). Used by the console catalog, which holds exact article titles.
/// Best-effort: a miss or transport error yields `Ok(None)`.
pub async fn fetch_summary_by_title(title: &str) -> AppResult<Option<WikiSummary>> {
    let client = http_client()?;
    let body = match get_text(&client, &build_summary_url(title)).await? {
        Some(b) => b,
        None => return Ok(None),
    };
    Ok(parse_summary(&body))
}

/// Download an image (the article thumbnail) and return its raw bytes, or `None`
/// on a 404 / non-success. Used to cache console photos on disk.
pub async fn fetch_image_bytes(url: &str) -> AppResult<Option<Vec<u8>>> {
    let client = http_client()?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("image request failed: {e}")))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Network(format!("failed to read image body: {e}")))?;
    Ok(Some(bytes.to_vec()))
}

/// Build a reqwest client with the Wikimedia-required descriptive User-Agent.
fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Network(format!("failed to build HTTP client: {e}")))
}

/// GET `url` and return the body text, or `None` on a non-success status.
async fn get_text(client: &reqwest::Client, url: &str) -> AppResult<Option<String>> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("wikipedia request failed: {e}")))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Network(format!("failed to read wikipedia body: {e}")))?;
    Ok(Some(body))
}

/// Percent-encode a query-string value (RFC 3986 unreserved pass through).
fn percent_encode(s: &str) -> String {
    encode_with(s, |b| {
        matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~')
    })
}

/// Percent-encode a path segment, additionally letting through the characters
/// Wikipedia keeps literal in article paths (`_`, `.`, `,`, `:`, `'`, `!`, etc.).
fn percent_encode_path(s: &str) -> String {
    encode_with(s, |b| {
        matches!(b,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'.' | b'_' | b'~' | b':' | b',' | b'\'' | b'!' | b'*' | b'(' | b')')
    })
}

/// Shared percent-encoder: bytes for which `keep` returns true pass through,
/// everything else becomes an uppercase-hex `%XX` escape. `pub(crate)` (W421)
/// so `core::search::template`'s RFC 3986 encoder can reuse this same
/// byte-level scaffold instead of hand-rolling an identical copy.
pub(crate) fn encode_with(s: &str, keep: impl Fn(u8) -> bool) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        if keep(byte) {
            out.push(byte as char);
        } else {
            out.push('%');
            out.push(char::from_digit((byte >> 4) as u32, 16).unwrap().to_ascii_uppercase());
            out.push(char::from_digit((byte & 0xf) as u32, 16).unwrap().to_ascii_uppercase());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_region_and_revision_tags() {
        assert_eq!(normalize_title("Super Mario Bros. (USA)"), "Super Mario Bros.");
        assert_eq!(
            normalize_title("Chrono Trigger (USA) (Rev 1)"),
            "Chrono Trigger"
        );
        assert_eq!(normalize_title("Sonic [!]"), "Sonic");
        assert_eq!(normalize_title("Plain Title"), "Plain Title");
    }

    #[test]
    fn normalize_collapses_inner_whitespace() {
        assert_eq!(normalize_title("Mega Man   X  (USA)"), "Mega Man X");
    }

    #[test]
    fn search_url_appends_hint_and_encodes() {
        let url = build_search_url("Super Mario Bros.", "video game");
        assert!(url.contains("list=search"));
        assert!(url.contains("Super%20Mario%20Bros.%20video%20game"));
    }

    #[test]
    fn summary_url_uses_underscores() {
        let url = build_summary_url("Super Mario Bros.");
        assert_eq!(
            url,
            "https://en.wikipedia.org/api/rest_v1/page/summary/Super_Mario_Bros."
        );
    }

    #[test]
    fn parses_first_search_title() {
        let json = r#"{"query":{"search":[{"title":"Super Mario Bros."},{"title":"Other"}]}}"#;
        assert_eq!(parse_search_first_title(json).as_deref(), Some("Super Mario Bros."));
    }

    #[test]
    fn empty_search_yields_none() {
        let json = r#"{"query":{"search":[]}}"#;
        assert!(parse_search_first_title(json).is_none());
    }

    #[test]
    fn parses_summary_extract_url_and_thumbnail() {
        let json = r#"{
            "type":"standard",
            "title":"Super Mario Bros.",
            "extract":"Super Mario Bros. is a platform game.",
            "content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Super_Mario_Bros."}},
            "thumbnail":{"source":"https://upload.wikimedia.org/smb.png"}
        }"#;
        let s = parse_summary(json).unwrap();
        assert_eq!(s.title, "Super Mario Bros.");
        assert!(s.extract.starts_with("Super Mario Bros. is"));
        assert_eq!(
            s.page_url.as_deref(),
            Some("https://en.wikipedia.org/wiki/Super_Mario_Bros.")
        );
        assert_eq!(s.thumbnail_url.as_deref(), Some("https://upload.wikimedia.org/smb.png"));
    }

    #[test]
    fn disambiguation_summary_is_skipped() {
        let json = r#"{"type":"disambiguation","title":"Mario","extract":"Mario may refer to:"}"#;
        assert!(parse_summary(json).is_none());
    }

    #[test]
    fn summary_without_extract_is_none() {
        let json = r#"{"type":"standard","title":"X","extract":""}"#;
        assert!(parse_summary(json).is_none());
    }
}
