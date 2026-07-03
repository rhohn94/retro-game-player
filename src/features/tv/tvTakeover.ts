// TV takeover transition state machine (v0.26 W265, tv-mode-design.md §Design
// "Transitions"). Pure + framework-free so the reveal sequencing — the tile's
// cover art expands to fill the surface while the player boots UNDERNEATH, then
// crossfades out as soon as the player surface exists — is fully unit-testable
// without a DOM, Framer Motion, or a real player.
//
// The contract this module encodes (the "reveal contract"):
//   1. `expanding` — the launched tile's cover art scales up from its tile rect
//      toward full-viewport; the player (PlaySwitch) is already mounting +
//      booting behind it (boot screen + sound intact — never gated, never
//      muted; muted-on-boot is a bug).
//   2. `revealed` — the cover art crossfades OUT, uncovering the live player
//      surface. The reveal is driven by the player surface EXISTING, not by a
//      fixed timer: we do NOT hold the cover over the boot screen artificially
//      long, because the EmulatorJS boot screen is part of the retro vibe.
//   3. reduced motion collapses (1)→(2) into a single frame: a plain crossfade
//      with no expand, honouring the app's central reduced-motion policy.
//
// Exit reverses the sequence: `collapsing` shrinks the surface back toward the
// originating tile rect, landing on the same rail + tile with focus restored
// (the home stays mounted behind the surface, so its per-rail focus memory and
// scroll position are intact — the surface is an overlay, not a route swap).

/** The phases of a takeover, entry through exit. */
export type TakeoverPhase =
  /** No game launched — the surface is not mounted. */
  | "idle"
  /** Cover art is expanding from the tile rect; the player boots behind it. */
  | "expanding"
  /** Cover art has crossfaded out; the live player surface is uncovered. */
  | "revealed"
  /** Cover art is shrinking back toward the tile rect on exit. */
  | "collapsing";

/** The tile geometry a takeover expands from / collapses back to, in viewport
 * pixels (a DOMRect's read-only shape). Null when the launch had no source rect
 * (e.g. launched from a non-tile affordance) — the transition then falls back to
 * a centred plain crossfade. */
export interface TileRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** One in-flight (or idle) takeover. Immutable — every transition returns a new
 * value so React state updates stay referentially honest. */
export interface TakeoverState {
  readonly phase: TakeoverPhase;
  /** The game being taken over to, or null when idle. */
  readonly gameId: number | null;
  /** The originating tile rect, or null (centred fallback). */
  readonly originRect: TileRect | null;
}

/** The resting/idle takeover — nothing launched. */
export const IDLE_TAKEOVER: TakeoverState = {
  phase: "idle",
  gameId: null,
  originRect: null,
};

/**
 * Begin a takeover for `gameId` from `originRect`. Under reduced motion the
 * expand is skipped entirely — we jump straight to `revealed` so the transition
 * is a plain crossfade (the design's reduced-motion path). Otherwise we enter
 * `expanding`; the reveal fires later via {@link revealPlayer} once the player
 * surface exists.
 */
export function beginTakeover(
  gameId: number,
  originRect: TileRect | null,
  reducedMotion: boolean,
): TakeoverState {
  return {
    phase: reducedMotion ? "revealed" : "expanding",
    gameId,
    originRect,
  };
}

/**
 * Cross the cover art out to uncover the live player. Idempotent — only an
 * `expanding` takeover advances to `revealed`; calling it again (or on an
 * already-revealed / collapsing / idle state) is a no-op, so wiring it to "the
 * player surface now exists" can fire more than once safely.
 */
export function revealPlayer(state: TakeoverState): TakeoverState {
  if (state.phase !== "expanding") return state;
  return { ...state, phase: "revealed" };
}

/**
 * Begin exiting: shrink the surface back toward the originating tile. Only a
 * live takeover (`expanding` or `revealed`) can collapse; an idle or
 * already-collapsing state is returned unchanged so a double-exit is safe.
 */
export function beginCollapse(state: TakeoverState): TakeoverState {
  if (state.phase !== "expanding" && state.phase !== "revealed") return state;
  return { ...state, phase: "collapsing" };
}

/** Whether a takeover is currently active (the surface should be mounted). */
export function isTakeoverActive(state: TakeoverState): boolean {
  return state.phase !== "idle";
}

/** Whether the live player surface should be uncovered (cover art gone). True
 * only while `revealed` — the game is playing and fully visible. During
 * `collapsing` the cover fades back in over the player (see
 * {@link isCoverVisible}) as it shrinks to the tile, so the player is NOT
 * "uncovered" then. */
export function isPlayerUncovered(state: TakeoverState): boolean {
  return state.phase === "revealed";
}

/** Whether the expanding/collapsing cover-art layer should be rendered. Visible
 * while the cover is animating over the player — during `expanding` (before the
 * reveal) and during `collapsing` (fading back in as it shrinks to the tile) —
 * and hidden once `revealed` (the game is playing) or `idle`. */
export function isCoverVisible(state: TakeoverState): boolean {
  return state.phase === "expanding" || state.phase === "collapsing";
}
