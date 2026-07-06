// AchievementBadge — one achievement's badge art in the detail-page
// achievement list (v0.38 W384, retroachievements-design.md §Achievement
// list). Best-effort: resolves `badgeName` to a cached/fetched local file
// path via `getAchievementBadgePath` and renders it through `artUrl`
// (the same `convertFileSrc` boundary every other on-disk image in this app
// uses); degrades to a neutral placeholder glyph — no spinner, ever — the
// moment the name is absent or the backend can't resolve a path (offline,
// unrecognized badge, or an already-known miss this session).

import { useState } from "react";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { getAchievementBadgePath } from "../../ipc/retroachievements";
import { swallow } from "../../ipc/swallow";
import { artUrl } from "./art";

export interface AchievementBadgeProps {
  /** RA badge id, or `null` when the achievement's set carried none. */
  badgeName: string | null;
  /** Whether the owning achievement is unlocked — purely a class modifier so
   * CSS can dim a locked badge, matching the rest of the locked-entry
   * treatment. */
  unlocked: boolean;
}

/** Neutral placeholder glyph shown whenever no real badge art resolves. */
const PLACEHOLDER_GLYPH = "🏆";

/** One achievement's badge image (or a placeholder glyph). */
export function AchievementBadge({ badgeName, unlocked }: AchievementBadgeProps) {
  const [path, setPath] = useState<string | null>(null);

  useCancellableEffect(
    (isCancelled) => {
      setPath(null);
      if (!badgeName) return;
      getAchievementBadgePath(badgeName)
        .then((resolved) => {
          if (!isCancelled()) setPath(resolved);
        })
        .catch((err: unknown) => swallow(err, "AchievementBadge.loadBadgePath", "info"));
    },
    [badgeName],
  );

  const url = path ? artUrl(path) : null;
  const className = `rgp-achievement-badge${unlocked ? "" : " rgp-achievement-badge--locked"}`;

  if (url) {
    return <img src={url} alt="" className={className} />;
  }
  return (
    <span className={className} aria-hidden="true">
      {PLACEHOLDER_GLYPH}
    </span>
  );
}
