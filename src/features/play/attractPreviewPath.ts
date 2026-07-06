// attractPreviewPath — the single answer to "if this game dwells long enough,
// which player (if any) should preview it?" (v0.37 W376,
// tv-mode-design.md §v0.27 → W273, extended §v0.37 → W376).
//
// W273 shipped v1 with a native-only scope: `isNativePathEligible` was the
// entire decision, because the purity guarantee (no play-session record, no
// saves) was structural there. W376 extends previews to the EJS path — a
// system with an installed (or embedded) in-page core now previews too, via
// `InPagePlayer` in the "preview" presentation, whose own purity contract is
// enforced end-to-end by `presentationAllowsSaves`/`presentationRecordsPlaySession`
// (presentation.ts) and the `?preview=1` flag threaded to player.html's save
// bridge (in-page-play-design.md). External-only systems (no native AND no
// in-page core at all, e.g. GameCube/Wii — `inPageAvailability` answers
// "none") have no in-page surface whatsoever and are correctly never
// eligible: there is nothing to mount.
//
// Pure module (no React) so the three-way choice is unit-testable without a
// DOM, mirroring nativePath.ts's shape.

import type { InPageCore } from "../../ipc/inpage-cores";
import { inPageAvailability } from "./inPageAvailability";
import { isNativePathEligible, type NativeCapabilities } from "./nativePath";

/** Which player (if any) a dwelt game should preview through. */
export type AttractPreviewPath =
  | { kind: "native" }
  | { kind: "ejs"; ejsCore: string }
  | { kind: "none" };

/**
 * Resolves the preview path for `system`, preferring native (the original,
 * structurally-pure W273 path) and falling back to EJS (W376) when the
 * system has a ready in-page core. Neither path exists → `{ kind: "none" }`
 * — the tile keeps its static art, exactly as an external-only system always
 * has.
 */
export function resolveAttractPreviewPath(
  system: string,
  nativeEnabled: boolean,
  nativeCapabilities: NativeCapabilities,
  inPageCores: InPageCore[] | null,
): AttractPreviewPath {
  if (isNativePathEligible(system, nativeEnabled, nativeCapabilities)) {
    return { kind: "native" };
  }
  const availability = inPageAvailability(system, inPageCores);
  if (availability.kind === "ready") {
    return { kind: "ejs", ejsCore: availability.ejsCore };
  }
  return { kind: "none" };
}
