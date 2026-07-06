//! User-created library collections (v0.37 W373, query-domain submodule of
//! [`super::LibraryRepo`]; see `docs/design/collections-design.md`). Backs the
//! detail-page "Add to collection" picker, the library collection filter, and
//! the TV collection rails. Reuses the shared [`map_game`] row-mapper (the
//! v0.36 W364 helper) so a collection's member list is a `Game`, identical to
//! every other library listing.

use super::model::{map_collection, map_game, Collection, CollectionWithCount, Game};
use super::LibraryRepo;
use crate::db::repo::{map_sqlite, require_affected, require_found};
use crate::error::AppResult;
use rusqlite::{params, OptionalExtension};

impl LibraryRepo<'_> {
    /// Create a collection, returning its assigned id. A duplicate `name`
    /// surfaces as [`crate::error::AppError::Conflict`] via the `name` UNIQUE
    /// index (map_sqlite).
    pub fn create_collection(&self, name: &str, created_at: i64) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO collections (name, created_at, sort) VALUES (?1, ?2, 0)",
                params![name, created_at],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Rename a collection. NotFound if absent; a collision with another
    /// collection's name surfaces as `Conflict` via the UNIQUE index.
    pub fn rename_collection(&self, id: i64, name: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE collections SET name = ?1 WHERE id = ?2",
                    params![name, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a collection (cascades to its `collection_games` memberships
    /// only — the member games themselves are never touched). NotFound if
    /// absent.
    pub fn delete_collection(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM collections WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Fetch a single collection by id (NotFound if absent).
    pub fn get_collection(&self, id: i64) -> AppResult<Collection> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM collections WHERE id = ?1",
                params![id],
                map_collection,
            )
            .map_err(require_found)
        })
    }

    /// List every collection with its member count, ordered by `sort` then
    /// name. A collection with zero members is still listed here (the picker
    /// and library-filter chip need to show it exists); callers that only
    /// want non-empty collections (e.g. the TV rails) filter on `game_count`.
    pub fn list_collections_with_counts(&self) -> AppResult<Vec<CollectionWithCount>> {
        self.db.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT c.id, c.name, c.created_at, c.sort, \
                        (SELECT count(*) FROM collection_games cg WHERE cg.collection_id = c.id) AS game_count \
                 FROM collections c \
                 ORDER BY c.sort, c.name COLLATE NOCASE",
            ).map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(CollectionWithCount {
                        collection: map_collection(row)?,
                        game_count: row.get("game_count")?,
                    })
                })
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Add a game to a collection. A double-add (the same game already a
    /// member) surfaces as `Conflict` via the `(collection_id, game_id)`
    /// primary key.
    pub fn add_game_to_collection(&self, collection_id: i64, game_id: i64, added_at: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO collection_games (collection_id, game_id, added_at) VALUES (?1, ?2, ?3)",
                params![collection_id, game_id, added_at],
            )
            .map_err(map_sqlite)?;
            Ok(())
        })
    }

    /// Remove a game from a collection. NotFound if it was not a member (or
    /// the collection doesn't exist).
    pub fn remove_game_from_collection(&self, collection_id: i64, game_id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "DELETE FROM collection_games WHERE collection_id = ?1 AND game_id = ?2",
                    params![collection_id, game_id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// List every game in a collection, most-recently-added first. NotFound
    /// if the collection itself doesn't exist (distinguishes "empty
    /// collection" from "no such collection").
    pub fn list_games_by_collection(&self, collection_id: i64) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT 1 FROM collections WHERE id = ?1",
                params![collection_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(map_sqlite)?
            .ok_or_else(|| require_found(rusqlite::Error::QueryReturnedNoRows))?;

            let mut stmt = c
                .prepare(
                    "SELECT g.* FROM games g \
                     JOIN collection_games cg ON cg.game_id = g.id \
                     WHERE cg.collection_id = ?1 \
                     ORDER BY cg.added_at DESC",
                )
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![collection_id], map_game)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// List the ids of every collection `game_id` belongs to — the seed for
    /// the detail-page picker's checked state. Empty for a game in no
    /// collection (not an error).
    pub fn list_collection_ids_for_game(&self, game_id: i64) -> AppResult<Vec<i64>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT collection_id FROM collection_games WHERE game_id = ?1")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map(params![game_id], |row| row.get(0))
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::db::repo::library::test_support::{folder, game};
    use crate::db::repo::library::LibraryRepo;
    use crate::db::repo::Repository;
    use crate::db::Db;
    use crate::error::AppError;

    #[test]
    fn create_rename_delete_collection_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let id = repo.create_collection("Couch co-op", 100).unwrap();
        let got = repo.get_collection(id).unwrap();
        assert_eq!(got.name, "Couch co-op");
        assert_eq!(got.created_at, 100);

        repo.rename_collection(id, "Couch Co-op!").unwrap();
        assert_eq!(repo.get_collection(id).unwrap().name, "Couch Co-op!");

        repo.delete_collection(id).unwrap();
        assert!(matches!(repo.get_collection(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn duplicate_collection_name_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        repo.create_collection("Kids", 0).unwrap();
        assert!(matches!(
            repo.create_collection("Kids", 1),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn renaming_to_an_existing_name_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        repo.create_collection("Kids", 0).unwrap();
        let id2 = repo.create_collection("RPGs", 0).unwrap();
        assert!(matches!(
            repo.rename_collection(id2, "Kids"),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn rename_missing_collection_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.rename_collection(999, "X"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn delete_missing_collection_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(repo.delete_collection(999), Err(AppError::NotFound(_))));
    }

    #[test]
    fn add_and_remove_game_membership_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let cid = repo.create_collection("RPGs", 0).unwrap();

        repo.add_game_to_collection(cid, gid, 10).unwrap();
        let members = repo.list_games_by_collection(cid).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].id, gid);

        repo.remove_game_from_collection(cid, gid).unwrap();
        assert_eq!(repo.list_games_by_collection(cid).unwrap().len(), 0);
    }

    #[test]
    fn double_add_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let cid = repo.create_collection("RPGs", 0).unwrap();
        repo.add_game_to_collection(cid, gid, 10).unwrap();
        assert!(matches!(
            repo.add_game_to_collection(cid, gid, 20),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn remove_membership_that_does_not_exist_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let cid = repo.create_collection("RPGs", 0).unwrap();
        assert!(matches!(
            repo.remove_game_from_collection(cid, gid),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn list_games_by_collection_missing_collection_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.list_games_by_collection(999),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn list_games_by_collection_orders_most_recently_added_first() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let g1 = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let g2 = repo.add_game(&game(fid, "/roms/b.nes")).unwrap();
        let cid = repo.create_collection("RPGs", 0).unwrap();
        repo.add_game_to_collection(cid, g1, 10).unwrap();
        repo.add_game_to_collection(cid, g2, 20).unwrap();

        let members = repo.list_games_by_collection(cid).unwrap();
        assert_eq!(members.iter().map(|g| g.id).collect::<Vec<_>>(), vec![g2, g1]);
    }

    #[test]
    fn list_collections_with_counts_reports_membership_size() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let g1 = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let g2 = repo.add_game(&game(fid, "/roms/b.nes")).unwrap();
        let full = repo.create_collection("RPGs", 0).unwrap();
        let empty = repo.create_collection("Kids", 0).unwrap();
        repo.add_game_to_collection(full, g1, 10).unwrap();
        repo.add_game_to_collection(full, g2, 20).unwrap();

        let all = repo.list_collections_with_counts().unwrap();
        assert_eq!(all.len(), 2);
        let rpgs = all.iter().find(|c| c.collection.id == full).unwrap();
        assert_eq!(rpgs.game_count, 2);
        let kids = all.iter().find(|c| c.collection.id == empty).unwrap();
        assert_eq!(kids.game_count, 0);
    }

    #[test]
    fn list_collection_ids_for_game_reflects_membership() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let c1 = repo.create_collection("RPGs", 0).unwrap();
        let c2 = repo.create_collection("Kids", 0).unwrap();
        repo.add_game_to_collection(c1, gid, 10).unwrap();

        let mut ids = repo.list_collection_ids_for_game(gid).unwrap();
        ids.sort();
        assert_eq!(ids, vec![c1]);
        assert!(!ids.contains(&c2));
    }

    #[test]
    fn deleting_a_collection_never_deletes_its_games() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let cid = repo.create_collection("RPGs", 0).unwrap();
        repo.add_game_to_collection(cid, gid, 10).unwrap();

        repo.delete_collection(cid).unwrap();

        assert!(repo.get_game(gid).is_ok(), "the game must survive the collection's deletion");
    }

    #[test]
    fn deleting_a_game_cleans_its_collection_memberships() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        let cid = repo.create_collection("RPGs", 0).unwrap();
        repo.add_game_to_collection(cid, gid, 10).unwrap();

        repo.delete_game(gid).unwrap();

        assert_eq!(repo.list_games_by_collection(cid).unwrap().len(), 0);
        assert!(repo.get_collection(cid).is_ok(), "the collection must survive the game's deletion");
    }
}
