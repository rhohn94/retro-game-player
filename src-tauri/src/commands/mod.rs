//! Command aggregation — the SINGLE shared edit point for the IPC surface.
//!
//! APPEND-ONLY pattern (master contract architecture-design.md §1.2): each
//! backend work item adds (a) ONE `pub mod <domain>;` line below, and (b) ONE
//! line per command inside the `register_commands!` `generate_handler!` list.
//! No item edits another item's lines, so the integration master merges this
//! file by concatenation — never overwrite.

pub mod health; // W1 — liveness stub (ping)
// --- APPEND DOMAIN MODULE DECLARATIONS BELOW THIS LINE ---
pub mod cores; // W5/W16
pub mod library; // W6/W13
pub mod launch; // W7
pub mod metadata; // W8
pub mod search; // W9/W17
pub mod vibrancy; // W10
pub mod fleet; // W11
pub mod familiar; // W12
// pub mod settings;    // W4/W15
pub mod controllers; // W14
pub mod console; // v0.12 — console catalog (browse + detail + bundled titles)
pub mod play; // v0.15 — in-page WASM emulator ROM delivery
pub mod native_play; // v0.21 "Bedrock" W214 — native libretro core frame delivery

/// Single source of truth for the Tauri invoke_handler. The builder invokes
/// this macro exactly once (in `lib.rs`). Each domain contributes its command
/// paths to the `generate_handler!` list below; that list is the only shared
/// edit point and merges by append.
#[macro_export]
macro_rules! register_commands {
    ($builder:expr) => {
        $builder.invoke_handler(tauri::generate_handler![
            // health (W1)
            $crate::commands::health::ping,
            // --- APPEND COMMAND PATHS BELOW THIS LINE (one per line) ---
            // cores (W5)
            $crate::commands::cores::list_available_cores,
            $crate::commands::cores::list_installed_cores,
            $crate::commands::cores::install_core,
            $crate::commands::cores::update_core,
            $crate::commands::cores::set_active_core,
            // library (W6/W13)
            $crate::commands::library::add_content_folder,
            $crate::commands::library::list_content_folders,
            $crate::commands::library::remove_content_folder,
            $crate::commands::library::scan_folder,
            $crate::commands::library::rescan,
            $crate::commands::library::list_games,
            $crate::commands::library::get_game,
            // library (W51 — create-a-games-folder)
            $crate::commands::library::suggest_games_dir,
            $crate::commands::library::create_games_folder,
            // library (v0.12 — import a game)
            $crate::commands::library::import_games,
            // launch (W7)
            $crate::commands::launch::launch_game,
            $crate::commands::launch::locate_retroarch,
            $crate::commands::launch::set_retroarch_path,
            // metadata (W8; v0.12 enrich_game_metadata)
            $crate::commands::metadata::fetch_boxart,
            $crate::commands::metadata::get_cached_art,
            $crate::commands::metadata::enrich_game_metadata,
            // search (W9)
            $crate::commands::search::list_providers,
            $crate::commands::search::add_provider,
            $crate::commands::search::update_provider,
            $crate::commands::search::remove_provider,
            $crate::commands::search::run_search,
            // search liveness probe (v0.19)
            $crate::commands::search::probe_links,
            // provider discovery (v0.20)
            $crate::commands::search::validate_provider,
            $crate::commands::search::list_provider_catalog,
            // vibrancy (W10)
            $crate::commands::vibrancy::get_blurred_hero,
            // fleet (W11)
            $crate::commands::fleet::get_fleet_status,
            // familiar (W12; save_familiar_config glue for W15 settings)
            $crate::commands::familiar::probe_familiar,
            $crate::commands::familiar::enrich_game,
            $crate::commands::familiar::save_familiar_config,
            // controllers (W14)
            $crate::commands::controllers::list_bindings,
            $crate::commands::controllers::set_binding,
            // console catalog (v0.12)
            $crate::commands::console::list_consoles,
            $crate::commands::console::get_console,
            $crate::commands::console::list_catalog_titles,
            // in-page play (v0.15)
            $crate::commands::play::get_play_origin,
            // native play (v0.21 "Bedrock" W214/W215)
            $crate::commands::native_play::get_native_play_enabled,
            $crate::commands::native_play::set_native_play_enabled,
            $crate::commands::native_play::start_native_play,
            $crate::commands::native_play::stop_native_play,
            $crate::commands::native_play::get_native_frame,
            $crate::commands::native_play::set_native_input,
            // save persistence (v0.23 "Continuity" W230)
            $crate::commands::native_play::save_native_state,
            $crate::commands::native_play::load_native_state,
            $crate::commands::native_play::list_game_saves,
            // overlay pause (v0.23 "Continuity" W232)
            $crate::commands::native_play::set_native_paused,
            // attract-mode audio duck (v0.23 "Continuity" W235)
            $crate::commands::native_play::set_native_volume,
        ])
    };
}
