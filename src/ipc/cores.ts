// Typed wrappers for the `cores` domain (W5). Each function is a thin call
// through the IPC chokepoint `invoke`, mirroring the Rust `#[tauri::command]`
// surface (architecture-design.md §2.2). The frontend imports these from the
// barrel `@/ipc/commands`, never `@tauri-apps/api` directly.

import { invoke } from "./invoke";

/**
 * A libretro core, as both a catalog entry and an installed/active record.
 * Mirrors the Rust `CoreDto` (architecture-design.md §2). `available` is true
 * for every curated core; `installedPath`/`active` reflect on-disk + DB state.
 */
export interface Core {
  id: number;
  system: string;
  coreId: string;
  installedPath: string | null;
  version: string | null;
  lastModified: number | null;
  active: boolean;
  available: boolean;
}

/** The curated catalog (optionally for one system), folding in install state. */
export function listAvailableCores(system?: string): Promise<Core[]> {
  return invoke<Core[]>("list_available_cores", { system });
}

/** Only the cores actually installed on disk. */
export function listInstalledCores(): Promise<Core[]> {
  return invoke<Core[]>("list_installed_cores");
}

/** Download, arch-verify (arm64), install, and persist a core. */
export function installCore(system: string, coreId: string): Promise<Core> {
  return invoke<Core>("install_core", { system, coreId });
}

/** Re-fetch a core if the buildbot copy is newer; re-verify and swap. */
export function updateCore(id: number): Promise<Core> {
  return invoke<Core>("update_core", { id });
}

/** Make an installed core the active one for its system. */
export function setActiveCore(system: string, coreId: string): Promise<Core> {
  return invoke<Core>("set_active_core", { system, coreId });
}
