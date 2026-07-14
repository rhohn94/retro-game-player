/** One provider's previewed results, as a collapsible group. The header is a
 * toggle (rotating chevron + provider name + count badge) plus a group
 * select-all; the body shows the filtered + sorted rows (or a no-match / empty /
 * error note). The open-search-page link and the direct-download marker sit
 * beside the toggle so they don't trigger a collapse. */
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "../../../ipc/opener";
import { listContainer, DUR, EASE_OUT, EASE_STANDARD } from "../../../lib/motion";
import { groupSelectionState } from "../resultSelection";
import { matchStrength } from "../resultRanking";
import type { RankQuery } from "../resultRanking";
import type { SearchResultItem, ProviderResults, LinkState } from "../../../ipc/search";
import { FocusRing, useFocusable } from "../../controller";
import { ResultRow } from "./ResultRow";
import { GroupCountBadge, GroupSelectAll } from "./GroupControls";
import { healthBadgeLabel } from "../providerHealth";

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
  // Registers the group's expand/collapse toggle with the spatial-nav registry
  // (W268) — the group header is a required navigable stop per route audit.
  const { ref, isFocused } = useFocusable<HTMLButtonElement>(
    `search:group:${group.providerId}`,
    onToggle,
  );
  useEffect(() => {
    if (isFocused) ref.current?.focus();
  }, [isFocused, ref]);

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
        <FocusRing focused={isFocused}>
        <button
          ref={ref}
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
          {healthBadgeLabel(group) && (
            <span
              title={group.error ?? undefined}
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--aura-on-surface-muted)",
                border: "1px solid var(--aura-outline-subtle, currentColor)",
                borderRadius: 4,
                padding: "1px 5px",
                flexShrink: 0,
              }}
            >
              {healthBadgeLabel(group)}
            </span>
          )}
        </button>
        </FocusRing>
        {/* Direct download is live for opted-in providers (v0.24 W244): the
            chip marks the group; each row carries the actual ⬇ action. */}
        {group.directDownload && (
          <span
            title="Direct download is enabled for this provider — use ⬇ download on a result row."
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--aura-primary)",
              border: "1px solid var(--aura-primary)",
              borderRadius: 4,
              padding: "1px 5px",
              flexShrink: 0,
            }}
          >
            ⬇ Direct download
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
                role="list"
                aria-label={`Results from ${group.providerName}`}
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
                    downloadProviderId={group.directDownload ? group.providerId : undefined}
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
