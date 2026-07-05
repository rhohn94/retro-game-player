//! `games` CRUD, lookup, and source-dedupe (query-domain submodule of
//! [`super::LibraryRepo`]). [`insert_game_row`] is the one place the `INSERT
//! INTO games` statement is written — [`LibraryRepo::add_game`] and
//! [`LibraryRepo::upsert_game_by_source`]'s insert branch both call it rather
//! than each carrying their own copy (the v0.36 W364 cleanup).

use super::model::{map_game, Game, GameSource, NewGame};
use super::LibraryRepo;
use crate::db::repo::{map_sqlite, require_affected, require_found};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};

/// Resolve a game id to its `(system, path)` columns over an arbitrary
/// already-open connection, or `None` if no such row exists. `None` is also
/// returned for a `rom`-less row (`path`/`system` are `NULL` for non-ROM
/// sources, v0.31 W310) since `rusqlite` cannot populate a `String` from a
/// `NULL` column.
///
/// Takes `&Connection` rather than going through [`LibraryRepo`] /
/// [`crate::db::Db::with_conn`] on purpose: this is the one `games`-table
/// lookup [`crate::play::server`]'s loopback play server needs, and that
/// server deliberately opens its own short-lived **read-only** connection per
/// request (see its module doc) instead of sharing the app's managed [`Db`]
/// mutex — SQLite permits concurrent readers, so a dedicated connection never
/// blocks (or is blocked by) the main writer connection. Centralizing this
/// query here still gets us "no raw SQL against `games` outside `db/repo`"
/// without forcing the play server onto the shared connection.
pub fn system_and_path_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<(String, String)>> {
    conn.query_row(
        "SELECT system, path FROM games WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
}

/// Resolve a game id to its stored ROM `path` alone, over an arbitrary
/// already-open connection. Same rationale as [`system_and_path_by_id`] for
/// taking `&Connection` directly.
pub fn path_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT path FROM games WHERE id = ?1", params![id], |row| {
        row.get(0)
    })
    .optional()
}

/// Insert one `games` row from `game`, returning its assigned id. The sole
/// `INSERT INTO games` call site; shared by [`LibraryRepo::add_game`] and the
/// fresh-row branch of [`LibraryRepo::upsert_game_by_source`].
fn insert_game_row(conn: &Connection, game: &NewGame) -> rusqlite::Result<i64> {
    conn.execute(
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
    )?;
    Ok(conn.last_insert_rowid())
}

impl LibraryRepo<'_> {
    /// Insert a game, returning its assigned id.
    pub fn add_game(&self, game: &NewGame) -> AppResult<i64> {
        self.db
            .with_conn(|c| insert_game_row(c, game).map_err(map_sqlite))
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
            AppError::Validation("upsert_game_by_source requires external_id".to_string())
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
                insert_game_row(c, game).map_err(map_sqlite)
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
    use crate::db::repo::library::test_support::{folder, game, non_rom_game};
    use crate::db::repo::library::{GameSource, LibraryRepo};
    use crate::db::repo::Repository;
    use crate::db::Db;
    use crate::error::AppError;

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
        assert_eq!(repo.get_game_by_path("/roms/a.nes").unwrap().unwrap().id, gid);
        assert!(repo.get_game_by_path("/roms/missing.nes").unwrap().is_none());
        assert_eq!(repo.find_game_by_hash("deadbeef", "nes").unwrap().unwrap().id, gid);
        assert!(repo.find_game_by_hash("deadbeef", "snes").unwrap().is_none());
        assert!(repo.find_game_by_hash("00000000", "nes").unwrap().is_none());
    }

    #[test]
    fn delete_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(repo.delete_game(999), Err(AppError::NotFound(_))));
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
