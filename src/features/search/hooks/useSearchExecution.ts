/** useSearchExecution — query + structured filters (console/region) and the
 *  search-run lifecycle for the Search page (W362). Owns the query text, the
 *  console/region selects, the executed-query snapshot used for relevance
 *  ranking, the in-flight/error state, and the collapsed-group seed on a new
 *  result set. Also auto-runs a search that arrived pre-filled via navigation
 *  state ("Find downloads for this title"), once providers have loaded, at
 *  most once per mount. Extracted from SearchPage (v0.16 onward; auto-run
 *  v0.18) with no behavior change. Phase 4 adds compose prefs + health memory. */
import { useCallback, useEffect, useRef, useState } from "react";
import { runSearch } from "../../../ipc/search";
import type { ProviderResults, SearchProvider } from "../../../ipc/search";
import { groupHasLikelyHits } from "../components/resultVisibility";
import { isAppError } from "../../../ipc/commands";
import type { RankQuery } from "../resultRanking";
import type { ConsoleInfo } from "../../../ipc/console";
import {
  loadAppendRomPref,
  saveAppendRomPref,
  loadAppendZipPref,
  saveAppendZipPref,
  loadExcludeNoisePref,
  saveExcludeNoisePref,
  loadQuoteTitlePref,
  saveQuoteTitlePref,
} from "../searchPrefs";
import { isUnhealthyProvider } from "../providerHealth";
import {
  listSoftSkippedProviderIds,
  recordSearchHealth,
  resumeProvider,
  isSoftSkipped,
} from "../providerHealthMemory";

export interface UseSearchExecutionResult {
  query: string;
  setQuery: (q: string) => void;
  consoleKey: string;
  setConsoleKey: (k: string) => void;
  region: string;
  setRegion: (r: string) => void;
  /** Append a `rom` token for meta-search / download providers. */
  appendRom: boolean;
  setAppendRom: (v: boolean) => void;
  /** Append a `zip` token (Phase 4). */
  appendZip: boolean;
  setAppendZip: (v: boolean) => void;
  /** Meta noise negatives (Phase 4). */
  excludeNoise: boolean;
  setExcludeNoise: (v: boolean) => void;
  /** Quote multi-word titles on meta (Phase 4). */
  quoteTitle: boolean;
  setQuoteTitle: (v: boolean) => void;
  /** Provider ids currently soft-skipped by health memory. */
  softSkippedIds: number[];
  /** Clear soft-skip for one provider and re-include it next search. */
  resumeSoftSkipped: (providerId: number) => void;
  results: ProviderResults[] | null;
  rankQuery: RankQuery;
  running: boolean;
  searchError: string | null;
  collapsed: Set<number>;
  setCollapsed: React.Dispatch<React.SetStateAction<Set<number>>>;
  handleSearch: () => Promise<void>;
}

/** Runs the search for `query` against every enabled provider, folding in the
 *  console/region structured filters, and resets browse-state (filter,
 *  selection, liveness verdicts, merged-row expansions) for the fresh result
 *  set. A console failure to resolve simply omits that filter. */
export function useSearchExecution(
  initialQuery: string,
  providers: SearchProvider[],
  consoles: ConsoleInfo[],
  resetBrowseState: () => void
): UseSearchExecutionResult {
  const [query, setQuery] = useState(initialQuery);
  const [consoleKey, setConsoleKey] = useState("");
  const [region, setRegion] = useState("");
  const [appendRom, setAppendRomState] = useState(() => loadAppendRomPref());
  const [appendZip, setAppendZipState] = useState(() => loadAppendZipPref());
  const [excludeNoise, setExcludeNoiseState] = useState(() => loadExcludeNoisePref());
  const [quoteTitle, setQuoteTitleState] = useState(() => loadQuoteTitlePref());
  const [softSkippedIds, setSoftSkippedIds] = useState(() => listSoftSkippedProviderIds());
  const [results, setResults] = useState<ProviderResults[] | null>(null);
  const [rankQuery, setRankQuery] = useState<RankQuery>({ name: "" });
  const [running, setRunning] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const didAutoRun = useRef(false);

  const setAppendRom = useCallback((v: boolean) => {
    setAppendRomState(v);
    saveAppendRomPref(v);
  }, []);
  const setAppendZip = useCallback((v: boolean) => {
    setAppendZipState(v);
    saveAppendZipPref(v);
  }, []);
  const setExcludeNoise = useCallback((v: boolean) => {
    setExcludeNoiseState(v);
    saveExcludeNoisePref(v);
  }, []);
  const setQuoteTitle = useCallback((v: boolean) => {
    setQuoteTitleState(v);
    saveQuoteTitlePref(v);
  }, []);
  const resumeSoftSkipped = useCallback((providerId: number) => {
    resumeProvider(providerId);
    setSoftSkippedIds(listSoftSkippedProviderIds());
  }, []);

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
    resetBrowseState();
    setRankQuery({
      name: q,
      console: consoleRankTokens || undefined,
      region: reg || undefined,
    });

    const excludeIds = listSoftSkippedProviderIds();
    setSoftSkippedIds(excludeIds);

    try {
      const all = await runSearch({
        query: q,
        console: consoleComposeToken || undefined,
        region: reg || undefined,
        appendRom,
        appendZip,
        excludeNoise,
        quoteTitle,
        excludeProviderIds: excludeIds.length > 0 ? excludeIds : undefined,
      });
      recordSearchHealth(all);
      setSoftSkippedIds(listSoftSkippedProviderIds());
      // Pin non-empty high-priority groups first, then non-empty others, then empties.
      // Backend already orders by priority; this keeps filled ROM archives on top.
      const sorted = [...all].sort((a, b) => {
        const aEmpty = a.items.length === 0 || !!a.error;
        const bEmpty = b.items.length === 0 || !!b.error;
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        const pa = a.priority ?? 100;
        const pb = b.priority ?? 100;
        if (pa !== pb) return pa - pb;
        return a.providerId - b.providerId;
      });
      setResults(sorted);
      // Collapse: empty/error, captcha/JS-shell health, reference
      // (priority>30), and groups with no likely title hits (quality P0).
      const rankQ = {
        name: q,
        console: consoleRankTokens || undefined,
        region: reg || undefined,
      };
      setCollapsed(
        new Set(
          sorted
            .filter(
              (g) =>
                g.items.length === 0 ||
                !!g.error ||
                isUnhealthyProvider(g) ||
                (g.priority ?? 100) > 30 ||
                !groupHasLikelyHits(g, rankQ)
            )
            .map((g) => g.providerId)
        )
      );
    } catch (err) {
      const detail = isAppError(err) ? err.detail : String(err);
      setSearchError(detail);
    } finally {
      setRunning(false);
    }
  }, [
    query,
    providers,
    consoles,
    consoleKey,
    region,
    appendRom,
    appendZip,
    excludeNoise,
    quoteTitle,
    resetBrowseState,
  ]);

  // Auto-run a search that arrived pre-filled via navigation state ("Find
  // downloads for this title"), once providers have loaded so enabled ones
  // contribute. Runs at most once per mount.
  useEffect(() => {
    if (didAutoRun.current || !initialQuery || providers.length === 0) return;
    didAutoRun.current = true;
    void handleSearch();
  }, [providers, initialQuery, handleSearch]);

  return {
    query,
    setQuery,
    consoleKey,
    setConsoleKey,
    region,
    setRegion,
    appendRom,
    setAppendRom,
    appendZip,
    setAppendZip,
    excludeNoise,
    setExcludeNoise,
    quoteTitle,
    setQuoteTitle,
    softSkippedIds,
    resumeSoftSkipped,
    results,
    rankQuery,
    running,
    searchError,
    collapsed,
    setCollapsed,
    handleSearch,
  };
}

// re-export for tests / chips UI that want to check a single id
export { isSoftSkipped };
