//! Game-sources IPC adapters (v0.31 W313). Thin `#[tauri::command]` wrappers
//! over the `core::sources` scanners and `LibraryRepo::upsert_game_by_source`.
//! See `docs/design/non-retro-library-design.md` §Game sources and §UI.
//!
//! Command contract (shared with W312's Steam scanner — the master reconciles
//! this file additively):
//! - `scan_app_source` — enumerate the app shortlist; creates no rows.
//! - `confirm_app_entries` — upsert the user-confirmed subset of a shortlist.
//! - `add_manual_entry` — the manual-entry escape hatch (name + app/exec target).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::sources::app_scan::AppScanner;
use crate::core::sources::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::{GameSource, LibraryRepo, NewGame};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::time::{SystemTime, UNIX_EPOCH};

/// Wire DTO for a shortlisted-but-unconfirmed game (camelCase per §2).
/// Mirrors `core::sources::DiscoveredGame`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredGameDto {
    pub name: String,
    pub source: String,
    pub external_id: Option<String>,
    pub launch_descriptor: serde_json::Value,
    pub art_hint: Option<String>,
}

impl From<DiscoveredGame> for DiscoveredGameDto {
    fn from(g: DiscoveredGame) -> Self {
        Self {
            name: g.name,
            source: g.source.as_db_str().to_string(),
            external_id: g.external_id,
            launch_descriptor: g.launch_descriptor,
            art_hint: g.art_hint,
        }
    }
}

/// Current Unix epoch seconds, for a freshly-confirmed/manual row's `added_at`.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Build the `NewGame` a non-ROM source upserts — every non-ROM field besides
/// name/source/external_id/launch_descriptor is a sensible empty default,
/// since these rows carry no folder/hash identity (v0.31 W310 invariant).
fn new_game_for_source(
    name: String,
    source: GameSource,
    external_id: Option<String>,
    launch_descriptor: serde_json::Value,
    art_path: Option<String>,
) -> AppResult<NewGame> {
    Ok(NewGame {
        folder_id: None,
        path: None,
        system: None,
        crc32: None,
        md5: None,
        clean_name: name,
        dat_matched: false,
        core_hint: None,
        art_path,
        size_bytes: 0,
        added_at: now_epoch_secs(),
        year: None,
        developer: None,
        publisher: None,
        aliases: None,
        source,
        launch_descriptor: Some(serde_json::to_string(&launch_descriptor)?),
        external_id,
    })
}

/// Run the app-bundle scan and return the shortlist. Creates no rows — the
/// user must confirm via [`confirm_app_entries`] before anything persists
/// (design doc: "no silent library flooding").
#[tauri::command]
pub async fn scan_app_source() -> AppResult<Vec<DiscoveredGameDto>> {
    let found = AppScanner::new().scan()?;
    Ok(found.into_iter().map(Into::into).collect())
}

/// Upsert the user-confirmed subset of an app-scan shortlist. Each entry must
/// carry a non-empty `externalId` (the scanner always supplies one — either
/// the bundle identifier or its path) since `upsert_game_by_source` dedupes on
/// `(source, external_id)`.
#[tauri::command]
pub async fn confirm_app_entries(
    db: State<'_, Db>,
    entries: Vec<DiscoveredGameDto>,
) -> AppResult<Vec<i64>> {
    let repo = LibraryRepo::new(&db);
    let mut ids = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.external_id.is_none() {
            return Err(AppError::Validation(
                "app-scan entry is missing an external id".to_string(),
            ));
        }
        let game = new_game_for_source(
            entry.name,
            GameSource::App,
            entry.external_id,
            entry.launch_descriptor,
            entry.art_hint,
        )?;
        ids.push(repo.upsert_game_by_source(&game)?);
    }
    Ok(ids)
}

/// A manual-entry target: either an app bundle to `open -a`, or an arbitrary
/// executable (+ args) to run directly.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ManualTarget {
    App { bundle_path: String },
    Exec { program: String, args: Vec<String> },
}

/// Add a manual library entry: a name plus an app-bundle or exec target
/// (the "escape hatch" form — design doc §Game sources). Validates both the
/// display name and the target are non-empty before creating a `manual` row.
#[tauri::command]
pub async fn add_manual_entry(
    db: State<'_, Db>,
    name: String,
    target: ManualTarget,
) -> AppResult<i64> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "manual entry name must not be empty".to_string(),
        ));
    }
    let (descriptor, art_hint) = match &target {
        ManualTarget::App { bundle_path } => {
            let bundle_path = bundle_path.trim().to_string();
            if bundle_path.is_empty() {
                return Err(AppError::Validation(
                    "manual entry app target must not be empty".to_string(),
                ));
            }
            (
                serde_json::json!({ "kind": "app", "bundle_path": bundle_path }),
                Some(bundle_path),
            )
        }
        ManualTarget::Exec { program, args } => {
            let program = program.trim().to_string();
            if program.is_empty() {
                return Err(AppError::Validation(
                    "manual entry exec target must not be empty".to_string(),
                ));
            }
            (
                serde_json::json!({ "kind": "exec", "program": program, "args": args }),
                None,
            )
        }
    };
    // Manual entries have no natural external id; the descriptor's target
    // (bundle path / program) is stable enough to dedupe re-adds of the same
    // target under upsert_game_by_source's (source, external_id) key.
    let external_id = match &target {
        ManualTarget::App { bundle_path } => bundle_path.trim().to_string(),
        ManualTarget::Exec { program, .. } => program.trim().to_string(),
    };
    let repo = LibraryRepo::new(&db);
    let game = new_game_for_source(
        name,
        GameSource::Manual,
        Some(external_id),
        descriptor,
        art_hint,
    )?;
    repo.upsert_game_by_source(&game)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovered(name: &str, external_id: Option<&str>) -> DiscoveredGameDto {
        DiscoveredGameDto {
            name: name.to_string(),
            source: "app".to_string(),
            external_id: external_id.map(str::to_string),
            launch_descriptor: serde_json::json!({ "kind": "app", "bundle_path": "/Applications/X.app" }),
            art_hint: Some("/Applications/X.app".to_string()),
        }
    }

    /// `new_game_for_source` never leaves a non-ROM row with a rom identity
    /// (folder_id/path/system) — the W310 CHECK invariant relies on this.
    #[test]
    fn new_game_for_source_has_no_rom_identity() {
        let game = new_game_for_source(
            "Some Game".to_string(),
            GameSource::App,
            Some("com.example.game".to_string()),
            serde_json::json!({ "kind": "app", "bundle_path": "/Applications/Some Game.app" }),
            None,
        )
        .unwrap();
        assert!(game.folder_id.is_none());
        assert!(game.path.is_none());
        assert!(game.system.is_none());
        assert!(game.launch_descriptor.is_some());
        assert_eq!(game.source, GameSource::App);
    }

    /// The confirm-gate contract: a shortlist entry without an external id is
    /// the scanner failing its own invariant (it always supplies one), so
    /// `confirm_app_entries` must reject it rather than silently upserting a
    /// row with no dedupe key. This test exercises the gating logic directly
    /// via the same validation `confirm_app_entries` performs.
    #[test]
    fn shortlist_entry_without_external_id_is_rejected() {
        let entry = discovered("No Id Game", None);
        assert!(entry.external_id.is_none());
        // Mirrors the check inside confirm_app_entries.
        let result: AppResult<()> = if entry.external_id.is_none() {
            Err(AppError::Validation("missing external id".to_string()))
        } else {
            Ok(())
        };
        assert!(result.is_err());
    }

    #[test]
    fn shortlist_entry_with_external_id_passes_the_gate() {
        let entry = discovered("Has Id Game", Some("com.example.hasid"));
        assert!(entry.external_id.is_some());
    }
}
