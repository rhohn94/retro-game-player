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
//   - overlay closed: EVERY semantic action is swallowed — including `menu`
//     (v0.28 W279: a bare Start press used to open the overlay here, but
//     every game needs Start for its own play, so `menu`'s bare press no
//     longer summons anything; see useGameplayMenuTrigger.ts for the two
//     gestures that now do). Game input reaches the core via the raw gamepad
//     poll (native) or EmulatorJS's own internal pipeline (in-page) — never
//     via semantic actions.
//   - overlay open: nav_up/nav_down move the selection (wrapping), confirm
//     activates the selected item, back/menu close (resume) — `menu` still
//     CLOSES an already-open overlay (symmetric with `back`); only the
//     "summon it from closed" branch was removed.
//   - backgrounded (attract) presentations never hold the slot — the page
//     owns the controller (see presentation.ts).
//
// v0.28 W279: the overlay now opens via a SEPARATE raw-poll gesture
// (`useGameplayMenuTrigger`, this directory) instead of the semantic `menu`
// action — Start+Select chorded, or Start held alone for `MENU_HOLD_MS`.
// Like `useLongPress`/`useMenuTrigger` this trigger polls the raw gamepad
// directly (independent of the exclusive-claim dispatch), so it is wired up
// here alongside the claim lifecycle rather than through `routeScopedAction`;
// it is enabled exactly while this scope owns the slot and the overlay is
// closed (opening while already open is a no-op the trigger doesn't need to
// know about — reopening does nothing).
//
// The rAF-driven dispatch itself lives in ControllerProvider/useGamepadPoll;
// this hook only owns the claim/release lifecycle and the routing, matching
// the useGamepadPoll pattern of keeping the impure surface minimal.

import { useEffect, useRef } from "react";
import { useController } from "../controller";
import type { SemanticAction } from "../controller/actions";
import type { OverlayItem } from "./PlayerOverlay";
import { presentationOwnsController, type PlayerPresentation } from "./presentation";
import { useGameplayMenuTrigger } from "./useGameplayMenuTrigger";

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
    // v0.28 W279: a bare `menu` (Start) press no longer summons the overlay —
    // every semantic action is swallowed while closed, full stop. The overlay
    // now opens only via the raw-poll chord/hold gesture in
    // useGameplayMenuTrigger.ts, wired up alongside the claim below.
    return { kind: "swallow" };
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
  /** Live progress (0..1) toward the W279 hold-open threshold, reported every
   * tick Start is held alone toward `MENU_HOLD_MS`; back to 0 on release, on
   * the chord superseding it, or once it fires. Drives the hold indicator;
   * omit if the player renders none. */
  onHoldProgress?: (progress: number) => void;
}

/**
 * Claim the controller's exclusive slot for a mounted player while it is
 * ready and foreground-presented; release it on unmount, on losing readiness,
 * or on backgrounding. Both players (InPagePlayer, NativePlayer) adopt this
 * hook so input ownership can never diverge between the play paths again.
 */
export function useExclusiveControllerScope(scope: ExclusiveControllerScope): void {
  const { claimExclusive, bindingOverrides } = useController();

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

  // v0.28 W279: the overlay-open gesture itself — Start+Select chord or a
  // solo Start hold to MENU_HOLD_MS — independent of the semantic dispatch
  // above (same raw-poll pattern as useLongPress/useMenuTrigger). Enabled
  // exactly while this scope owns the slot AND the overlay is closed
  // (re-triggering while already open would be a no-op anyway, and the
  // overlay's own controller routing above owns everything once it's open).
  useGameplayMenuTrigger({
    onOpen: () => scopeRef.current.openOverlay(),
    onProgress: (progress) => scopeRef.current.onHoldProgress?.(progress),
    overrides: bindingOverrides,
    enabled: owns && !scope.overlayOpen,
  });
}
