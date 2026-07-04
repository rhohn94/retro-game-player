// useTvSystemMenuTrigger — wires the raw-poll Select/touchpad trigger
// (`useMenuTrigger`, controller feature) to opening the W278 TV system menu
// (tv-mode-design.md §v0.28 → W278). A thin policy adapter over the
// controller feature's mechanism, the same split `useTvModeControllerToggle`
// already established for the `menu` long-press: this hook owns WHEN the
// trigger is armed and WHAT it does; `useMenuTrigger` owns the raw gamepad
// polling.
//
// Gating (all AND'd, per the release-plan contract): TV mode active, the menu
// not ALREADY open (a second Select/touchpad press while the panel is open is
// handled entirely by TvSystemMenu's own exclusive-claim handler — its
// `quit`/`back` branch closes it via the normal semantic-action dispatch path,
// a completely independent poll from this raw one; re-arming this trigger
// too would race the two "did Select just close it" signals against each
// other for no benefit, since opening an already-open menu is a no-op
// anyway), outside gameplay (`gameplayClaimActive` — the exclusive-claim-stack
// signal, same one `useTvModeControllerToggle` already reads), no takeover
// surface mounted (`launched === null` — the TvModeContext field the TV
// takeover sets; checked so a running game keeps sole ownership of every
// input source, not just the semantic-action dispatch the takeover's fallback
// claim already swallows), and the window focused (`useWindowFocus`, the same
// gate W275 added to the hover-attract dwell so a backgrounded app never
// reacts to input).

import { useController, useMenuTrigger } from "../controller";
import { useWindowFocus } from "../../hooks/useWindowFocus";
import { useTvMode } from "./TvModeContext";

/**
 * Mount once at the TV shell level (alongside `useTvModeControllerToggle`).
 * Pressing Select (any family) or the PlayStation touchpad opens the system
 * menu whenever TV mode is active, outside gameplay, with no takeover
 * mounted, and the window focused.
 */
export function useTvSystemMenuTrigger(): void {
  const { active, launched, menuOpen, openMenu } = useTvMode();
  const { gameplayClaimActive, bindingOverrides } = useController();
  const windowFocused = useWindowFocus();

  useMenuTrigger({
    onTrigger: openMenu,
    overrides: bindingOverrides,
    enabled: active && !menuOpen && !gameplayClaimActive && launched === null && windowFocused,
  });
}
