/** The game-first (v0.19) merged results view: one row per title with an
 *  "available from N providers" expander, plus the provider chip toggle used
 *  in the provider-chips bar. */
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "../../../ipc/opener";
import { listContainer, listItem, DUR, EASE_STANDARD } from "../../../lib/motion";
import { parseBadges } from "../resultBadges";
import { matchStrength } from "../resultRanking";
import type { RankQuery, MatchStrength } from "../resultRanking";
import type { MergedResult } from "../resultDedup";
import { isDownloadProvider } from "../downloads";
import type { SearchProvider, LinkState } from "../../../ipc/search";
import { MatchBadge, BadgeChip, LivenessDot } from "./ResultBadges";
import { mergedRankable, aggregateState } from "./resultVisibility";

/** One game-first row (v0.19): a merged title with an "available from N
 *  providers" expander. The primary button opens the first source; the expander
 *  lists every provider source so the user can pick which one to open. */
function MergedRow({
  merged,
  strength,
  statusMap,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: {
  merged: MergedResult;
  strength: MatchStrength;
  statusMap: Map<string, LinkState>;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: (url: string) => void;
  onToggleExpand: (key: string) => void;
}) {
  const rep = merged.sources[0];
  const multi = merged.sources.length > 1;
  const badges = parseBadges(merged.title);
  const aggregate = aggregateState(merged, statusMap);

  return (
    <motion.li
      variants={listItem}
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(rep.item.url)}
          aria-label={`Select ${merged.title}`}
          style={{ marginLeft: 14, flexShrink: 0, cursor: "pointer" }}
        />
        <button
          onClick={() => openUrl(rep.item.url)}
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
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "var(--aura-surface-raised)")
          }
          onMouseLeave={(e) =>
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
            {merged.title}
          </span>
          <MatchBadge strength={strength} />
          {badges.map((b) => (
            <BadgeChip key={`${b.kind}:${b.label}`} badge={b} />
          ))}
          <LivenessDot state={aggregate} />
          <span
            style={{ fontSize: 11, color: "var(--aura-on-surface-muted)", flexShrink: 0 }}
          >
            ↗ open
          </span>
        </button>
        {/* Source-count pill: a toggle when there is more than one provider. */}
        <button
          onClick={() => multi && onToggleExpand(merged.key)}
          disabled={!multi}
          title={
            multi
              ? `Available from ${merged.sources.length} providers — choose a source`
              : `Only from ${rep.providerName}`
          }
          style={{
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            padding: "3px 7px",
            marginRight: 12,
            borderRadius: 10,
            border: `1px solid ${multi ? "var(--aura-primary)" : "var(--aura-on-surface-muted)"}`,
            background: multi ? "var(--harmony-provider-enabled-bg)" : "transparent",
            color: multi ? "var(--aura-primary)" : "var(--aura-on-surface-muted)",
            cursor: multi ? "pointer" : "default",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {multi
            ? `${expanded ? "▾" : "▸"} ${merged.sources.length} providers`
            : rep.providerName}
        </button>
      </div>

      {/* Expanded source list: one row per provider link. */}
      <AnimatePresence initial={false}>
        {multi && expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_STANDARD }}
            style={{
              listStyle: "none",
              margin: 0,
              padding: "0 0 6px 44px",
              overflow: "hidden",
            }}
          >
            {merged.sources.map((s) => (
              <li
                key={s.item.url}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <button
                  onClick={() => openUrl(s.item.url)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                    minWidth: 0,
                    padding: "5px 10px",
                    borderRadius: 6,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--aura-on-surface-muted)",
                    textAlign: "left",
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "var(--aura-surface-raised)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "transparent")
                  }
                  title={s.item.title}
                >
                  <LivenessDot state={statusMap.get(s.item.url)} />
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>
                    {s.providerName}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      opacity: 0.8,
                    }}
                  >
                    {s.item.title}
                  </span>
                  <span style={{ flexShrink: 0 }}>↗</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** The game-first results view (v0.19): a flat, merged list with per-row
 *  "available from N providers" expanders. */
export function MergedResultsView({
  merged,
  rankQuery,
  statusMap,
  selected,
  expandedKeys,
  onToggleItem,
  onToggleExpand,
  emptyNote,
}: {
  merged: MergedResult[];
  rankQuery: RankQuery;
  statusMap: Map<string, LinkState>;
  selected: ReadonlySet<string>;
  expandedKeys: ReadonlySet<string>;
  onToggleItem: (url: string) => void;
  onToggleExpand: (key: string) => void;
  emptyNote: string;
}) {
  if (merged.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          padding: "12px 16px",
          fontSize: 12,
          color: "var(--aura-on-surface-muted)",
        }}
      >
        {emptyNote}
      </p>
    );
  }
  return (
    <motion.ul
      variants={listContainer}
      initial="hidden"
      animate="visible"
      style={{ listStyle: "none", margin: 0, padding: "4px 4px 8px" }}
    >
      {merged.map((m) => (
        <MergedRow
          key={m.key}
          merged={m}
          strength={matchStrength(mergedRankable(m), rankQuery)}
          statusMap={statusMap}
          selected={selected.has(m.sources[0].item.url)}
          expanded={expandedKeys.has(m.key)}
          onToggleSelect={onToggleItem}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </motion.ul>
  );
}

/** Provider chip toggle with edit/remove actions. */
export function ProviderChip({
  provider,
  onToggle,
  onEdit,
  onRemove,
}: {
  provider: SearchProvider;
  onToggle: (id: number) => void;
  onEdit: (provider: SearchProvider) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: provider.enabled ? 600 : 400,
        border: `1.5px solid ${provider.enabled ? "var(--aura-primary)" : "var(--aura-on-surface-muted)"}`,
        background: provider.enabled
          ? "var(--harmony-provider-enabled-bg)"
          : "transparent",
        color: provider.enabled
          ? "var(--aura-primary)"
          : "var(--aura-on-surface-muted)",
        transition: "all 0.12s",
      }}
    >
      <button
        onClick={() => onToggle(provider.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
        }}
        title={provider.enabled ? "Disable provider" : "Enable provider"}
      >
        {provider.enabled ? "✓ " : ""}
        {isDownloadProvider(provider) ? "⬇ " : ""}
        {provider.name}
      </button>
      <button
        onClick={() => onEdit(provider)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--aura-on-surface-muted)",
          fontSize: 11,
        }}
        title="Edit provider"
      >
        ✎
      </button>
      <button
        onClick={() => onRemove(provider.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--aura-on-surface-muted)",
          fontSize: 12,
        }}
        title="Remove provider"
      >
        ×
      </button>
    </span>
  );
}
