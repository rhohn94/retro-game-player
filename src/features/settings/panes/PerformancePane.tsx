// PerformancePane — the Settings "Performance" section (v0.29 W281,
// performance-tooling-design.md). Reads all three perf logs (native-perf.log,
// ejs-perf.log, draw-cost-perf.log) via IPC and renders each path's recent
// entries as a small table + inline-SVG sparkline (PerfSparkline, reusing the
// MenuHoldIndicator pattern) — no charting dependency, no cross-session
// analytics (out of scope per the design doc).
//
// v0.38 W381 (closes #35): the third section, "GPU draw cost", surfaces the
// real EXT_disjoint_timer_query_webgl2 samples CrtWebglRenderer resolves —
// see crt-filter-design.md §measurement for how the numbers get here.

import { useCallback, useEffect, useState } from "react";
import { AuraButton } from "@aura/react";
import { readDrawCostLog, readEjsPerfLog, readNativePerfLog } from "../../../ipc/perf-tools";
import type { PerfLogEntries } from "../../../ipc/perf-tools";
import { PerfSparkline } from "./PerfSparkline";
import "./perf-pane.css";

/** How many of the most recent table rows to show per path — the log itself
 * already caps at a small recent window (backend `MAX_RECENT_LINES`); this
 * further limits the TABLE (not the sparkline, which still plots every
 * returned sample) so the panel stays scannable. */
const TABLE_ROW_LIMIT = 10;

interface PathSectionProps {
  title: string;
  entries: PerfLogEntries | null;
  error: string | null;
  emptyHint: string;
  /** Whether to render the fps sparkline for this section — `false` for a
   * log whose lines carry no fps field (e.g. the draw-cost log), where a
   * sparkline would only ever show "No data yet." and mislead. */
  showSparkline?: boolean;
}

function PathSection({ title, entries, error, emptyHint, showSparkline = true }: PathSectionProps) {
  const recentRows = entries ? entries.lines.slice(-TABLE_ROW_LIMIT).reverse() : [];
  return (
    <div className="rgp-perf-pane__section">
      <h4 style={{ margin: 0 }}>{title}</h4>
      {error && (
        <p style={{ color: "var(--aura-error)", margin: "4px 0", fontSize: 13 }}>{error}</p>
      )}
      {entries && entries.lines.length === 0 && !error && (
        <p className="rgp-muted" style={{ margin: "4px 0", fontSize: 13 }}>
          {emptyHint}
        </p>
      )}
      {entries && entries.lines.length > 0 && (
        <>
          {showSparkline && <PerfSparkline values={entries.fpsSeries} label={`${title} recent fps`} />}
          <div className="rgp-perf-pane__table" data-testid={`perf-table-${title}`}>
            {recentRows.map((line, i) => (
              <div key={i} className="rgp-perf-pane__row">
                {line}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PerformancePane() {
  const [native, setNative] = useState<PerfLogEntries | null>(null);
  const [ejs, setEjs] = useState<PerfLogEntries | null>(null);
  const [drawCost, setDrawCost] = useState<PerfLogEntries | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [ejsError, setEjsError] = useState<string | null>(null);
  const [drawCostError, setDrawCostError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    readNativePerfLog()
      .then((e) => {
        setNative(e);
        setNativeError(null);
      })
      .catch((e: unknown) => setNativeError(String(e)));
    readEjsPerfLog()
      .then((e) => {
        setEjs(e);
        setEjsError(null);
      })
      .catch((e: unknown) => setEjsError(String(e)));
    readDrawCostLog()
      .then((e) => {
        setDrawCost(e);
        setDrawCostError(null);
      })
      .catch((e: unknown) => setDrawCostError(String(e)))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="settings-pane" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Performance</h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Recent emulation performance telemetry from both play paths, recorded
        to disk as you play (native path: frame-time percentiles and dropped
        frames; EmulatorJS path: reported fps and mean frame time; GPU draw
        cost: real timer-query samples from the native path's WebGL2
        renderer). Turn on the on-screen FPS counter under Playback to see
        live numbers while playing.
      </p>

      <div>
        <AuraButton tabIndex={0} variant="ghost" disabled={refreshing} onClick={load}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </AuraButton>
      </div>

      <PathSection
        title="Native path"
        entries={native}
        error={nativeError}
        emptyHint="No native-play sessions recorded yet — play a native-hosted game to populate this."
      />
      <PathSection
        title="EmulatorJS path"
        entries={ejs}
        error={ejsError}
        emptyHint="No in-page sessions recorded yet — play an EmulatorJS-hosted game to populate this."
      />
      <PathSection
        title="GPU draw cost"
        entries={drawCost}
        error={drawCostError}
        emptyHint="No timer-query samples recorded yet — play a native-hosted game on a browser/driver that supports EXT_disjoint_timer_query_webgl2 to populate this."
        showSparkline={false}
      />
    </div>
  );
}
