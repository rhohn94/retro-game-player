// useTvExitConfirm — the "press Back again to exit TV mode" confirm gesture
// (v0.26 W260 originally in TvShell; extracted in W261 so both TvShell's chrome
// and TvHome's controller routing share ONE source of truth for the two-press
// exit). `back` at TV root has no back-stack to unwind, so a single press arms a
// brief confirm window and a second press within it exits; the window resets on
// its own so a stray press never leaves the app one press from silently exiting.

import { useCallback, useEffect, useRef, useState } from "react";

/** How long the confirm affordance stays armed before resetting (ms). */
const EXIT_CONFIRM_TIMEOUT_MS = 3000;

export interface TvExitConfirm {
  /** True while the "press Back again" affordance is showing. */
  confirming: boolean;
  /** Handle a `back` press: arms the confirm on the first press, calls `onExit`
   * on the second press within the window. */
  requestExit: () => void;
}

/**
 * Two-press exit-confirm for TV root. `onExit` fires only on the second `back`
 * press inside the confirm window.
 */
export function useTvExitConfirm(onExit: () => void): TvExitConfirm {
  const [confirming, setConfirming] = useState(false);
  // Keep the latest onExit without re-creating requestExit each render.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const requestExit = useCallback(() => {
    setConfirming((wasConfirming) => {
      if (wasConfirming) {
        onExitRef.current();
        return false;
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), EXIT_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return { confirming, requestExit };
}
