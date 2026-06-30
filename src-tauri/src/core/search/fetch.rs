//! HTML-scraping preview fetch for search providers (v0.16 "Trove").
//!
//! v0.16 evolves the search contract: to show a *preview of what a provider
//! found*, `run_search` now fetches each provider's public search-results page
//! and extracts the candidate result links from its HTML. This module owns that
//! fetch-and-parse step.
//!
//! The invariant that matters is preserved: **Harmony never downloads the
//! content itself.** It fetches only the provider's HTML search-results page
//! (metadata about what is available), surfaces the links it finds, and the user
//! opens their chosen link in their own browser. The safeguards below bound the
//! fetch (scheme, timeout, body size, result count, title length) so a hostile
//! or huge page cannot hang or exhaust the app.

use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

use scraper::{Html, Selector};

use crate::error::{AppError, AppResult};

/// Maximum number of preview links returned per provider (keeps the response and
/// the UI bounded regardless of how many anchors a page contains).
const MAX_RESULTS: usize = 30;

/// Maximum length (in chars) of a preview title; longer anchor text is truncated.
const MAX_TITLE_LEN: usize = 200;

/// Per-request network timeout. Generic scraping hits arbitrary sites, so this
/// is short — a slow provider degrades to "no preview" rather than hanging.
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);

/// Maximum HTML body read into memory before parsing (2 MiB). A larger page is
/// truncated at the limit and we parse what we have.
const MAX_BODY_BYTES: u64 = 2 * 1024 * 1024;

/// Descriptive User-Agent so providers can identify the client.
const USER_AGENT: &str = concat!(
    "Harmony/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/rhohn94/harmony)"
);

/// A single scraped preview link: the anchor's visible text and its absolute URL.
#[derive(Debug, Clone, PartialEq)]
pub struct ScrapedResult {
    pub title: String,
    pub url: String,
}

/// Fetch `search_url` and extract candidate result links from the returned HTML.
///
/// Returns `Err` when the URL is not http(s), the request fails, or the response
/// is a non-success status — the caller surfaces that per-provider and falls
/// back to offering the search-page link itself.
pub fn fetch_results(search_url: &str) -> AppResult<Vec<ScrapedResult>> {
    let body = fetch_body(search_url)?;
    Ok(extract_links(&body, search_url))
}

/// Diagnostics for the provider validator (v0.20): the scraped links plus a
/// guess at whether the page is JavaScript-rendered (so a static scrape finds
/// nothing). Returned by `fetch_diagnostics`.
pub struct FetchDiagnostics {
    pub links: Vec<ScrapedResult>,
    pub likely_js_rendered: bool,
}

/// Fetch `search_url` and return both the scraped links and a JS-rendered guess,
/// for the "Test provider" validator. Same fetch path + safeguards as
/// `fetch_results`; `Err` on the same conditions (non-http, request failure,
/// non-success status).
pub fn fetch_diagnostics(search_url: &str) -> AppResult<FetchDiagnostics> {
    let body = fetch_body(search_url)?;
    let links = extract_links(&body, search_url);
    let likely_js_rendered = looks_client_rendered(&body, count_anchors(&body));
    Ok(FetchDiagnostics {
        links,
        likely_js_rendered,
    })
}

/// Fetch a search page's HTML body over http(s), enforcing the scheme, status,
/// timeout, and body-size safeguards. Shared by `fetch_results` and
/// `fetch_diagnostics`.
fn fetch_body(search_url: &str) -> AppResult<String> {
    // Only ever fetch over http(s); never file://, data:, etc.
    if !is_http_url(search_url) {
        return Err(AppError::Validation(format!(
            "refusing to fetch non-http(s) URL: {search_url}"
        )));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Network(format!("failed to build HTTP client: {e}")))?;

    let resp = client
        .get(search_url)
        .send()
        .map_err(|e| AppError::Network(format!("search request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "provider returned status {}",
            resp.status()
        )));
    }

    read_capped(resp)
}

/// Read a response body up to `MAX_BODY_BYTES`, decoding as UTF-8 lossily. The
/// cap is enforced while reading (via `Read::take`), so an oversized body never
/// fully lands in memory.
fn read_capped(resp: reqwest::blocking::Response) -> AppResult<String> {
    let mut buf = Vec::with_capacity(64 * 1024);
    resp.take(MAX_BODY_BYTES)
        .read_to_end(&mut buf)
        .map_err(|e| AppError::Network(format!("failed to read response body: {e}")))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Extract candidate result links from `html`, resolving relative hrefs against
/// `base_url`. Pure (no I/O) so it is unit-testable without a network.
///
/// The heuristic is deliberately source-agnostic (the provider is arbitrary):
/// take every `<a href>`, resolve it to an absolute http(s) URL, require
/// non-empty visible text, drop duplicates and the search page itself, and cap
/// at `MAX_RESULTS`. This previews whatever a page links to — imperfectly, but
/// without per-site parsers.
pub fn extract_links(html: &str, base_url: &str) -> Vec<ScrapedResult> {
    let base = reqwest::Url::parse(base_url).ok();
    let doc = Html::parse_document(html);
    let selector = match Selector::parse("a[href]") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut out: Vec<ScrapedResult> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for el in doc.select(&selector) {
        let Some(href) = el.value().attr("href").map(str::trim) else {
            continue;
        };
        let Some(url) = resolve_http_url(href, base.as_ref()) else {
            continue;
        };
        // Skip the search page itself (a self-link is not a result).
        if url == base_url {
            continue;
        }
        let title = normalize_title(&el.text().collect::<String>());
        if title.is_empty() {
            continue;
        }
        // v0.18: drop obvious page chrome (nav/pagination/legal/social) before it
        // becomes a "result". Conservative — whole-string matches only, so a real
        // title is never dropped.
        if is_chrome_anchor(&title) {
            continue;
        }
        if !seen.insert(url.clone()) {
            continue;
        }
        out.push(ScrapedResult { title, url });
        if out.len() >= MAX_RESULTS {
            break;
        }
    }
    out
}

/// True when `url` parses as an absolute http(s) URL.
fn is_http_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .map(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or(false)
}

/// Resolve `href` (absolute, protocol-relative, or relative) against `base` to
/// an absolute http(s) URL string. Returns `None` for fragments, unsupported
/// schemes (`javascript:`, `mailto:`, `data:`, …), or unparseable hrefs.
fn resolve_http_url(href: &str, base: Option<&reqwest::Url>) -> Option<String> {
    if href.is_empty() || href.starts_with('#') {
        return None;
    }
    let lower = href.to_ascii_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("mailto:")
        || lower.starts_with("data:")
        || lower.starts_with("tel:")
    {
        return None;
    }
    let resolved = match reqwest::Url::parse(href) {
        Ok(u) => u,                       // already absolute
        Err(_) => base?.join(href).ok()?, // relative / protocol-relative → join
    };
    if !matches!(resolved.scheme(), "http" | "https") {
        return None;
    }
    Some(resolved.to_string())
}

/// Minimum visible-title length to keep an anchor (drops single-character chrome
/// like a "›" pagination arrow).
const MIN_TITLE_LEN: usize = 2;

/// Exact (whole-string, case-insensitive) anchor texts that are page chrome,
/// never a result: navigation, account, pagination, legal, and social links.
/// Matched against the full normalized title, so a real title that merely
/// *contains* one of these words (e.g. "Home Alone") is unaffected.
const CHROME_WORDS: &[&str] = &[
    "home", "login", "log in", "logout", "log out", "sign in", "sign up",
    "signin", "signup", "register", "account", "next", "previous", "prev",
    "more", "back", "top", "menu", "search", "about", "contact", "privacy",
    "terms", "help", "faq", "cart", "donate", "forum", "forums", "blog",
    "rss", "twitter", "facebook", "discord", "reddit", "github", "download",
    "downloads", "browse", "all", "view all", "see all", "read more",
];

/// True when `title` is page chrome that should not be surfaced as a result:
/// a pure-numeric/short token (pagination), or an exact match for a known
/// nav/legal/social word. Conservative by design — whole-string matches only.
fn is_chrome_anchor(title: &str) -> bool {
    let t = title.trim();
    if t.chars().count() < MIN_TITLE_LEN {
        return true;
    }
    // Pagination ordinals: "1", "23", "»" already caught by length; catch
    // multi-digit page numbers here.
    if t.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    let lower = t.to_ascii_lowercase();
    CHROME_WORDS.contains(&lower.as_str())
}

/// Count `<a ` / `<a>` opening tags in raw HTML (case-insensitive). A cheap proxy
/// for "how many links does the server actually render", used by the JS-rendered
/// heuristic — independent of `extract_links`' filtering.
fn count_anchors(html: &str) -> usize {
    let lower = html.to_ascii_lowercase();
    lower.match_indices("<a").filter(|(i, _)| {
        // Require the char after "<a" to be a space, '>' or '/' so "<article>"
        // etc. don't count as anchors.
        lower[*i + 2..]
            .chars()
            .next()
            .map(|c| c == ' ' || c == '>' || c == '\t' || c == '\n' || c == '/')
            .unwrap_or(false)
    }).count()
}

/// Markers that a page is a client-rendered single-page app: a near-empty mount
/// node plus a framework hook. Matched case-insensitively.
const SPA_MARKERS: &[&str] = &[
    "id=\"root\"",
    "id=\"app\"",
    "id=\"__next\"",
    "__next_data__",
    "window.__nuxt__",
    "data-reactroot",
    "ng-version",
    "ng-app",
];

/// Heuristic: does this HTML look JavaScript-rendered (so a static scrape finds
/// no real results)? True only when the page renders very few anchors **and**
/// carries a known SPA shell marker — conservative, so a genuinely empty
/// results page (few anchors, no SPA marker) is not mislabeled. Pure/testable.
fn looks_client_rendered(html: &str, anchor_count: usize) -> bool {
    if anchor_count >= 3 {
        return false;
    }
    let lower = html.to_ascii_lowercase();
    SPA_MARKERS.iter().any(|m| lower.contains(m))
}

/// Collapse internal whitespace, trim, and bound the length — anchor text often
/// carries newlines/tabs and can be arbitrarily long.
fn normalize_title(s: &str) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > MAX_TITLE_LEN {
        collapsed.chars().take(MAX_TITLE_LEN).collect()
    } else {
        collapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "https://example.com/search?q=mario";

    #[test]
    fn extracts_absolute_links_with_text() {
        let html = r#"<a href="https://files.example.com/a.zip">Super Mario (USA)</a>"#;
        let out = extract_links(html, BASE);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "Super Mario (USA)");
        assert_eq!(out[0].url, "https://files.example.com/a.zip");
    }

    #[test]
    fn resolves_relative_and_protocol_relative_against_base() {
        let html = r#"
            <a href="/details/mario">Relative</a>
            <a href="//cdn.example.com/x">Protocol-relative</a>
        "#;
        let out = extract_links(html, BASE);
        let urls: Vec<&str> = out.iter().map(|r| r.url.as_str()).collect();
        assert!(urls.contains(&"https://example.com/details/mario"));
        assert!(urls.contains(&"https://cdn.example.com/x"));
    }

    #[test]
    fn skips_fragments_and_non_http_schemes() {
        let html = r##"
            <a href="#top">Anchor</a>
            <a href="javascript:void(0)">JS</a>
            <a href="mailto:a@b.com">Mail</a>
            <a href="data:text/plain,hi">Data</a>
        "##;
        assert!(extract_links(html, BASE).is_empty());
    }

    #[test]
    fn skips_empty_text_and_deduplicates() {
        let html = r#"
            <a href="https://x.example.com/1"></a>
            <a href="https://x.example.com/2">Keep</a>
            <a href="https://x.example.com/2">Dup</a>
        "#;
        let out = extract_links(html, BASE);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].url, "https://x.example.com/2");
    }

    #[test]
    fn skips_the_search_page_self_link() {
        let html = format!(r#"<a href="{BASE}">self</a><a href="https://x.example.com/1">other</a>"#);
        let out = extract_links(&html, BASE);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].url, "https://x.example.com/1");
    }

    #[test]
    fn caps_results_at_the_limit() {
        let mut html = String::new();
        for i in 0..(MAX_RESULTS + 20) {
            html.push_str(&format!(r#"<a href="https://x.example.com/{i}">Item {i}</a>"#));
        }
        assert_eq!(extract_links(&html, BASE).len(), MAX_RESULTS);
    }

    #[test]
    fn collapses_whitespace_in_titles() {
        let html = "<a href=\"https://x.example.com/1\">  Super\n\t Mario  </a>";
        let out = extract_links(html, BASE);
        assert_eq!(out[0].title, "Super Mario");
    }

    #[test]
    fn drops_chrome_and_pagination_anchors() {
        // v0.18: nav/legal/social chrome and pagination must not become results,
        // but a real title is kept even when it contains a chrome word.
        let html = r#"
            <a href="https://x.example.com/home">Home</a>
            <a href="https://x.example.com/login">Login</a>
            <a href="https://x.example.com/next">Next</a>
            <a href="https://x.example.com/p2">2</a>
            <a href="https://x.example.com/arrow">›</a>
            <a href="https://x.example.com/privacy">Privacy</a>
            <a href="https://x.example.com/game">Home Alone 2 (USA)</a>
        "#;
        let out = extract_links(html, BASE);
        let titles: Vec<&str> = out.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, vec!["Home Alone 2 (USA)"]);
    }

    #[test]
    fn is_chrome_anchor_classifies_correctly() {
        assert!(is_chrome_anchor("Home"));
        assert!(is_chrome_anchor("  LOGIN "));
        assert!(is_chrome_anchor("Sign In"));
        assert!(is_chrome_anchor("12"));
        assert!(is_chrome_anchor("›"));
        // Real titles are kept, even ones containing a chrome word.
        assert!(!is_chrome_anchor("Home Alone (USA)"));
        assert!(!is_chrome_anchor("Contra"));
        assert!(!is_chrome_anchor("Super Mario Bros. 3"));
    }

    #[test]
    fn is_http_url_rejects_non_http() {
        assert!(is_http_url("https://example.com"));
        assert!(is_http_url("http://example.com"));
        assert!(!is_http_url("ftp://example.com"));
        assert!(!is_http_url("file:///etc/passwd"));
        assert!(!is_http_url("not a url"));
    }

    #[test]
    fn looks_client_rendered_flags_spa_shells() {
        // An SPA shell: a near-empty mount node + a framework script, no anchors.
        let spa = r#"<html><body><div id="root"></div><script src="/app.js"></script></body></html>"#;
        assert!(looks_client_rendered(spa, count_anchors(spa)));
        let next = r#"<div id="__next"></div><script>window.__NEXT_DATA__={}</script>"#;
        assert!(looks_client_rendered(next, count_anchors(next)));
    }

    #[test]
    fn looks_client_rendered_is_false_for_server_rendered_pages() {
        // Several real anchors → server-rendered, even if a marker coincidentally
        // appears.
        let html = r#"<div id="app"><a href="/1">A</a><a href="/2">B</a><a href="/3">C</a></div>"#;
        assert!(!looks_client_rendered(html, count_anchors(html)));
        // Few anchors but NO SPA marker → a genuinely sparse page, not mislabeled.
        let sparse = r#"<html><body><p>No results found.</p></body></html>"#;
        assert!(!looks_client_rendered(sparse, count_anchors(sparse)));
    }

    #[test]
    fn count_anchors_counts_only_real_anchors() {
        let html = r#"<a href="x">1</a><article>not a link</article><a>2</a><address/>"#;
        assert_eq!(count_anchors(html), 2);
    }

    #[test]
    fn fetch_rejects_non_http_url_without_network() {
        // Guards the scheme check before any socket is opened.
        assert!(matches!(
            fetch_results("file:///etc/passwd"),
            Err(AppError::Validation(_))
        ));
    }
}
