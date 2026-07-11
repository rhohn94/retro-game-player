/**
 * SearchPage — File-search UI screen (W17 / v0.16 "Trove").
 *
 * Route: /search. Archetype: Search / Query-results (harmony-ux-design.md §5).
 *
 * Key contracts:
 *  - v0.16 PREVIEWS results: the backend fetches each provider's search page and
 *    returns the links it found, grouped by provider. Retro Game Player NEVER downloads
 *    the content — each item's `url` is opened in the system browser via
 *    tauri-plugin-opener. (download-search-design.md)
 *  - Ships with an empty user-provider list; guides the user to add one.
 *  - Controller-navigable: query field → provider chips → result links → add button.
 *
 * W362 (v0.36): decomposed into a container (this file) plus data hooks
 * (hooks/useSearchProviders, hooks/useSearchExecution, hooks/useLinkProbe,
 * hooks/useResultSelection) and presentational subcomponents
 * (components/SearchQueryBar, components/ProviderChipsBar,
 * components/ResultsPanel, components/ResultsToolbar,
 * components/SelectionFooter, components/FocusableControls). Behavior is
 * unchanged — see those files for the extracted logic.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ProviderDialog } from "./ProviderDialog";
import { ProviderCatalog } from "./ProviderCatalog";
import { loadSortPref, saveSortPref } from "./resultSort";
import type { SortKey } from "./resultSort";
import { dedupeAcrossProviders } from "./resultDedup";
import { listConsoles } from "../../ipc/console";
import type { ConsoleInfo } from "../../ipc/console";
import { computeVisible, computeMerged } from "./components/resultVisibility";
import { ErrorNotice } from "../../components/ErrorNotice";
import { SearchHeader, SearchQueryBar } from "./components/SearchQueryBar";
import { ProviderChipsBar } from "./components/ProviderChipsBar";
import { ResultsPanel } from "./components/ResultsPanel";
import { useSearchProviders } from "./hooks/useSearchProviders";
import { useSearchExecution } from "./hooks/useSearchExecution";
import { useLinkProbe } from "./hooks/useLinkProbe";
import { useResultSelection } from "./hooks/useResultSelection";
import { swallow } from "../../ipc/swallow";

/** How results are grouped in the panel: by provider (default) or merged into
 *  one game-first row per title ("available from N providers"). */
export type GroupBy = "provider" | "game";

// ── Main page ────────────────────────────────────────────────────────────────

export function SearchPage() {
  // A "Find downloads for this title" jump (e.g. from the game detail page)
  // arrives with the title pre-filled in navigation state; we run it once the
  // providers have loaded.
  const location = useLocation();
  const initialQuery = (
    (location.state as { query?: string } | null)?.query ?? ""
  ).trim();

  const providersApi = useSearchProviders();
  const selection = useResultSelection();
  const consoles = useConsoleCatalog();
  const execution = useSearchExecution(
    initialQuery,
    providersApi.providers,
    consoles,
    selection.reset
  );
  const linkProbe = useLinkProbe(execution.results);

  // Result-browsing controls (v0.17): live filter, sort (persisted).
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(loadSortPref);
  // Structured search + relevance controls (v0.18): the hide-weak toggle.
  const [hideWeak, setHideWeak] = useState(false);
  // Grouping (v0.19): provider-first (default) vs game-first merged view.
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");

  // Keyboard: Enter in query field runs search.
  function handleQueryKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") execution.handleSearch();
  }

  // Sort: persist the choice so it carries across searches and restarts.
  function handleSortChange(key: SortKey) {
    setSortKey(key);
    saveSortPref(key);
  }

  // Collapse controls for the result groups.
  function toggleGroupCollapse(id: number) {
    execution.setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandAll() {
    execution.setCollapsed(new Set());
  }
  function collapseAll() {
    execution.setCollapsed(
      new Set((execution.results ?? []).map((g) => g.providerId))
    );
  }

  // Results arrive already grouped per provider from the backend (v0.16).
  const { results } = execution;
  const totalItems = results?.reduce((n, g) => n + g.items.length, 0) ?? 0;
  // Precompute the visible rows per group (filter → order → hide-weak) once, as
  // the single source of truth for both rendering and the toolbar summary.
  const groupViews =
    results?.map((g) => ({
      group: g,
      visible: computeVisible(g.items, filter, sortKey, execution.rankQuery, hideWeak),
    })) ?? [];
  const visibleTotal = groupViews.reduce((n, gv) => n + gv.visible.length, 0);
  // Game-first merged rows (v0.19), computed only when that view is active.
  const mergedViews =
    groupBy === "game" && results
      ? computeMerged(results, filter, sortKey, execution.rankQuery, hideWeak)
      : [];
  // Unfiltered merged-row total, for the "N of M games shown" summary.
  const mergedTotal =
    groupBy === "game" && results ? dedupeAcrossProviders(results).length : 0;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}
      aria-label="File search"
    >
      <SearchHeader />

      <SearchQueryBar
        query={execution.query}
        onQueryChange={execution.setQuery}
        onQueryKeyDown={handleQueryKey}
        consoleKey={execution.consoleKey}
        onConsoleChange={execution.setConsoleKey}
        consoles={consoles}
        region={execution.region}
        onRegionChange={execution.setRegion}
        onSearch={execution.handleSearch}
        searchDisabled={
          !execution.query.trim() || providersApi.activeCount === 0 || execution.running
        }
        running={execution.running}
      />

      <ProviderChipsBar
        providers={providersApi.providers}
        hasProviders={providersApi.hasProviders}
        onToggle={providersApi.toggleProvider}
        onEdit={providersApi.openEditDialog}
        onRemove={providersApi.removeProviderById}
        onAddProvider={providersApi.openAddDialog}
        onBrowse={providersApi.openCatalog}
      />

      {execution.searchError && (
        <ErrorNotice>Search failed: {execution.searchError}</ErrorNotice>
      )}

      {results !== null && (
        <ResultsPanel
          results={results}
          query={execution.query}
          filter={filter}
          onFilterChange={setFilter}
          sortKey={sortKey}
          onSortChange={handleSortChange}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          checkLinks={linkProbe.checkLinks}
          onCheckLinksChange={linkProbe.setCheckLinks}
          probing={linkProbe.probing}
          hideWeak={hideWeak}
          onHideWeakChange={setHideWeak}
          rankQuery={execution.rankQuery}
          statusMap={linkProbe.statusMap}
          selected={selection.selected}
          expandedKeys={selection.expandedKeys}
          collapsed={execution.collapsed}
          onToggleGroupCollapse={toggleGroupCollapse}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onToggleItem={selection.toggleItem}
          onToggleGroupSelection={selection.toggleGroupSelection}
          onToggleMergedExpand={selection.toggleMergedExpand}
          onClearSelection={selection.clearSelection}
          onOpenSelected={() =>
            void selection
              .openSelected()
              .catch((err: unknown) => swallow(err, "SearchPage.onOpenSelected"))
          }
          groupViews={groupViews}
          mergedViews={mergedViews}
          mergedTotal={mergedTotal}
          totalItems={totalItems}
          visibleTotal={visibleTotal}
        />
      )}

      {/* Add / Edit provider dialog */}
      <ProviderDialog
        open={providersApi.dialog.open}
        provider={providersApi.dialog.provider}
        onSave={providersApi.saveDialog}
        onClose={providersApi.closeDialog}
      />

      {/* Discover & add providers from the curated catalog (v0.20) */}
      <ProviderCatalog
        open={providersApi.catalogOpen}
        onClose={providersApi.closeCatalog}
        onAdded={providersApi.addFromCatalog}
      />
    </section>
  );
}

/** Loads the console catalog (for the structured-search select, and to
 *  resolve compose/rank tokens in `useSearchExecution`) on mount. A fetch
 *  failure simply leaves the list empty. */
function useConsoleCatalog(): ConsoleInfo[] {
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);
  useEffect(() => {
    listConsoles()
      .then(setConsoles)
      .catch((err: unknown) => {
        setConsoles([]);
        swallow(err, "useConsoleCatalog.load");
      });
  }, []);
  return consoles;
}
