// useAttractPresentation — the attract-mode scroll driver (v0.23 W235;
// native-emulation-design.md §Attract mode). Watches the player's in-flow
// slot with an IntersectionObserver and decides fore/background with
// hysteresis: background when less than ~35% of the slot is visible,
// foreground again only once ~65% is visible — two thresholds so the
// boundary never flaps mid-scroll.

import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** Below this visible fraction, the player hands off to the background. */
export const BACKGROUND_BELOW = 0.35;
/** At or above this visible fraction, the player reattaches. */
export const FOREGROUND_ABOVE = 0.65;

export type Presentation = "foreground" | "background";

/** The hysteresis step — pure, so the flap-free boundary is unit-testable. */
export function nextPresentation(prev: Presentation, visibleRatio: number): Presentation {
  if (prev === "foreground") {
    return visibleRatio < BACKGROUND_BELOW ? "background" : "foreground";
  }
  return visibleRatio >= FOREGROUND_ABOVE ? "foreground" : "background";
}

/** Observes `slotRef` and returns the current presentation for the player. */
export function useAttractPresentation(slotRef: RefObject<HTMLElement | null>): Presentation {
  const [presentation, setPresentation] = useState<Presentation>("foreground");

  useEffect(() => {
    const el = slotRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        setPresentation((prev) => nextPresentation(prev, last.intersectionRatio));
      },
      { threshold: [0, BACKGROUND_BELOW, FOREGROUND_ABOVE, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [slotRef]);

  return presentation;
}
