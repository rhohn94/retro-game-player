// The single IPC chokepoint. The frontend NEVER calls @tauri-apps/api `invoke`
// directly — every command goes through this typed wrapper so the AppError
// union is decoded uniformly. Master contract: architecture-design.md §2.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { decodeAppError } from "./error";

/**
 * Invoke a Rust `#[tauri::command]`, returning its typed result or throwing a
 * typed AppError. `TReturn` is the command's Rust `Ok` payload; raw errors are
 * decoded into the AppError union by `decodeAppError`.
 */
export async function invoke<TReturn>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<TReturn> {
  try {
    return await tauriInvoke<TReturn>(cmd, args);
  } catch (raw) {
    throw decodeAppError(raw);
  }
}
