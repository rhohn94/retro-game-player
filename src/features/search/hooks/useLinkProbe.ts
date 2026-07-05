/** useLinkProbe — opt-in liveness probe for previewed result links (v0.19,
 *  W362). When "Check links" is on, HEAD-probes the deduped + capped set of
 *  URLs across every provider's results and stores their verdicts; toggling
 *  off (or a fresh result set) clears the map. The probe is opt-in and never
 *  blocks browsing. Extracted from SearchPage with no behavior change. */
import { useEffect, useState } from "react";
import { probeLinks } from "../../../ipc/search";
import type { ProviderResults, LinkState } from "../../../ipc/search";
import { buildStatusMap } from "../linkStatus";
import { swallow } from "../../../ipc/swallow";

/** The most we probe for liveness in one pass (mirrors the backend cap). */
const MAX_PROBE_URLS = 64;

export interface UseLinkProbeResult {
  checkLinks: boolean;
  setCheckLinks: (v: boolean | ((prev: boolean) => boolean)) => void;
  statusMap: Map<string, LinkState>;
  probing: boolean;
}

/** Re-runs the probe whenever `checkLinks` flips on or a new result set
 *  arrives while it's already on; clears the map otherwise. */
export function useLinkProbe(
  results: ProviderResults[] | null
): UseLinkProbeResult {
  const [checkLinks, setCheckLinks] = useState(false);
  const [statusMap, setStatusMap] = useState<Map<string, LinkState>>(new Map());
  const [probing, setProbing] = useState(false);

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
      .catch((err: unknown) => {
        if (!cancelled) setStatusMap(new Map());
        swallow(err, "useLinkProbe.probeLinks");
      })
      .finally(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [checkLinks, results]);

  return { checkLinks, setCheckLinks, statusMap, probing };
}
