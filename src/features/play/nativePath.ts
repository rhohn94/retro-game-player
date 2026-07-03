// nativePath — the single answer to "would this game take the NATIVE play
// path?" (v0.27 W273). PlaySwitch (W215) has always made this call inline;
// the TV hover-attract preview needs the same answer BEFORE mounting anything
// (previews are native-only in v1 — the purity guarantee is structural there,
// tv-mode-design.md §v0.27 → W273 "Scope"), so the decision lives in one pure,
// unit-tested module both consumers share instead of drifting apart.

/** Must match the Rust `play::native::NATIVE_SYSTEM` — the only system v0.21
 * "Bedrock" hosts natively. */
export const NATIVE_SYSTEM = "nes";

/**
 * Whether a game on `system` would genuinely take the native play path, given
 * the resolved native-play opt-in flag (`get_native_play_enabled`). Runtime
 * start failures still degrade after this answers true — callers that must
 * never show an error (the TV preview) handle `onStartFailed` themselves.
 */
export function isNativePathEligible(system: string, nativeEnabled: boolean): boolean {
  return nativeEnabled && system === NATIVE_SYSTEM;
}
