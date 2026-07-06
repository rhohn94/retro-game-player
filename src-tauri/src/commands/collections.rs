//! Collections IPC adapters (v0.37 W373; docs/design/collections-design.md).
//! Thin `#[tauri::command]` wrappers over `LibraryRepo`'s collections
//! submodule, mirroring the repo surface 1:1 (one command per repo method).
//! Adapters own the camelCase wire DTOs (architecture-design.md §2).

use crate::commands::library::GameDto;
use crate::db::repo::library::{CollectionWithCount, LibraryRepo};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Wire DTO for a collection (camelCase per §2). Mirrors TS `Collection`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDto {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub sort: i64,
}

/// Wire DTO for a collection plus its member count (camelCase per §2).
/// Mirrors TS `CollectionWithCount`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionWithCountDto {
    #[serde(flatten)]
    pub collection: CollectionDto,
    pub game_count: i64,
}

impl From<crate::db::repo::library::Collection> for CollectionDto {
    fn from(c: crate::db::repo::library::Collection) -> Self {
        Self {
            id: c.id,
            name: c.name,
            created_at: c.created_at,
            sort: c.sort,
        }
    }
}

impl From<CollectionWithCount> for CollectionWithCountDto {
    fn from(c: CollectionWithCount) -> Self {
        Self {
            collection: c.collection.into(),
            game_count: c.game_count,
        }
    }
}

/// Current Unix epoch seconds, used to stamp `created_at`/`added_at`.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Reject an empty/whitespace-only collection name with a `Validation`
/// error. The frontend picker already guards this client-side
/// (`isValidNewCollectionName`), but the command must not trust the caller —
/// a direct IPC invocation (or a future non-picker surface) must never be
/// able to persist a blank name.
fn require_nonblank_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() {
        return Err(AppError::Validation(
            "collection name must not be empty".to_string(),
        ));
    }
    Ok(())
}

/// Create a collection, returning the persisted row. `Validation` if `name`
/// is empty/whitespace-only; `Conflict` if `name` is already taken.
#[tauri::command]
pub async fn create_collection(db: State<'_, Db>, name: String) -> AppResult<CollectionDto> {
    require_nonblank_name(&name)?;
    let repo = LibraryRepo::new(&db);
    let id = repo.create_collection(name.trim(), now_epoch_secs())?;
    Ok(repo.get_collection(id)?.into())
}

/// Rename a collection. `Validation` if `name` is empty/whitespace-only;
/// `NotFound` if absent; `Conflict` if the new name collides with another
/// collection.
#[tauri::command]
pub async fn rename_collection(db: State<'_, Db>, id: i64, name: String) -> AppResult<()> {
    require_nonblank_name(&name)?;
    LibraryRepo::new(&db).rename_collection(id, name.trim())
}

/// Delete a collection (cascades to its memberships only; member games are
/// never deleted). `NotFound` if absent.
#[tauri::command]
pub async fn delete_collection(db: State<'_, Db>, id: i64) -> AppResult<()> {
    LibraryRepo::new(&db).delete_collection(id)
}

/// List every collection with its member count, for the library filter chip
/// row and the detail-page picker.
#[tauri::command]
pub async fn list_collections(db: State<'_, Db>) -> AppResult<Vec<CollectionWithCountDto>> {
    Ok(LibraryRepo::new(&db)
        .list_collections_with_counts()?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Add a game to a collection. `Conflict` if already a member (double-add).
#[tauri::command]
pub async fn add_game_to_collection(
    db: State<'_, Db>,
    collection_id: i64,
    game_id: i64,
) -> AppResult<()> {
    LibraryRepo::new(&db).add_game_to_collection(collection_id, game_id, now_epoch_secs())
}

/// Remove a game from a collection. `NotFound` if it was not a member.
#[tauri::command]
pub async fn remove_game_from_collection(
    db: State<'_, Db>,
    collection_id: i64,
    game_id: i64,
) -> AppResult<()> {
    LibraryRepo::new(&db).remove_game_from_collection(collection_id, game_id)
}

/// List every game in a collection, most-recently-added first. `NotFound` if
/// the collection doesn't exist.
#[tauri::command]
pub async fn list_games_by_collection(db: State<'_, Db>, collection_id: i64) -> AppResult<Vec<GameDto>> {
    Ok(LibraryRepo::new(&db)
        .list_games_by_collection(collection_id)?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// List the ids of every collection `game_id` belongs to — seeds the
/// detail-page picker's checked state.
#[tauri::command]
pub async fn list_collection_ids_for_game(db: State<'_, Db>, game_id: i64) -> AppResult<Vec<i64>> {
    LibraryRepo::new(&db).list_collection_ids_for_game(game_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo::library::Collection;

    fn sample_collection() -> Collection {
        Collection {
            id: 1,
            name: "Couch co-op".to_string(),
            created_at: 100,
            sort: 0,
        }
    }

    #[test]
    fn collection_dto_round_trips_fields() {
        let dto: CollectionDto = sample_collection().into();
        assert_eq!(dto.id, 1);
        assert_eq!(dto.name, "Couch co-op");
        assert_eq!(dto.created_at, 100);
        assert_eq!(dto.sort, 0);
    }

    #[test]
    fn collection_with_count_dto_carries_the_count() {
        let dto: CollectionWithCountDto = CollectionWithCount {
            collection: sample_collection(),
            game_count: 3,
        }
        .into();
        assert_eq!(dto.collection.name, "Couch co-op");
        assert_eq!(dto.game_count, 3);
    }

    #[test]
    fn require_nonblank_name_rejects_empty_string() {
        assert!(matches!(
            require_nonblank_name(""),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn require_nonblank_name_rejects_whitespace_only() {
        assert!(matches!(
            require_nonblank_name("   \t  "),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn require_nonblank_name_accepts_a_real_name() {
        assert!(require_nonblank_name("Couch co-op").is_ok());
    }

    // ── Command-level coverage (v0.38 W385) ──────────────────────────────
    //
    // The `#[tauri::command]` wrappers above take `tauri::State`, which this
    // crate has no test-time constructor for outside a full mock app (the
    // `tauri` `test` feature is not enabled here — see the `play_stats`
    // module's `SessionTracker` for the same non-Tauri-testability
    // convention). So these tests exercise the same guard + `LibraryRepo`
    // call sequence the commands perform, against a real in-memory db —
    // equivalent coverage of every success/error path the commands expose,
    // without needing a mock `AppHandle`.

    mod command_flows {
        use super::require_nonblank_name;
        use crate::db::repo::library::{GameSource, LibraryRepo, NewContentFolder, NewGame};
        use crate::db::repo::Repository;
        use crate::db::Db;
        use crate::error::AppError;

        /// Minimal `NewContentFolder` fixture (mirrors the `test_support`
        /// helper other `db::repo::library` submodules share; duplicated
        /// here since that module is `pub(super)`-scoped to `db::repo::library`
        /// and not reachable from `commands::collections`).
        fn folder(path: &str) -> NewContentFolder {
            NewContentFolder {
                path: path.to_string(),
                enabled: true,
                added_at: 100,
            }
        }

        /// Minimal `NewGame` fixture, same rationale as `folder()` above.
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

        /// Mirrors `create_collection`'s body: guard, then create + fetch.
        fn create(repo: &LibraryRepo, name: &str) -> crate::error::AppResult<i64> {
            require_nonblank_name(name)?;
            repo.create_collection(name.trim(), 0)
        }

        /// Mirrors `rename_collection`'s body: guard, then rename.
        fn rename(repo: &LibraryRepo, id: i64, name: &str) -> crate::error::AppResult<()> {
            require_nonblank_name(name)?;
            repo.rename_collection(id, name.trim())
        }

        #[test]
        fn create_persists_and_is_fetchable() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let id = create(&repo, "Couch co-op").unwrap();
            assert_eq!(repo.get_collection(id).unwrap().name, "Couch co-op");
        }

        #[test]
        fn create_rejects_whitespace_only_name_as_validation() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            assert!(matches!(
                create(&repo, "   "),
                Err(AppError::Validation(_))
            ));
        }

        #[test]
        fn create_rejects_duplicate_name_as_conflict() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            create(&repo, "Kids").unwrap();
            assert!(matches!(create(&repo, "Kids"), Err(AppError::Conflict(_))));
        }

        #[test]
        fn rename_updates_the_name() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let id = create(&repo, "Kids").unwrap();
            rename(&repo, id, "Kids games").unwrap();
            assert_eq!(repo.get_collection(id).unwrap().name, "Kids games");
        }

        #[test]
        fn rename_rejects_whitespace_only_name_as_validation() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let id = create(&repo, "Kids").unwrap();
            assert!(matches!(
                rename(&repo, id, "  \n "),
                Err(AppError::Validation(_))
            ));
        }

        #[test]
        fn rename_unknown_id_is_not_found() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            assert!(matches!(
                rename(&repo, 999, "New name"),
                Err(AppError::NotFound(_))
            ));
        }

        #[test]
        fn rename_to_an_existing_name_is_conflict() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            create(&repo, "Kids").unwrap();
            let id = create(&repo, "RPGs").unwrap();
            assert!(matches!(rename(&repo, id, "Kids"), Err(AppError::Conflict(_))));
        }

        #[test]
        fn delete_removes_the_collection() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let id = create(&repo, "Kids").unwrap();
            repo.delete_collection(id).unwrap();
            assert!(matches!(repo.get_collection(id), Err(AppError::NotFound(_))));
        }

        #[test]
        fn delete_unknown_id_is_not_found() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            assert!(matches!(
                repo.delete_collection(999),
                Err(AppError::NotFound(_))
            ));
        }

        #[test]
        fn delete_does_not_delete_member_games() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();
            repo.add_game_to_collection(id, game_id, 0).unwrap();

            repo.delete_collection(id).unwrap();

            assert!(repo.get_game(game_id).is_ok(), "member game must survive collection delete");
        }

        #[test]
        fn add_game_to_collection_then_list_contains_it() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();

            repo.add_game_to_collection(id, game_id, 0).unwrap();

            let members = repo.list_games_by_collection(id).unwrap();
            assert_eq!(members.len(), 1);
            assert_eq!(members[0].id, game_id);
        }

        #[test]
        fn add_game_to_collection_twice_is_conflict() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();
            repo.add_game_to_collection(id, game_id, 0).unwrap();

            assert!(matches!(
                repo.add_game_to_collection(id, game_id, 0),
                Err(AppError::Conflict(_))
            ));
        }

        #[test]
        fn remove_game_from_collection_drops_membership() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();
            repo.add_game_to_collection(id, game_id, 0).unwrap();

            repo.remove_game_from_collection(id, game_id).unwrap();

            assert!(repo.list_games_by_collection(id).unwrap().is_empty());
        }

        #[test]
        fn remove_game_not_a_member_is_not_found() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();

            assert!(matches!(
                repo.remove_game_from_collection(id, game_id),
                Err(AppError::NotFound(_))
            ));
        }

        #[test]
        fn list_games_by_collection_unknown_id_is_not_found() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            assert!(matches!(
                repo.list_games_by_collection(999),
                Err(AppError::NotFound(_))
            ));
        }

        #[test]
        fn list_collections_with_counts_reflects_membership() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();
            repo.add_game_to_collection(id, game_id, 0).unwrap();

            let all = repo.list_collections_with_counts().unwrap();
            let found = all.iter().find(|c| c.collection.id == id).unwrap();
            assert_eq!(found.game_count, 1);
        }

        #[test]
        fn list_collection_ids_for_game_seeds_picker_membership() {
            let db = Db::open_in_memory().unwrap();
            let repo = LibraryRepo::new(&db);
            let folder_id = repo.add_folder(&folder("/games")).unwrap();
            let game_id = repo.add_game(&game(folder_id, "/games/a.zip")).unwrap();
            let id = create(&repo, "Kids").unwrap();
            repo.add_game_to_collection(id, game_id, 0).unwrap();

            let ids = repo.list_collection_ids_for_game(game_id).unwrap();
            assert_eq!(ids, vec![id]);
        }
    }
}
