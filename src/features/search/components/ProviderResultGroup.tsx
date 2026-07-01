/** One provider's previewed results, as a collapsible group. The header is a
 * toggle (rotating chevron + provider name + count badge) plus a group
 * select-all; the body shows the filtered + sorted rows (or a no-match / empty /
 * error note). The open-search-page link and the direct-download marker sit
 * beside the toggle so they don't trigger a collapse. */
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "../../../ipc/opener";
import { listContainer, DUR, EASE_OUT, EASE_STANDARD } from "../../../lib/motion";
import { groupSelectionState } from "../resultSelection";
import { matchStrength } from "../resultRanking";
import type { RankQuery } from "../resultRanking";
import type { SearchResultItem, ProviderResults, LinkState } from "../../../ipc/search";
import { ResultRow } from "./ResultRow";
import { GroupCountBadge, GroupSelectAll } from "./GroupControls";

export function ProviderResultGroup({
  group,
  collapsed,
  onToggle,
  visible,
  rankQuery,
  filter,
  selected,
  statusMap,
  onToggleItem,
  onToggleGroup,
}: {
  group: ProviderResults;
  collapsed: boolean;
  onToggle: () => void;
  /** The rows actually shown (filter → order → hide-weak), computed by parent. */
  visible: SearchResultItem[];
  /** The executed search, for per-row match-strength badges. */
  rankQuery: RankQuery;
  filter: string;
  selected: ReadonlySet<string>;
  /** url → liveness verdict, when the "Check links" probe has run (else empty). */
  statusMap: Map<string, LinkState>;
  onToggleItem: (url: string) => void;
  onToggleGroup: (urls: string[]) => void;
}) {
  async function openSearchPage() {
    if (group.searchUrl) await openUrl(group.searchUrl);
  }

  const bodyId = `provider-group-${group.providerId}`;
  const visibleUrls = visible.map((i) => i.url);
  const selState = groupSelectionState(visibleUrls, selected);
  const filteredEmpty = group.items.length > 0 && visible.length === 0;

  return (
    <div style={{ borderTop: "1px solid var(--aura-outline-subtle, transparent)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 16px 4px 0",
        }}
      >
        {/* Group select-all (only when there are visible, selectable rows). */}
        {visible.length > 0 ? (
          <GroupSelectAll
            state={selState}
            onToggle={() => onToggleGroup(visibleUrls)}
            label={`Select all from ${group.providerName}`}
          />
        ) : (
          <span style={{ width: 16, marginLeft: 16, flexShrink: 0 }} />
        )}
        {/* The toggle owns the chevron + name + count and spans the free space. */}
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "8px 0",
            color: "var(--aura-on-surface-muted)",
            textAlign: "left",
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <motion.span
            aria-hidden
            animate={{ rotate: collapsed ? 0 : 90 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}
            style={{ fontSize: 10, lineHeight: 1, display: "inline-block", width: 10 }}
          >
            ▶
          </motion.span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.providerName}
          </span>
          <GroupCountBadge group={group} count={visible.length} />
        </button>
        {/* v0.16 scaffolding: a vendor with the future direct-download
            capability shows a clearly-disabled marker — no action is wired yet. */}
        {group.directDownload && (
          <span
            title="Direct download is not available yet — coming in a future release."
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--aura-on-surface-muted)",
              border: "1px solid var(--aura-on-surface-muted)",
              borderRadius: 4,
              padding: "1px 5px",
              opacity: 0.6,
              flexShrink: 0,
            }}
          >
            ⬇ Direct download · soon
          </span>
        )}
        {group.searchUrl && (
          <button
            onClick={openSearchPage}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontSize: 11,
              color: "var(--aura-primary)",
              flexShrink: 0,
            }}
            title="Open the full results page in your browser"
          >
            open search page ↗
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE_STANDARD }}
            style={{ overflow: "hidden" }}
          >
            {group.error ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 16px 10px",
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                }}
              >
                Couldn't load a preview ({group.error}). Use “open search page”
                above to view results in your browser.
              </p>
            ) : group.items.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 16px 10px",
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                }}
              >
                No previewable links found.
              </p>
            ) : filteredEmpty ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 16px 10px",
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                }}
              >
                {filter.trim()
                  ? `No matches for “${filter}” here.`
                  : "No likely matches here (hidden by “Hide unlikely matches”)."}
              </p>
            ) : (
              <motion.ul
                variants={listContainer}
                initial="hidden"
                animate="visible"
                style={{ listStyle: "none", margin: 0, padding: "0 4px 8px" }}
              >
                {visible.map((item) => (
                  <ResultRow
                    key={item.url}
                    result={item}
                    selected={selected.has(item.url)}
                    strength={matchStrength(item, rankQuery)}
                    status={statusMap.get(item.url)}
                    onToggleSelect={onToggleItem}
                  />
                ))}
              </motion.ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
