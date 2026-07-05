/** useResultSelection — result-row selection, merged-row expansion, and the
 *  "open selected in browser" action for the Search page (W362). Selection is
 *  keyed by result url so it works uniformly across the provider-grouped and
 *  game-first merged views. Extracted from SearchPage with no behavior change. */
import { useCallback, useState } from "react";
import { openUrl } from "../../../ipc/opener";
import {
  withGroupToggled,
  withItemToggled,
  needsOpenConfirm,
} from "../resultSelection";

export interface UseResultSelectionResult {
  selected: Set<string>;
  expandedKeys: Set<string>;
  toggleItem: (url: string) => void;
  toggleGroupSelection: (urls: string[]) => void;
  clearSelection: () => void;
  toggleMergedExpand: (key: string) => void;
  openSelected: () => Promise<void>;
  reset: () => void;
}

/** `confirm` gates a batch-open above `needsOpenConfirm`'s threshold so the
 *  user isn't surprised by dozens of tabs launching at once. */
export function useResultSelection(): UseResultSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

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
  // Reset both selection and expansion — called when a fresh search replaces
  // the browsable result set. Memoized so it has a stable identity for
  // `useSearchExecution`'s `handleSearch` useCallback dependency array.
  const reset = useCallback(() => {
    setSelected(new Set());
    setExpandedKeys(new Set());
  }, []);

  return {
    selected,
    expandedKeys,
    toggleItem,
    toggleGroupSelection,
    clearSelection,
    toggleMergedExpand,
    openSelected,
    reset,
  };
}
