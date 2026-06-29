// In-page play IPC (v0.15). The emulator runtime + ROM are served by a loopback
// HTTP origin inside the app (a real web origin where EmulatorJS's Worker/WASM
// pipeline works, unlike the tauri:// scheme). The frontend only needs that
// origin; it embeds `<origin>/player.html?...` in an iframe.

import { invoke } from "./invoke";

/**
 * The `http://127.0.0.1:<port>` origin of the in-page play server. Empty string
 * when the server isn't running — the caller then hides in-page play and the
 * game falls back to the native launch.
 */
export async function getPlayOrigin(): Promise<string> {
  return invoke<string>("get_play_origin");
}
