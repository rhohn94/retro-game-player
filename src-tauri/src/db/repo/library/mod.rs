//! Library repository (W3): CRUD for `content_folders` and `games`.
//!
//! Folders own games via a cascading FK, so deleting a folder removes its games.
//! Row shapes mirror the `ContentFolder` / `Game` TS DTOs (architecture §2).
//!
//! Split into query-domain submodules (v0.36 W364 cleanup) so no single file
//! carries every `games`-table concern:
//!   * [`model`]       — row shapes + row-mappers, shared by every submodule.
//!   * [`folders`]     — `content_folders` CRUD.
//!   * [`games`]       — `games` CRUD, lookup, and source-dedupe/re-key.
//!   * [`play_life`]   — favoriting + play-session recency/counts (v0.26 W264).
//!   * [`collections`] — user-created collections + membership (v0.37 W373).
//!
//! All five `impl LibraryRepo` blocks below combine into one type; callers
//! outside this module see no difference from the pre-split single file (every
//! public item still resolves at `crate::db::repo::library::*`).

mod collections;
mod folders;
mod games;
mod model;
mod play_life;

pub use games::{path_by_id, system_and_path_by_id};
pub use model::{Collection, CollectionWithCount, ContentFolder, Game, GameSource, NewContentFolder, NewGame};

use super::Repository;
use crate::db::Db;

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

/// Shared test-only fixture builders, used by every query-domain submodule's
/// `#[cfg(test)] mod tests` so each keeps its own focused test list without
/// re-declaring `folder()` / `game()` / `non_rom_game()`.
#[cfg(test)]
pub(super) mod test_support {
    use super::model::{GameSource, NewContentFolder, NewGame};

    pub(crate) fn folder(path: &str) -> NewContentFolder {
        NewContentFolder {
            path: path.to_string(),
            enabled: true,
            added_at: 100,
        }
    }

    pub(crate) fn game(folder_id: i64, path: &str) -> NewGame {
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
    pub(crate) fn non_rom_game(source: GameSource, external_id: &str, clean_name: &str) -> NewGame {
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
}
