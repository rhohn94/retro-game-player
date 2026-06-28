//! Console-catalog IPC adapters (v0.12).
//!
//! Thin `#[tauri::command]` wrappers over the console domain (`core/console`):
//! `list_consoles` (every console with cached media, no network), `get_console`
//! (one console, fetching + caching media on demand), and `list_catalog_titles`
//! (browse a console's bundled title catalog with search + pagination, each
//! title flagged `owned`).
//!
//! DTOs own the camelCase wire shape (architecture-design.md §2); the domain
//! stays Tauri-free.

use crate::config::paths::Paths;
use crate::core::console::{catalog, media, titles};
use crate::db::repo::console_meta::ConsoleMetaRepo;
use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;

/// Wire DTO for a console (static facts + cached media + ownership/catalog counts).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleDto {
    pub key: String,
    pub name: String,
    pub manufacturer: String,
    pub abbreviation: String,
    pub generation: u8,
    pub year: u16,
    /// Main CPU (chip + clock).
    pub cpu: String,
    /// Graphics processor / video chip.
    pub gpu: String,
    /// Main system RAM (display string — units vary across the retro era).
    pub ram: String,
    /// Wikipedia summary text, if fetched/cached (null until then).
    pub description: Option<String>,
    /// Canonical Wikipedia article URL, if cached.
    pub wikipedia_url: Option<String>,
    /// On-disk path to the cached console photo, if any.
    pub image_path: Option<String>,
    /// How many games the user owns for this console.
    pub owned_count: i64,
    /// How many distinct titles the bundled catalog knows for this console.
    pub catalog_count: i64,
}

/// Build a DTO from static facts; counts + media are filled by the caller.
fn base_dto(c: &catalog::ConsoleInfo) -> ConsoleDto {
    ConsoleDto {
        key: c.key.to_string(),
        name: c.name.to_string(),
        manufacturer: c.manufacturer.to_string(),
        abbreviation: c.abbreviation.to_string(),
        generation: c.generation,
        year: c.year,
        cpu: c.cpu.to_string(),
        gpu: c.gpu.to_string(),
        ram: c.ram.to_string(),
        description: None,
        wikipedia_url: None,
        image_path: None,
        owned_count: 0,
        catalog_count: titles::count(c.key) as i64,
    }
}

/// List every console with whatever media is already cached (no network call).
/// The owned count comes from the library; the browse grid renders immediately
/// and the frontend lazily calls `get_console` to fetch any missing photos.
#[tauri::command]
pub async fn list_consoles(db: State<'_, Db>) -> AppResult<Vec<ConsoleDto>> {
    let lib = LibraryRepo::new(&db);
    let meta = ConsoleMetaRepo::new(&db);

    // One pass over the library to tally owned games per system.
    let mut owned: HashMap<String, i64> = HashMap::new();
    for g in lib.list_games(None)? {
        *owned.entry(g.system).or_insert(0) += 1;
    }

    let mut out = Vec::with_capacity(catalog::all().len());
    for c in catalog::all() {
        let mut dto = base_dto(c);
        dto.owned_count = *owned.get(c.key).unwrap_or(&0);
        if let Some(m) = meta.get(c.key)? {
            dto.description = m.description;
            dto.wikipedia_url = m.wikipedia_url;
            dto.image_path = m.image_path;
        }
        out.push(dto);
    }
    Ok(out)
}

/// Fetch one console, downloading + caching its Wikipedia photo + description on
/// first access (best-effort — a fetch miss simply leaves media null).
#[tauri::command]
pub async fn get_console(
    db: State<'_, Db>,
    paths: State<'_, Paths>,
    key: String,
) -> AppResult<ConsoleDto> {
    let console = catalog::require(&key)?;

    // Populate media cache (best-effort; ignore network errors).
    let _ = media::ensure_console_media(&db, &paths, console).await;

    let owned = LibraryRepo::new(&db).list_games(Some(&key))?.len() as i64;
    let mut dto = base_dto(console);
    dto.owned_count = owned;
    if let Some(m) = ConsoleMetaRepo::new(&db).get(&key)? {
        dto.description = m.description;
        dto.wikipedia_url = m.wikipedia_url;
        dto.image_path = m.image_path;
    }
    Ok(dto)
}

/// One catalog title with an ownership flag.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTitleDto {
    pub title: String,
    /// True when the user's library has a game matching this title.
    pub owned: bool,
}

/// A page of a console's title catalog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPageDto {
    pub system: String,
    /// Total titles matching the query (the full set when no query).
    pub total: i64,
    pub offset: i64,
    pub items: Vec<CatalogTitleDto>,
}

/// Browse a console's bundled title catalog with an optional case-insensitive
/// search and pagination. Each returned title is flagged `owned` when the user
/// has a library game whose normalized name matches. `limit` is clamped to
/// 1..=500 so a single page stays bounded.
#[tauri::command]
pub async fn list_catalog_titles(
    db: State<'_, Db>,
    system: String,
    query: Option<String>,
    offset: i64,
    limit: i64,
) -> AppResult<CatalogPageDto> {
    let off = offset.max(0) as usize;
    let lim = limit.clamp(1, 500) as usize;
    let (total, page) = titles::search(&system, query.as_deref(), off, lim);

    // Normalized names of the user's games for this system → ownership flags.
    let owned: HashSet<String> = LibraryRepo::new(&db)
        .list_games(Some(&system))?
        .into_iter()
        .map(|g| titles::normalize(&g.clean_name))
        .collect();

    let items = page
        .into_iter()
        .map(|t| CatalogTitleDto {
            owned: owned.contains(&titles::normalize(t)),
            title: t.to_string(),
        })
        .collect();

    Ok(CatalogPageDto {
        system,
        total: total as i64,
        offset: off as i64,
        items,
    })
}
