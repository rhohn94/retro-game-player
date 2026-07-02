// On-demand in-page (EmulatorJS) core IPC (v0.24 W241, #17). The curated
// core catalog lives in Rust (play/ejs_cores.rs, pinned hashes); this surface
// lists it with install state and installs one system's core. See
// docs/design/in-page-play-design.md §7.

import { invoke } from "./invoke";

/** One curated on-demand core (mirrors Rust `InPageCoreDto`). */
export interface InPageCore {
  /** EmulatorJS core name — also the player page's `?core=` value. */
  core: string;
  /** Harmony system keys this core covers. */
  systems: string[];
  installed: boolean;
  sizeBytes: number;
}

/** The on-demand core catalog with per-core installed status. */
export function listInPageCores(): Promise<InPageCore[]> {
  return invoke<InPageCore[]>("list_inpage_cores");
}

/** Downloads + verifies + caches the core covering `system`. Idempotent. */
export function installInPageCore(system: string): Promise<void> {
  return invoke<void>("install_inpage_core", { system });
}
