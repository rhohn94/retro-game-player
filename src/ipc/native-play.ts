// Native play IPC (v0.21 "Bedrock" W214/W215/W216). A native libretro core
// session runs entirely in the Rust backend; the frontend starts/stops it,
// polls decoded RGBA frames to paint onto a <canvas>, and pushes joypad
// input state (NativePlayer.tsx). Mirrors
// docs/design/native-emulation-design.md §3/§4.

import { invoke } from "./invoke";

/** Mirrors the Rust `NativeFrameDto` (commands::native_play). */
export interface NativeFrame {
  width: number;
  height: number;
  /** Base64-encoded RGBA8888 bytes, `width * height * 4` long once decoded. */
  rgbaBase64: string;
}

/** Whether native hosting is enabled (off by default — W215). */
export function getNativePlayEnabled(): Promise<boolean> {
  return invoke<boolean>("get_native_play_enabled");
}

/** Persists the native-play opt-in. */
export function setNativePlayEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_native_play_enabled", { enabled });
}

/** Starts a native session for `gameId`, replacing any session already running. */
export function startNativePlay(gameId: number): Promise<void> {
  return invoke<void>("start_native_play", { gameId });
}

/** Stops the in-flight native session, if any. */
export function stopNativePlay(): Promise<void> {
  return invoke<void>("stop_native_play");
}

/** The most recently produced frame, or `null` if none is available yet. */
export function getNativeFrame(): Promise<NativeFrame | null> {
  return invoke<NativeFrame | null>("get_native_frame");
}

/** Pushes the current joypad bitmask (see `nativeInput.ts`'s `computeJoypadBits`). */
export function setNativeInput(bits: number): Promise<void> {
  return invoke<void>("set_native_input", { bits });
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
