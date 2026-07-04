// Typed wrappers for the per-core libretro option GUI backend (v0.29 W282).
// Mirrors `cores.ts`'s shape: thin calls through the IPC chokepoint `invoke`,
// one function per Rust `#[tauri::command]` (architecture-design.md §2.2).
// Native FFI-hosted cores only (currently `fceumm` NES) — RetroArch-external
// and EmulatorJS systems reject with an `unsupported` AppError, which the
// frontend uses to withhold the Core Options entry point entirely (see
// docs/design/core-options-design.md).

import { invoke } from "./invoke";

/**
 * One core-declared libretro option paired with its effective current value
 * (the persisted value, or the core's own declared default when nothing has
 * been persisted yet). Mirrors the Rust `CoreOptionDto`.
 */
export interface CoreOption {
  key: string;
  description: string;
  choices: string[];
  value: string;
}

/**
 * Lists the active native-hosted core's declared options for `system`, each
 * paired with its effective value. Rejects (`unsupported`) for any system
 * that isn't native-FFI-hosted.
 */
export function listCoreOptions(system: string): Promise<CoreOption[]> {
  return invoke<CoreOption[]>("list_core_options", { system });
}

/** Reads one option's persisted value, or `null` if nothing has been saved. */
export function getCoreOption(system: string, optionKey: string): Promise<string | null> {
  return invoke<string | null>("get_core_option", { system, optionKey });
}

/** Persists one option's value. Takes effect on the next boot (no hot-reload). */
export function setCoreOption(system: string, optionKey: string, value: string): Promise<void> {
  return invoke<void>("set_core_option", { system, optionKey, value });
}
