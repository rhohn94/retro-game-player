// useTvModeControllerToggle — wires the controller `menu` long-press to
// toggling TV mode (v0.26 W260, tv-mode-design.md §Controller: "`menu`
// long-press toggles TV mode anywhere outside gameplay"). A thin adapter over
// `useLongPress` (controller feature) so the TV feature owns the *policy*
// (which action, which threshold, enter-vs-exit) while the controller feature
// owns the *mechanism* (raw gamepad polling) — same separation as
// `useAutoTvModeOnStartup` owning config-read policy over the raw IPC call.
//
// "Outside gameplay" must be enforced HERE (v0.27 W275): `useLongPress` runs
// its own raw-gamepad rAF poll, so the exclusive-handler slot — which only
// gates SEMANTIC actions dispatched through ControllerProvider — cannot
// silence it (the W260 comment claiming otherwise was wrong; holding `menu`
// 600 ms mid-game toggled TV mode and tore the running session down). The
// provider's `gameplayClaimActive` is the honest signal: true exactly while a
// mounted player owns the gamepad (useExclusiveControllerScope claims with
// kind "gameplay"), false on the TV home / desktop shell where the toggle
// must keep working. The persisted binding overrides are threaded through too,
// so a rebound `menu` moves the long-press with it (W267 parity).

import { useController, useLongPress } from "../controller";
import { useTvMode } from "./TvModeContext";

/**
 * Mount once at the app shell. Holding `menu` for the long-press threshold
 * enters TV mode when inactive, or exits it when active — except during
 * gameplay, where the pad belongs to the game.
 */
export function useTvModeControllerToggle(): void {
  const { active, enter, exit } = useTvMode();
  const { gameplayClaimActive, bindingOverrides } = useController();

  useLongPress({
    action: "menu",
    onLongPress: () => (active ? exit() : enter()),
    overrides: bindingOverrides,
    enabled: !gameplayClaimActive,
  });
}
