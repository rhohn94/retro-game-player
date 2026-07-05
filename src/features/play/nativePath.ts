// nativePath — the single answer to "would this game take the NATIVE play
// path?" (v0.27 W273). PlaySwitch (W215) has always made this call inline;
// the TV hover-attract preview needs the same answer BEFORE mounting anything
// (previews are native-only in v1 — the purity guarantee is structural there,
// tv-mode-design.md §v0.27 → W273 "Scope"), so the decision lives in one pure,
// unit-tested module both consumers share instead of drifting apart.
//
// v0.34 "Engines" (W340) generalizes this from a single hard-coded
// `system === "nes"` comparison to a table-driven capability check: a system
// is native-path-eligible when it (a) appears in the backend's
// `list_native_systems` table AND (b) has its core installed. Callers fetch
// the table once (`fetchNativeCapabilities`) and pass it into
// `isNativePathEligible` alongside the existing opt-in flag — the pure
// decision function itself stays synchronous and unit-testable.

import { listNativeSystems, type NativeSystemInfo } from "../../ipc/native-play";

/** Must match one row of the Rust `play::native::NATIVE_SYSTEMS` table — kept
 * as a named export because a few NES-only surfaces (the Core Options pane,
 * the Cores screen's per-row options entry point) still only ever apply to
 * the one native-hosted core this release ships. New call sites that need to
 * know "is ANY system native-eligible" should use
 * `isNativePathEligible`/`fetchNativeCapabilities` instead of comparing
 * against this constant directly. */
export const NATIVE_SYSTEM = "nes";

/** A system → core-installed lookup built from `list_native_systems` — the
 * frontend's native-capability map (W340). Keyed by system id. */
export type NativeCapabilities = ReadonlyMap<string, NativeSystemInfo>;

/** Fetches the native-hostable system table and indexes it by system id. A
 * failed fetch degrades to an empty map (no system is native-path-eligible)
 * rather than throwing — callers fall back to EJS/external exactly as they
 * would for any other native-start failure. */
export async function fetchNativeCapabilities(): Promise<NativeCapabilities> {
  try {
    const rows = await listNativeSystems();
    return new Map(rows.map((row) => [row.system, row]));
  } catch {
    return new Map();
  }
}

/**
 * Whether a game on `system` would genuinely take the native play path,
 * given the resolved native-play opt-in flag (`get_native_play_enabled`) and
 * the native-capability map (`fetchNativeCapabilities`). `system` must both
 * be in the capability table AND have its core installed — a table entry
 * with no core installed yet is exactly the "fall back to EJS/external"
 * case, same as any other native-start failure. Runtime start failures still
 * degrade after this answers true — callers that must never show an error
 * (the TV preview) handle `onStartFailed` themselves.
 */
export function isNativePathEligible(
  system: string,
  nativeEnabled: boolean,
  capabilities: NativeCapabilities,
): boolean {
  if (!nativeEnabled) return false;
  const capability = capabilities.get(system);
  return capability !== undefined && capability.coreInstalled;
}
