// Frontend unhandled-error sink (W360, error-telemetry-design.md). One funnel
// (`recordFrontendError`) for every capture point: `window.onerror`,
// `unhandledrejection`, the route-shell `ErrorBoundary`, and the `swallow()`
// IPC-failure helper (src/ipc/swallow.ts). Foundational scope only: records
// go to `console.error` + an in-memory ring buffer (inspectable/testable);
// persisting to disk via a `record_frontend_error` IPC command mirroring the
// Rust panic-hook sink is a documented Follow-up, not this item's job.

/** The capture point that produced a record — mirrors the four feeders. */
export type FrontendErrorSource =
  | "window.onerror"
  | "unhandledrejection"
  | "react-error-boundary"
  | `swallow:${string}`;

/** One recorded frontend error. */
export interface FrontendErrorRecord {
  source: FrontendErrorSource;
  message: string;
  detail?: string;
  occurredAt: number;
}

/** Bounded ring buffer size — a crash beacon, not an unbounded log. */
const MAX_RECORDS = 50;

const records: FrontendErrorRecord[] = [];

/**
 * Record an unhandled frontend error: logs to `console.error` with a stable
 * `[telemetry]` prefix and appends to the bounded in-memory ring buffer.
 */
export function recordFrontendError(
  source: FrontendErrorSource,
  message: string,
  detail?: string,
): FrontendErrorRecord {
  const record: FrontendErrorRecord = { source, message, detail, occurredAt: Date.now() };
  records.push(record);
  if (records.length > MAX_RECORDS) records.shift();
  console.error(`[telemetry] ${source}: ${message}`, detail ?? "");
  return record;
}

/** Read-only snapshot of everything recorded so far (tests / future diagnostics UI). */
export function getRecordedFrontendErrors(): readonly FrontendErrorRecord[] {
  return [...records];
}

/** Test-only reset of the ring buffer so specs don't leak state into each other. */
export function clearRecordedFrontendErrors(): void {
  records.length = 0;
}

/**
 * Install `window.onerror` + `unhandledrejection` handlers that funnel into
 * `recordFrontendError`. Idempotent-ish in practice: call once from
 * `main.tsx`, before the app renders, so the earliest possible boot errors
 * are covered.
 */
export function installGlobalErrorHandlers(target: Window = window): void {
  target.onerror = (message, source, lineno, colno, error) => {
    const detail = [source, lineno, colno].filter((v) => v !== undefined).join(":");
    recordFrontendError(
      "window.onerror",
      error instanceof Error ? error.message : String(message),
      detail || undefined,
    );
    // Preserve default browser behavior (devtools console logging).
    return false;
  };

  target.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    recordFrontendError("unhandledrejection", message);
  });
}
