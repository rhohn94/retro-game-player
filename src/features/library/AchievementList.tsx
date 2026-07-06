// AchievementList — the detail page's expandable full achievement list
// (v0.38 W384, retroachievements-design.md §Achievement list). Rendered
// under the existing "N of M" summary row; collapsed by default (a game with
// dozens of achievements shouldn't push the rest of the detail page down
// unasked). Unlocked entries render distinctly (badge + unlock date); locked
// entries dim and show only their point value. Ordering (unlocked-first,
// then by points) is entirely backend-computed (`get_achievement_list`) —
// this component renders the list exactly as given, no re-sorting here.
//
// Renders nothing when `entries` is empty — mirrors the summary row's own
// "unconfigured / no cached set ⇒ hide the section" behavior, so a caller can
// pass the list straight through without its own empty-check.

import { AchievementBadge } from "./AchievementBadge";
import type { AchievementListEntry } from "../../ipc/retroachievements";

export interface AchievementListProps {
  entries: AchievementListEntry[];
  /** Whether the list is currently expanded. Controlled by the parent so the
   * "N of M" row's own toggle button can drive it (single source of truth
   * for open/closed, matching `CollectionPicker`'s controlled-disclosure
   * shape). */
  open: boolean;
}

/** Formats a Unix-epoch-seconds unlock timestamp as a short local date. */
function formatUnlockDate(unlockedAt: number): string {
  return new Date(unlockedAt * 1000).toLocaleDateString();
}

/** The full per-game achievement list, shown/hidden via `open`. */
export function AchievementList({ entries, open }: AchievementListProps) {
  if (entries.length === 0 || !open) return null;

  return (
    <ul className="rgp-achievement-list" role="list">
      {entries.map((entry) => {
        const unlocked = entry.unlockedAt !== null;
        return (
          <li
            key={entry.id}
            className={`rgp-achievement-list__item${unlocked ? " rgp-achievement-list__item--unlocked" : " rgp-achievement-list__item--locked"}`}
          >
            <AchievementBadge badgeName={entry.badgeName} unlocked={unlocked} />
            <div className="rgp-achievement-list__body">
              <p className="rgp-achievement-list__title">{entry.title}</p>
              {entry.description && (
                <p className="rgp-achievement-list__desc">{entry.description}</p>
              )}
              {unlocked && entry.unlockedAt !== null && (
                <p className="rgp-achievement-list__unlocked-at">
                  Unlocked {formatUnlockDate(entry.unlockedAt)}
                </p>
              )}
            </div>
            <span className="rgp-achievement-list__points">{entry.points} pts</span>
          </li>
        );
      })}
    </ul>
  );
}
