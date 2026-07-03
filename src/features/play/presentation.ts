// presentation — the shared player-presentation vocabulary (v0.27 W272,
// tv-mode-design.md §v0.27 → W272). A mounted player renders in exactly one
// presentation:
//   - "foreground": the interactive desktop detail-page player (default).
//   - "background": W235 attract mode — the live session re-presented as a
//     dimmed page backdrop; input detaches and the PAGE owns the controller.
//   - "takeover":   the TV fullscreen takeover (W265/W272) — the player fills
//     its surface edge-to-edge and owns the controller like foreground.
// Pure module (no React) so the predicates are unit-testable and PlaySwitch +
// both players share one vocabulary instead of re-declaring string unions.

export type PlayerPresentation = "foreground" | "background" | "takeover";

/**
 * Whether a presentation OWNS the controller's exclusive slot while the player
 * is mounted. Backgrounded/attract players are spectator surfaces — the page
 * keeps the controller (tv-mode-design.md §v0.27 → W272 "Input ownership").
 */
export function presentationOwnsController(presentation: PlayerPresentation): boolean {
  return presentation !== "background";
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
  return classes.join(" ");
}
