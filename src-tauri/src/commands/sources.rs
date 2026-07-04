//! Game-source scan IPC adapters (v0.31 W312 "Frontier"). Thin
//! `#[tauri::command]` wrappers over the `core::sources` scanners — each
//! command runs one scanner, upserts every discovered game via
//! `LibraryRepo::upsert_game_by_source`, and returns a summary count so the
//! settings UI can report "discovered N, added M, updated K".

use crate::core::sources::steam::SteamScanner;
use crate::core::sources::{DiscoveredGame, GameSourceScanner};
use crate::db::repo::library::{LibraryRepo, NewGame};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Summary of one game-source scan (wire DTO, camelCase per §2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceScanReportDto {
    /// Total games the scanner found.
    pub discovered: usize,
    /// Newly inserted library rows (no prior row for that `(source, external_id)`).
    pub added: usize,
    /// Existing library rows refreshed by this scan.
    pub updated: usize,
}

/// Current Unix epoch seconds, for `added_at` on newly-discovered rows.
fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Upsert every game a scanner discovered, returning the discovered/added/
/// updated counts. Shared by every source-scan command so each one stays a
/// one-line adapter.
fn upsert_discovered(repo: &LibraryRepo, discovered: Vec<DiscoveredGame>) -> AppResult<SourceScanReportDto> {
    let now = now_epoch_secs();
    let mut added = 0usize;
    let mut updated = 0usize;
    let discovered_count = discovered.len();

    for game in discovered {
        // external_id is always Some for a scanner-discovered game (it's the
        // dedup key every GameSourceScanner impl populates); upsert_game_by_source
        // would itself error on None, so this check just makes the "already
        // existed?" probe below correct rather than duplicating validation.
        let already_existed = match game.external_id.as_deref() {
            Some(ext_id) => repo
                .get_game_by_source_external_id(game.source, ext_id)?
                .is_some(),
            None => false,
        };

        let new_game = NewGame {
            folder_id: None,
            path: None,
            system: None,
            crc32: None,
            md5: None,
            clean_name: game.name,
            dat_matched: false,
            core_hint: None,
            art_path: None,
            size_bytes: 0,
            added_at: now,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
            source: game.source,
            launch_descriptor: Some(game.launch_descriptor.to_string()),
            external_id: game.external_id,
        };
        repo.upsert_game_by_source(&new_game)?;

        if already_existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    Ok(SourceScanReportDto {
        discovered: discovered_count,
        added,
        updated,
    })
}

/// Scan the local Steam installation for installed games (parses
/// `appmanifest_*.acf` under `~/Library/Application Support/Steam/steamapps`;
/// no network calls) and upsert each into the library. A missing Steam
/// installation yields a report with `discovered: 0` rather than an error.
#[tauri::command]
pub async fn scan_steam_source(db: State<'_, Db>) -> AppResult<SourceScanReportDto> {
    let repo = LibraryRepo::new(&db);
    let scanner = SteamScanner::default_location();
    let discovered = scanner.scan()?;
    upsert_discovered(&repo, discovered)
}
