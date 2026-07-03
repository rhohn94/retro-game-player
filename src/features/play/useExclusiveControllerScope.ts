// useExclusiveControllerScope — the shared "a mounted player owns the
// controller" pattern (v0.27 W272, tv-mode-design.md §v0.27 → W272). While a
// player is mounted in a foreground-class presentation it claims the
// controller's exclusive slot (ControllerProvider.claimExclusive, a layered
// claim stack since W275) as a GAMEPLAY owner, so no semantic action can leak
// to the page underneath — the defect that let PlayStation ✕ (confirm) reach
// the still-mounted TV home mid-game and launch a different game. Releasing
// the claim uncovers whatever surface sits beneath it (the TV takeover's
// fallback, or the page) instead of emptying the slot.
//
// Routing contract (pure `routeScopedAction`, unit-tested without hardware):
//   - overlay closed: `menu` summons the overlay; EVERY other semantic action
//     is swallowed. Game input reaches the core via the raw gamepad poll
//     (native) or EmulatorJS's own internal pipeline (in-page) — never via
//     semantic actions.
//   - overlay open: nav_up/nav_down move the selection (wrapping), confirm
//     activates the selected item, back/menu close (resume).
//   - backgrounded (attract) presentations never hold the slot — the page
//     owns the controller (see presentation.ts).
//
// The rAF-driven dispatch itself lives in ControllerProvider/useGamepadPoll;
// this hook only owns the claim/release lifecycle and the routing, matching
// the useGamepadPoll pattern of keeping the impure surface minimal.

import { useEffect, useRef } from "react";
import { useController } from "../controller";
import type { SemanticAction } from "../controller/actions";
import type { OverlayItem } from "./PlayerOverlay";
import { presentationOwnsController, type PlayerPresentation } from "./presentation";

/** One routed outcome of a semantic action inside the player's scope — plain
 * data so the whole routing table is unit-testable without React. */
export type ScopeCommand =
  | { kind: "open-overlay" }
  | { kind: "close-overlay" }
  | { kind: "select"; index: number }
  | { kind: "activate"; index: number }
  | { kind: "swallow" };

/** The live state a routing decision depends on. */
export interface ScopeRouteState {
  overlayOpen: boolean;
  itemCount: number;
  selection: number;
}

/**
 * Route one semantic action per the W272 contract (file header). Pure: the
 * hook applies the returned command; tests assert the table exhaustively.
 */
export function routeScopedAction(action: SemanticAction, state: ScopeRouteState): ScopeCommand {
  if (!state.overlayOpen) {
    return action === "menu" ? { kind: "open-overlay" } : { kind: "swallow" };
  }
  const n = state.itemCount;
  if (action === "nav_up" && n > 0) {
    return { kind: "select", index: (state.selection - 1 + n) % n };
  }
  if (action === "nav_down" && n > 0) {
    return { kind: "select", index: (state.selection + 1) % n };
  }
  if (action === "confirm") return { kind: "activate", index: state.selection };
  if (action === "back" || action === "menu") return { kind: "close-overlay" };
  return { kind: "swallow" };
}

/** The live player state the scope reads. Passed as plain values each render;
 * the hook mirrors them into a ref so the installed handler never goes stale
 * and never re-installs mid-session. */
export interface ExclusiveControllerScope {
  /** The player's presentation; only foreground-class ones own the slot. */
  presentation: PlayerPresentation;
  /** False while the player isn't real yet (e.g. the in-page play origin is
   * still resolving or unavailable) — the page keeps the controller. */
  ready: boolean;
  overlayOpen: boolean;
  items: readonly OverlayItem[];
  selection: number;
  setSelection: (index: number) => void;
  openOverlay: () => void;
  closeOverlay: () => void;
}

/**
 * Claim the controller's exclusive slot for a mounted player while it is
 * ready and foreground-presented; release it on unmount, on losing readiness,
 * or on backgrounding. Both players (InPagePlayer, NativePlayer) adopt this
 * hook so input ownership can never diverge between the play paths again.
 */
export function useExclusiveControllerScope(scope: ExclusiveControllerScope): void {
  const { claimExclusive } = useController();

  // Live mirror (the useOverlayMenu cfg pattern): the handler is installed
  // once per ownership span and reads current values at action time.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const owns = scope.ready && presentationOwnsController(scope.presentation);

  useEffect(() => {
    if (!owns) return;
    const handler = (action: SemanticAction) => {
      const s = scopeRef.current;
      const command = routeScopedAction(action, {
        overlayOpen: s.overlayOpen,
        itemCount: s.items.length,
        selection: s.selection,
      });
      switch (command.kind) {
        case "open-overlay":
          s.openOverlay();
          break;
        case "close-overlay":
          s.closeOverlay();
          break;
        case "select":
          s.setSelection(command.index);
          break;
        case "activate": {
          const item = s.items[command.index];
          if (item && !item.disabled) item.run();
          break;
        }
        case "swallow":
          break; // deliberately eaten — nothing may leak to the page beneath
      }
    };
    // A GAMEPLAY claim: the gamepad belongs to the game (gates the `menu`
    // long-press TV toggle via gameplayClaimActive). The returned release is
    // idempotent and identity-based, so this cleanup can never pop another
    // owner's claim.
    return claimExclusive(handler, "gameplay");
  }, [owns, claimExclusive]);
}
