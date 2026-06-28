//! Search-provider IPC adapters (W9 / W17). Thin `#[tauri::command]` wrappers
//! that delegate to `core::search` and `db::repo::search_providers`.
//!
//! **Design contract (architecture-design.md §2.5):**
//! - `run_search` returns constructed links **only** — it never fetches URLs
//!   server-side and never auto-downloads anything. The caller opens links in
//!   the system browser. This is a hard requirement.
//! - The provider list ships **empty** — users add providers manually via
//!   `add_provider`.

use tauri::State;

use crate::core::search::{provider as provider_core, template};
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
}

/// A single search result — a constructed link only (mirrors TS `SearchResult`).
/// The UI opens this URL in the system browser; the backend never fetches it.
#[derive(serde::Serialize)]
pub struct SearchResult {
    #[serde(rename = "providerId")]
    pub provider_id: i64,
    #[serde(rename = "providerName")]
    pub provider_name: String,
    pub title: String,
    pub url: String,
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn to_ipc(p: crate::db::repo::search_providers::SearchProvider) -> SearchProvider {
    SearchProvider {
        id: p.id,
        name: p.name,
        url_template: p.url_template,
        enabled: p.enabled,
        kind: p.kind,
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
    db: State<'_, Db>,
) -> AppResult<SearchProvider> {
    provider_core::validate_template(&url_template)?;
    let repo = SearchProvidersRepo::new(db.inner());
    let id = repo.add(&NewSearchProvider {
        name,
        url_template,
        enabled: true,
        // User-added providers are reference-kind by default; the seeded
        // download providers are the curated legal sources (migration 004).
        kind: "reference".to_string(),
    })?;
    repo.get(id).map(to_ipc)
}

/// Update an existing provider's fields (all optional). Returns the updated provider.
#[tauri::command]
pub fn update_provider(
    id: i64,
    name: Option<String>,
    url_template: Option<String>,
    enabled: Option<bool>,
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
    repo.get(id).map(to_ipc)
}

/// Remove a search provider by id.
#[tauri::command]
pub fn remove_provider(id: i64, db: State<'_, Db>) -> AppResult<()> {
    let repo = SearchProvidersRepo::new(db.inner());
    repo.delete(id)
}

/// Construct search links for the given query.
///
/// **Returns links only — never fetches or downloads.** The UI opens each link
/// in the system browser. If `provider_id` is supplied, only that provider is
/// used; otherwise all enabled providers are used.
#[tauri::command]
pub fn run_search(
    query: String,
    provider_id: Option<i64>,
    db: State<'_, Db>,
) -> AppResult<Vec<SearchResult>> {
    if query.trim().is_empty() {
        return Err(AppError::Validation("query must not be empty".to_string()));
    }
    let repo = SearchProvidersRepo::new(db.inner());
    let providers = if let Some(pid) = provider_id {
        vec![repo.get(pid)?]
    } else {
        repo.list()?.into_iter().filter(|p| p.enabled).collect()
    };

    providers
        .into_iter()
        .map(|p| {
            let url = template::substitute(&p.url_template, &query)?;
            Ok(SearchResult {
                provider_id: p.id,
                provider_name: p.name.clone(),
                title: p.name,
                url,
            })
        })
        .collect::<AppResult<Vec<_>>>()
}
