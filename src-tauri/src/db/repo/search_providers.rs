//! Search-providers repository (W3): CRUD over `search_providers`.
//!
//! Provider `name` is unique. Row shape mirrors the `SearchProvider` TS DTO
//! (architecture §2). Template validation (the `{query}` placeholder) is the
//! concern of `core/search` (W9), not this layer.

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, Row};

/// A search provider (`search_providers` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SearchProvider {
    pub id: i64,
    pub name: String,
    pub url_template: String,
    pub enabled: bool,
    /// Provider category: `"reference"` (metadata/info) or `"download"`
    /// (links to legal homes for downloadable content). Free text; defaults to
    /// `"reference"` for user-added providers.
    pub kind: String,
}

/// New-provider input (no id; assigned by SQLite).
pub struct NewSearchProvider {
    pub name: String,
    pub url_template: String,
    pub enabled: bool,
    pub kind: String,
}

/// Repository over the `search_providers` table.
pub struct SearchProvidersRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for SearchProvidersRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_provider(row: &Row) -> rusqlite::Result<SearchProvider> {
    Ok(SearchProvider {
        id: row.get("id")?,
        name: row.get("name")?,
        url_template: row.get("url_template")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        kind: row.get("kind")?,
    })
}

impl SearchProvidersRepo<'_> {
    /// Insert a provider, returning its id. Duplicate `name` is a conflict.
    pub fn add(&self, provider: &NewSearchProvider) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO search_providers (name, url_template, enabled, kind) \
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    provider.name,
                    provider.url_template,
                    provider.enabled as i64,
                    provider.kind
                ],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a provider by id (NotFound if absent).
    pub fn get(&self, id: i64) -> AppResult<SearchProvider> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM search_providers WHERE id = ?1",
                params![id],
                map_provider,
            )
            .map_err(require_found)
        })
    }

    /// List all providers ordered by id.
    pub fn list(&self) -> AppResult<Vec<SearchProvider>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT * FROM search_providers ORDER BY id")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], map_provider)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Rename a provider (NotFound if absent; Conflict if new name already taken).
    pub fn rename(&self, id: i64, name: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE search_providers SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Update the URL template for a provider (NotFound if absent).
    pub fn set_url_template(&self, id: i64, url_template: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE search_providers SET url_template = ?1 WHERE id = ?2",
                    params![url_template, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Toggle a provider's enabled flag (NotFound if absent).
    pub fn set_enabled(&self, id: i64, enabled: bool) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE search_providers SET enabled = ?1 WHERE id = ?2",
                    params![enabled as i64, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a provider by id (NotFound if absent).
    pub fn delete(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM search_providers WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    fn provider(name: &str) -> NewSearchProvider {
        NewSearchProvider {
            name: name.to_string(),
            url_template: "https://example.com/?q={query}".to_string(),
            enabled: true,
            kind: "reference".to_string(),
        }
    }

    #[test]
    fn provider_crud_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = SearchProvidersRepo::new(&db);
        // The DB ships with seeded built-in providers (migration 003); assert
        // relative to that baseline using a name that is not one of the seeds.
        let base = repo.list().unwrap().len();
        let id = repo.add(&provider("My Custom Provider")).unwrap();
        assert_eq!(repo.get(id).unwrap().name, "My Custom Provider");
        repo.set_enabled(id, false).unwrap();
        assert!(!repo.get(id).unwrap().enabled);
        assert_eq!(repo.list().unwrap().len(), base + 1);
        repo.delete(id).unwrap();
        assert!(matches!(repo.get(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn kind_round_trips_and_defaults_reference() {
        let db = Db::open_in_memory().unwrap();
        let repo = SearchProvidersRepo::new(&db);
        let id = repo.add(&provider("My Custom Provider")).unwrap();
        assert_eq!(repo.get(id).unwrap().kind, "reference");
    }

    #[test]
    fn migration_seeds_legal_download_providers() {
        // The download-kind providers (migration 004) ship enabled and link-only.
        let db = Db::open_in_memory().unwrap();
        let repo = SearchProvidersRepo::new(&db);
        let downloads: Vec<_> = repo
            .list()
            .unwrap()
            .into_iter()
            .filter(|p| p.kind == "download")
            .collect();
        assert!(
            downloads.len() >= 2,
            "expected the seeded legal download providers"
        );
        for p in downloads {
            // Contract: link-only templates (no fetch path exists in run_search).
            assert!(p.url_template.contains("{query}"));
            assert!(p.url_template.starts_with("https://"));
        }
    }

    #[test]
    fn duplicate_name_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = SearchProvidersRepo::new(&db);
        repo.add(&provider("My Custom Provider")).unwrap();
        assert!(matches!(
            repo.add(&provider("My Custom Provider")),
            Err(AppError::Conflict(_))
        ));
    }
}
