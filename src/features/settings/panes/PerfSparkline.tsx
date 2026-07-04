// PerfSparkline — a minimal inline-SVG line sparkline for the Settings →
// Performance panel (v0.29 W281, performance-tooling-design.md). Reuses
// MenuHoldIndicator.tsx's convention (v0.28 W279): a plain SVG whose geometry
// is recomputed directly from live data on every render, no CSS
// transition/animation and no charting dependency — the design doc's explicit
// instruction ("reuse the MenuHoldIndicator pattern ... no new charting
// dependency, no new npm package").

const WIDTH = 240;
const HEIGHT = 48;
/** Inset so the line's stroke never clips against the viewBox edge. */
const PADDING = 3;

export interface PerfSparklineProps {
  /** fps samples, oldest first; `null` entries are skipped (unparsed lines). */
  values: (number | null)[];
  /** Accessible label (e.g. "Native path recent fps"). */
  label: string;
}

/** Maps `values` onto an SVG polyline's point list, scaled to fill the
 * viewBox with `PADDING` on every edge. Pure so it's unit-testable without
 * mounting the component. */
export function sparklinePoints(values: (number | null)[], width: number, height: number, padding: number): string {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return "";
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1; // avoid a divide-by-zero flat line collapsing to NaN
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  const n = values.length;
  const points: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    const x = n <= 1 ? padding : padding + (i / (n - 1)) * usableW;
    const y = padding + usableH - ((v - min) / span) * usableH;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return points.join(" ");
}

/** A small fps-over-time line chart. Renders an empty-state message instead
 * of a blank canvas when there's nothing to plot (a fresh install/no
 * sessions yet), so the panel never looks broken. */
export function PerfSparkline({ values, label }: PerfSparklineProps) {
  const points = sparklinePoints(values, WIDTH, HEIGHT, PADDING);
  if (!points) {
    return (
      <p className="rgp-muted" style={{ margin: 0, fontSize: 12 }}>
        No data yet.
      </p>
    );
  }
  return (
    <svg
      className="rgp-perf-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <polyline className="rgp-perf-sparkline__line" points={points} />
    </svg>
  );
}
