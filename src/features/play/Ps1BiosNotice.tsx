// Ps1BiosNotice — the standing HLE-BIOS honesty notice shown above the
// native player on a PS1 game's detail page (v0.34 "Engines" W344). Visually
// matches PlayNotice (same info-tone banner, dismissible per mount) but is
// NOT a degradation: the native path IS what's running, so this doesn't
// route through degradation.ts's once-per-session funnel — it renders every
// time the PS1 native path is active, same as any other detail-page metadata.

import { useState } from "react";
import { PS1_BIOS_NOTICE } from "./ps1BiosCopy";

/** Renders the PS1 HLE-BIOS notice until dismissed for this mount. */
export function Ps1BiosNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="rgp-play-notice" role="status">
      <div className="rgp-play-notice__text">
        <p className="rgp-play-notice__message">{PS1_BIOS_NOTICE.message}</p>
        <p className="rgp-play-notice__hint">{PS1_BIOS_NOTICE.hint}</p>
      </div>
      <button
        type="button"
        className="rgp-play-notice__dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  );
}
