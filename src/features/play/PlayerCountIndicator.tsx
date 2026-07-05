// PlayerCountIndicator — the quiet "P1"/"P1 P2" connected-controllers chip
// (v0.35 "Player Two" W351, controller-input-design.md §Two-player capture).
// Reuses the existing chip visual language (`rgp-player__fs`, the same class
// the Menu/Exit chrome buttons use) rather than inventing a new style, per
// the design language's "quiet/minimal" guidance for this release. Renders
// in both the detail-page player chrome bar (NativePlayer's `rgp-player__bar`)
// and the in-game overlay panel, so a second player plugging in sees the
// pickup happen live wherever they're looking.

import { playerCountAriaLabel, playerCountLabel } from "./playerCountLabel";

export interface PlayerCountIndicatorProps {
  /** How many gamepads are currently assigned a native-input port (0, 1, or 2 this release). */
  connectedPadCount: number;
}

/** A small live status chip reporting which player slots are picked up. */
export function PlayerCountIndicator({ connectedPadCount }: PlayerCountIndicatorProps) {
  const label = playerCountLabel(connectedPadCount);
  return (
    <span className="rgp-player-count" role="status" aria-label={playerCountAriaLabel(connectedPadCount)}>
      {label}
    </span>
  );
}
