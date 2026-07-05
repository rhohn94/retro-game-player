// Native play IPC (v0.21 "Bedrock" W214/W215/W216). A native libretro core
// session runs entirely in the Rust backend; the frontend starts/stops it,
// polls decoded RGBA frames to paint onto a <canvas>, and pushes joypad
// input state (NativePlayer.tsx). Mirrors
// docs/design/native-emulation-design.md §3/§4.

import { invoke } from "./invoke";

/** Whether native hosting is enabled (off by default — W215). */
export function getNativePlayEnabled(): Promise<boolean> {
  return invoke<boolean>("get_native_play_enabled");
}

/** Persists the native-play opt-in. */
export function setNativePlayEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_native_play_enabled", { enabled });
}

/**
 * One native-hostable system (v0.34 "Engines" W340), mirroring Rust's
 * `NativeSystemDto` — the table-driven successor to the old hard-coded
 * `system === "nes"` check. `coreInstalled` reflects `CoresRepo` state at
 * call time (not re-checked live), matching every other cores-adjacent
 * listing in this app.
 */
export interface NativeSystemInfo {
  system: string;
  coreId: string;
  coreInstalled: boolean;
}

/** Lists every native-hostable system and its current core-install state. */
export function listNativeSystems(): Promise<NativeSystemInfo[]> {
  return invoke<NativeSystemInfo[]>("list_native_systems");
}

/** Options for `startNativePlay` (v0.27 W273). */
export interface StartNativePlayOptions {
  /** Start the session as a NO-TRACE preview (the TV hover-attract surface,
   * tv-mode-design.md §v0.27 → W273 "Purity"): the backend passes
   * `saves: None` (no SRAM load/flush, no exit auto-save-state) and no
   * perf-log path (so a preview never truncates the last real session's
   * `logs/native-perf.log`). Default false — a normal, persisted session. */
  preview?: boolean;
}

/** Starts a native session for `gameId`, replacing any session already running. */
export function startNativePlay(gameId: number, opts: StartNativePlayOptions = {}): Promise<void> {
  return invoke<void>("start_native_play", { gameId, preview: opts.preview ?? false });
}

/** Stops the in-flight native session, if any. */
export function stopNativePlay(): Promise<void> {
  return invoke<void>("stop_native_play");
}

/**
 * Polls the most recent frame as **raw bytes** (W239): a 16-byte header +
 * RGBA8888 pixels, parsed by `nativeFrame.ts`'s `parseFrameBuffer`. Pass the
 * last painted sequence number — an unchanged frame (or no session/frame)
 * comes back as an empty body, so idle polls cost nothing.
 */
export function getNativeFrame(lastSeq: number): Promise<ArrayBuffer | null> {
  return invoke<ArrayBuffer | null>("get_native_frame", { lastSeq });
}

/**
 * Pushes the current joypad bitmask (see `nativeInput.ts`'s
 * `computeJoypadBits`) for `port` (v0.35 "Player Two" W350: ports 0 and 1
 * this release). `port` is optional and backward-compatible — an omitted
 * `port` behaves exactly as it did before ports existed, i.e. port 0, so
 * every pre-W350 call site keeps working unmodified.
 */
export function setNativeInput(bits: number, port?: number): Promise<void> {
  return invoke<void>("set_native_input", { bits, port });
}

/**
 * Releases every port's held buttons in one call — the overlay-open and
 * session-stop "let go of everything" contract (W350,
 * native-emulation-design.md §Multiplayer input). Use this instead of
 * `setNativeInput(0)` when the intent is "release all players", not just
 * port 0.
 */
export function releaseAllNativeInput(): Promise<void> {
  return invoke<void>("release_all_native_input");
}

/** Pauses/resumes the running native session (overlay open = frozen game). */
export function setNativePaused(paused: boolean): Promise<void> {
  return invoke<void>("set_native_paused", { paused });
}

/** Sets the native session's audio gain [0,1] (attract-mode duck, W235). */
export function setNativeVolume(gain: number): Promise<void> {
  return invoke<void>("set_native_volume", { gain });
}

// --- Save persistence (v0.23 "Continuity" W230; save-persistence-design.md) ---

/** A save slot name: manual slots "1"–"4", or the exit auto-save. */
export type SaveSlot = "1" | "2" | "3" | "4" | "auto";

/** One recorded state slot (mirrors Rust `SaveSlotDto`). */
export interface SaveSlotInfo {
  slot: string;
  /** "native" | "ejs" — states only load on the path that wrote them. */
  playPath: string;
  /** Unix seconds. */
  createdAt: number;
}

/** A game's on-disk save inventory (mirrors Rust `GameSavesDto`). */
export interface GameSaves {
  hasSram: boolean;
  slots: SaveSlotInfo[];
}

/** Saves the running native session's state into `slot`. */
export function saveNativeState(slot: SaveSlot): Promise<void> {
  return invoke<void>("save_native_state", { slot });
}

/** Restores `slot` into the running native session. */
export function loadNativeState(slot: SaveSlot): Promise<void> {
  return invoke<void>("load_native_state", { slot });
}

/** Lists a game's saves (SRAM + state slots); works with no session running. */
export function listGameSaves(gameId: number): Promise<GameSaves> {
  return invoke<GameSaves>("list_game_saves", { gameId });
}
