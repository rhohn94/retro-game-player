/**
 * SearchPage — File-search UI screen (W17 / v0.16 "Trove").
 *
 * Route: /search. Archetype: Search / Query-results (harmony-ux-design.md §5).
 *
 * Key contracts:
 *  - v0.16 PREVIEWS results: the backend fetches each provider's search page and
 *    returns the links it found, grouped by provider. Harmony NEVER downloads
 *    the content — each item's `url` is opened in the system browser via
 *    tauri-plugin-opener. (download-search-design.md)
 *  - Ships with an empty user-provider list; guides the user to add one.
 *  - Controller-navigable: query field → provider chips → result links → add button.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AuraButton, AuraField, AuraCard } from "@aura/react";
import { isDownloadProvider } from "./downloads";
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
  runSearch,
  probeLinks,
} from "../../ipc/search";
import type {
  SearchProvider,
  ProviderResults,
  SearchResultItem,
  LinkState,
} from "../../ipc/search";
import { isAppError } from "../../ipc/commands";
import { ProviderDialog } from "./ProviderDialog";
import type { ProviderFormData } from "./ProviderDialog";
import { ProviderCatalog } from "./ProviderCatalog";
import { listContainer, listItem, DUR, EASE_OUT, EASE_STANDARD } from "../../lib/motion";
import { filterItems } from "./resultFilter";
import {
  sortItems,
  isSortKey,
  SORT_KEYS,
  SORT_LABELS,
  loadSortPref,
  saveSortPref,
} from "./resultSort";
import type { SortKey } from "./resultSort";
import { parseBadges } from "./resultBadges";
import type { Badge } from "./resultBadges";
import {
  groupSelectionState,
  withGroupToggled,
  withItemToggled,
  needsOpenConfirm,
} from "./resultSelection";
import type { GroupSelectionState } from "./resultSelection";
import { rankItems, matchStrength, scoreItem, SEARCH_REGIONS } from "./resultRanking";
import type { RankQuery, MatchStrength, Rankable } from "./resultRanking";
import { dedupeAcrossProviders } from "./resultDedup";
import type { MergedResult } from "./resultDedup";
import { statusIndicator, buildStatusMap } from "./linkStatus";
import { listConsoles } from "../../ipc/console";
import type { ConsoleInfo } from "../../ipc/console";

/** How results are grouped in the panel: by provider (default) or merged into
 *  one game-first row per title ("available from N providers"). */
type GroupBy = "provider" | "game";

/** The most we probe for liveness in one pass (mirrors the backend cap). */
const MAX_PROBE_URLS = 64;

// ── Types ────────────────────────────────────────────────────────────────────

interface DialogState {
  open: boolean;
  provider?: SearchProvider;
}

// ── Result-visibility pipeline ───────────────────────────────────────────────

/** The single source of truth for which rows of a group are shown, in order:
 *  live filter → order (relevance ranking or title/scrape sort) → optional
 *  hide-weak. Used both to render a group and to tally the toolbar totals, so
 *  they never diverge. Pure. */
function computeVisible(
  items: SearchResultItem[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): SearchResultItem[] {
  const filtered = filterItems(items, filter);
  const ordered =
    sortKey === "relevance"
      ? rankItems(filtered, rankQuery)
      : sortItems(filtered, sortKey);
  return hideWeak
    ? ordered.filter((i) => matchStrength(i, rankQuery) !== "none")
    : ordered;
}

/** Adapt a merged row to the {title, url} shape the ranker/filter/match expect,
 *  folding every source URL into the haystack so a URL filter still hits. */
function mergedRankable(m: MergedResult): Rankable {
  return { title: m.title, url: m.sources.map((s) => s.item.url).join(" ") };
}

/** The game-first analogue of {@link computeVisible}: dedupe across providers,
 *  then filter → order (relevance ranking or title/scrape sort) → optional
 *  hide-weak. Pure. */
function computeMerged(
  results: ProviderResults[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): MergedResult[] {
  const merged = dedupeAcrossProviders(results);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? merged.filter((m) => {
        const r = mergedRankable(m);
        return `${r.title} ${r.url}`.toLowerCase().includes(q);
      })
    : merged;
  let ordered: MergedResult[];
  if (sortKey === "relevance") {
    ordered = filtered
      .map((m, index) => ({ m, index, score: scoreItem(mergedRankable(m), rankQuery) }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
      .map((e) => e.m);
  } else {
    ordered = sortItems(filtered, sortKey);
  }
  return hideWeak
    ? ordered.filter((m) => matchStrength(mergedRankable(m), rankQuery) !== "none")
    : ordered;
}

/** The verdict to show on a merged row that folds several source links: alive if
 *  any source is reachable, dead only if every probed source is dead, else
 *  unknown. Returns undefined until at least one source has been probed. */
function aggregateState(
  merged: MergedResult,
  statusMap: Map<string, LinkState>
): LinkState | undefined {
  const states = merged.sources
    .map((s) => statusMap.get(s.item.url))
    .filter((s): s is LinkState => s !== undefined);
  if (states.length === 0) return undefined;
  if (states.includes("alive")) return "alive";
  if (states.every((s) => s === "dead")) return "dead";
  return "unknown";
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Empty state shown when no providers are configured. */
function EmptyState({
  onAddProvider,
  onBrowse,
}: {
  onAddProvider: () => void;
  onBrowse: () => void;
}) {
  return (
    <AuraCard
      class="harmony-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 40,
        textAlign: "center",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 32,
          lineHeight: 1,
          opacity: 0.4,
        }}
      >
        🔍
      </p>
      <h2 style={{ margin: 0, fontSize: 18 }}>No search providers yet</h2>
      <p style={{ margin: 0, color: "var(--aura-on-surface-muted)" }}>
        Add a provider to get started. A provider is a URL template like{" "}
        <code
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            background: "var(--aura-surface-raised)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          https://example.com?q={"{query}"}
        </code>
        . Harmony constructs the link and opens it in your browser — it never
        downloads anything automatically.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <AuraButton variant="primary" onClick={onBrowse}>
          ⊞ Browse providers
        </AuraButton>
        <AuraButton variant="ghost" onClick={onAddProvider}>
          + Add your own
        </AuraButton>
      </div>
    </AuraCard>
  );
}

/** Tone → colour for a parsed badge chip. */
function badgeColor(tone: Badge["tone"]): string {
  if (tone === "good") return "var(--aura-success)";
  if (tone === "bad") return "var(--aura-error)";
  return "var(--aura-on-surface-muted)";
}

/** A relevance "Match"/"Partial" chip (v0.18) — indicates that a row matches
 *  the searched-for game. `none`-strength rows render nothing. */
function MatchBadge({ strength }: { strength: MatchStrength }) {
  if (strength === "none") return null;
  const strong = strength === "strong";
  const color = strong ? "var(--aura-primary)" : "var(--aura-on-surface-muted)";
  return (
    <span
      title={strong ? "Strong match for your search" : "Partial match for your search"}
      style={{
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        background: strong ? "var(--harmony-provider-enabled-bg)" : "transparent",
        color,
        flexShrink: 0,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {strong ? "✓ Match" : "~ Partial"}
    </span>
  );
}

/** A small liveness dot (v0.19) — green alive / red dead / grey unknown. Renders
 *  nothing until the link has been probed (`state` undefined = not checked). */
function LivenessDot({ state }: { state: LinkState | undefined }) {
  if (!state) return null;
  const ind = statusIndicator(state);
  return (
    <span
      role="img"
      aria-label={ind.label}
      title={ind.label}
      style={{ color: ind.color, fontSize: 10, lineHeight: 1, flexShrink: 0 }}
    >
      {ind.symbol}
    </span>
  );
}

/** A compact chip for a title-parsed badge (region / revision / quality / type). */
function BadgeChip({ badge }: { badge: Badge }) {
  const color = badgeColor(badge.tone);
  return (
    <span
      title={badge.kind}
      style={{
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        color,
        flexShrink: 0,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {badge.label}
    </span>
  );
}

/** A single previewed result: a select checkbox + a focusable open-link button
 *  with title-parsed badges. */
function ResultRow({
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

/** A small count/status pill for a provider header: visible link count, or an
 * error marker when the fetch failed. */
function GroupCountBadge({
  group,
  count,
}: {
  group: ProviderResults;
  count: number;
}) {
  const isError = group.error !== null;
  const label = isError ? "error" : String(count);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        minWidth: 18,
        textAlign: "center",
        padding: "2px 6px",
        borderRadius: 10,
        background: isError ? "transparent" : "var(--aura-surface-raised)",
        border: isError ? "1px solid var(--aura-error)" : "none",
        color: isError ? "var(--aura-error)" : "var(--aura-on-surface-muted)",
      }}
    >
      {label}
    </span>
  );
}

/** A tri-state "select all in this group" checkbox (checked / indeterminate /
 * empty), driven by the group's {@link GroupSelectionState}. */
function GroupSelectAll({
  state,
  onToggle,
  label,
}: {
  state: GroupSelectionState;
  onToggle: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      onChange={onToggle}
      aria-label={label}
      style={{ marginLeft: 16, flexShrink: 0, cursor: "pointer" }}
    />
  );
}

/** One provider's previewed results, as a collapsible group. The header is a
 * toggle (rotating chevron + provider name + count badge) plus a group
 * select-all; the body shows the filtered + sorted rows (or a no-match / empty /
 * error note). The open-search-page link and the direct-download marker sit
 * beside the toggle so they don't trigger a collapse. */
function ProviderResultGroup({
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
function MergedResultsView({
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
function ProviderChip({
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

// ── Main page ────────────────────────────────────────────────────────────────

export function SearchPage() {
  // A "Find downloads for this title" jump (e.g. from the game detail page)
  // arrives with the title pre-filled in navigation state; we run it once the
  // providers have loaded.
  const location = useLocation();
  const initialQuery = (
    (location.state as { query?: string } | null)?.query ?? ""
  ).trim();
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ProviderResults[] | null>(null);
  // Collapsed provider groups, keyed by providerId. Empty/errored groups start
  // collapsed so the populated providers lead; the user can fold any group.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Result-browsing controls (v0.17): live filter, sort (persisted), selection.
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(loadSortPref);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Structured search + relevance controls (v0.18): console/region filters, the
  // hide-weak toggle, and the executed query captured for ranking.
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);
  const [consoleKey, setConsoleKey] = useState("");
  const [region, setRegion] = useState("");
  const [hideWeak, setHideWeak] = useState(false);
  const [rankQuery, setRankQuery] = useState<RankQuery>({ name: "" });
  // Grouping + liveness (v0.19): provider-first (default) vs game-first merged
  // view; an opt-in HEAD-probe liveness check with its url→state map; and which
  // merged rows are expanded to show their per-provider sources.
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [checkLinks, setCheckLinks] = useState(false);
  const [statusMap, setStatusMap] = useState<Map<string, LinkState>>(new Map());
  const [probing, setProbing] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  // Provider discovery (v0.20): the curated "Browse providers" catalog sheet.
  const [catalogOpen, setCatalogOpen] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);
  const didAutoRun = useRef(false);

  // Load providers + the console catalog (for the structured-search select) on
  // mount. A console-list failure simply leaves the select empty.
  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
    listConsoles()
      .then(setConsoles)
      .catch(() => setConsoles([]));
  }, []);

  // Run search: collect results from enabled providers, grouped by provider.
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const active = providers.filter((p) => p.enabled);
    if (active.length === 0) return;

    // Resolve the selected console into a short token for the backend compose
    // (e.g. "SNES") and richer tokens for client-side ranking (name + abbr +
    // key, so any of them matches a result title).
    const selectedConsole = consoles.find((c) => c.key === consoleKey);
    const consoleComposeToken = selectedConsole?.abbreviation ?? "";
    const consoleRankTokens = selectedConsole
      ? `${selectedConsole.name} ${selectedConsole.abbreviation} ${selectedConsole.key}`
      : "";
    const reg = region.trim();

    setRunning(true);
    setSearchError(null);
    setResults(null);
    // A new search is a fresh browse: clear the filter, selection, stale
    // liveness verdicts, and merged-row expansions, and capture the executed
    // query for relevance ranking + Match badges.
    setFilter("");
    setSelected(new Set());
    setStatusMap(new Map());
    setExpandedKeys(new Set());
    setRankQuery({
      name: q,
      console: consoleRankTokens || undefined,
      region: reg || undefined,
    });

    try {
      const all = await runSearch({
        query: q,
        console: consoleComposeToken || undefined,
        region: reg || undefined,
      });
      setResults(all);
      // Start with empty/errored groups folded; populated providers stay open.
      setCollapsed(
        new Set(all.filter((g) => g.items.length === 0).map((g) => g.providerId))
      );
    } catch (err) {
      const detail = isAppError(err) ? err.detail : String(err);
      setSearchError(detail);
    } finally {
      setRunning(false);
    }
  }, [query, providers, consoles, consoleKey, region]);

  // Auto-run a search that arrived pre-filled via navigation state ("Find
  // downloads for this title"), once providers have loaded so enabled ones
  // contribute. Runs at most once per mount.
  useEffect(() => {
    if (didAutoRun.current || !initialQuery || providers.length === 0) return;
    didAutoRun.current = true;
    void handleSearch();
  }, [providers, initialQuery, handleSearch]);

  // Liveness probe (v0.19): when "Check links" is on, HEAD-probe the previewed
  // links (deduped + capped) and store their verdicts; off → clear. Re-runs when
  // a new result set arrives. The probe is opt-in and never blocks browsing.
  useEffect(() => {
    if (!checkLinks || !results) {
      setStatusMap(new Map());
      return;
    }
    const urls = Array.from(
      new Set(results.flatMap((g) => g.items.map((i) => i.url)))
    ).slice(0, MAX_PROBE_URLS);
    if (urls.length === 0) return;
    let cancelled = false;
    setProbing(true);
    probeLinks(urls)
      .then((statuses) => {
        if (!cancelled) setStatusMap(buildStatusMap(statuses));
      })
      .catch(() => {
        if (!cancelled) setStatusMap(new Map());
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [checkLinks, results]);

  // Keyboard: Enter in query field runs search.
  function handleQueryKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  // Provider management callbacks.
  async function handleToggle(id: number) {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    const updated = await updateProvider({ id, enabled: !p.enabled });
    setProviders((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  function handleEditOpen(provider: SearchProvider) {
    setDialog({ open: true, provider });
  }

  async function handleRemove(id: number) {
    await removeProvider({ id });
    setProviders((prev) => prev.filter((x) => x.id !== id));
  }

  async function handleDialogSave(data: ProviderFormData) {
    if (dialog.provider) {
      const updated = await updateProvider({
        id: dialog.provider.id,
        name: data.name,
        urlTemplate: data.urlTemplate,
        kind: data.kind,
        directDownload: data.directDownload,
        composeFilters: data.composeFilters,
      });
      setProviders((prev) =>
        prev.map((x) => (x.id === dialog.provider!.id ? updated : x))
      );
    } else {
      const created = await addProvider(data);
      setProviders((prev) => [...prev, created]);
    }
    setDialog({ open: false });
  }

  // A provider added from the catalog sheet (v0.20) — append if new.
  function handleCatalogAdded(created: SearchProvider) {
    setProviders((prev) =>
      prev.some((p) => p.id === created.id) ? prev : [...prev, created]
    );
  }

  // Collapse controls for the result groups.
  function toggleGroup(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandAll() {
    setCollapsed(new Set());
  }
  function collapseAll() {
    setCollapsed(new Set((results ?? []).map((g) => g.providerId)));
  }

  // Sort: persist the choice so it carries across searches and restarts.
  function handleSortChange(key: SortKey) {
    setSortKey(key);
    saveSortPref(key);
  }

  // Selection (keyed by result url).
  function toggleItem(url: string) {
    setSelected((prev) => withItemToggled(url, prev));
  }
  function toggleGroupSelection(urls: string[]) {
    setSelected((prev) => withGroupToggled(urls, prev));
  }
  function clearSelection() {
    setSelected(new Set());
  }
  // Expand/collapse one merged row's per-provider source list (game view).
  function toggleMergedExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  async function openSelected() {
    const urls = [...selected];
    if (urls.length === 0) return;
    if (
      needsOpenConfirm(urls.length) &&
      !window.confirm(`Open ${urls.length} links in your browser?`)
    ) {
      return;
    }
    for (const url of urls) await openUrl(url);
  }

  // Results arrive already grouped per provider from the backend (v0.16).
  const hasProviders = providers.length > 0;
  const activeCount = providers.filter((p) => p.enabled).length;
  const totalItems = results?.reduce((n, g) => n + g.items.length, 0) ?? 0;
  // Precompute the visible rows per group (filter → order → hide-weak) once, as
  // the single source of truth for both rendering and the toolbar summary.
  const groupViews =
    results?.map((g) => ({
      group: g,
      visible: computeVisible(g.items, filter, sortKey, rankQuery, hideWeak),
    })) ?? [];
  const visibleTotal = groupViews.reduce((n, gv) => n + gv.visible.length, 0);
  // Game-first merged rows (v0.19), computed only when that view is active.
  const mergedViews =
    groupBy === "game" && results
      ? computeMerged(results, filter, sortKey, rankQuery, hideWeak)
      : [];
  // Unfiltered merged-row total, for the "N of M games shown" summary.
  const mergedTotal =
    groupBy === "game" && results ? dedupeAcrossProviders(results).length : 0;
  const narrowing = filter.trim().length > 0 || hideWeak;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}
      aria-label="File search"
    >
      {/* Header */}
      <h1 style={{ margin: 0, fontSize: 22 }}>Search</h1>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Find games and info across your providers. Harmony{" "}
        <strong>previews what each provider found</strong> and opens your chosen
        link in your browser — it <strong>never downloads files for you</strong>.{" "}
        <span aria-hidden>⬇</span> marks download sources. Providers vary in what
        they host; you're responsible for how you use any link you open.
      </p>

      {/* Query + structured filters + run */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <AuraField style={{ flex: 1, minWidth: 200 }}>
          <input
            ref={queryRef}
            name="search-query"
            className="harmony-input"
            type="search"
            value={query}
            placeholder="Game name…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleQueryKey}
          />
        </AuraField>
        {/* Structured filters (v0.18): always feed relevance ranking; appended
            to a provider's query only when it has compose-filters enabled. */}
        <select
          name="search-console"
          className="harmony-input"
          aria-label="Console"
          value={consoleKey}
          onChange={(e) => setConsoleKey(e.target.value)}
          style={{ fontSize: 13, padding: "6px 8px", maxWidth: 180 }}
        >
          <option value="">Any console</option>
          {consoles.map((c) => (
            <option key={c.key} value={c.key}>
              {c.abbreviation || c.name}
            </option>
          ))}
        </select>
        <select
          name="search-region"
          className="harmony-input"
          aria-label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{ fontSize: 13, padding: "6px 8px", maxWidth: 150 }}
        >
          <option value="">Any region</option>
          {SEARCH_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <AuraButton
          variant="primary"
          onClick={handleSearch}
          disabled={!query.trim() || activeCount === 0 || running}
        >
          {running ? "Searching…" : "Search"}
        </AuraButton>
      </div>

      {/* Provider chips */}
      {hasProviders ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--aura-on-surface-muted)", marginRight: 2 }}>
            Providers:
          </span>
          {providers.map((p) => (
            <ProviderChip
              key={p.id}
              provider={p}
              onToggle={handleToggle}
              onEdit={handleEditOpen}
              onRemove={handleRemove}
            />
          ))}
          <AuraButton
            variant="ghost"
            style={{ fontSize: 13, padding: "4px 10px" }}
            onClick={() => setDialog({ open: true })}
          >
            + Add
          </AuraButton>
          <AuraButton
            variant="ghost"
            style={{ fontSize: 13, padding: "4px 10px" }}
            onClick={() => setCatalogOpen(true)}
          >
            ⊞ Browse providers
          </AuraButton>
        </div>
      ) : (
        /* No providers configured → empty state */
        <EmptyState
          onAddProvider={() => setDialog({ open: true })}
          onBrowse={() => setCatalogOpen(true)}
        />
      )}

      {/* Search error */}
      {searchError && (
        <p style={{ margin: 0, color: "var(--aura-error)", fontSize: 14 }}>
          Search failed: {searchError}
        </p>
      )}

      {/* Results — one previewed group per provider */}
      {results !== null && (
        <AuraCard
          class="harmony-panel"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {results.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "20px 16px",
                color: "var(--aura-on-surface-muted)",
                fontSize: 14,
              }}
            >
              No enabled providers to search.
            </p>
          ) : (
            <>
              {/* Browse toolbar: filter + sort + summary + expand/collapse-all.
                  Shown once there are any links to browse. */}
              {totalItems > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--aura-outline-subtle, transparent)",
                  }}
                >
                  <AuraField style={{ flex: 1, minWidth: 160 }}>
                    <input
                      name="result-filter"
                      className="harmony-input"
                      type="search"
                      value={filter}
                      placeholder="Filter results…"
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </AuraField>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    Sort
                    <select
                      name="result-sort"
                      className="harmony-input"
                      value={sortKey}
                      onChange={(e) =>
                        isSortKey(e.target.value) && handleSortChange(e.target.value)
                      }
                      style={{ fontSize: 12, padding: "4px 6px" }}
                    >
                      {SORT_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {SORT_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Group-by (v0.19): provider-first (default) vs game-first
                      merged rows ("available from N providers"). */}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    Group
                    <select
                      name="result-groupby"
                      className="harmony-input"
                      value={groupBy}
                      onChange={(e) =>
                        setGroupBy(e.target.value === "game" ? "game" : "provider")
                      }
                      style={{ fontSize: 12, padding: "4px 6px" }}
                    >
                      <option value="provider">By provider</option>
                      <option value="game">By game</option>
                    </select>
                  </label>
                  {/* Liveness (v0.19): opt-in HEAD probe of each link. Off by
                      default; never blocks browsing. */}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                      cursor: "pointer",
                    }}
                    title="Probe each link with a HEAD request and mark it alive / dead / unknown. Off by default."
                  >
                    <input
                      name="result-check-links"
                      type="checkbox"
                      checked={checkLinks}
                      onChange={(e) => setCheckLinks(e.target.checked)}
                    />
                    {probing ? "Checking links…" : "Check links"}
                  </label>
                  {/* Hide-weak (v0.18): off by default; weak matches are
                      otherwise demoted to the bottom, never hidden silently. */}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                      cursor: "pointer",
                    }}
                    title="Hide rows that don't match your search (kept, just hidden)"
                  >
                    <input
                      name="result-hide-weak"
                      type="checkbox"
                      checked={hideWeak}
                      onChange={(e) => setHideWeak(e.target.checked)}
                    />
                    Hide unlikely matches
                  </label>
                  {groupBy === "provider" && results.length > 1 && (
                    <>
                      <button
                        onClick={expandAll}
                        disabled={collapsed.size === 0}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: collapsed.size === 0 ? "default" : "pointer",
                          padding: 0,
                          fontSize: 11,
                          color:
                            collapsed.size === 0
                              ? "var(--aura-on-surface-muted)"
                              : "var(--aura-primary)",
                          opacity: collapsed.size === 0 ? 0.5 : 1,
                        }}
                      >
                        Expand all
                      </button>
                      <span style={{ color: "var(--aura-on-surface-muted)", fontSize: 11 }}>
                        ·
                      </span>
                      <button
                        onClick={collapseAll}
                        disabled={collapsed.size === results.length}
                        style={{
                          background: "none",
                          border: "none",
                          cursor:
                            collapsed.size === results.length ? "default" : "pointer",
                          padding: 0,
                          fontSize: 11,
                          color:
                            collapsed.size === results.length
                              ? "var(--aura-on-surface-muted)"
                              : "var(--aura-primary)",
                          opacity: collapsed.size === results.length ? 0.5 : 1,
                        }}
                      >
                        Collapse all
                      </button>
                    </>
                  )}
                  <span
                    style={{
                      width: "100%",
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    {groupBy === "game"
                      ? narrowing
                        ? `${mergedViews.length} of ${mergedTotal} games shown`
                        : `${mergedTotal} ${mergedTotal === 1 ? "game" : "games"} · merged from ${totalItems} links across ${results.length} ${results.length === 1 ? "provider" : "providers"}`
                      : narrowing
                        ? `${visibleTotal} of ${totalItems} links shown`
                        : `${totalItems} ${totalItems === 1 ? "link" : "links"} across ${results.length} ${results.length === 1 ? "provider" : "providers"}`}
                  </span>
                </div>
              )}
              {groupBy === "game"
                ? totalItems > 0 && (
                    <MergedResultsView
                      merged={mergedViews}
                      rankQuery={rankQuery}
                      statusMap={statusMap}
                      selected={selected}
                      expandedKeys={expandedKeys}
                      onToggleItem={toggleItem}
                      onToggleExpand={toggleMergedExpand}
                      emptyNote={
                        narrowing
                          ? "No matches in the merged view."
                          : "No previewable links found."
                      }
                    />
                  )
                : groupViews.map(({ group, visible }) => (
                    <ProviderResultGroup
                      key={group.providerId}
                      group={group}
                      collapsed={collapsed.has(group.providerId)}
                      onToggle={() => toggleGroup(group.providerId)}
                      visible={visible}
                      rankQuery={rankQuery}
                      filter={filter}
                      selected={selected}
                      statusMap={statusMap}
                      onToggleItem={toggleItem}
                      onToggleGroup={toggleGroupSelection}
                    />
                  ))}
              {/* Selection footer: batch-open the chosen links in the browser. */}
              {selected.size > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    borderTop: "1px solid var(--aura-outline-subtle, transparent)",
                    background: "var(--aura-surface-raised)",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {selected.size} selected
                  </span>
                  <button
                    onClick={clearSelection}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    Clear
                  </button>
                  <AuraButton variant="primary" onClick={openSelected}>
                    Open {selected.size} in browser ↗
                  </AuraButton>
                </div>
              )}
            </>
          )}
          {results.length > 0 && totalItems === 0 && (
            <p
              style={{
                margin: 0,
                padding: "4px 16px 16px",
                color: "var(--aura-on-surface-muted)",
                fontSize: 12,
              }}
            >
              No previewable links found for "{query}". Use a provider's “open
              search page” link to see full results in your browser.
            </p>
          )}
        </AuraCard>
      )}

      {/* Add / Edit provider dialog */}
      <ProviderDialog
        open={dialog.open}
        provider={dialog.provider}
        onSave={handleDialogSave}
        onClose={() => setDialog({ open: false })}
      />

      {/* Discover & add providers from the curated catalog (v0.20) */}
      <ProviderCatalog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdded={handleCatalogAdded}
      />
    </section>
  );
}
