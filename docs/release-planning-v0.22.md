# Release Planning — v0.22 "Polish"

> status: agreed
> Companion to `version-history.md`. Captures the scope, pass structure, and
> implementation ledger for v0.22. Archive into `version-history.md` when the
> release ships (note: this project's established convention is that
> `roadmap.md`'s per-version sections serve as the real changelog —
> `version-history.md` has never been populated across 20+ prior releases;
> see `docs/roadmap.md` for the actual shipped-feature record).

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.22` |
| **Previous** | v0.21 "Bedrock" (native libretro NES core hosting, behind a flag) |
| **Theme** | "Polish" — a code-quality and UX consistency pass, not a new feature. Origin: a fresh audit (4 independent agent passes: coding-practices, architecture, dead-code/duplication, UX consistency) run against `docs/coding-standards.md`, `docs/architecture-guidelines.md`, and `docs/design/ux/design-language.md` after v0.21 shipped. Fixes 2 real bugs the audit surfaced, plus the highest-value structure/consistency findings. |

### Scope decisions (user-directed)

- Confirmed via AskUserQuestion: **lock the full 9-item scope** (not bugs-only,
  not user-adjusted) — all of W220–W228 ship together in v0.22.
- No new design doc — this release fixes deviations from *existing* standards
  docs (`coding-standards.md`, `architecture-guidelines.md`,
  `design-language.md`), it does not introduce a new subsystem.

---

## 2. Major Features

### W220 — Fix search-thread panic-on-join

`src-tauri/src/commands/search.rs:298` and `src-tauri/src/core/search/liveness.rs:126`
both call `.join().expect(...)` on a worker thread. A panicked worker
propagates into a panic of the whole command, contradicting `run_search`'s own
documented contract ("a fetch failure degrades that provider to 'no preview',
never fails the whole search"). Fix: catch the panic per-thread and map it to
a per-item error/`Unknown` result instead of `.expect()`.

- **Acceptance:** a worker thread that panics degrades its own item to an
  error/unknown result; the command returns successfully with the other
  items intact. Unit test simulates a panicking closure.
- Branch: `feat/w220-fix-search-thread-panic`.

### W221 — Fix controller focus-ring lingering

`src/features/controller/ControllerProvider.tsx` never resets `focusedId` on
route change, and mouse hover (`GameTile.tsx` et al.) never calls
`useController().setFocus()` — only local hero-display state. Result: the
gamepad focus ring can visually linger on a stale element when mouse and
controller input are mixed (confirmed reproducible by the audit, a
previously-noted cosmetic issue).

- **Acceptance:** navigating routes clears stale controller focus; hovering
  with the mouse updates the controller's `focusedId` so ring and pointer
  never diverge. Verified via a throwaway Playwright/mock-ipc drive (no
  headless gamepad, so a real gamepad check is the real-device verification
  gap — note it explicitly rather than claim full coverage).
- Branch: `feat/w221-fix-focus-ring-lingering`.

### W222 — Extract `useCancellableEffect` hook

The `let cancelled = false; ...; return () => { cancelled = true }` guard is
hand-rolled independently in 9+ places (`GameDetailPage`, `ConsoleDetailPage`,
`NativePlayer`, `LibraryPage`, `ConsolesPage`, `CreateGamesFolderDialog`,
`HeroBackdrop`/`useBoxart`, `CatalogBrowser`, `InPagePlayer`). Extract one
shared hook and migrate the call sites.

- **Acceptance:** a single `useCancellableEffect`/equivalent hook exists,
  unit-tested; the 9 identified call sites are migrated with no behavior
  change (existing screens still load/error/cancel correctly).
- Branch: `feat/w222-cancellable-effect-hook`.

### W223 — Split `SearchPage.tsx`

1679 lines. Lines 1–1002 are ~10 self-contained presentational
components/helpers with no dependency on the page's own state
(`EmptyState`, `MatchBadge`, `LivenessDot`, `BadgeChip`, `ResultRow`,
`GroupCountBadge`, `GroupSelectAll`, `ProviderResultGroup`, `MergedRow`,
`MergedResultsView`, `ProviderChip`, `computeVisible`/`computeMerged`/
`aggregateState`). Move them to `src/features/search/components/`, leaving
`SearchPage.tsx` as the orchestrating shell (~680 lines).

- **Acceptance:** `SearchPage.tsx` shrinks to roughly the shell only; no
  behavior change; all existing search tests still pass.
- Branch: `feat/w223-split-search-page`.

### W224 — Split `SettingsPage.tsx` panes

916 lines. Lines 72–821 are 8 fully independent `*Pane` components
(`FoldersPane`, `CoresPane`, `ControllersPane`, `ProvidersPane`,
`FamiliarPane`, `PlaybackPane`, `AppearancePane`, `RetroArchPane`), each
owning its own state/effects/IPC calls, dispatched via a `SectionPane` switch.
Move each to its own file under `src/features/settings/panes/`.

- **Acceptance:** `SettingsPage.tsx` shrinks to the two-column shell + section
  switch (under ~150 lines); no behavior change.
- Branch: `feat/w224-split-settings-panes`.

### W225 — IPC boundary cleanup

Two leaks found: (1) `SettingsPage.tsx` has direct `invoke()` calls
(`save_familiar_config`, `set_retroarch_path` call sites) bypassing its own
documented "no raw invoke here" convention — both already have IPC wrappers
in `ipc/familiar.ts`/`ipc/launch.ts` that should be used instead, or the raw
calls should route through them. (2) Several `@tauri-apps/plugin-opener`/
`plugin-dialog` imports happen directly in feature components
(`CreateGamesFolderDialog.tsx`, `GameDetailPage.tsx`, `ConsoleDetailPage.tsx`,
`SearchPage.tsx`, `features/library/import.ts`) instead of through
`src/ipc/`. Also fixes the one cross-feature encapsulation violation:
`GameDetailPage.tsx` imports `PlaySwitch` directly from `play/`, which has no
public barrel (unlike `controller/`'s `index.ts`) — add `play/index.ts`.

- **Acceptance:** no raw `invoke()` calls remain outside `src/ipc/`; opener/
  dialog plugin calls route through new `src/ipc/opener.ts`/`ipc/dialog.ts`
  wrappers; `play/` exposes a public barrel and `GameDetailPage` imports
  through it.
- Branch: `feat/w225-ipc-boundary-cleanup`.

### W226 — Unified empty/error/loading states

Library/Consoles/GameDetail/ConsoleDetail share a consistent convention
(`harmony-muted` for loading/empty, `AuraCard class="harmony-notice"` for
errors) but Search/Cores hand-roll inline-styled text instead — visually
jarring when navigating between screens. Extract the existing convention into
real `LoadingState`/`ErrorNotice`/`EmptyState` components and adopt them on
Search/Cores.

- **Acceptance:** Search and Cores use the same loading/error/empty visual
  treatment as Library/Consoles; no behavior change to what triggers each
  state, only its presentation.
- Branch: `feat/w226-unified-empty-error-states`.

### W227 — UX consistency pass

Smaller, targeted fixes: `FocusRing.tsx`'s hardcoded `120ms ease` transition
routed through `--harmony-dur-fast`/`--harmony-ease-out` instead;
`AppearancePane`'s hand-rolled theme-picker button/selected-state logic
replaced with `AuraButton` + a `--harmony-*` selected-state token; Settings
pane gap-value outlier (`ControllersPane`'s `gap: 12` vs every other pane's
`gap: 16`) fixed; the panes still using bare `<input>`/`<select>` migrated to
`AuraField` for consistency with `FamiliarPane`/`RetroArchPane`.

- **Acceptance:** the 4 sub-fixes above land; `scripts/motion.test.mjs` and
  `scripts/token-adoption.test.mjs` still pass (and ideally catch the
  `FocusRing.tsx` class of issue going forward — extending those guards is a
  stretch goal, not a hard requirement of this item).
- Branch: `feat/w227-ux-consistency-pass`.

### W228 — Tests, docs, release ritual

Full gate suite (cargo test/clippy/check, pnpm typecheck/lint/test,
`recipe.py smoke`) across everything landed; roadmap v0.22 entry; version
bump (4 files); standard release ritual (`merge:` → `release:` → tag → push,
human-gated).

- **Acceptance:** all gates green; `recipe.py smoke` exit 0; roadmap updated;
  release pushed only after explicit user confirmation (per this project's
  established human-gated release/push convention).
- Branch: `feat/w228-tests-docs-release`.

---

## 3. Parallel Implementation Strategy

Executed **sequentially** by a single integration-master agent (no PM, no
separate task-agent lanes — same model as v0.21). Order matters only weakly:
W220/W221 (bugs) first since they're independent and highest-value; then
W222 (the shared hook) before W223/W224 use it incidentally in passing (not a
hard dependency — the splits don't have to adopt the new hook, but doing
W222 first means any migration touches the not-yet-split files exactly once);
then W223/W224 (structural splits, disjoint files); then W225 (IPC/barrel
cleanup, touches files split in W223/W224 so runs after them); then W226/W227
(presentation-layer consistency, safest last since they touch the
now-split/cleaned-up files); W228 last.

Conflict map: W223 and W224 touch disjoint files (`SearchPage.tsx` vs
`SettingsPage.tsx`) — no overlap. W225 touches files W223/W224 already split,
so it runs after both. W226/W227 touch Search/Cores/Settings presentation —
runs after the splits so it edits the smaller, already-organized files.

---

## 4. Out of Scope for v0.22

- **Extending `token-adoption.test.mjs`/`motion.test.mjs` to catch the classes
  of gap found in this audit** (token-as-fallback patterns, inline `style={{}}`
  magic numbers beyond the 3 currently-guarded files, non-JS-object motion
  literals) — noted in W227 as a stretch goal, not required; a real follow-up
  for a future pass if it recurs.
- **Rust repo-access boilerplate standardization** (`db.inner()` vs `&db`
  inconsistency across `commands/*.rs`) — lower value than the items in
  scope; deferred.
- **`library.rs`'s folders/games split** — lower priority than the TSX splits
  per the audit (cohesion is already high, an in-file section boundary
  already exists); deferred.
- **JS-render fetch tier** (still v0.22+ per the v0.21 ledger's original
  carryover note) — this release took the "next" slot for the code-quality
  pivot instead; the JS-render tier rolls to v0.23.
- **TV-UI epic #8**, **#14 boot-latency spike** — untouched, unchanged
  priority candidates for a future release.

No `Grimoire-Requirement`-tagged open issues exist for this scope (not
re-checked this pass — carried from v0.21's check; no new issues were filed
since).

---

## 5. Status Ledger

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.22 |
|---|---|---|---|---|
| `feat/w220-fix-search-thread-panic` (W220) | n/a | ☑ | ☑ | ☑ |
| `feat/w221-fix-focus-ring-lingering` (W221) | n/a | ☑ | ☑ | ☑ |
| `feat/w222-cancellable-effect-hook` (W222) | n/a | ☑ | ☑ | ☑ |
| `feat/w223-split-search-page` (W223) | n/a | ☑ | ☑ | ☑ |
| `feat/w224-split-settings-panes` (W224) | n/a | ☑ | ☑ | ☑ |
| `feat/w225-ipc-boundary-cleanup` (W225) | n/a | ☑ | ☑ | ☑ |
| `feat/w226-unified-empty-error-states` (W226)* | n/a | ☑ | ☑ | ☑ |
| `feat/w227-ux-consistency-pass` (W227) | n/a | ☑ | ☑ | ☑ |
| `feat/w228-tests-docs-release` (W228) | n/a | ☑ | ☑ | ☑ |

\* W226 was implemented and gate-verified as a direct commit on `version/0.22`
(614a739) rather than on its own `feat/w226-*` branch — a process slip, not a
scope or quality issue. See Follow-ups below.

### Follow-ups discovered during implementation

- **W222 scope note.** 11 of the 15 grep-matched `cancelled`-flag call sites
  were migrated to `useCancellableEffect`. Two were deliberately left as-is
  because the pattern doesn't fit without changing behavior:
  `LibraryPage.tsx`'s `loadGames` is a re-invokable `useCallback` called both
  from a mount effect and imperatively from import handlers (the returned
  cleanup can't cleanly become the hook's cleanup); `NativePlayer.tsx`'s
  effect ties the flag to a continuous `requestAnimationFrame` polling loop
  plus keyboard/gamepad listeners, not a one-shot fetch. Forcing either into
  the generic hook would obscure more than it simplifies.

- **W225 incidental bug fixes.** Routing `RetroArchPane.tsx` through the
  existing (correctly-typed) `ipc/launch.ts` wrappers instead of its raw
  `invoke()` calls fixed two pre-existing latent bugs found along the way:
  (1) the pane's mount effect called `invoke("get_retroarch_path")`, a command
  that was never wired up on the Rust side (only `locate_retroarch` exists),
  so the path field silently never populated — now uses `locateRetroArch()`.
  (2) `handleSave` passed `path.trim() || null` to `set_retroarch_path`, but
  the Rust command takes a plain `String` (rejecting empty with a validation
  error) and never accepted `null` — now passes `path.trim()` through
  `setRetroArchPath(path: string)`, matching the backend's actual contract.
  Neither fix changes the acceptance criteria for W225; both were the natural
  consequence of using the already-correct existing wrapper instead of the
  mistyped raw call.

- **W226 process note.** Implemented directly on `version/0.22` instead of a
  `feat/w226-unified-empty-error-states` branch — the branch-creation step was
  skipped by mistake before starting the edits. The work itself went through
  the same gate sequence (typecheck/lint/test/`recipe.py smoke`) as every other
  item before being committed (614a739). No functional impact; flagged here so
  the ledger's `*` annotation has a paper trail, and as a reminder to create the
  branch *before* editing on W227/W228.
