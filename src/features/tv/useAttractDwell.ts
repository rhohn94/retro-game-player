// useAttractDwell — the TV hover-attract dwell timer (v0.27 W273,
// tv-mode-design.md §v0.27 → W273). Watches the tile the user is dwelling on
// (controller focus and pointer hover are ONE notion here: TvTile/TvHero fold
// pointer hover into controller focus, so the focus id is the shared dwell
// key) and, once the SAME eligible game has held for the dwell threshold,
// emits it as the game to preview behind the home.
//
// Rules (all encoded in the pure-ish AttractDwellTimer so they are
// fake-timer-testable without React, the PlaySessionTracker pattern):
//   - the timer resets whenever the dwell key (focus) changes — a changed
//     dwelt game goes back through the FULL dwell, never a partial one;
//   - a fired preview clears the instant the key changes, the candidate stops
//     being eligible, or the gate disables (takeover up / exit-confirm
//     showing) — "moving focus tears it down within a frame's crossfade";
//   - re-enabling after a disable re-dwells from zero (a real launch always
//     boots fresh; returning from it never resumes a half-elapsed timer).
//
// The hook is only mounted by TvHome, so "only while the TV home is mounted"
// is structural: unmounting disposes the timer.

import { useEffect, useRef, useState } from "react";
import type { Game } from "../../ipc/library";

/** Hover-attract dwell threshold (ms) — mirrors `--rgp-tv-attract-dwell-ms`
 * in theme/tv.css (the CSS token the same interval is expressed as for
 * anything that needs to *show* the threshold, e.g. a future dwell-progress
 * ring). CSS custom properties aren't readable from a JS timer, so the number
 * is the single JS source and the token is the single CSS source — keep both
 * in sync if this changes, the way `--rgp-tv-long-press-ms` mirrors
 * LONG_PRESS_MS (useLongPress.ts). Dropped from 5000 to 1000 in v0.37 W376
 * (user directive: attract should feel near-instant on a couch dwell). */
export const TV_ATTRACT_DWELL_MS = 1000;

/** What the dwell timer watches each update. */
export interface AttractDwellInput {
  /** Identity of the dwelt-upon tile — the controller focus id (pointer hover
   * funnels into it). ANY change resets the timer and clears a fired preview. */
  key: string | null;
  /** The preview-eligible game (native OR, since v0.37 W376, EJS-path) that
   * key resolves to, or null when the focus target is not previewable (hero
   * row, external-only tile, previously failed preview). Compared by id. */
  game: Game | null;
  /** Master gate: false while a takeover is up or the exit-confirm is
   * showing. Disabling cancels the timer and clears a fired preview. */
  enabled: boolean;
}

/**
 * Owns one home-mount's dwell timer. `onChange` receives the game to preview
 * (or null) whenever that answer changes; it never fires redundantly.
 */
export class AttractDwellTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private key: string | null = null;
  private gameId: number | null = null;
  private enabled = false;
  private emitted: Game | null = null;

  constructor(
    private readonly onChange: (game: Game | null) => void,
    private readonly dwellMs: number = TV_ATTRACT_DWELL_MS,
  ) {}

  /** Report the current dwell candidate + gating. Idempotent: an update that
   * changes nothing relevant leaves a running timer (or a fired preview)
   * untouched, so unrelated re-renders can never stretch the dwell. */
  update(input: AttractDwellInput): void {
    const gameId = input.game?.id ?? null;
    if (input.key === this.key && gameId === this.gameId && input.enabled === this.enabled) {
      return;
    }
    this.key = input.key;
    this.gameId = gameId;
    this.enabled = input.enabled;

    this.clearTimer();
    this.emit(null); // any relevant change tears a fired preview down at once

    if (!input.enabled || !input.game || input.key === null) return;
    const game = input.game;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.emit(game);
    }, this.dwellMs);
  }

  /** Cancel everything (home unmount). Clears a fired preview too. */
  dispose(): void {
    this.clearTimer();
    this.key = null;
    this.gameId = null;
    this.enabled = false;
    this.emit(null);
  }

  private emit(game: Game | null): void {
    if (this.emitted === game) return;
    this.emitted = game;
    this.onChange(game);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * The game to preview behind the TV home (or null): `input.game` once it has
 * dwelt uninterrupted for `TV_ATTRACT_DWELL_MS` and while it remains the
 * dwelt, eligible, enabled candidate.
 */
export function useAttractDwell(input: AttractDwellInput): Game | null {
  const [preview, setPreview] = useState<Game | null>(null);

  // One timer per home mount; setPreview is stable so constructing with it
  // once is safe (the ControllerProvider lazy-ref pattern).
  const timerRef = useRef<AttractDwellTimer | null>(null);
  if (timerRef.current === null) timerRef.current = new AttractDwellTimer(setPreview);

  useEffect(() => {
    timerRef.current?.update(input);
    // Intentionally depends on the fields the timer compares (not the `input`
    // object identity) so a rails re-load re-creating an identical Game — or
    // a fresh options object each render — never churns the effect.
  }, [input.key, input.game?.id, input.enabled]);

  useEffect(() => {
    const timer = timerRef.current;
    return () => timer?.dispose();
  }, []);

  return preview;
}
