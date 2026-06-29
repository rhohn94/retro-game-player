//! In-page play IPC (v0.15) — hand the frontend the loopback origin where the
//! embedded EmulatorJS host runs. The detail screen embeds
//! `<origin>/player.html?...` in an `<iframe>`; the server itself
//! ([`crate::play::server`]) serves the emulator runtime and the ROM, so the
//! webview never has to read ROM bytes over the `tauri://` scheme (where the
//! emulator's Worker/WASM pipeline fails). Harmony ships no game content — the
//! server only serves files the user imported into their own library.

use crate::play::PlayServer;
use tauri::State;

/// The `http://127.0.0.1:<port>` origin of the in-page play server, or an empty
/// string if the server isn't running (the UI then hides in-page play and the
/// game launches natively instead).
#[tauri::command]
pub fn get_play_origin(server: State<'_, PlayServer>) -> String {
    server.origin().to_string()
}
