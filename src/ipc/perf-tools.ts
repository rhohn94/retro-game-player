// Emulation performance tooling IPC (v0.29 W281, performance-tooling-design.md):
// the FPS-counter toggle, the EJS-path sibling perf log, and the log
// read-back the Settings → Performance panel uses for both paths.

import { invoke } from "./invoke";

/** Whether the optional on-screen FPS counter is shown on both play paths. */
export function getShowFpsCounter(): Promise<boolean> {
  return invoke<boolean>("get_show_fps_counter");
}

/** Persists the FPS-counter toggle. */
export function setShowFpsCounter(enabled: boolean): Promise<void> {
  return invoke<void>("set_show_fps_counter", { enabled });
}

/** One periodic stat report from the EJS path's in-iframe sampling loop —
 * mirrors the Rust `EjsPerfReport`. */
export interface EjsPerfReport {
  gameId: number;
  /** Effective fps over the report's sampling window. */
  fps: number;
  /** Mean frame time over the same window, in milliseconds. */
  frameTimeMs: number;
}

/** Appends one periodic EJS-path stat report to the sibling log
 * (`logs/ejs-perf.log`). Callers should treat this as fire-and-forget
 * (`.catch(() => undefined)`) — a missed report is not a session error. */
export function reportEjsPerfStats(report: EjsPerfReport): Promise<void> {
  return invoke<void>("report_ejs_perf_stats", { report });
}

/** One path's recent perf-log entries — mirrors the Rust `PerfLogEntries`. */
export interface PerfLogEntries {
  /** Recent raw lines, oldest first. */
  lines: string[];
  /** The fps parsed out of each line in `lines` (same order/length); `null`
   * for a line whose fps field couldn't be parsed. */
  fpsSeries: (number | null)[];
}

/** Recent entries from the native-path log (`logs/native-perf.log`). */
export function readNativePerfLog(): Promise<PerfLogEntries> {
  return invoke<PerfLogEntries>("read_native_perf_log");
}

/** Recent entries from the EJS-path sibling log (`logs/ejs-perf.log`). */
export function readEjsPerfLog(): Promise<PerfLogEntries> {
  return invoke<PerfLogEntries>("read_ejs_perf_log");
}

/** One resolved GPU draw-cost sample from `CrtWebglRenderer`'s
 * `EXT_disjoint_timer_query_webgl2` timer query (v0.38 W381, closes #35) —
 * mirrors the Rust `DrawCostSample`. */
export interface DrawCostSample {
  /** Resolved GPU draw cost for one frame, in milliseconds. */
  drawCostMs: number;
}

/** Appends one resolved GPU draw-cost sample to the sibling log
 * (`logs/draw-cost-perf.log`). Callers should treat this as fire-and-forget
 * (route failures through `swallow()`) — a missed report is not a session
 * error. */
export function reportDrawCostSample(sample: DrawCostSample): Promise<void> {
  return invoke<void>("report_draw_cost_sample", { sample });
}

/** Recent entries from the GPU draw-cost sibling log
 * (`logs/draw-cost-perf.log`). */
export function readDrawCostLog(): Promise<PerfLogEntries> {
  return invoke<PerfLogEntries>("read_draw_cost_log");
}
