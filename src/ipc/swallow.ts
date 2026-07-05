// The shared IPC-failure helper (W360, error-telemetry-design.md
// §"swallow() — the shared IPC-failure helper"). Call sites that today do
// `.catch(() => undefined)` route through `swallow(err, context)` instead —
// it decodes the error via the existing AppError contract and records it
// through the same frontend error sink `window.onerror`/`unhandledrejection`
// feed, instead of dropping it silently. Migrating the 53 existing call
// sites onto this helper is Pass-2 (W361); this item only ships the helper.

import { decodeAppError } from "./error";
import { recordFrontendError } from "../telemetry/errorTelemetry";

/** How loudly a swallowed error should be treated once recorded. */
export type SwallowSeverity = "info" | "warn" | "error";

/**
 * Record-and-continue for an IPC failure (or any caught error) that the
 * caller has decided not to propagate. `context` identifies the call site
 * (e.g. `"GameDetailPage.refreshMetadata"`) — free text, not an enum, so
 * adding a new call site never requires a shared registry update.
 * `severity` defaults to `"warn"`: today's silent `.catch(() => undefined)`
 * sites are implicitly "don't crash the UI, but not necessarily silent."
 */
export function swallow(err: unknown, context: string, severity: SwallowSeverity = "warn"): void {
  const decoded = decodeAppError(err);
  recordFrontendError(`swallow:${context}`, decoded.detail, `severity=${severity} kind=${decoded.kind}`);
}
