// useTvModeControllerToggle — wires the controller `menu` long-press to
// toggling TV mode (v0.26 W260, tv-mode-design.md §Controller: "`menu`
// long-press toggles TV mode anywhere outside gameplay"). A thin adapter over
// `useLongPress` (controller feature) so the TV feature owns the *policy*
// (which action, which threshold, enter-vs-exit) while the controller feature
// owns the *mechanism* (raw gamepad polling) — same separation as
// `useAutoTvModeOnStartup` owning config-read policy over the raw IPC call.
//
// "Outside gameplay" is satisfied by construction today: this hook is mounted
// once at the app-shell level (App.tsx), and the in-page/native player
// surfaces install an EXCLUSIVE controller handler
// (`ControllerProvider.setExclusiveHandler`) while a game is running, which
// makes every other action source — including this long-press poll — a no-op
// until the exclusive owner releases it (ControllerProvider.tsx
// `handleAction`). No extra gameplay check is needed here.

import { useLongPress } from "../controller";
import { useTvMode } from "./TvModeContext";

/**
 * Mount once at the app shell. Holding `menu` for the long-press threshold
 * enters TV mode when inactive, or exits it when active.
 */
export function useTvModeControllerToggle(): void {
  const { active, enter, exit } = useTvMode();

  useLongPress({
    action: "menu",
    onLongPress: () => (active ? exit() : enter()),
  });
}
