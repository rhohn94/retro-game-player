// Typed wrappers for the `controllers` domain (W14). Thin calls through the IPC
// chokepoint `invoke`, mirroring the Rust `controllers` command surface
// (architecture-design.md §2.10). The frontend imports these from the barrel
// `@/ipc/commands`, never `@tauri-apps/api` directly.

import { invoke } from "./invoke";

/**
 * A persisted controller binding — one `(deviceFamily, action) -> button`
 * override. Mirrors the Rust `ControllerBindingDto`. The spatial-nav layer folds
 * these over the per-family compiled-in defaults; an absent row means "default".
 */
export interface ControllerBinding {
  id: number;
  deviceFamily: string;
  action: string;
  button: string;
}

/** List persisted binding overrides, optionally filtered to one device family. */
export function listBindings(deviceFamily?: string): Promise<ControllerBinding[]> {
  return invoke<ControllerBinding[]>("list_bindings", { deviceFamily });
}

/** Upsert one override, returning the persisted row. */
export function setBinding(
  deviceFamily: string,
  action: string,
  button: string,
): Promise<ControllerBinding> {
  return invoke<ControllerBinding>("set_binding", { deviceFamily, action, button });
}
