//! Search-provider IPC adapters (W9 / W17 / v0.16 "Trove"). Thin
//! `#[tauri::command]` wrappers that delegate to `core::search` and
//! `db::repo::search_providers`.
//!
//! **Design contract (architecture-design.md §2.5; download-search-design.md):**
//! - v0.16 evolves `run_search`: it now fetches each enabled provider's public
//!   search-results page and scrapes the candidate links so the UI can **preview
//!   what the provider found**. The invariant that matters is unchanged —
//!   Harmony **never downloads the content itself**; it surfaces links the user
//!   opens in their own browser.
//! - Each provider is fetched concurrently; a fetch failure degrades that
//!   provider to "no preview" (its `searchUrl` is still offered) rather than
//!   failing the whole search.
//! - `directDownload` is a per-vendor capability flag — v0.16 ships the flag and
//!   its plumbing only; no direct-download action exists yet.
//! - The provider list ships **empty** — users add providers manually via
//!   `add_provider`.

use tauri::State;

use crate::core::search::{catalog, fetch, liveness, provider as provider_core, template};
use crate::db::{
    repo::{
        search_providers::{NewSearchProvider, SearchProvidersRepo},
        Repository,
    },
    Db,
};
use crate::error::{AppError, AppResult};

// ── DTOs returned over IPC ────────────────────────────────────────────────────

/// A search provider as returned to the frontend (mirrors TS `SearchProvider`).
#[derive(serde::Serialize)]
pub struct SearchProvider {
    pub id: i64,
    pub name: String,
    #[serde(rename = "urlTemplate")]
    pub url_template: String,
    pub enabled: bool,
    /// `"reference"` (metadata/info) or `"download"` (links to legal homes for
    /// downloadable content). The UI groups + labels providers by this.
    pub kind: String,
    /// Per-vendor opt-in for the future direct-download feature (v0.16
    /// scaffolding). `false` by default; no direct-download action exists yet.
    #[serde(rename = "directDownload")]
    pub direct_download: bool,
    /// Per-vendor opt-in (v0.18): append the structured search filters
    /// (console, region) to this provider's query before substitution.
    #[serde(rename = "composeFilters")]
    pub compose_filters: bool,
}

/// A single scraped preview link from a provider's results page (mirrors TS
/// `SearchResultItem`). The UI opens this URL in the system browser.
#[derive(serde::Serialize)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
}

/// The previewed results for one provider (mirrors TS `ProviderResults`).
///
/// `search_url` is the constructed provider search-page link — always present,
/// so the UI can offer "open the full results page" even when scraping yields
/// nothing or fails. `items` are the scraped preview links; `error` carries a
/// per-provider fetch/parse failure (the search as a whole still succeeds).
#[derive(serde::Serialize)]
pub struct ProviderResults {
    #[serde(rename = "providerId")]
    pub provider_id: i64,
    #[serde(rename = "providerName")]
    pub provider_name: String,
    #[serde(rename = "searchUrl")]
    pub search_url: String,
    #[serde(rename = "directDownload")]
    pub direct_download: bool,
    pub items: Vec<SearchResultItem>,
    pub error: Option<String>,
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn to_ipc(p: crate::db::repo::search_providers::SearchProvider) -> SearchProvider {
    SearchProvider {
        id: p.id,
        name: p.name,
        url_template: p.url_template,
        enabled: p.enabled,
        kind: p.kind,
        direct_download: p.direct_download,
        compose_filters: p.compose_filters,
    }
}

/// Build the effective query for one provider. When the provider opted into
/// filter composition (v0.18), the non-empty structured filters (console,
/// region) are appended to the game-name query, narrowing the search at the
/// source; otherwise the bare game name is used.
fn effective_query(query: &str, console: &str, region: &str, compose: bool) -> String {
    if !compose {
        return query.to_string();
    }
    let mut parts: Vec<&str> = vec![query.trim()];
    for filter in [console.trim(), region.trim()] {
        if !filter.is_empty() {
            parts.push(filter);
        }
    }
    parts
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Build one provider's preview group: substitute the query into its template,
/// fetch + scrape the results page, and map any failure to a per-provider error.
/// Pure of `State`/`Db` so it can run on a worker thread (see `run_search`).
fn provider_results(
    p: &crate::db::repo::search_providers::SearchProvider,
    query: &str,
    console: &str,
    region: &str,
) -> ProviderResults {
    let effective = effective_query(query, console, region, p.compose_filters);
    let search_url = match template::substitute(&p.url_template, &effective) {
        Ok(url) => url,
        Err(e) => {
            return ProviderResults {
                provider_id: p.id,
                provider_name: p.name.clone(),
                search_url: String::new(),
                direct_download: p.direct_download,
                items: Vec::new(),
                error: Some(e.to_string()),
            };
        }
    };
    let (items, error) = match fetch::fetch_results(&search_url) {
        Ok(found) => (
            found
                .into_iter()
                .map(|r| SearchResultItem {
                    title: r.title,
                    url: r.url,
                })
                .collect(),
            None,
        ),
        Err(e) => (Vec::new(), Some(e.to_string())),
    };
    ProviderResults {
        provider_id: p.id,
        provider_name: p.name.clone(),
        search_url,
        direct_download: p.direct_download,
        items,
        error,
    }
}

// ── commands ──────────────────────────────────────────────────────────────────

/// List all search providers ordered by id.
#[tauri::command]
pub fn list_providers(db: State<'_, Db>) -> AppResult<Vec<SearchProvider>> {
    let repo = SearchProvidersRepo::new(db.inner());
    repo.list().map(|ps| ps.into_iter().map(to_ipc).collect())
}

/// Add a new search provider. Returns the created provider.
/// Validates that `url_template` is non-empty and contains `{query}`.
#[tauri::command]
pub fn add_provider(
    name: String,
    url_template: String,
    kind: Option<String>,
    direct_download: Option<bool>,
    compose_filters: Option<bool>,
    db: State<'_, Db>,
) -> AppResult<SearchProvider> {
    provider_core::validate_template(&url_template)?;
    let repo = SearchProvidersRepo::new(db.inner());
    let id = repo.add(&NewSearchProvider {
        name,
        url_template,
        enabled: true,
        // v0.20: the dialog/catalog can specify kind; default reference when the
        // caller doesn't (a plain user-added provider).
        kind: normalize_kind(kind.as_deref()),
        // Direct download is opt-in per vendor; off unless explicitly set.
        direct_download: direct_download.unwrap_or(false),
        // Filter composition is opt-in per vendor (v0.18); off by default.
        compose_filters: compose_filters.unwrap_or(false),
    })?;
    repo.get(id).map(to_ipc)
}

/// Normalize an optional caller-supplied `kind` to a known value, defaulting to
/// `"reference"` (only `"download"` and `"reference"` are valid).
fn normalize_kind(kind: Option<&str>) -> String {
    match kind {
        Some("download") => "download".to_string(),
        _ => "reference".to_string(),
    }
}

/// Update an existing provider's fields (all optional). Returns the updated provider.
// Tauri commands receive their args positionally from the IPC payload, so the
// optional-field set is naturally wide; grouping them into a struct would only
// move the deserialization boilerplate.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_provider(
    id: i64,
    name: Option<String>,
    url_template: Option<String>,
    enabled: Option<bool>,
    kind: Option<String>,
    direct_download: Option<bool>,
    compose_filters: Option<bool>,
    db: State<'_, Db>,
) -> AppResult<SearchProvider> {
    if let Some(ref t) = url_template {
        provider_core::validate_template(t)?;
    }
    let repo = SearchProvidersRepo::new(db.inner());
    if let Some(n) = name {
        repo.rename(id, &n)?;
    }
    if let Some(t) = url_template {
        repo.set_url_template(id, &t)?;
    }
    if let Some(e) = enabled {
        repo.set_enabled(id, e)?;
    }
    if let Some(k) = kind {
        repo.set_kind(id, &normalize_kind(Some(&k)))?;
    }
    if let Some(d) = direct_download {
        repo.set_direct_download(id, d)?;
    }
    if let Some(c) = compose_filters {
        repo.set_compose_filters(id, c)?;
    }
    repo.get(id).map(to_ipc)
}

/// Remove a search provider by id.
#[tauri::command]
pub fn remove_provider(id: i64, db: State<'_, Db>) -> AppResult<()> {
    let repo = SearchProvidersRepo::new(db.inner());
    repo.delete(id)
}

/// Run a search and preview each provider's results.
///
/// For every selected provider, the query is substituted into its URL template,
/// the resulting search page is fetched, and its candidate links are scraped for
/// an in-app preview. **Harmony never downloads the content itself** — each
/// previewed link is opened by the user in their own browser. Providers are
/// fetched concurrently; a per-provider failure surfaces as that group's `error`
/// and never fails the whole search. If `provider_id` is supplied, only that
/// provider is used; otherwise all enabled providers are used.
#[tauri::command]
pub fn run_search(
    query: String,
    console: Option<String>,
    region: Option<String>,
    provider_id: Option<i64>,
    db: State<'_, Db>,
) -> AppResult<Vec<ProviderResults>> {
    if query.trim().is_empty() {
        return Err(AppError::Validation("query must not be empty".to_string()));
    }
    let console = console.unwrap_or_default();
    let region = region.unwrap_or_default();
    let repo = SearchProvidersRepo::new(db.inner());
    let providers = if let Some(pid) = provider_id {
        vec![repo.get(pid)?]
    } else {
        repo.list()?.into_iter().filter(|p| p.enabled).collect()
    };

    // Fetch every provider concurrently so total latency is bounded by the
    // slowest single fetch, not their sum. Each scrape is self-contained and the
    // scraper's HTML types never cross the thread boundary (only the owned
    // `ProviderResults` does), so a scoped thread per provider is safe.
    let groups = std::thread::scope(|scope| {
        let (query, console, region) = (&query, &console, &region);
        let handles: Vec<_> = providers
            .iter()
            .map(|p| (p, scope.spawn(|| provider_results(p, query, console, region))))
            .collect();
        handles
            .into_iter()
            .map(|(p, h)| {
                // A panicking worker degrades just that provider's group to an
                // error result — matches this function's own documented contract
                // ("a per-provider failure ... never fails the whole search")
                // instead of panicking the entire command via `.expect()`.
                h.join().unwrap_or_else(|_| ProviderResults {
                    provider_id: p.id,
                    provider_name: p.name.clone(),
                    search_url: String::new(),
                    direct_download: p.direct_download,
                    items: Vec::new(),
                    error: Some("search worker thread panicked".to_string()),
                })
            })
            .collect()
    });
    Ok(groups)
}

// ── Provider discovery (v0.20 "Atlas") ────────────────────────────────────────

/// The result of validating a provider's URL template against a sample query.
#[derive(serde::Serialize)]
pub struct ProviderValidation {
    #[serde(rename = "searchUrl")]
    pub search_url: String,
    #[serde(rename = "linkCount")]
    pub link_count: usize,
    #[serde(rename = "sampleTitles")]
    pub sample_titles: Vec<String>,
    #[serde(rename = "likelyJsRendered")]
    pub likely_js_rendered: bool,
    pub error: Option<String>,
}

/// One catalog entry as returned to the UI, with an `added` flag.
#[derive(serde::Serialize)]
pub struct CatalogEntry {
    pub name: String,
    #[serde(rename = "urlTemplate")]
    pub url_template: String,
    pub kind: String,
    pub media: String,
    pub description: String,
    #[serde(rename = "jsRendered")]
    pub js_rendered: bool,
    /// True when a provider with this name or template is already configured.
    pub added: bool,
}

/// Validate a provider's URL template (v0.20 "Test provider"). Substitutes a
/// sample query, fetches the resulting search page, and reports how many
/// scrapeable links it found (with a few sample titles) plus a guess at whether
/// the page is JavaScript-rendered. A fetch failure is returned as `error`, not
/// a thrown command error, so the dialog can show it inline. Like `run_search`,
/// this only fetches the public results page — it never downloads content.
#[tauri::command]
pub fn validate_provider(
    url_template: String,
    sample_query: Option<String>,
) -> AppResult<ProviderValidation> {
    provider_core::validate_template(&url_template)?;
    let q = sample_query
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "mario".to_string());
    let search_url = template::substitute(&url_template, &q)?;
    match fetch::fetch_diagnostics(&search_url) {
        Ok(diag) => Ok(ProviderValidation {
            link_count: diag.links.len(),
            sample_titles: diag.links.into_iter().take(5).map(|r| r.title).collect(),
            likely_js_rendered: diag.likely_js_rendered,
            search_url,
            error: None,
        }),
        Err(e) => Ok(ProviderValidation {
            search_url,
            link_count: 0,
            sample_titles: Vec::new(),
            likely_js_rendered: false,
            error: Some(e.to_string()),
        }),
    }
}

/// List the curated provider catalog (v0.20), each entry flagged `added` when a
/// provider with the same name or template is already configured.
#[tauri::command]
pub fn list_provider_catalog(db: State<'_, Db>) -> AppResult<Vec<CatalogEntry>> {
    let repo = SearchProvidersRepo::new(db.inner());
    let existing = repo.list()?;
    Ok(catalog::all()
        .iter()
        .map(|c| CatalogEntry {
            name: c.name.to_string(),
            url_template: c.url_template.to_string(),
            kind: c.kind.to_string(),
            media: c.media.to_string(),
            description: c.description.to_string(),
            js_rendered: c.js_rendered,
            added: existing
                .iter()
                .any(|p| p.name == c.name || p.url_template == c.url_template),
        })
        .collect())
}

/// Probe previewed links for liveness (v0.19 "Reach"). OPT-IN: the frontend only
/// calls this when the user enables the "Check links" toggle. Each URL gets a
/// cheap `HEAD` request classified as alive / dead / unknown — a probe, not a
/// content download (it reads headers only). Bounded by a URL cap, a short
/// timeout, and capped concurrency in `core::search::liveness`.
#[tauri::command]
pub fn probe_links(urls: Vec<String>) -> AppResult<Vec<liveness::LinkStatus>> {
    Ok(liveness::probe_links(&urls))
}

#[cfg(test)]
mod tests {
    use super::{effective_query, ProviderResults};

    /// W220 — a panicking search-worker thread must degrade that provider's
    /// group to an error result, never propagate and crash the whole
    /// `run_search` command. Exercises the exact `join().unwrap_or_else(...)`
    /// pattern `run_search` uses, with a closure that panics on purpose
    /// rather than trying to force a real fetch to panic over the network.
    #[test]
    fn a_panicking_search_worker_degrades_to_an_error_result_instead_of_propagating() {
        let result = std::thread::scope(|scope| {
            let handle = scope.spawn(|| -> ProviderResults { panic!("simulated worker panic") });
            handle.join().unwrap_or_else(|_| ProviderResults {
                provider_id: 7,
                provider_name: "Test Provider".to_string(),
                search_url: String::new(),
                direct_download: false,
                items: Vec::new(),
                error: Some("search worker thread panicked".to_string()),
            })
        });
        assert_eq!(result.provider_id, 7);
        assert!(result.items.is_empty());
        assert_eq!(result.error.as_deref(), Some("search worker thread panicked"));
    }

    #[test]
    fn no_compose_returns_bare_query() {
        assert_eq!(effective_query("super mario", "SNES", "USA", false), "super mario");
    }

    #[test]
    fn compose_appends_non_empty_filters() {
        assert_eq!(
            effective_query("super mario", "SNES", "USA", true),
            "super mario SNES USA"
        );
    }

    #[test]
    fn compose_skips_empty_filters() {
        assert_eq!(effective_query("zelda", "", "", true), "zelda");
        assert_eq!(effective_query("zelda", "N64", "", true), "zelda N64");
        assert_eq!(effective_query("zelda", "", "EUR", true), "zelda EUR");
    }

    #[test]
    fn compose_trims_whitespace() {
        assert_eq!(
            effective_query("  contra  ", "  NES  ", "  USA  ", true),
            "contra NES USA"
        );
    }
}
