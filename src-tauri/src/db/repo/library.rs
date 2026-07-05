//! Library repository (W3): CRUD for `content_folders` and `games`.
//!
//! Folders own games via a cascading FK, so deleting a folder removes its games.
//! Row shapes mirror the `ContentFolder` / `Game` TS DTOs (architecture §2).

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, OptionalExtension, Row};

/// A scanned content folder (`content_folders` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ContentFolder {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

/// A game's source (`games.source`, v0.31 W310 "Frontier" — see
/// `docs/design/non-retro-library-design.md`). `Rom` is the pre-v0.31 default;
/// the rest are non-retro library rows that launch externally via a
/// `launch_descriptor` rather than through a ROM + core. `Gog`/`Itch` were
/// added in v0.32 W320 (migration `013_gog_itch_sources.sql`); `Crossover`
/// was added in v0.33 W331 (migration `014_crossover_source.sql`) — each
/// extends the `games.source` CHECK list to match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GameSource {
    #[default]
    Rom,
    Steam,
    App,
    Manual,
    Gog,
    Itch,
    Crossover,
}

impl GameSource {
    /// The stored SQLite TEXT value (must match the migration's CHECK list).
    pub fn as_db_str(&self) -> &'static str {
        match self {
            GameSource::Rom => "rom",
            GameSource::Steam => "steam",
            GameSource::App => "app",
            GameSource::Manual => "manual",
            GameSource::Gog => "gog",
            GameSource::Itch => "itch",
            GameSource::Crossover => "crossover",
        }
    }

    /// Parse a stored `games.source` value. Any value outside the CHECK-
    /// enforced set indicates on-disk corruption or a build/schema mismatch —
    /// callers should treat it as an internal error, not silently default.
    pub fn from_db_str(s: &str) -> Option<Self> {
        match s {
            "rom" => Some(GameSource::Rom),
            "steam" => Some(GameSource::Steam),
            "app" => Some(GameSource::App),
            "manual" => Some(GameSource::Manual),
            "gog" => Some(GameSource::Gog),
            "itch" => Some(GameSource::Itch),
            "crossover" => Some(GameSource::Crossover),
            _ => None,
        }
    }
}

/// A game/ROM entry (`games` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Game {
    pub id: i64,
    /// Owning content folder; `None` for non-ROM sources (v0.31 W310).
    pub folder_id: Option<i64>,
    /// ROM path; `None` for non-ROM sources (v0.31 W310).
    pub path: Option<String>,
    /// Emulated system; `None` for non-ROM sources (v0.31 W310).
    pub system: Option<String>,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
    /// Release year, if known (W61; nullable — populated by future enrichment).
    pub year: Option<i64>,
    /// Developer / studio, if known (W61; nullable).
    pub developer: Option<String>,
    /// Publisher, if known (W61; nullable).
    pub publisher: Option<String>,
    /// Alternate titles as a JSON array string, if known (W61; nullable).
    pub aliases: Option<String>,
    /// Wikipedia summary text, if fetched (v0.12 enrichment; nullable).
    pub description: Option<String>,
    /// Canonical Wikipedia article URL, if known (v0.12 enrichment; nullable).
    pub wikipedia_url: Option<String>,
    /// User-toggled favorite flag (v0.26 "library life", W264).
    pub favorite: bool,
    /// Unix epoch seconds of the most recent play session's end, if ever
    /// played (v0.26 "library life", W264).
    pub last_played_at: Option<i64>,
    /// Number of completed play sessions (v0.26 "library life", W264).
    pub play_count: i64,
    /// Cumulative server-measured play time, in milliseconds (v0.26 "library
    /// life", W264).
    pub total_play_time_ms: i64,
    /// Game source: `rom` (default) or a non-retro source (v0.31 W310).
    pub source: GameSource,
    /// JSON launch descriptor for non-`rom` sources; `None` for `rom` rows
    /// (v0.31 W310, see `docs/design/non-retro-library-design.md`).
    pub launch_descriptor: Option<String>,
    /// Source-scoped external identifier (e.g. a Steam appid); `None` for
    /// `rom` rows (v0.31 W310). Unique per `source` where present.
    pub external_id: Option<String>,
}

/// New-folder input (no id; assigned by SQLite).
pub struct NewContentFolder {
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

/// New-game input (no id; assigned by SQLite).
pub struct NewGame {
    /// Owning content folder; `None` for non-ROM sources (v0.31 W310).
    pub folder_id: Option<i64>,
    /// ROM path; `None` for non-ROM sources (v0.31 W310).
    pub path: Option<String>,
    /// Emulated system; `None` for non-ROM sources (v0.31 W310).
    pub system: Option<String>,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
    /// Optional metadata (W61). Defaults to `None` from a scan (no enrichment yet).
    pub year: Option<i64>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub aliases: Option<String>,
    /// Game source; defaults to [`GameSource::Rom`] (v0.31 W310).
    pub source: GameSource,
    /// JSON launch descriptor; required (non-`None`) for non-`rom` sources
    /// (v0.31 W310).
    pub launch_descriptor: Option<String>,
    /// Source-scoped external identifier, e.g. a Steam appid (v0.31 W310).
    pub external_id: Option<String>,
}

/// Repository over the library tables.
pub struct LibraryRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for LibraryRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_folder(row: &Row) -> rusqlite::Result<ContentFolder> {
    Ok(ContentFolder {
        id: row.get("id")?,
        path: row.get("path")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        added_at: row.get("added_at")?,
    })
}

fn map_game(row: &Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        path: row.get("path")?,
        system: row.get("system")?,
        crc32: row.get("crc32")?,
        md5: row.get("md5")?,
        clean_name: row.get("clean_name")?,
        dat_matched: row.get::<_, i64>("dat_matched")? != 0,
        core_hint: row.get("core_hint")?,
        art_path: row.get("art_path")?,
        size_bytes: row.get("size_bytes")?,
        added_at: row.get("added_at")?,
        year: row.get("year")?,
        developer: row.get("developer")?,
        publisher: row.get("publisher")?,
        aliases: row.get("aliases")?,
        description: row.get("description")?,
        wikipedia_url: row.get("wikipedia_url")?,
        favorite: row.get::<_, i64>("favorite")? != 0,
        last_played_at: row.get("last_played_at")?,
        play_count: row.get("play_count")?,
        total_play_time_ms: row.get("total_play_time_ms")?,
        source: {
            let raw: String = row.get("source")?;
            GameSource::from_db_str(&raw).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    format!("unrecognized games.source value: {raw}").into(),
                )
            })?
        },
        launch_descriptor: row.get("launch_descriptor")?,
        external_id: row.get("external_id")?,
    })
}

impl LibraryRepo<'_> {
    // --- content_folders ---

    /// Insert a content folder, returning its assigned id.
    pub fn add_folder(&self, folder: &NewContentFolder) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO content_folders (path, enabled, added_at) VALUES (?1, ?2, ?3)",
                params![folder.path, folder.enabled as i64, folder.added_at],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a folder by id (NotFound if absent).
    pub fn get_folder(&self, id: i64) -> AppResult<ContentFolder> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM content_folders WHERE id = ?1",
                params![id],
                map_folder,
            )
            .map_err(require_found)
        })
    }

    /// Fetch a folder by its exact path, or `None` if not registered. Uses the
    /// `content_folders.path` UNIQUE index — O(log n), not a full scan.
    pub fn get_folder_by_path(&self, path: &str) -> AppResult<Option<ContentFolder>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM content_folders WHERE path = ?1",
                params![path],
                map_folder,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// List all folders ordered by id.
    pub fn list_folders(&self) -> AppResult<Vec<ContentFolder>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT * FROM content_folders ORDER BY id")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], map_folder)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Toggle a folder's enabled flag (NotFound if absent).
    pub fn set_folder_enabled(&self, id: i64, enabled: bool) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE content_folders SET enabled = ?1 WHERE id = ?2",
                    params![enabled as i64, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a folder (cascades to its games). NotFound if absent.
    pub fn delete_folder(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM content_folders WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    // --- games ---

    /// Insert a game, returning its assigned id.
    pub fn add_game(&self, game: &NewGame) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO games (folder_id, path, system, crc32, md5, clean_name, \
                 dat_matched, core_hint, art_path, size_bytes, added_at, \
                 year, developer, publisher, aliases, source, launch_descriptor, \
                 external_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, \
                 ?16, ?17, ?18)",
                params![
                    game.folder_id,
                    game.path,
                    game.system,
                    game.crc32,
                    game.md5,
                    game.clean_name,
                    game.dat_matched as i64,
                    game.core_hint,
                    game.art_path,
                    game.size_bytes,
                    game.added_at,
                    game.year,
                    game.developer,
                    game.publisher,
                    game.aliases,
                    game.source.as_db_str(),
                    game.launch_descriptor,
                    game.external_id,
                ],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Source-aware upsert keyed on `(source, external_id)` (v0.31 W310): a
    /// non-`rom` re-scan (Steam / app / manual) must never create a duplicate
    /// row for a title it has already registered. Requires `external_id`
    /// (the dedup key) — `rom` rows keep using [`Self::add_game`] /
    /// [`Self::find_game_by_hash`], which dedupe on content hash instead.
    /// Returns the existing row's id (updated in place) or a freshly
    /// inserted id.
    pub fn upsert_game_by_source(&self, game: &NewGame) -> AppResult<i64> {
        let external_id = game.external_id.as_deref().ok_or_else(|| {
            crate::error::AppError::Validation(
                "upsert_game_by_source requires external_id".to_string(),
            )
        })?;
        self.db.with_conn(|c| {
            let existing: Option<i64> = c
                .query_row(
                    "SELECT id FROM games WHERE source = ?1 AND external_id = ?2",
                    params![game.source.as_db_str(), external_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(map_sqlite)?;

            if let Some(id) = existing {
                c.execute(
                    "UPDATE games SET clean_name = ?1, art_path = ?2, size_bytes = ?3, \
                     launch_descriptor = ?4, core_hint = ?5 WHERE id = ?6",
                    params![
                        game.clean_name,
                        game.art_path,
                        game.size_bytes,
                        game.launch_descriptor,
                        game.core_hint,
                        id,
                    ],
                )
                .map_err(map_sqlite)?;
                Ok(id)
            } else {
                c.execute(
                    "INSERT INTO games (folder_id, path, system, crc32, md5, clean_name, \
                     dat_matched, core_hint, art_path, size_bytes, added_at, \
                     year, developer, publisher, aliases, source, launch_descriptor, \
                     external_id) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, \
                     ?16, ?17, ?18)",
                    params![
                        game.folder_id,
                        game.path,
                        game.system,
                        game.crc32,
                        game.md5,
                        game.clean_name,
                        game.dat_matched as i64,
                        game.core_hint,
                        game.art_path,
                        game.size_bytes,
                        game.added_at,
                        game.year,
                        game.developer,
                        game.publisher,
                        game.aliases,
                        game.source.as_db_str(),
                        game.launch_descriptor,
                        game.external_id,
                    ],
                )
                .map_err(map_sqlite)?;
                Ok(c.last_insert_rowid())
            }
        })
    }

    /// Re-key a game's `external_id` in place (v0.34 W347): when a source's
    /// key format evolves (CrossOver's `<bottle>/<display-name>` →
    /// `<bottle>/<CFBundleIdentifier>`), the old-keyed row must move to the
    /// new key rather than be left behind for [`Self::upsert_game_by_source`]
    /// to duplicate. A no-op when a row already exists under
    /// `new_external_id` (the transition already happened) or when no row
    /// exists under `old_external_id` (nothing to transition). The row's id
    /// is untouched, so play history and FK references survive. Returns
    /// whether a row was re-keyed.
    pub fn rekey_game_external_id(
        &self,
        source: GameSource,
        old_external_id: &str,
        new_external_id: &str,
    ) -> AppResult<bool> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET external_id = ?3 \
                     WHERE source = ?1 AND external_id = ?2 \
                     AND NOT EXISTS \
                     (SELECT 1 FROM games WHERE source = ?1 AND external_id = ?3)",
                    params![source.as_db_str(), old_external_id, new_external_id],
                )
                .map_err(map_sqlite)?;
            Ok(n > 0)
        })
    }

    /// Fetch a game by its `(source, external_id)` dedup key, or `None` if no
    /// such row exists yet (v0.31 W312). Lets a source-scan IPC command tell
    /// whether an upsert inserted a fresh row or refreshed an existing one,
    /// without re-listing the whole table per discovered game.
    pub fn get_game_by_source_external_id(
        &self,
        source: GameSource,
        external_id: &str,
    ) -> AppResult<Option<Game>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM games WHERE source = ?1 AND external_id = ?2",
                params![source.as_db_str(), external_id],
                map_game,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// Fetch a game by id (NotFound if absent).
    pub fn get_game(&self, id: i64) -> AppResult<Game> {
        self.db.with_conn(|c| {
            c.query_row("SELECT * FROM games WHERE id = ?1", params![id], map_game)
                .map_err(require_found)
        })
    }

    /// Fetch a game by its exact stored path, or `None`. Uses the `games.path`
    /// UNIQUE index — O(log n), not a full table scan.
    pub fn get_game_by_path(&self, path: &str) -> AppResult<Option<Game>> {
        self.db.with_conn(|c| {
            c.query_row("SELECT * FROM games WHERE path = ?1", params![path], map_game)
                .optional()
                .map_err(map_sqlite)
        })
    }

    /// Find a game already in the library by its content hash + system (the
    /// import dedup key — re-importing the same ROM, even from a different
    /// location or filename, resolves to the existing row). Uses `idx_games_crc32`.
    pub fn find_game_by_hash(&self, crc32: &str, system: &str) -> AppResult<Option<Game>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM games WHERE crc32 = ?1 AND system = ?2 LIMIT 1",
                params![crc32, system],
                map_game,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// List games, optionally filtered by system. `None` lists all.
    pub fn list_games(&self, system: Option<&str>) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let collect = |stmt: &mut rusqlite::Statement, p: &[&dyn rusqlite::ToSql]| {
                stmt.query_map(p, map_game)
                    .map_err(map_sqlite)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(map_sqlite)
            };
            match system {
                Some(s) => {
                    let mut stmt = c
                        .prepare("SELECT * FROM games WHERE system = ?1 ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[&s])
                }
                None => {
                    let mut stmt = c
                        .prepare("SELECT * FROM games ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[])
                }
            }
        })
    }

    /// Update a game's denormalized display art path (NotFound if absent).
    pub fn set_game_art(&self, id: i64, art_path: Option<&str>) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET art_path = ?1 WHERE id = ?2",
                    params![art_path, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Update a game's `clean_name` (W12 Familiar enrichment writes the
    /// disambiguated title here). NotFound if absent.
    pub fn set_game_clean_name(&self, id: i64, clean_name: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET clean_name = ?1 WHERE id = ?2",
                    params![clean_name, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Persist Wikipedia-sourced enrichment (description + canonical article URL)
    /// for a game. Either field may be `None` to leave/clear it. NotFound if the
    /// game is absent. Art is set separately via [`Self::set_game_art`].
    pub fn set_game_enrichment(
        &self,
        id: i64,
        description: Option<&str>,
        wikipedia_url: Option<&str>,
    ) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET description = ?1, wikipedia_url = ?2 WHERE id = ?3",
                    params![description, wikipedia_url, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Set (or clear) a game's favorite flag (v0.26 "library life", W264).
    /// NotFound if absent.
    pub fn set_favorite(&self, id: i64, favorite: bool) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET favorite = ?1 WHERE id = ?2",
                    params![favorite as i64, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Record the end of a completed play session (v0.26 "library life",
    /// W264): sets `last_played_at` to `ended_at` (Unix epoch seconds),
    /// increments `play_count`, and accumulates `duration_ms` into
    /// `total_play_time_ms`. Called once per session, after the session's
    /// server-measured duration is known (never a frontend-supplied clock —
    /// see `commands::play_stats`). NotFound if the game is absent.
    pub fn record_play_session(
        &self,
        id: i64,
        ended_at: i64,
        duration_ms: i64,
    ) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET \
                     last_played_at = ?1, \
                     play_count = play_count + 1, \
                     total_play_time_ms = total_play_time_ms + ?2 \
                     WHERE id = ?3",
                    params![ended_at, duration_ms, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// List games that have been played at least once, most-recently-played
    /// first (v0.26 "library life", W264). Games with a `NULL` last-played
    /// timestamp are never played and are excluded rather than sorted last —
    /// callers wanting "never played" games use `list_games` instead.
    pub fn list_recently_played(&self, limit: i64) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare(
                    "SELECT * FROM games WHERE last_played_at IS NOT NULL \
                     ORDER BY last_played_at DESC LIMIT ?1",
                )
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![limit], map_game)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// List favorited games, ordered by display title (v0.26 "library life",
    /// W264).
    pub fn list_favorites(&self, limit: i64) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare(
                    "SELECT * FROM games WHERE favorite = 1 \
                     ORDER BY clean_name COLLATE NOCASE LIMIT ?1",
                )
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![limit], map_game)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Delete a game (cascades to its art_cache rows). NotFound if absent.
    pub fn delete_game(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM games WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    fn folder(path: &str) -> NewContentFolder {
        NewContentFolder {
            path: path.to_string(),
            enabled: true,
            added_at: 100,
        }
    }

    fn game(folder_id: i64, path: &str) -> NewGame {
        NewGame {
            folder_id: Some(folder_id),
            path: Some(path.to_string()),
            system: Some("nes".to_string()),
            crc32: Some("deadbeef".to_string()),
            md5: None,
            clean_name: "Super Game".to_string(),
            dat_matched: true,
            core_hint: Some("mesen".to_string()),
            art_path: None,
            size_bytes: 4096,
            added_at: 200,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source: GameSource::Rom,
            launch_descriptor: None,
            external_id: None,
        }
    }

    /// A non-ROM `NewGame` (v0.31 W310): no folder/path/system, but a
    /// launch descriptor and an external id, so it satisfies the CHECK
    /// invariant and can dedupe via `(source, external_id)`.
    fn non_rom_game(source: GameSource, external_id: &str, clean_name: &str) -> NewGame {
        NewGame {
            folder_id: None,
            path: None,
            system: None,
            crc32: None,
            md5: None,
            clean_name: clean_name.to_string(),
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: 200,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source,
            launch_descriptor: Some(r#"{"kind":"steam","appid":"12345"}"#.to_string()),
            external_id: Some(external_id.to_string()),
        }
    }

    #[test]
    fn folder_crud_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let id = repo.add_folder(&folder("/roms")).unwrap();
        let got = repo.get_folder(id).unwrap();
        assert_eq!(got.path, "/roms");
        assert!(got.enabled);
        repo.set_folder_enabled(id, false).unwrap();
        assert!(!repo.get_folder(id).unwrap().enabled);
        assert_eq!(repo.list_folders().unwrap().len(), 1);
        repo.delete_folder(id).unwrap();
        assert!(matches!(repo.get_folder(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn duplicate_folder_path_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        repo.add_folder(&folder("/roms")).unwrap();
        assert!(matches!(
            repo.add_folder(&folder("/roms")),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn game_crud_and_cascade() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        assert_eq!(repo.get_game(gid).unwrap().clean_name, "Super Game");
        repo.set_game_art(gid, Some("/art/a.png")).unwrap();
        assert_eq!(
            repo.get_game(gid).unwrap().art_path.as_deref(),
            Some("/art/a.png")
        );
        assert_eq!(repo.list_games(Some("nes")).unwrap().len(), 1);
        assert_eq!(repo.list_games(Some("snes")).unwrap().len(), 0);
        assert_eq!(repo.list_games(None).unwrap().len(), 1);
        // Deleting the folder cascades to the game.
        repo.delete_folder(fid).unwrap();
        assert!(matches!(repo.get_game(gid), Err(AppError::NotFound(_))));
    }

    #[test]
    fn game_metadata_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let mut g = game(fid, "/roms/meta.nes");
        g.year = Some(1990);
        g.developer = Some("Nintendo R&D4".to_string());
        g.publisher = Some("Nintendo".to_string());
        g.aliases = Some(r#"["Mario 3","SMB3"]"#.to_string());
        let gid = repo.add_game(&g).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert_eq!(got.year, Some(1990));
        assert_eq!(got.developer.as_deref(), Some("Nintendo R&D4"));
        assert_eq!(got.publisher.as_deref(), Some("Nintendo"));
        assert_eq!(got.aliases.as_deref(), Some(r#"["Mario 3","SMB3"]"#));
    }

    #[test]
    fn scanned_game_has_null_metadata() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/plain.nes")).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert!(got.year.is_none());
        assert!(got.developer.is_none());
        assert!(got.publisher.is_none());
        assert!(got.aliases.is_none());
    }

    #[test]
    fn enrichment_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/enrich.nes")).unwrap();
        // A scanned game starts with no description.
        assert!(repo.get_game(gid).unwrap().description.is_none());
        repo.set_game_enrichment(
            gid,
            Some("A platformer about a plumber."),
            Some("https://en.wikipedia.org/wiki/Super_Mario_Bros."),
        )
        .unwrap();
        let got = repo.get_game(gid).unwrap();
        assert_eq!(got.description.as_deref(), Some("A platformer about a plumber."));
        assert_eq!(
            got.wikipedia_url.as_deref(),
            Some("https://en.wikipedia.org/wiki/Super_Mario_Bros.")
        );
    }

    #[test]
    fn set_enrichment_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.set_game_enrichment(999, Some("x"), None),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn lookup_by_path_and_hash() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap(); // crc deadbeef, nes
        // by path
        assert_eq!(repo.get_game_by_path("/roms/a.nes").unwrap().unwrap().id, gid);
        assert!(repo.get_game_by_path("/roms/missing.nes").unwrap().is_none());
        // by hash + system (the import dedup key)
        assert_eq!(repo.find_game_by_hash("deadbeef", "nes").unwrap().unwrap().id, gid);
        assert!(repo.find_game_by_hash("deadbeef", "snes").unwrap().is_none());
        assert!(repo.find_game_by_hash("00000000", "nes").unwrap().is_none());
        // folder by path
        assert_eq!(repo.get_folder_by_path("/roms").unwrap().unwrap().id, fid);
        assert!(repo.get_folder_by_path("/nope").unwrap().is_none());
    }

    #[test]
    fn delete_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(repo.delete_game(999), Err(AppError::NotFound(_))));
    }

    #[test]
    fn a_scanned_game_starts_with_library_life_defaults() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/fresh.nes")).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert!(!got.favorite);
        assert_eq!(got.last_played_at, None);
        assert_eq!(got.play_count, 0);
        assert_eq!(got.total_play_time_ms, 0);
    }

    #[test]
    fn favorite_toggle_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/fav.nes")).unwrap();
        assert!(!repo.get_game(gid).unwrap().favorite);
        repo.set_favorite(gid, true).unwrap();
        assert!(repo.get_game(gid).unwrap().favorite);
        repo.set_favorite(gid, false).unwrap();
        assert!(!repo.get_game(gid).unwrap().favorite);
    }

    #[test]
    fn set_favorite_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.set_favorite(999, true),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn record_play_session_updates_recency_count_and_duration() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/play.nes")).unwrap();

        repo.record_play_session(gid, 1_000, 5_000).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert_eq!(got.last_played_at, Some(1_000));
        assert_eq!(got.play_count, 1);
        assert_eq!(got.total_play_time_ms, 5_000);

        // A second session accumulates rather than replacing.
        repo.record_play_session(gid, 2_000, 3_000).unwrap();
        let got2 = repo.get_game(gid).unwrap();
        assert_eq!(got2.last_played_at, Some(2_000));
        assert_eq!(got2.play_count, 2);
        assert_eq!(got2.total_play_time_ms, 8_000);
    }

    #[test]
    fn record_play_session_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.record_play_session(999, 1, 1),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn list_recently_played_orders_by_last_played_desc_and_excludes_unplayed() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let never = repo.add_game(&game(fid, "/roms/never.nes")).unwrap();
        let older = repo.add_game(&game(fid, "/roms/older.nes")).unwrap();
        let newer = repo.add_game(&game(fid, "/roms/newer.nes")).unwrap();

        repo.record_play_session(older, 100, 1).unwrap();
        repo.record_play_session(newer, 200, 1).unwrap();

        let recent = repo.list_recently_played(10).unwrap();
        let ids: Vec<i64> = recent.iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![newer, older], "most-recent first");
        assert!(!ids.contains(&never), "never-played games are excluded");
    }

    #[test]
    fn list_recently_played_respects_limit() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        for i in 0..5 {
            let gid = repo
                .add_game(&game(fid, &format!("/roms/g{i}.nes")))
                .unwrap();
            repo.record_play_session(gid, 100 + i, 1).unwrap();
        }
        assert_eq!(repo.list_recently_played(2).unwrap().len(), 2);
    }

    #[test]
    fn list_favorites_orders_by_clean_name_and_excludes_non_favorites() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();

        let mut zelda = game(fid, "/roms/zelda.nes");
        zelda.clean_name = "Zelda".to_string();
        let zelda_id = repo.add_game(&zelda).unwrap();

        let mut mario = game(fid, "/roms/mario.nes");
        mario.clean_name = "Mario".to_string();
        let mario_id = repo.add_game(&mario).unwrap();

        let not_fav = repo.add_game(&game(fid, "/roms/other.nes")).unwrap();

        repo.set_favorite(zelda_id, true).unwrap();
        repo.set_favorite(mario_id, true).unwrap();

        let favorites = repo.list_favorites(10).unwrap();
        let ids: Vec<i64> = favorites.iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![mario_id, zelda_id], "alphabetical by clean_name");
        assert!(!ids.contains(&not_fav));
    }

    // --- v0.31 W310: ROM-less library model ---

    #[test]
    fn a_rom_row_still_round_trips_folder_path_and_system() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let g = repo.get_game(gid).unwrap();
        assert_eq!(g.folder_id, Some(fid));
        assert_eq!(g.path.as_deref(), Some("/roms/a.nes"));
        assert_eq!(g.system.as_deref(), Some("nes"));
        assert_eq!(g.source, GameSource::Rom);
        assert_eq!(g.launch_descriptor, None);
        assert_eq!(g.external_id, None);
    }

    #[test]
    fn a_non_rom_row_persists_with_no_folder_path_or_system() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let gid = repo
            .add_game(&non_rom_game(GameSource::Steam, "12345", "Portal 2"))
            .unwrap();
        let g = repo.get_game(gid).unwrap();
        assert_eq!(g.folder_id, None);
        assert_eq!(g.path, None);
        assert_eq!(g.system, None);
        assert_eq!(g.source, GameSource::Steam);
        assert_eq!(g.external_id.as_deref(), Some("12345"));
        assert!(g.launch_descriptor.is_some());
    }

    // --- v0.32 W320: GOG + itch sources ---

    /// `GameSource::as_db_str` / `from_db_str` round-trip for every variant,
    /// including the W320 GOG/itch and W331 CrossOver additions — this is the
    /// single place both the migration's CHECK list and the enum's wire
    /// mapping must agree.
    #[test]
    fn game_source_db_str_round_trips_every_variant() {
        for source in [
            GameSource::Rom,
            GameSource::Steam,
            GameSource::App,
            GameSource::Manual,
            GameSource::Gog,
            GameSource::Itch,
            GameSource::Crossover,
        ] {
            let db_str = source.as_db_str();
            assert_eq!(GameSource::from_db_str(db_str), Some(source));
        }
    }

    #[test]
    fn from_db_str_rejects_unrecognized_values() {
        assert_eq!(GameSource::from_db_str("epic"), None);
        assert_eq!(GameSource::from_db_str(""), None);
    }

    #[test]
    fn a_gog_row_persists_with_no_folder_path_or_system() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let gid = repo
            .add_game(&non_rom_game(GameSource::Gog, "gog-1207658930", "The Witcher 3"))
            .unwrap();
        let g = repo.get_game(gid).unwrap();
        assert_eq!(g.folder_id, None);
        assert_eq!(g.source, GameSource::Gog);
        assert_eq!(g.external_id.as_deref(), Some("gog-1207658930"));
    }

    #[test]
    fn an_itch_row_persists_with_no_folder_path_or_system() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let gid = repo
            .add_game(&non_rom_game(GameSource::Itch, "user/celeste", "Celeste"))
            .unwrap();
        let g = repo.get_game(gid).unwrap();
        assert_eq!(g.folder_id, None);
        assert_eq!(g.source, GameSource::Itch);
        assert_eq!(g.external_id.as_deref(), Some("user/celeste"));
    }

    /// Acceptance: "either-rom-or-descriptor CHECK invariant enforced with a
    /// repo test" — a row with neither a rom identity (`path` + `system`)
    /// nor a `launch_descriptor` must be rejected at the database level.
    #[test]
    fn check_invariant_rejects_a_row_with_neither_rom_identity_nor_descriptor() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let mut neither = non_rom_game(GameSource::Manual, "x", "Bad Row");
        neither.launch_descriptor = None; // no descriptor AND no path/system
        let result = repo.add_game(&neither);
        assert!(
            result.is_err(),
            "a row with neither identity should violate the CHECK constraint"
        );
    }

    /// A `rom`-sourced row with only `path` set (no `system`) is still
    /// rejected: the CHECK requires BOTH halves of the rom identity.
    #[test]
    fn check_invariant_rejects_path_without_system() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let mut half_identity = non_rom_game(GameSource::Rom, "y", "Half Row");
        half_identity.launch_descriptor = None;
        half_identity.path = Some("/roms/half.nes".to_string());
        // system stays None — CHECK must still fail.
        let result = repo.add_game(&half_identity);
        assert!(result.is_err());
    }

    #[test]
    fn upsert_by_source_inserts_once_then_updates_on_rescan() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);

        let first = non_rom_game(GameSource::Steam, "620", "Portal 2");
        let id = repo.upsert_game_by_source(&first).unwrap();
        assert_eq!(repo.list_games(None).unwrap().len(), 1);

        // A re-scan with a changed clean_name/art must resolve to the SAME
        // row, not create a duplicate.
        let mut rescanned = non_rom_game(GameSource::Steam, "620", "Portal 2 (renamed)");
        rescanned.art_path = Some("/art/portal2.png".to_string());
        let id_again = repo.upsert_game_by_source(&rescanned).unwrap();

        assert_eq!(id, id_again, "re-scan must dedupe to the existing row");
        assert_eq!(repo.list_games(None).unwrap().len(), 1, "no duplicate created");
        let updated = repo.get_game(id).unwrap();
        assert_eq!(updated.clean_name, "Portal 2 (renamed)");
        assert_eq!(updated.art_path.as_deref(), Some("/art/portal2.png"));
    }

    #[test]
    fn upsert_by_source_distinguishes_same_external_id_across_sources() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);

        // Same external_id, different source — must be two distinct rows,
        // since the dedup key is (source, external_id).
        repo.upsert_game_by_source(&non_rom_game(GameSource::Steam, "1", "Steam Game"))
            .unwrap();
        repo.upsert_game_by_source(&non_rom_game(GameSource::App, "1", "App Game"))
            .unwrap();

        assert_eq!(repo.list_games(None).unwrap().len(), 2);
    }

    // --- v0.34 W347: legacy external_id re-key ---

    #[test]
    fn rekey_moves_a_row_to_the_new_key_preserving_id_and_play_history() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let gid = repo
            .upsert_game_by_source(&non_rom_game(
                GameSource::Crossover,
                "Steam/Half-Life 2",
                "Half-Life 2",
            ))
            .unwrap();
        repo.record_play_session(gid, 1_000, 5_000).unwrap();

        let rekeyed = repo
            .rekey_game_external_id(
                GameSource::Crossover,
                "Steam/Half-Life 2",
                "Steam/com.valve.halflife2",
            )
            .unwrap();

        assert!(rekeyed);
        assert_eq!(repo.list_games(None).unwrap().len(), 1, "no duplicate row");
        let moved = repo
            .get_game_by_source_external_id(GameSource::Crossover, "Steam/com.valve.halflife2")
            .unwrap()
            .expect("row must now live under the new key");
        assert_eq!(moved.id, gid, "the row id (and thus its FKs) must survive");
        assert_eq!(moved.last_played_at, Some(1_000));
        assert_eq!(moved.play_count, 1);
        assert_eq!(moved.total_play_time_ms, 5_000);
        assert!(repo
            .get_game_by_source_external_id(GameSource::Crossover, "Steam/Half-Life 2")
            .unwrap()
            .is_none());
    }

    #[test]
    fn rekey_is_a_noop_when_no_row_has_the_old_key() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let rekeyed = repo
            .rekey_game_external_id(GameSource::Crossover, "Steam/Missing", "Steam/com.x.missing")
            .unwrap();
        assert!(!rekeyed);
    }

    #[test]
    fn rekey_is_a_noop_when_a_row_already_holds_the_new_key() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let old_id = repo
            .upsert_game_by_source(&non_rom_game(
                GameSource::Crossover,
                "Steam/Half-Life 2",
                "Half-Life 2",
            ))
            .unwrap();
        let new_id = repo
            .upsert_game_by_source(&non_rom_game(
                GameSource::Crossover,
                "Steam/com.valve.halflife2",
                "Half-Life 2",
            ))
            .unwrap();

        let rekeyed = repo
            .rekey_game_external_id(
                GameSource::Crossover,
                "Steam/Half-Life 2",
                "Steam/com.valve.halflife2",
            )
            .unwrap();

        assert!(!rekeyed, "an occupied new key must never be clobbered");
        assert_eq!(
            repo.get_game(old_id).unwrap().external_id.as_deref(),
            Some("Steam/Half-Life 2")
        );
        assert_eq!(
            repo.get_game(new_id).unwrap().external_id.as_deref(),
            Some("Steam/com.valve.halflife2")
        );
    }

    #[test]
    fn rekey_is_scoped_to_the_given_source() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let gid = repo
            .upsert_game_by_source(&non_rom_game(
                GameSource::App,
                "Steam/Half-Life 2",
                "Half-Life 2",
            ))
            .unwrap();

        let rekeyed = repo
            .rekey_game_external_id(
                GameSource::Crossover,
                "Steam/Half-Life 2",
                "Steam/com.valve.halflife2",
            )
            .unwrap();

        assert!(!rekeyed, "a same-key row under another source is untouched");
        assert_eq!(
            repo.get_game(gid).unwrap().external_id.as_deref(),
            Some("Steam/Half-Life 2")
        );
    }

    #[test]
    fn duplicate_external_id_within_same_source_is_rejected_by_raw_insert() {
        // The partial unique index backstops add_game() too (not just the
        // upsert path) — a second row with the same (source, external_id)
        // via the plain insert path must be rejected.
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        repo.add_game(&non_rom_game(GameSource::Steam, "620", "Portal 2"))
            .unwrap();
        let result = repo.add_game(&non_rom_game(GameSource::Steam, "620", "Portal 2 Dup"));
        assert!(result.is_err());
    }
}
