// PlaySwitch — chooses between the native libretro player (v0.21 "Bedrock",
// flagged off by default, NES only) and the existing in-page EmulatorJS
// player, falling back automatically — never a blank/broken screen — if
// native hosting fails to start for any reason. W215 — see
// docs/design/native-emulation-design.md §4.
//
// v0.23 W234: fallbacks are honest — when a path degrades (native start
// failure, play server unavailable) a dismissible notice above the player
// says what failed, what runs instead, and where to fix it
// (in-page-play-design.md §6). One notice per session per cause.

import { useCallback, useState } from "react";
import { GetCorePanel } from "./GetCorePanel";
import { InPagePlayer } from "./InPagePlayer";
import { NativePlayer } from "./NativePlayer";
import { PlayNotice } from "./PlayNotice";
import type { PlayerPresentation } from "./presentation";
import { canPlayInPage, isEmbeddedInPage } from "./ejs";
import { inPageAvailability, systemLabel } from "./inPageAvailability";
import { describeDegradation, recordDegradation } from "./degradation";
import type { DegradationNotice } from "./degradation";
import { getNativePlayEnabled } from "../../ipc/native-play";
import { listInPageCores } from "../../ipc/inpage-cores";
import type { InPageCore } from "../../ipc/inpage-cores";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";

/** Must match the Rust `play::native::NATIVE_SYSTEM` — the only system v0.21
 * "Bedrock" hosts natively. */
const NATIVE_SYSTEM = "nes";

export interface PlaySwitchProps {
  gameId: number;
  system: string;
  gameName: string;
  /** How the mounted player is presented (presentation.ts). "background"
   * (W235 attract) is meaningful to the native player only — the EmulatorJS
   * iframe cannot become a page background (explicit v0.23 non-goal), so it
   * degrades to plain foreground on the in-page path. "takeover" (v0.27
   * W272, the TV fullscreen surface) threads through to BOTH players:
   * edge-to-edge fill, and the player owns the controller's exclusive slot. */
  presentation?: PlayerPresentation;
  /** How "Exit game" leaves the player (v0.26 W265). Omitted on the desktop
   * detail route → the players default to `navigate(-1)` (back to the grid).
   * The TV takeover surface passes an explicit callback so exiting collapses
   * the takeover back to the originating tile instead of touching the router
   * (TV mode is not route-driven — there is no history entry to pop). */
  onExit?: () => void;
}

/**
 * Picks the player for one game's detail screen. Renders nothing for a
 * system with no in-page path at all (native external RetroArch launch only
 * — unaffected by this switch).
 */
export function PlaySwitch({ gameId, system, gameName, presentation, onExit }: PlaySwitchProps) {
  const isNativeCandidate = system === NATIVE_SYSTEM;
  // null = still resolving the flag; true/false once known. Only matters for
  // the native-candidate system — every other system ignores it entirely.
  const [nativeEnabled, setNativeEnabled] = useState<boolean | null>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  // A degradation to surface above the (fallback) player — honest, never
  // blocking (W234). Only the first occurrence per session per cause shows.
  const [notice, setNotice] = useState<DegradationNotice | null>(null);

  const onNativeFailed = useCallback(() => {
    setNativeFailed(true);
    if (recordDegradation("native-start-failed")) {
      setNotice(describeDegradation("native-start-failed"));
    }
  }, []);

  const onEjsUnavailable = useCallback(() => {
    if (recordDegradation("play-server-unavailable")) {
      setNotice(describeDegradation("play-server-unavailable"));
    }
  }, []);

  useCancellableEffect(
    (isCancelled) => {
      if (!isNativeCandidate) return;
      getNativePlayEnabled()
        .then((enabled) => !isCancelled() && setNativeEnabled(enabled))
        .catch(() => !isCancelled() && setNativeEnabled(false));
    },
    [isNativeCandidate],
  );

  // On-demand core catalog (W241): only systems whose in-page core isn't
  // embedded need it. `coresResolved` gates rendering so the get-core panel
  // never flashes before an installed core is known about; a failed listing
  // degrades to needs-core (never a false "ready").
  const needsCatalog = canPlayInPage(system) && !isEmbeddedInPage(system);
  const [cores, setCores] = useState<InPageCore[] | null>(null);
  const [coresResolved, setCoresResolved] = useState(false);
  // Set once GetCorePanel reports a verified install — boots in place
  // without refetching the catalog.
  const [justInstalled, setJustInstalled] = useState(false);
  useCancellableEffect(
    (isCancelled) => {
      if (!needsCatalog) return;
      listInPageCores()
        .then((list) => {
          if (isCancelled()) return;
          setCores(list);
          setCoresResolved(true);
        })
        .catch(() => !isCancelled() && setCoresResolved(true));
    },
    [needsCatalog],
  );

  // Resolving the flag for a system that *could* go native — wait rather
  // than flash EmulatorJS only to immediately swap to the native player.
  if (isNativeCandidate && nativeEnabled === null) return null;

  const noticeEl = notice ? <PlayNotice notice={notice} /> : null;

  if (isNativeCandidate && nativeEnabled && !nativeFailed) {
    return (
      <>
        {noticeEl}
        <NativePlayer
          gameId={gameId}
          gameName={gameName}
          presentation={presentation}
          onStartFailed={onNativeFailed}
          onExit={onExit}
        />
      </>
    );
  }

  const availability = inPageAvailability(system, cores);
  if (availability.kind === "none") return noticeEl;
  if (availability.kind === "ready" || justInstalled) {
    // The EmulatorJS iframe cannot become a page background (explicit v0.23
    // non-goal), so attract's "background" degrades to plain foreground here;
    // only the TV takeover presentation threads through (W272).
    const inPagePresentation: PlayerPresentation =
      presentation === "takeover" ? "takeover" : "foreground";
    return (
      <>
        {noticeEl}
        <InPagePlayer
          gameId={gameId}
          ejsSystem={availability.ejsCore}
          gameName={gameName}
          onUnavailable={onEjsUnavailable}
          onExit={onExit}
          presentation={inPagePresentation}
        />
      </>
    );
  }
  // Still resolving the catalog — render nothing rather than flash the panel.
  if (!coresResolved) return noticeEl;
  return (
    <>
      {noticeEl}
      <GetCorePanel
        system={system}
        systemLabel={systemLabel(system)}
        sizeBytes={availability.sizeBytes}
        onInstalled={() => setJustInstalled(true)}
      />
    </>
  );
}
