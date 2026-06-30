// PlaySwitch — chooses between the native libretro player (v0.21 "Bedrock",
// flagged off by default, NES only) and the existing in-page EmulatorJS
// player, falling back automatically — never a blank/broken screen — if
// native hosting fails to start for any reason. W215 — see
// docs/design/native-emulation-design.md §4.

import { useEffect, useState } from "react";
import { InPagePlayer } from "./InPagePlayer";
import { NativePlayer } from "./NativePlayer";
import { inPageSystem } from "./ejs";
import { getNativePlayEnabled } from "../../ipc/native-play";

/** Must match the Rust `play::native::NATIVE_SYSTEM` — the only system v0.21
 * "Bedrock" hosts natively. */
const NATIVE_SYSTEM = "nes";

export interface PlaySwitchProps {
  gameId: number;
  system: string;
  gameName: string;
}

/**
 * Picks the player for one game's detail screen. Renders nothing for a
 * system with no in-page path at all (native external RetroArch launch only
 * — unaffected by this switch).
 */
export function PlaySwitch({ gameId, system, gameName }: PlaySwitchProps) {
  const isNativeCandidate = system === NATIVE_SYSTEM;
  // null = still resolving the flag; true/false once known. Only matters for
  // the native-candidate system — every other system ignores it entirely.
  const [nativeEnabled, setNativeEnabled] = useState<boolean | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);

  useEffect(() => {
    if (!isNativeCandidate) return;
    let cancelled = false;
    getNativePlayEnabled()
      .then((enabled) => !cancelled && setNativeEnabled(enabled))
      .catch(() => !cancelled && setNativeEnabled(false));
    return () => {
      cancelled = true;
    };
  }, [isNativeCandidate]);

  // Resolving the flag for a system that *could* go native — wait rather
  // than flash EmulatorJS only to immediately swap to the native player.
  if (isNativeCandidate && nativeEnabled === null) return null;

  if (isNativeCandidate && nativeEnabled && !nativeFailed) {
    return (
      <NativePlayer gameId={gameId} gameName={gameName} onStartFailed={() => setNativeFailed(true)} />
    );
  }

  const ejsSystem = inPageSystem(system);
  if (!ejsSystem) return null;
  return <InPagePlayer gameId={gameId} ejsSystem={ejsSystem} gameName={gameName} />;
}
