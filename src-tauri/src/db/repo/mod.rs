//! Repository layer (W3, architecture-design.md §3 notes).
//!
//! One repo per table group, each a thin struct that borrows a [`Db`] handle and
//! exposes CRUD methods returning [`AppResult`]. Repos hold no connection of their
//! own — they call [`Db::with_conn`] so locking lives in one place. Row mapping is
//! the only domain-specific glue; the rest is mechanical and lives here to avoid
//! duplicated boilerplate.
//!
//! Shared model structs (the row shapes) mirror the TS DTOs in
//! `architecture-design.md §2` so the IPC adapters (W5/W6/W8/W9/W14/W15) can
//! serialize repo rows directly.

pub mod art_cache;
pub mod controller_bindings;
pub mod cores;
pub mod library;
pub mod search_providers;
pub mod settings;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::Error as SqliteError;

/// Shared behaviour for every repository: each holds a borrowed [`Db`] handle.
/// Implementors get a uniform constructor and accessor, so the IPC layer treats
/// all repos identically and new repos cost no boilerplate.
pub trait Repository<'a> {
    /// Construct the repo over a borrowed database handle.
    fn new(db: &'a Db) -> Self;
    /// The underlying database handle (for [`Db::with_conn`]).
    fn db(&self) -> &Db;
}

/// Map a rusqlite error into the unified [`AppError`], translating a
/// UNIQUE/constraint violation into [`AppError::Conflict`] (which the IPC layer
/// surfaces as a typed `conflict`) and everything else into [`AppError::Db`].
/// Centralized so every repo reports constraint failures identically.
pub(crate) fn map_sqlite(err: SqliteError) -> AppError {
    if let SqliteError::SqliteFailure(ref e, _) = err {
        if e.code == rusqlite::ErrorCode::ConstraintViolation {
            return AppError::Conflict(err.to_string());
        }
    }
    AppError::Db(err.to_string())
}

/// Translate "no row" into [`AppError::NotFound`]; otherwise defer to
/// [`map_sqlite`]. Used by `get`/`update`/`delete` paths that expect a row.
pub(crate) fn require_found(err: SqliteError) -> AppError {
    match err {
        SqliteError::QueryReturnedNoRows => AppError::NotFound("row not found".to_string()),
        other => map_sqlite(other),
    }
}

/// Map a rows-affected count of 0 to [`AppError::NotFound`], else return `()`.
/// Shared by update/delete so the "did it exist?" check is written once.
pub(crate) fn require_affected(affected: usize) -> AppResult<()> {
    if affected == 0 {
        Err(AppError::NotFound("row not found".to_string()))
    } else {
        Ok(())
    }
}
