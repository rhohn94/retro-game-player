/** A single previewed result: a select checkbox + a focusable open-link button
 *  with title-parsed badges. */
import { motion } from "framer-motion";
import { openUrl } from "../../../ipc/opener";
import { listItem } from "../../../lib/motion";
import { parseBadges } from "../resultBadges";
import type { MatchStrength } from "../resultRanking";
import type { SearchResultItem, LinkState } from "../../../ipc/search";
import { MatchBadge, BadgeChip, LivenessDot } from "./ResultBadges";

export function ResultRow({
  result,
  selected,
  strength,
  status,
  onToggleSelect,
}: {
  result: SearchResultItem;
  selected: boolean;
  strength: MatchStrength;
  status: LinkState | undefined;
  onToggleSelect: (url: string) => void;
}) {
  async function handleOpen() {
    await openUrl(result.url);
  }

  const badges = parseBadges(result.title);

  return (
    <motion.li
      variants={listItem}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(result.url)}
        aria-label={`Select ${result.title}`}
        style={{ marginLeft: 14, flexShrink: 0, cursor: "pointer" }}
      />
      <button
        onClick={handleOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          padding: "10px 14px",
          borderRadius: 8,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--aura-on-surface)",
          textAlign: "left",
          fontSize: 14,
          transition: "background var(--harmony-dur-fast) var(--harmony-ease-out)",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "var(--aura-surface-raised)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
        onFocus={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "var(--aura-surface-raised)")
        }
        onBlur={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {result.title}
        </span>
        <MatchBadge strength={strength} />
        {badges.map((b) => (
          <BadgeChip key={`${b.kind}:${b.label}`} badge={b} />
        ))}
        <LivenessDot state={status} />
        <span
          style={{
            fontSize: 11,
            color: "var(--aura-on-surface-muted)",
            flexShrink: 0,
          }}
        >
          ↗ open
        </span>
      </button>
    </motion.li>
  );
}
