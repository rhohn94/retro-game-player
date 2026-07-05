# Release Planning — v0.36

> status: draft
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.36.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.36` |
| **Previous** | v0.35 (Player Two — two-controller NES/SNES multiplayer, auto pickup) |
| **Theme** | "Spring Cleaning" — code quality: unhandled-error observability, decomposition of the two worst oversized modules, duplication collapse, dead-code removal, and targeted test-depth work. No user-visible feature work. |

User directive (2026-07-05): orchestrate a release focused on code quality.

Grounding facts (planning read, 2026-07-05, post-v0.35):

- Lint (`pnpm lint`), typecheck (`pnpm typecheck` + `cargo check`), and
  `cargo clippy -- -D warnings` are all clean at `dev` c591c74 — the debt is
  structural, not lint-visible.
- Coding-practices audit: no unhandled-error telemetry anywhere (no Rust
  panic hook, no `window.onerror`/`unhandledrejection`, no React
  ErrorBoundary); 53 `.catch(() => …)` silent-swallow sites (31 exactly
  `.catch(() => undefined)`).
- Code-health audit: `src/features/search/SearchPage.tsx` is CC 34 / 919
  lines (frontend worst, issue #43); `src-tauri/src/play/native/runtime.rs`
  is 2306 lines with a 99-line `run_core_loop`; `callbacks.rs` carries a
  5-way input-callback clone family (1307–1452); `db/repo/library.rs` has
  two query/row-mapping clone pairs; 67 jscpd clones repo-wide (1.64%,
  Rust 2.32%).
- Confirmed dead exports: `getCoreOption`, `BRAND_KNOBS`, `enrichGame`,
  unused Aura type decls in `aura-react.d.ts`, and the unconsumed
  `src/ipc/fleet.ts` frontend wrapper.
- Grimoire-Requirement tracker read returned zero open issues (valid).

---

## 2. Major Features

### W360 — Error-telemetry foundations

Add unhandled-error observability at both tiers: a Rust `panic::set_hook`
that records panics through the existing telemetry sink (`telemetry.rs`,
alongside `record_run_start`); frontend `window.onerror` +
`unhandledrejection` handlers; a React ErrorBoundary at the route shell;
and a shared `swallow(err, context)` IPC-failure helper in `src/ipc/` that
logs/records instead of dropping errors (consumed at scale by W361).
First commit on the branch: scaffold `docs/design/error-telemetry-design.md`
per the `grm-design-doc-scaffold` house layout and index it in
`docs/design/README.md`.

- **Acceptance:** a deliberate Rust panic in a test writes a telemetry
  record; a thrown error / rejected promise in the frontend reaches the
  handler (unit-tested); rendering a component that throws shows the
  boundary fallback instead of a white screen (tested); `swallow()` records
  the error and context and is unit-tested; design doc exists and is
  indexed; `recipe.py smoke` passes.
- **Branch:** `w360-error-telemetry`
- **Design:** `error-telemetry-design.md` (new, scaffolded on this branch).

### W361 — Silent-catch remediation

Replace the 53 `.catch(() => …)` silent-swallow sites across ~15 feature
files (representative: `GameDetailPage.tsx:125`, `TvHome.tsx:219`,
`NativePlayer.tsx:197–229`, `import.ts:73`) with the W360 `swallow()`
helper, preserving intentional ignore semantics where a comment justifies
them. Pass 2: depends on W360's helper and must follow W362/W366 (same
files move).

- **Acceptance:** zero bare `.catch(() => undefined)` remain in `src/`
  (grep-clean or carrying an explicit justification comment); every
  replaced site routes through `swallow()`; no behavior change beyond
  logging (existing tests stay green); `recipe.py smoke` passes.
- **Branch:** `w361-silent-catch-remediation`
- **Design:** `error-telemetry-design.md` §swallow-helper contract.

### W362 — SearchPage decomposition (issue #43)

Decompose `src/features/search/SearchPage.tsx` (CC 34, 919 lines, largest
frontend file by 2×) into a container plus result-list, provider-tab, and
probe-state subunits, one file per component, behavior-preserving.

- **Acceptance:** no resulting file exceeds ~300 lines; the top complexity
  warning for `SearchPage` clears (CC under the 12 threshold per unit, or
  documented residual); existing search tests pass unchanged (or moved
  1:1); no UX change; `recipe.py smoke` passes; issue #43 closable.
- **Branch:** `w362-searchpage-decomposition`
- **Design:** existing search design doc — update file references in place.

### W363 — Native runtime split + callback dedup

Split `src-tauri/src/play/native/runtime.rs` (2306 lines) into
video/audio/input/session submodules along its internal seams
(pure-move refactor discipline: no logic changes); collapse the 5-way
per-console input-callback clone family in `callbacks.rs:1307–1452` into
one generic dispatch helper; dedupe `load_optional_symbol`'s NUL-name
derivation with `load_symbol` (v0.35 review follow-up). Carry the two
v0.35 doc corrections: EJS `EJS_defaultControls` comment says "gameplay
buttons 0–13" (not full parity), and document the per-game localStorage
`controlSettings` precedence over `EJS_defaultControls`.

- **Acceptance:** `runtime.rs` reduced to a thin module root (each
  submodule ≤ ~600 lines); all 827+ Rust tests pass unchanged; the clone
  family is a single helper (jscpd-clean at those sites); no behavioral
  diff on the native play path (smoke: boot an NES title); doc corrections
  landed in `native-emulation-design.md`; `recipe.py smoke` passes.
- **Branch:** `w363-native-runtime-split`
- **Design:** `native-emulation-design.md` — new §Module layout.

### W364 — Library repo + play server data-layer cleanup

In `src-tauri/src/db/repo/library.rs` (1257 lines): extract shared
row-mapper/query helpers for the clone pairs (75–88≙130–143,
303–334≙375–406) and split into query-domain submodules. In
`src-tauri/src/play/server.rs`: move the raw `games` queries
(`game_saves`/`rom_path`, lines ~255/288) behind a `db/repo` helper
preserving the documented concurrent-reader design, dedupe the connection
setup between the two functions, fix its 3 `unwrap`s, and replace the
brittle test asserting literal `playerControls(true/false)` source strings
with a structural assertion (v0.35 review follow-up).

- **Acceptance:** clone pairs collapsed (jscpd-clean at those sites); no
  raw SQL against `games` outside `db/repo`; zero non-test `unwrap` in
  `play/server.rs`; the rewritten test fails on a real regression but not
  on reformatting; all tests pass; `recipe.py smoke` passes.
- **Branch:** `w364-library-repo-cleanup`
- **Design:** existing data-layer/native docs — update references in place.

### W365 — Dead-code removal

Remove confirmed dead exports: `getCoreOption` (`ipc/core-options.ts:33`),
`BRAND_KNOBS` (`theme/tokens.ts:81`), `enrichGame` (`ipc/familiar.ts`),
the unused Aura component type decls (`aura-react.d.ts:33–41`), and the
unconsumed `src/ipc/fleet.ts` frontend wrapper (the Rust `fleet` command
surface stays — pending the #39 self-update decision; note the orphan in
the code). Remove matching barrel re-exports.

- **Acceptance:** deleted symbols absent; typecheck/lint/tests clean;
  ts-prune no longer reports the removed items; a code comment on the Rust
  fleet surface records why it is retained; `recipe.py smoke` passes.
- **Branch:** `w365-dead-code-removal`
- **Design:** none required (pure deletion).

### W366 — Settings/hooks duplication collapse

Extract a shared "locate-tool pane" component for `FamiliarPane.tsx` ≙
`RetroArchPane.tsx` (21-line pane skeleton + second clone); extract a
source-row component for the 3-site clone in `GameSourcesPane.tsx:290–332`
and break up `GameSourcesPane` (CC 19, 370 lines); extract a shared async
load/refresh hook for `useCoreOptions.ts:70–83` ≙ `useCores.ts:117–130`;
collapse the `CoresPage.tsx` 131–141 ≙ 205–217 clone.

- **Acceptance:** the named clone clusters are jscpd-clean; `GameSourcesPane`
  CC under threshold; settings panes render identically (existing tests +
  smoke); `recipe.py smoke` passes.
- **Branch:** `w366-settings-dedup`
- **Design:** UX design language unchanged; no doc work.

### W367 — Test depth (partial issue #28)

Add unit tests for the untested logic files:
`src/features/search/result{Badges,Filter,Selection,Sort}.ts`,
`src/features/library/import.ts`, the `src/ipc/invoke.ts` chokepoint, and
the logic-bearing Rust command adapters `commands/{launch,metadata,
player_prefs}.rs`. Pass 2: runs after the refactor passes settle file
layout.

- **Acceptance:** each named file has a test file exercising its core
  logic paths (happy + representative error path); suite green; no test
  asserts an injected URL without resolving it against a served route
  (CLAUDE.md test-quality rule); `recipe.py smoke` passes.
- **Branch:** `w367-test-depth`
- **Design:** none required (test-only).

---

## 3. Parallel Implementation Strategy

**Pass 1 (parallel, disjoint files):** W360, W362, W363, W364, W365, W366.

**Pass 2 (after all Pass-1 merges):** W361, W367.

Conflict map:

- W360 touches `src-tauri/src/lib.rs`, `telemetry.rs`, `src/main.tsx`,
  `src/App.tsx`, new files in `src/ipc/` — disjoint from all other Pass-1
  lanes (W365 deletes from `ipc/core-options.ts`/`familiar.ts`/`fleet.ts`,
  not `invoke.ts`; W360 adds a new helper file).
- W363 (play/native/*) and W364 (`db/repo/*` + `play/server.rs`) share the
  `src-tauri/src/play/` directory but no files. Merge W363 before W364
  as a precaution (both touch native-play-adjacent tests).
- W361 rewrites `.catch` sites in files W362 (SearchPage subunits) and
  W366 (settings panes) move — hence Pass 2, branched from the post-Pass-1
  staging tip.
- W367 tests files whose paths W362 may move (`result*.ts` expected to
  stay in place, but Pass-2 sequencing removes the guess).
- Merge order within Pass 1: W365 (smallest) → W360 → W366 → W362 →
  W363 → W364. Within Pass 2: W361 → W367.

Dispatch model: `release-phase-model: Auto` (write-capable workflow) —
branch names carry the `-v036pN-NN` suffix.

---

## 4. Out of Scope for v0.36

- **`GameDetailPage` (CC 26) and `ProviderDialog` simplification** — next
  quality pass; W362/W366 establish the decomposition patterns first.
- **`disc_ident.rs` (1109 lines) / `crossover.rs` (1050) splits** — deferred;
  stable, low-churn modules.
- **Aura upstream React types (#40)** — needs a vendor sync; separate lane,
  later release.
- **`vendor/` → `lib/third-party/` relocation** (arch-standard-layout warn)
  — build-config churn disproportionate to a quality release; backlog.
- **Inline-style sweep (384 `style={{` sites) and `!important` audit** —
  needs a static-vs-dynamic triage pass first; backlog.
- **Frontend interaction telemetry (`telemetry-web-interactions`, info)** —
  only error telemetry ships this release.
- **Rust fleet command surface removal** — retained pending the #39
  self-update decision (W365 documents the orphan instead).
- **eslint `complexity`/`max-lines-per-function` gating** — adopt after the
  W362/W366 refactors land so the gate starts green; follow-up candidate.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero, 2026-07-05).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.36 |
|---|---|---|---|---|
| `w360-error-telemetry` (W360) | ☐ | ☐ | ☐ | ☐ |
| `w362-searchpage-decomposition` (W362) | ☐ | ☐ | ☐ | ☐ |
| `w363-native-runtime-split` (W363) | ☐ | ☐ | ☐ | ☐ |
| `w364-library-repo-cleanup` (W364) | ☐ | ☐ | ☐ | ☐ |
| `w365-dead-code-removal` (W365) | ☐ | ☐ | ☐ | ☐ |
| `w366-settings-dedup` (W366) | ☐ | ☐ | ☐ | ☐ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.36 |
|---|---|---|---|---|
| `w361-silent-catch-remediation` (W361) | ☐ | ☐ | ☐ | ☐ |
| `w367-test-depth` (W367) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

(populated by release-phase-merge as branches land)
