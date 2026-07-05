// ExternalOnlyNotice — the player slot's affordance for a system with no
// in-page or native path at all (v0.34 W346; `inPageAvailability`'s
// `kind: "none"`). Before this, the switch rendered nothing here beyond the
// notice banner, so GameCube/Wii (and any future external-only system) had
// no explanation on the detail page for why the slot stays empty. Names the
// actual emulator (e.g. "Dolphin" for GameCube/Wii) so the honest-outcome
// story reads as a deliberate choice, not a missing feature — see
// native-emulation-design.md §HW-render GC/Wii note.

import { externalOnlyMessage } from "./inPageAvailability";

export interface ExternalOnlyNoticeProps {
  system: string;
}

/** Renders the "plays externally" explanation for a `kind: "none"` system.
 * Renders nothing for a blank system key (a retro row with no system would
 * otherwise produce malformed copy). */
export function ExternalOnlyNotice({ system }: ExternalOnlyNoticeProps) {
  const message = externalOnlyMessage(system);
  if (!message) return null;
  return (
    <div className="rgp-external-only" role="status">
      <p className="rgp-external-only__message">{message}</p>
    </div>
  );
}
