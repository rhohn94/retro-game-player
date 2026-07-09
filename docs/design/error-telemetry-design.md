# Error-telemetry foundations

> **Up:** [↑ Design index](README.md)

## Motivation

Unhandled errors currently vanish. A Rust panic in a background thread prints
to stderr (if anyone is watching a terminal) and is otherwise invisible; a
thrown error or rejected promise on the frontend either logs to a devtools
console no one opens in a packaged build, or — worse — leaves React showing a
white screen with no diagnostic trail. There is no single place that answers
"did anything crash during this run?" That question matters for a desktop app
users run unattended (TV mode, long play sessions) with no one watching a
terminal.

This item builds the **foundations**: a place unhandled errors land at both
tiers (Rust panic, frontend `window.onerror`/`unhandledrejection`), a
render-time safety net (an `ErrorBoundary` so a component throw degrades to a
fallback screen instead of a blank one), and a shared frontend helper
(`swallow`) that gives call sites a one-line way to record-and-continue
instead of silently dropping an IPC failure. What changes if we don't ship
it: crashes stay invisible, and the follow-on item (W361, replacing the 53
existing bare `.catch(() => …)` sites) has no helper to route through.

## Scope

**In scope:**
- A Rust `panic::set_hook` that turns a panic into a telemetry record via the
  existing `telemetry.rs` sink, installed alongside `record_run_start` in
  `harmony_setup` (`lib.rs`).
- A `PanicRecord` type + `record_panic` writer in `telemetry.rs`, following
  the existing `RunRecord`/`record_run_start` shape (small file, timestamped).
- A `record_recoverable_error(source, detail)` helper in `telemetry.rs` for
  backend catch-and-continue sites, replacing their ad-hoc `eprintln!`
  prefixes with the same `[telemetry]` channel (no file write — see Design).
- Frontend `window.onerror` + `window.addEventListener("unhandledrejection")`
  handlers, installed once at app boot (`main.tsx`), that funnel into a
  shared recorder.
- A React `ErrorBoundary` class component mounted at the route shell
  (`App.tsx`) so a component throw shows a fallback instead of an unmounted
  white screen.
- A `swallow(err, context, severity?)` helper in `src/ipc/` — the shared
  shape Pass-2 (W361) will thread through the 53 existing silent-catch sites.

**Non-goals (explicitly out of scope):**
- Migrating any existing `.catch(() => …)` call site onto `swallow()` — that
  is W361, a separate branch, deliberately sequenced after this one merges.
- A remote/telemetry-upload backend. Everything here writes locally
  (`telemetry.rs`'s existing per-run-dir convention); shipping crash reports
  off-device is a future item if ever needed.
- Crash *recovery* (retry, state rehydration). The boundary's job is to stop
  a white screen and record the failure, not to resume the interrupted flow.
- Structured error *taxonomies* beyond what `swallow`'s `context`/`severity`
  parameters already give Pass-2 to work with.

## Design

### Rust: panic hook → telemetry

`telemetry.rs` gains a `PanicRecord` (schema version, app version, message,
optional location `file:line:column`, timestamp) and a
`record_panic(paths, version, message, location)` writer — same `app-support`
convention `RunRecord::write` already uses, so both land next to `run.json`
in the deployed version dir (`panic.json`, last-panic-wins, matching
`run.json`'s single-record shape rather than an unbounded log).

`install_panic_hook(paths: Paths, version: impl Into<String>)` is called once
from `harmony_setup` (`lib.rs`), right after `record_run_start` — the same
place that already resolves `Paths` and the crate version. It wraps
`std::panic::set_hook`: the hook captures the panic message + location via
`PanicHookInfo`, builds a `PanicRecord`, and calls `record_panic`, then
chains to the previous default hook (still prints to stderr — we're adding a
channel, not removing the existing one). The hook owns a cloned `Paths`
(cheap: a couple of `PathBuf`s) so it doesn't depend on Tauri's managed-state
machinery, which may not be reachable from an arbitrary panicking thread.

`telemetry.rs` also exports `record_recoverable_error(source, detail)` — a
lighter-weight sink for the backend's non-fatal, caught-and-continued errors
(a transient DB hiccup, a cache miss) that doesn't warrant a `panic.json`-style
file write. It logs through the same `[telemetry]`-prefixed `eprintln!`
channel rather than persisting, replacing the ad-hoc `"[rgp-achievements] ..."`
-style prefixes call sites used before; `src-tauri/src/commands/achievements.rs`
is the first (and, as of this writing, only) consumer, passing a fixed
bracketed source tag at each of its several catch-and-continue sites.

Tests: `record_panic` is a plain synchronous unit test (write, read back,
assert fields) mirroring `record_run_start`'s existing test shape. The
acceptance criterion ("a deliberate Rust panic in a test writes a telemetry
record") is satisfied by installing the hook against a temp `Paths` inside a
test, triggering a `std::panic::catch_unwind` panic, and asserting the file
now exists — no crash-the-test-runner needed.

### Frontend: window-level handlers

A new `src/telemetry/errorTelemetry.ts` module exports `recordFrontendError
(source, message, detail?)` — the frontend-side counterpart to Rust's
`record_panic`. For this foundational item it logs via `console.error` with
a stable `[telemetry]` prefix and keeps an in-memory ring buffer (testable,
inspectable) rather than writing to disk; wiring it to an IPC command that
persists next to the Rust panic record is a natural Follow-up once a
`record_frontend_error` command exists; it isn't in this item's scope.

`installGlobalErrorHandlers()` (same module) attaches:
- `window.onerror = (message, source, lineno, colno, error) => …` → routes to
  `recordFrontendError("window.onerror", …)`.
- `window.addEventListener("unhandledrejection", (event) => …)` → routes to
  `recordFrontendError("unhandledrejection", …)`.

Called once from `main.tsx`, before `ReactDOM.createRoot(...).render(...)` so
the earliest possible boot errors are covered.

### React: ErrorBoundary at the route shell

`src/components/ErrorBoundary.tsx` — a small class component (React's error
boundary contract requires a class; there is no hook equivalent). It
implements `getDerivedStateFromError` (flip to fallback UI) and
`componentDidCatch` (record via the same `recordFrontendError`, tagged
`"react-error-boundary"`). Mounted once in `App.tsx` wrapping `RoutedOutlet`
(the routed content area) — a throw in one screen shows the fallback in the
main content region while the sidebar/shell chrome stays intact, rather than
tearing down the whole app. The fallback is minimal (message + "reload"
affordance) since polish is not this item's job.

### `swallow()` — the shared IPC-failure helper

`src/ipc/swallow.ts`:

```ts
export type SwallowSeverity = "info" | "warn" | "error";

export function swallow(
  err: unknown,
  context: string,
  severity: SwallowSeverity = "warn",
): void;
```

- `context` is a short string identifying the call site (e.g.
  `"GameDetailPage.refreshMetadata"`) — free text, not an enum, so call
  sites don't need a shared registry to add one.
- `severity` defaults to `"warn"` (today's `.catch(() => undefined)` sites are
  implicitly "don't crash the UI, but not necessarily silent" — `warn` is the
  closest honest default; call sites that truly don't care can pass `"info"`).
- Internally: decodes the error via the existing `decodeAppError` (`ipc/
  error.ts`) so an `AppError`'s `kind`/`detail` are preserved, then records
  through the same `recordFrontendError` path the window-level handlers use
  (`source = "swallow:" + context"`) — one recorder, three feeders (window
  errors, rejected promises, swallowed IPC failures).
- Signature is deliberately the seam W361 consumes at the 53 existing sites;
  this item ships the helper and its tests, not the site-by-site migration.

### Why one recorder, three feeders

`window.onerror`, `unhandledrejection`, `ErrorBoundary.componentDidCatch`, and
`swallow()` are four different *capture* points but conceptually one sink.
Keeping `recordFrontendError` as the single funnel means a later "persist to
disk" or "upload" change touches one function, not four.

## Acceptance

- [ ] A deliberate Rust panic (inside a test, via `catch_unwind` around a
      hook-installed scope) writes a telemetry record readable back off disk.
- [ ] A thrown error reaches `window.onerror` → `recordFrontendError` (unit
      test drives the handler function directly with a synthetic event).
- [ ] A rejected promise reaches the `unhandledrejection` handler →
      `recordFrontendError` (unit-tested the same way).
- [ ] Rendering a component that throws inside `ErrorBoundary` shows the
      fallback UI instead of an unmounted/blank tree (rendered test).
- [ ] `swallow(err, context, severity?)` records the decoded error + context
      and is unit-tested (including the default-severity path).
- [ ] This design doc exists and is indexed in `docs/design/README.md`.
- [ ] `recipe.py smoke` passes.

## Open questions

None outstanding — the module boundaries above (one Rust sink, one frontend
sink, four feeders) were the only design decision and are resolved above.

## Follow-ups

- W361 (Pass 2, this release): replace the 53 existing bare
  `.catch(() => undefined)` sites with `swallow()`, preserving any
  intentionally-justified no-ops.
- Persist frontend error records to disk (a `record_frontend_error` IPC
  command mirroring `record_panic`) instead of the in-memory ring buffer, once
  a real consumer needs it (e.g. a future "diagnostics" screen or crash-report
  export).
- Consider surfacing the `panic.json` / frontend ring buffer in a
  developer-facing diagnostics view once the Fleet/Ensign status surface
  (W11) grows a UI.
