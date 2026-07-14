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

use scraper::{ElementRef, Html, Selector};

use crate::core::search::profiles::{
    host_from_url, profile_for_host, result_url_matches_profile,
};
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

/// SERP health after a successful fetch (Phase 3). Surfaces captcha / SPA /
/// empty results so the UI can auto-collapse and label groups.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SerpHealth {
    Ok,
    Captcha,
    JsShell,
    Empty,
}

impl SerpHealth {
    pub fn as_str(self) -> &'static str {
        match self {
            SerpHealth::Ok => "ok",
            SerpHealth::Captcha => "captcha",
            SerpHealth::JsShell => "js_shell",
            SerpHealth::Empty => "empty",
        }
    }
}

/// Scrape outcome: links + health assessment.
#[derive(Debug, Clone)]
pub struct FetchOutcome {
    pub links: Vec<ScrapedResult>,
    pub health: SerpHealth,
}

/// Fetch `search_url` and extract candidate result links from the returned HTML.
///
/// Returns `Err` when the URL is not http(s), the request fails, or the response
/// is a non-success status — the caller surfaces that per-provider and falls
/// back to offering the search-page link itself.
pub fn fetch_results(search_url: &str) -> AppResult<Vec<ScrapedResult>> {
    Ok(fetch_results_with_health(search_url)?.links)
}

/// Like [`fetch_results`], but also returns SERP health for the UI.
pub fn fetch_results_with_health(search_url: &str) -> AppResult<FetchOutcome> {
    let body = fetch_body(search_url)?;
    let mut links = extract_links(&body, search_url);
    let health = assess_serp_health(&body, &links);
    // Captcha pages often still yield nav chrome — clear so the group is empty.
    if health == SerpHealth::Captcha {
        links.clear();
    }
    Ok(FetchOutcome { links, health })
}

/// Classify a fetched SERP body. Pure / testable.
pub fn assess_serp_health(html: &str, links: &[ScrapedResult]) -> SerpHealth {
    if looks_like_captcha(html) {
        return SerpHealth::Captcha;
    }
    if links.is_empty() {
        if looks_client_rendered(html, count_anchors(html)) {
            return SerpHealth::JsShell;
        }
        return SerpHealth::Empty;
    }
    SerpHealth::Ok
}

/// Heuristic captcha / bot-wall markers (Yandex SmartCaptcha, reCAPTCHA, CF…).
pub fn looks_like_captcha(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "smartcaptcha",
        "g-recaptcha",
        "h-captcha",
        "cf-challenge",
        "cf-turnstile",
        "challenges.cloudflare.com",
        "id=\"captcha\"",
        "class=\"captcha\"",
        "data-sitekey",
        "verify you are human",
        "are you a robot",
        "unusual traffic",
        "attention required! | cloudflare",
        "enable javascript and cookies to continue",
    ];
    if MARKERS.iter().any(|m| lower.contains(m)) {
        return true;
    }
    // "captcha" near verify/challenge wording
    if lower.contains("captcha")
        && (lower.contains("verify")
            || lower.contains("challenge")
            || lower.contains("robot")
            || lower.contains("human"))
    {
        return true;
    }
    false
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
pub(crate) fn fetch_body(search_url: &str) -> AppResult<String> {
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
/// Phase 2 (structure-aware scrape):
/// 1. Host profiles (DuckDuckGo `a.result__a`, Archive.org `/details/`, …)
/// 2. Generic structural ranking — prefer `main`/`article`/results containers,
///    drop anchors inside `nav`/`header`/`footer`
/// 3. Fallback: every remaining non-chrome `<a href>` (v0.16 behaviour)
pub fn extract_links(html: &str, base_url: &str) -> Vec<ScrapedResult> {
    let profiled = extract_profile_links(html, base_url);
    if !profiled.is_empty() {
        return profiled;
    }
    extract_links_structured(html, base_url)
}

/// Known SERP profiles with reliable result-link selectors ([`profiles`]).
fn extract_profile_links(html: &str, base_url: &str) -> Vec<ScrapedResult> {
    let host = host_from_url(base_url);
    if host.is_empty() {
        return Vec::new();
    }
    let Some(profile) = profile_for_host(&host) else {
        return Vec::new();
    };
    if profile.result_selectors.is_empty() {
        return Vec::new();
    }
    let mut links = collect_by_selectors(html, base_url, profile.result_selectors);
    if let Some(_frag) = profile.result_path_contains {
        links.retain(|r| result_url_matches_profile(&r.url, profile));
    }
    links
}

/// Collect links matching any of the CSS `selectors`, in document order,
/// applying the same chrome / scheme / dedupe rules as the generic path.
fn collect_by_selectors(html: &str, base_url: &str, selectors: &[&str]) -> Vec<ScrapedResult> {
    let base = reqwest::Url::parse(base_url).ok();
    let doc = Html::parse_document(html);
    let mut out: Vec<ScrapedResult> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for sel_str in selectors {
        let Ok(selector) = Selector::parse(sel_str) else {
            continue;
        };
        for el in doc.select(&selector) {
            if let Some(item) = scrape_anchor(&el, base.as_ref(), base_url) {
                if seen.insert(item.url.clone()) {
                    out.push(item);
                    if out.len() >= MAX_RESULTS {
                        return out;
                    }
                }
            }
        }
    }
    out
}

/// Structure-aware generic scrape: score every non-chrome anchor by container
/// context, prefer results regions, drop nav/header/footer, then cap.
fn extract_links_structured(html: &str, base_url: &str) -> Vec<ScrapedResult> {
    let base = reqwest::Url::parse(base_url).ok();
    let doc = Html::parse_document(html);
    let Ok(selector) = Selector::parse("a[href]") else {
        return Vec::new();
    };

    struct Ranked {
        score: i32,
        order: usize,
        item: ScrapedResult,
    }

    let mut ranked: Vec<Ranked> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut order = 0usize;

    for el in doc.select(&selector) {
        // Skip anchors inside page chrome containers.
        if is_in_chrome_region(&el) {
            continue;
        }
        let Some(item) = scrape_anchor(&el, base.as_ref(), base_url) else {
            continue;
        };
        if !seen.insert(item.url.clone()) {
            continue;
        }
        let mut score: i32 = 10;
        if is_in_results_region(&el) {
            score += 40;
        }
        // Prefer longer, more specific titles over single tokens.
        let tlen = item.title.chars().count();
        if tlen >= 12 {
            score += 8;
        } else if tlen >= 6 {
            score += 3;
        }
        // Path looks like a content detail (not a bare index).
        if path_looks_like_content(&item.url) {
            score += 12;
        }
        // File-like URLs are high-signal for download providers.
        if url_looks_file_like(&item.url) {
            score += 20;
        }
        ranked.push(Ranked {
            score,
            order,
            item,
        });
        order += 1;
    }

    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.order.cmp(&b.order))
    });
    ranked
        .into_iter()
        .take(MAX_RESULTS)
        .map(|r| r.item)
        .collect()
}

/// Turn one `<a>` into a scraped result, or `None` if it should be dropped.
fn scrape_anchor(
    el: &ElementRef<'_>,
    base: Option<&reqwest::Url>,
    base_url: &str,
) -> Option<ScrapedResult> {
    let href = el.value().attr("href").map(str::trim)?;
    let url = resolve_http_url(href, base)?;
    if url == base_url {
        return None;
    }
    let title = normalize_title(&el.text().collect::<String>());
    if title.is_empty() {
        return None;
    }
    if is_chrome_anchor(&title) {
        return None;
    }
    Some(ScrapedResult { title, url })
}

/// True when `el` sits under nav / header / footer / aside chrome.
fn is_in_chrome_region(el: &ElementRef<'_>) -> bool {
    let mut node = el.parent();
    while let Some(n) = node {
        if let Some(parent) = ElementRef::wrap(n) {
            let name = parent.value().name().to_ascii_lowercase();
            if matches!(
                name.as_str(),
                "nav" | "header" | "footer" | "aside"
            ) {
                return true;
            }
            let role = parent
                .value()
                .attr("role")
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(
                role.as_str(),
                "navigation" | "banner" | "contentinfo" | "complementary"
            ) {
                return true;
            }
            let class = parent
                .value()
                .attr("class")
                .unwrap_or("")
                .to_ascii_lowercase();
            let id = parent.value().attr("id").unwrap_or("").to_ascii_lowercase();
            for token in class.split_whitespace().chain(std::iter::once(id.as_str())) {
                if matches!(
                    token,
                    "menu"
                        | "navbar"
                        | "nav-bar"
                        | "site-nav"
                        | "main-nav"
                        | "topnav"
                        | "sidebar"
                        | "side-bar"
                        | "footer"
                        | "site-footer"
                        | "header"
                        | "site-header"
                        | "breadcrumb"
                        | "breadcrumbs"
                        | "pagination"
                        | "pager"
                        | "social"
                        | "social-links"
                ) {
                    return true;
                }
            }
        }
        node = n.parent();
    }
    false
}

/// True when `el` sits under a main / article / results-like container.
fn is_in_results_region(el: &ElementRef<'_>) -> bool {
    let mut node = el.parent();
    while let Some(n) = node {
        if let Some(parent) = ElementRef::wrap(n) {
            let name = parent.value().name().to_ascii_lowercase();
            if matches!(name.as_str(), "main" | "article") {
                return true;
            }
            let role = parent
                .value()
                .attr("role")
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(role.as_str(), "main" | "list" | "feed" | "article") {
                return true;
            }
            let class = parent
                .value()
                .attr("class")
                .unwrap_or("")
                .to_ascii_lowercase();
            let id = parent.value().attr("id").unwrap_or("").to_ascii_lowercase();
            let hay = format!("{id} {class}");
            for key in [
                "results",
                "result-list",
                "search-results",
                "searchresults",
                "search_results",
                "game-list",
                "gamelist",
                "rom-list",
                "romlist",
                "entries",
                "item-list",
            ] {
                if hay.split_whitespace().any(|t| t == key || t.contains(key)) {
                    return true;
                }
            }
        }
        node = n.parent();
    }
    false
}

/// Path segments that look like content pages rather than bare indexes.
fn path_looks_like_content(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else {
        return false;
    };
    let path = u.path();
    let segs: Vec<_> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    if segs.len() >= 2 {
        return true;
    }
    if let Some(last) = segs.last() {
        // single slug with a hyphen or long name
        if last.contains('-') || last.len() >= 8 {
            return true;
        }
    }
    false
}

fn url_looks_file_like(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    const EXTS: &[&str] = &[
        ".zip", ".7z", ".rar", ".nes", ".sfc", ".smc", ".gb", ".gbc", ".gba", ".n64",
        ".z64", ".md", ".gen", ".iso", ".chd", ".nds",
    ];
    EXTS.iter().any(|e| path.ends_with(e))
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
    // Unwrap meta-search redirect wrappers so the UI/open/download see the real target.
    Some(unwrap_redirect_wrapper(resolved.to_string()))
}

/// Peel known SERP redirect wrappers (DuckDuckGo `uddg=`, etc.) to the destination URL.
/// Leaves the input unchanged when no wrapper is recognized.
pub fn unwrap_redirect_wrapper(url: String) -> String {
    let Ok(u) = reqwest::Url::parse(&url) else {
        return url;
    };
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    // DuckDuckGo HTML/lite: /l/?uddg=https%3A%2F%2Fexample.com%2F...
    if host.contains("duckduckgo.com") {
        for (k, v) in u.query_pairs() {
            if k == "uddg" {
                let dest = v.to_string();
                if dest.starts_with("http://") || dest.starts_with("https://") {
                    return dest;
                }
            }
        }
    }
    // Yandex sometimes uses /clck/jsredir?…&u=… (best-effort; captcha usually blocks first).
    if host.contains("yandex.") {
        for (k, v) in u.query_pairs() {
            if k == "u" || k == "url" {
                let dest = v.to_string();
                if dest.starts_with("http://") || dest.starts_with("https://") {
                    return dest;
                }
                // percent-encoded nested URL
                if let Ok(decoded) = percent_encoding::percent_decode_str(&dest).decode_utf8() {
                    if decoded.starts_with("http://") || decoded.starts_with("https://") {
                        return decoded.into_owned();
                    }
                }
            }
        }
    }
    url
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
    fn unwraps_duckduckgo_uddg_redirect_to_destination() {
        let wrapped = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Farchive.org%2Fdetails%2Fsonic1&rut=abc";
        assert_eq!(
            unwrap_redirect_wrapper(wrapped.to_string()),
            "https://archive.org/details/sonic1"
        );
        // Non-wrapper unchanged
        assert_eq!(
            unwrap_redirect_wrapper("https://archive.org/details/x".into()),
            "https://archive.org/details/x"
        );
    }

    #[test]
    fn extract_links_unwraps_ddg_redirects_in_hrefs() {
        let html = r#"<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fvimm.net%2Fvault%2FGenesis">Vimm's Lair Genesis</a>"#;
        let out = extract_links(html, "https://html.duckduckgo.com/html/?q=sonic");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].url, "https://vimm.net/vault/Genesis");
        assert!(out[0].title.contains("Vimm"));
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

    #[test]
    fn structure_aware_prefers_main_over_nav() {
        let html = r#"
          <html><body>
            <nav>
              <a href="https://x.example.com/roms">ROMs</a>
              <a href="https://x.example.com/emulators">Emulators</a>
            </nav>
            <main class="results">
              <a href="https://x.example.com/game/sonic-usa">Sonic the Hedgehog (USA)</a>
              <a href="https://x.example.com/game/sonic-eu">Sonic the Hedgehog (Europe)</a>
            </main>
            <footer><a href="https://x.example.com/privacy">Privacy</a></footer>
          </body></html>
        "#;
        let out = extract_links(html, BASE);
        let titles: Vec<_> = out.iter().map(|r| r.title.as_str()).collect();
        assert!(
            titles.iter().any(|t| t.contains("Sonic")),
            "expected game titles, got {titles:?}"
        );
        assert!(
            !titles.iter().any(|t| *t == "ROMs" || *t == "Emulators" || *t == "Privacy"),
            "nav/footer leaked: {titles:?}"
        );
        // Main hits should rank first
        assert!(out[0].title.contains("Sonic"), "{out:?}");
    }

    #[test]
    fn ddg_profile_prefers_result_a_class() {
        let html = r#"
          <html><body>
            <a href="https://duckduckgo.com/about">About DDG</a>
            <div class="results">
              <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Farchive.org%2Fdetails%2Fsonic">
                Sonic on Archive.org
              </a>
              <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fvimm.net%2Fvault">
                Vimm's Lair
              </a>
            </div>
          </body></html>
        "#;
        let out = extract_links(html, "https://html.duckduckgo.com/html/?q=sonic");
        assert_eq!(out.len(), 2, "{out:?}");
        assert!(out[0].url.contains("archive.org") || out[0].url.contains("vimm.net"));
        assert!(!out.iter().any(|r| r.title.contains("About")));
    }

    #[test]
    fn archive_org_profile_keeps_details_links() {
        let html = r#"
          <html><body>
            <a href="/about">About</a>
            <a href="/details/sonic_the_hedgehog_genesis">Sonic the Hedgehog</a>
            <a href="/details/">All details</a>
          </body></html>
        "#;
        let out = extract_links(html, "https://archive.org/search?query=sonic");
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].url.contains("/details/sonic"));
    }

    #[test]
    fn assess_captcha_and_empty() {
        assert_eq!(
            assess_serp_health(
                r#"<html><body><div class="smartcaptcha">verify</div></body></html>"#,
                &[]
            ),
            SerpHealth::Captcha
        );
        assert_eq!(
            assess_serp_health(
                r#"<html><body><div id="root"></div><script src="/app.js"></script></body></html>"#,
                &[]
            ),
            SerpHealth::JsShell
        );
        assert_eq!(
            assess_serp_health("<html><body><p>No results</p></body></html>", &[]),
            SerpHealth::Empty
        );
        let links = vec![ScrapedResult {
            title: "Game".into(),
            url: "https://x.example.com/g".into(),
        }];
        assert_eq!(
            assess_serp_health("<html><body>ok</body></html>", &links),
            SerpHealth::Ok
        );
    }
}
