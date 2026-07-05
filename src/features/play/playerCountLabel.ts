// playerCountLabel — pure formatting for the quiet "P1"/"P1 P2" connected-
// controllers indicator (v0.35 "Player Two" W351, controller-input-design.md
// §Two-player capture). Keyboard always drives port 0 alongside pad 0, so
// "P1" is shown even with zero pads connected — it never disappears, only
// gains "P2" once a second pad is assigned a port.
//
// Pure so the label text is unit-testable without mounting a component.

/** Builds the indicator label for the given count of connected (assigned) gamepads. */
export function playerCountLabel(connectedPadCount: number): string {
  return connectedPadCount >= 2 ? "P1 P2" : "P1";
}

/** Screen-reader description for the indicator — unlike the visual label it
 * distinguishes zero pads (keyboard alone drives player one) from one pad,
 * so it never announces a controller that isn't there. */
export function playerCountAriaLabel(connectedPadCount: number): string {
  if (connectedPadCount >= 2) return "Two controllers connected";
  if (connectedPadCount === 1) return "One controller connected";
  return "No controller connected — keyboard plays as player one";
}
