// PlayNotice — a dismissible, info-tone banner above the player slot
// explaining a play-path degradation (v0.23 W234). Non-blocking by design:
// the fallback player renders beneath it and keeps working.

import { useState } from "react";
import type { DegradationNotice } from "./degradation";

/** Renders one degradation notice until dismissed. */
export function PlayNotice({ notice }: { notice: DegradationNotice }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="harmony-play-notice" role="status">
      <div className="harmony-play-notice__text">
        <p className="harmony-play-notice__message">{notice.message}</p>
        <p className="harmony-play-notice__hint">{notice.hint}</p>
      </div>
      <button
        type="button"
        className="harmony-play-notice__dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  );
}
