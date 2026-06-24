// Typed IPC wrappers for W7 — RetroArch launch (architecture-design.md §2.3).
//
// Three commands mirror the Rust surface exactly:
//   launch_game        — resolve active core + locate RetroArch + spawn.
//   locate_retroarch   — return the current RetroArch executable path, or null.
//   set_retroarch_path — persist a user-chosen path to AppConfig.
//
// Import from "@/ipc/commands" (the barrel), not directly from this file.

import { invoke } from "./invoke";

/** Launch the game identified by `gameId`. Resolves when the process is spawned.
 *  Throws `AppError` with kind "dependency" if RetroArch is not installed, or
 *  "not_found" if no active core is configured for the game's system. */
export async function launchGame(gameId: number, fullscreen?: boolean): Promise<void> {
  return invoke<void>("launch_game", { gameId, fullscreen });
}

/** Probe for the RetroArch executable. Returns its absolute path, or `null`
 *  if RetroArch is not installed / not found. The frontend uses this to decide
 *  whether to show the "Install RetroArch" / manual-picker affordance. */
export async function locateRetroArch(): Promise<string | null> {
  return invoke<string | null>("locate_retroarch");
}

/** Persist `path` as the user's RetroArch override in AppConfig.
 *  Call this after the user picks an executable via a file-open dialog.
 *  Throws `AppError` with kind "io" if the path does not exist, or
 *  "validation" if `path` is empty. */
export async function setRetroArchPath(path: string): Promise<void> {
  return invoke<void>("set_retroarch_path", { path });
}
