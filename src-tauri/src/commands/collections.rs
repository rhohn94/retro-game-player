//! Collections IPC adapters (v0.37 W373; docs/design/collections-design.md).
//! Thin `#[tauri::command]` wrappers over `LibraryRepo`'s collections
//! submodule, mirroring the repo surface 1:1 (one command per repo method).
//! Adapters own the camelCase wire DTOs (architecture-design.md §2).

use crate::commands::library::GameDto;
use crate::db::repo::library::{CollectionWithCount, LibraryRepo};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
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

/// Create a collection, returning the persisted row. `Conflict` if `name` is
/// already taken.
#[tauri::command]
pub async fn create_collection(db: State<'_, Db>, name: String) -> AppResult<CollectionDto> {
    let repo = LibraryRepo::new(&db);
    let id = repo.create_collection(name.trim(), now_epoch_secs())?;
    Ok(repo.get_collection(id)?.into())
}

/// Rename a collection. `NotFound` if absent; `Conflict` if the new name
/// collides with another collection.
#[tauri::command]
pub async fn rename_collection(db: State<'_, Db>, id: i64, name: String) -> AppResult<()> {
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
}
