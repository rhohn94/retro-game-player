// Typed wrappers for the `sources` domain (v0.31 W313 — app scanner + manual
// entries; see `docs/design/non-retro-library-design.md` §Game sources). The
// Steam scan command (`scan_steam_source`, W312) is wired here by name per
// the shared contract so this pane resolves against it once W312 lands.

import { invoke } from "./invoke";
import type { GameSource } from "./library";

/** A shortlisted-but-unconfirmed game (mirrors Rust `DiscoveredGameDto`). */
export interface DiscoveredGame {
  name: string;
  source: GameSource;
  externalId: string | null;
  launchDescriptor: unknown;
  artHint: string | null;
}

/** A manual-entry target: an app bundle, or an arbitrary executable + args. */
export type ManualTarget =
  | { kind: "app"; bundlePath: string }
  | { kind: "exec"; program: string; args: string[] };

/**
 * Run the `/Applications` + `~/Applications` app scan and return the
 * shortlist. Creates no library rows — the caller must confirm entries via
 * `confirmAppEntries` before anything persists.
 */
export function scanAppSource(): Promise<DiscoveredGame[]> {
  return invoke<DiscoveredGame[]>("scan_app_source");
}

/**
 * Upsert the user-confirmed subset of an app-scan shortlist. Returns the
 * persisted row ids.
 */
export function confirmAppEntries(entries: DiscoveredGame[]): Promise<number[]> {
  return invoke<number[]>("confirm_app_entries", { entries });
}

/**
 * Add a manual library entry: a display name plus an app-bundle or exec
 * target. Returns the persisted row id.
 */
export function addManualEntry(name: string, target: ManualTarget): Promise<number> {
  return invoke<number>("add_manual_entry", { name, target: toWireTarget(target) });
}

/** Convert the camelCase TS `ManualTarget` into the Rust adapter's wire shape
 * (`snake_case` fields under a `kind` tag, matching `#[serde(tag = "kind",
 * rename_all = "snake_case")]` on `ManualTarget`). */
function toWireTarget(target: ManualTarget): Record<string, unknown> {
  if (target.kind === "app") {
    return { kind: "app", bundle_path: target.bundlePath };
  }
  return { kind: "exec", program: target.program, args: target.args };
}

/**
 * Trigger the Steam appmanifest scan (W312). Declared here per the shared
 * `scan_steam_source` command-name contract so the "Game sources" settings
 * pane can wire its Steam button before W312 merges; it resolves against the
 * real command at integration.
 */
export function scanSteamSource(): Promise<DiscoveredGame[]> {
  return invoke<DiscoveredGame[]>("scan_steam_source");
}
