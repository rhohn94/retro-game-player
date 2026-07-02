// Player-preference IPC (v0.24 W243, #22): in-game volume + pause-on-blur,
// persisted backend-side (AppConfig) so both play paths share them across
// sessions.

import { invoke } from "./invoke";

/** Mirrors the Rust `PlayerPrefsDto`. */
export interface PlayerPrefs {
  /** In-game audio volume [0, 1]. */
  volume: number;
  /** Pause the running game when the window loses focus. */
  pauseOnBlur: boolean;
}

/** The current player preferences. */
export function getPlayerPrefs(): Promise<PlayerPrefs> {
  return invoke<PlayerPrefs>("get_player_prefs");
}

/** Persists the player preferences (volume clamped backend-side). */
export function setPlayerPrefs(prefs: PlayerPrefs): Promise<void> {
  return invoke<void>("set_player_prefs", {
    volume: prefs.volume,
    pauseOnBlur: prefs.pauseOnBlur,
  });
}
