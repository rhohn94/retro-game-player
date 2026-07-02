// degradation — honest play-path fallbacks (v0.23 W234;
// in-page-play-design.md §6). When a play path silently degrades (native →
// EmulatorJS, in-page → external RetroArch), the user gets one dismissible,
// non-blocking explanation per session per cause: what failed, what Harmony
// is doing instead, where to fix it. Pure + testable; the one logging
// funnel for every degradation.

export type DegradationCause = "native-start-failed" | "play-server-unavailable";

export interface DegradationNotice {
  cause: DegradationCause;
  /** What happened → what Harmony does instead. */
  message: string;
  /** Where to fix it, e.g. a Settings pane. */
  hint: string;
}

const NOTICES: Record<DegradationCause, DegradationNotice> = {
  "native-start-failed": {
    cause: "native-start-failed",
    message:
      "Native play couldn't start — using the in-page player instead.",
    hint: "Check that the NES core is installed (Cores) or toggle native play in Settings → Playback.",
  },
  "play-server-unavailable": {
    cause: "play-server-unavailable",
    message:
      "In-page play is unavailable (the player server didn't start) — Play will launch RetroArch instead.",
    hint: "Restarting Harmony usually fixes this; the log has the reason.",
  },
};

/** Session-scoped memory of which causes were already shown (once each). */
const shownThisSession = new Set<DegradationCause>();

/** Look up the user-facing copy for a cause. */
export function describeDegradation(cause: DegradationCause): DegradationNotice {
  return NOTICES[cause];
}

/**
 * Records a degradation: logs it (the single funnel) and reports whether the
 * notice should be shown (first occurrence this session only).
 */
export function recordDegradation(cause: DegradationCause, detail?: string): boolean {
  console.warn(`[harmony-play] degraded: ${cause}${detail ? ` — ${detail}` : ""}`);
  if (shownThisSession.has(cause)) return false;
  shownThisSession.add(cause);
  return true;
}

/** Test hook: forget shown causes. */
export function resetDegradationsForTest(): void {
  shownThisSession.clear();
}
