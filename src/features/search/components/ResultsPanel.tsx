/** Results panel: wraps the browse toolbar, the provider-grouped or game-first
 *  merged result list, and the selection footer in a single card, including
 *  every empty/no-match state (W362, extracted from SearchPage). Rendered once
 *  a search has run (`results !== null`). */
import { AuraCard } from "@aura/react";
import type { LinkState, ProviderResults } from "../../../ipc/search";
import type { RankQuery } from "../resultRanking";
import type { SortKey } from "../resultSort";
import type { MergedResult } from "../resultDedup";
import type { GroupBy } from "../SearchPage";
import { EmptyState as NoResultsNotice } from "../../../components/EmptyState";
import { ResultsToolbar } from "./ResultsToolbar";
import { ProviderResultGroup } from "./ProviderResultGroup";
import { MergedResultsView } from "./MergedResultsView";
import { SelectionFooter } from "./SelectionFooter";

/** One provider group plus its precomputed visible rows (filter → order →
 *  hide-weak), the single source of truth shared by rendering and totals. */
export interface GroupView {
  group: ProviderResults;
  visible: ProviderResults["items"];
}

export function ResultsPanel({
  results,
  query,
  filter,
  onFilterChange,
  sortKey,
  onSortChange,
  groupBy,
  onGroupByChange,
  checkLinks,
  onCheckLinksChange,
  probing,
  hideWeak,
  onHideWeakChange,
  rankQuery,
  statusMap,
  selected,
  expandedKeys,
  collapsed,
  onToggleGroupCollapse,
  onExpandAll,
  onCollapseAll,
  onToggleItem,
  onToggleGroupSelection,
  onToggleMergedExpand,
  onClearSelection,
  onOpenSelected,
  onDownloadSelected,
  downloadableSelectedCount,
  onGetBestMatch,
  canGetBestMatch,
  groupViews,
  mergedViews,
  mergedTotal,
  totalItems,
  visibleTotal,
}: {
  results: ProviderResults[];
  query: string;
  filter: string;
  onFilterChange: (value: string) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  checkLinks: boolean;
  onCheckLinksChange: (value: boolean) => void;
  probing: boolean;
  hideWeak: boolean;
  onHideWeakChange: (value: boolean) => void;
  rankQuery: RankQuery;
  statusMap: Map<string, LinkState>;
  selected: Set<string>;
  expandedKeys: Set<string>;
  collapsed: Set<number>;
  onToggleGroupCollapse: (id: number) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleItem: (url: string) => void;
  onToggleGroupSelection: (urls: string[]) => void;
  onToggleMergedExpand: (key: string) => void;
  onClearSelection: () => void;
  onOpenSelected: () => void;
  onDownloadSelected?: () => void;
  downloadableSelectedCount?: number;
  onGetBestMatch?: () => void;
  canGetBestMatch?: boolean;
  groupViews: GroupView[];
  mergedViews: MergedResult[];
  mergedTotal: number;
  totalItems: number;
  visibleTotal: number;
}) {
  const narrowing = filter.trim().length > 0 || hideWeak;
  const summary =
    groupBy === "game"
      ? narrowing
        ? `${mergedViews.length} of ${mergedTotal} games shown`
        : `${mergedTotal} ${mergedTotal === 1 ? "game" : "games"} · merged from ${totalItems} links across ${results.length} ${results.length === 1 ? "provider" : "providers"}`
      : narrowing
        ? `${visibleTotal} of ${totalItems} links shown`
        : `${totalItems} ${totalItems === 1 ? "link" : "links"} across ${results.length} ${results.length === 1 ? "provider" : "providers"}`;

  return (
    <AuraCard class="rgp-panel" style={{ padding: 0, overflow: "hidden" }}>
      {results.length === 0 ? (
        <div style={{ padding: "20px 16px" }}>
          <NoResultsNotice>No enabled providers to search.</NoResultsNotice>
        </div>
      ) : (
        <>
          {totalItems > 0 && (
            <ResultsToolbar
              filter={filter}
              onFilterChange={onFilterChange}
              sortKey={sortKey}
              onSortChange={onSortChange}
              groupBy={groupBy}
              onGroupByChange={onGroupByChange}
              checkLinks={checkLinks}
              onCheckLinksChange={onCheckLinksChange}
              probing={probing}
              hideWeak={hideWeak}
              onHideWeakChange={onHideWeakChange}
              showExpandCollapse={groupBy === "provider" && results.length > 1}
              collapsedCount={collapsed.size}
              totalGroups={results.length}
              onExpandAll={onExpandAll}
              onCollapseAll={onCollapseAll}
              summary={summary}
              canGetBestMatch={!!canGetBestMatch}
              onGetBestMatch={onGetBestMatch}
            />
          )}
          {groupBy === "game"
            ? totalItems > 0 && (
                <MergedResultsView
                  merged={mergedViews}
                  rankQuery={rankQuery}
                  statusMap={statusMap}
                  selected={selected}
                  expandedKeys={expandedKeys}
                  onToggleItem={onToggleItem}
                  onToggleExpand={onToggleMergedExpand}
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
                  onToggle={() => onToggleGroupCollapse(group.providerId)}
                  visible={visible}
                  rankQuery={rankQuery}
                  filter={filter}
                  selected={selected}
                  statusMap={statusMap}
                  onToggleItem={onToggleItem}
                  onToggleGroup={onToggleGroupSelection}
                />
              ))}
          {selected.size > 0 && (
            <SelectionFooter
              count={selected.size}
              downloadableCount={downloadableSelectedCount}
              onClear={onClearSelection}
              onOpenSelected={onOpenSelected}
              onDownloadSelected={onDownloadSelected}
            />
          )}
        </>
      )}
      {results.length > 0 && totalItems === 0 && (
        <div style={{ padding: "4px 16px 16px", fontSize: 12 }}>
          <NoResultsNotice>
            No previewable links found for "{query}". Use a provider's “open
            search page” link to see full results in your browser.
          </NoResultsNotice>
        </div>
      )}
    </AuraCard>
  );
}
