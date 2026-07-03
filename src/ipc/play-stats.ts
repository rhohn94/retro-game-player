// Typed wrappers for the "library life" domain (v0.26 W264: favorites,
// recently-played, play-time tracking; docs/design/library-life-design.md).
// Session duration is measured server-side (Rust `Instant`) — callers only
// pass the opaque `sessionId` back to `recordPlayEnd`, never a duration.

import { invoke } from "./invoke";
import type { Game } from "./library";

/**
 * Starts tracking a play session for `gameId`. Call once per play path on
 * entry: in-page player mount, native session start, or external RetroArch
 * spawn. Returns an opaque session id to pass to `recordPlayEnd`.
 */
export function recordPlayStart(gameId: number): Promise<number> {
  return invoke<number>("record_play_start", { gameId });
}

/**
 * Ends `sessionId`: the backend computes its server-measured duration and
 * updates the game's `lastPlayedAt` / `playCount` / `totalPlayTimeMs`. A
 * no-op if the session id is unknown (e.g. already ended).
 */
export function recordPlayEnd(sessionId: number): Promise<void> {
  return invoke<void>("record_play_end", { sessionId });
}

/** Sets (or clears) a game's favorite flag. */
export function setFavorite(gameId: number, favorite: boolean): Promise<void> {
  return invoke<void>("set_favorite", { gameId, favorite });
}

/** Lists games played at least once, most-recently-played first. */
export function listRecentlyPlayed(limit: number): Promise<Game[]> {
  return invoke<Game[]>("list_recently_played", { limit });
}

/** Lists favorited games, ordered by display title. */
export function listFavorites(limit: number): Promise<Game[]> {
  return invoke<Game[]>("list_favorites", { limit });
}
