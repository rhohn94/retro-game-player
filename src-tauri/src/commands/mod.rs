//! Command aggregation — the SINGLE shared edit point for the IPC surface.
//!
//! APPEND-ONLY pattern (master contract architecture-design.md §1.2): each
//! backend work item adds (a) ONE `pub mod <domain>;` line below, and (b) ONE
//! line per command inside the `register_commands!` `generate_handler!` list.
//! No item edits another item's lines, so the integration master merges this
//! file by concatenation — never overwrite.

pub mod health; // W1 — liveness stub (ping)
// --- APPEND DOMAIN MODULE DECLARATIONS BELOW THIS LINE ---
// pub mod library;     // W6/W13
// pub mod cores;       // W5/W16
// pub mod launch;      // W7
// pub mod metadata;    // W8
// pub mod search;      // W9/W17
// pub mod vibrancy;    // W10
// pub mod fleet;       // W11
// pub mod familiar;    // W12
// pub mod settings;    // W4/W15
// pub mod controllers; // W14

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
            // $crate::commands::library::scan_folder,
            // $crate::commands::library::list_games,
        ])
    };
}
