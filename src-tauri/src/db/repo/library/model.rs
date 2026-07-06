//! Row shapes + row-mappers for the library tables (`content_folders` and
//! `games`). `Game` (a persisted row) and `NewGame` (pre-insert input) share
//! most fields; Rust has no field-macro or the struct would break the ~10
//! external call sites that build a `NewGame { folder_id: ..., path: ..., .. }`
//! literal (out of this cleanup's scope), so the two field lists stay
//! declared side by side here — kept in lock-step by [`map_game`] and every
//! `db/repo/library` submodule reading both through the same names.

use rusqlite::Row;

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

/// Map a `content_folders` row.
pub(super) fn map_folder(row: &Row) -> rusqlite::Result<ContentFolder> {
    Ok(ContentFolder {
        id: row.get("id")?,
        path: row.get("path")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        added_at: row.get("added_at")?,
    })
}

/// A user-created library collection (`collections` row, v0.37 W373 —
/// see `docs/design/collections-design.md`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub sort: i64,
}

/// A [`Collection`] paired with its member count, for the collections list
/// view (v0.37 W373). Kept separate from [`Collection`] rather than adding an
/// optional field to it, since a plain `Collection` is also returned
/// standalone (create/rename) where a count has no meaning yet.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct CollectionWithCount {
    pub collection: Collection,
    pub game_count: i64,
}

/// Map a `collections` row (no join).
pub(super) fn map_collection(row: &Row) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get("id")?,
        name: row.get("name")?,
        created_at: row.get("created_at")?,
        sort: row.get("sort")?,
    })
}

/// Map a `games` row.
pub(super) fn map_game(row: &Row) -> rusqlite::Result<Game> {
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
