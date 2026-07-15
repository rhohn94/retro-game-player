// CatalogGameTile — Global Catalog grid tile (same chrome as GameTile).
// Uses CatalogTitle from the bundled No-Intro-ish catalog; owned titles show
// "In library" and open the real game detail.

import { AuraCard } from "@aura/react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import type { CatalogTitle } from "../../ipc/console";
import { listItem } from "../../lib/motion";
import { useFocusable } from "../controller";

export interface CatalogGameTileProps {
  entry: CatalogTitle;
  onFocusEntry: (entry: CatalogTitle) => void;
  onOpen: (entry: CatalogTitle) => void;
}

/** Focusable cover-style tile for a Global Catalog title (placeholder art for E1). */
export function CatalogGameTile({ entry, onFocusEntry, onOpen }: CatalogGameTileProps) {
  const focusId = entry.owned && entry.gameId != null
    ? `game:${entry.gameId}`
    : `catalog:${entry.catalogId}`;
  const { ref, isFocused, focus } = useFocusable<HTMLButtonElement>(focusId, () =>
    onOpen(entry),
  );
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);

  const claimFocus = () => {
    focus();
    onFocusEntry(entry);
  };

  return (
    <motion.button
      ref={ref}
      variants={listItem}
      type="button"
      role="listitem"
      className="rgp-tile"
      onFocus={claimFocus}
      onMouseEnter={claimFocus}
      onClick={() => onOpen(entry)}
      aria-label={`${entry.title} (${entry.system})${entry.owned ? ", in library" : ""}`}
    >
      <AuraCard class="rgp-tile__card">
        <span className="rgp-tile__placeholder">{entry.system}</span>
        <div className="rgp-tile__title-row">
          <span className="rgp-tile__title">{entry.title}</span>
          {entry.owned ? (
            <span className="rgp-tile__source-badge" title="In your personal catalog">
              In library
            </span>
          ) : (
            <span className="rgp-tile__source-badge rgp-tile__source-badge--available">
              Available
            </span>
          )}
        </div>
      </AuraCard>
    </motion.button>
  );
}
