// presentation — the shared player-presentation vocabulary (v0.27 W272/W273,
// tv-mode-design.md §v0.27 → W272/W273). A mounted player renders in exactly
// one presentation:
//   - "foreground": the interactive desktop detail-page player (default).
//   - "background": W235 attract mode — the live session re-presented as a
//     dimmed page backdrop; input detaches and the PAGE owns the controller.
//   - "takeover":   the TV fullscreen takeover (W265/W272) — the player fills
//     its surface edge-to-edge and owns the controller like foreground.
//   - "preview":    the W273 TV hover-attract preview — a pure spectator
//     surface behind the TV home. Like "background" it never owns input, but
//     unlike it the session itself is a no-trace preview (no play-session
//     record, no saves — the purity contract lives in the predicates below).
// Pure module (no React) so the predicates are unit-testable and PlaySwitch +
// both players share one vocabulary instead of re-declaring string unions.

export type PlayerPresentation = "foreground" | "background" | "takeover" | "preview";

/**
 * Whether a presentation is a SPECTATOR surface: the player only shows the
 * running game — input (keyboard + gamepad poll) detaches entirely and audio
 * ducks to the attract gain. "background" (W235 attract) and "preview" (W273
 * TV hover-attract) both watch; foreground-class presentations play.
 */
export function presentationIsSpectator(presentation: PlayerPresentation): boolean {
  return presentation === "background" || presentation === "preview";
}

/**
 * Whether a presentation OWNS the controller's exclusive slot while the player
 * is mounted. Spectator presentations leave it to the page — the page keeps
 * the controller (tv-mode-design.md §v0.27 → W272 "Input ownership").
 */
export function presentationOwnsController(presentation: PlayerPresentation): boolean {
  return !presentationIsSpectator(presentation);
}

/**
 * Whether a mounted player in this presentation records a library-life play
 * session (play count / recency / play-time, W264). Only the W273 "preview"
 * opts out — a preview must not leave a trace (tv-mode-design.md §v0.27 →
 * W273 "Purity"). "background" stays true: W235 attract is the USER'S live
 * session re-presented mid-play, not a synthetic preview.
 */
export function presentationRecordsPlaySession(presentation: PlayerPresentation): boolean {
  return presentation !== "preview";
}

/**
 * Whether a presentation offers the app-immersive "Full screen" affordance
 * (the in-page player's window-fullscreen + fill mode, W232). Only the desktop
 * foreground player does: inside the TV takeover the window is ALREADY
 * fullscreen and owned by TV mode (v0.27 W275 — offering the item there was
 * redundant, and activating/exiting it yanked the window out of TV mode's
 * fullscreen), and spectator surfaces render no chrome at all.
 */
export function presentationAllowsImmersive(presentation: PlayerPresentation): boolean {
  return presentation === "foreground";
}

/**
 * The `.rgp-player` root class for a presentation, plus the in-page player's
 * immersive mode. One place computes the modifier set so the two players can
 * never drift apart on how a presentation is expressed in the DOM.
 */
export function playerShellClass(presentation: PlayerPresentation, immersive = false): string {
  const classes = ["rgp-player"];
  if (immersive) classes.push("rgp-player--immersive");
  if (presentation === "background") classes.push("rgp-player--attract");
  if (presentation === "takeover") classes.push("rgp-player--takeover");
  if (presentation === "preview") classes.push("rgp-player--preview");
  return classes.join(" ");
}
