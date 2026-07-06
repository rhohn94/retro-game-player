# Release Planning — v0.38

> status: draft
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.38.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.38` |
| **Previous** | v0.37 (Trophies — RetroAchievements foundation + collections) |
| **Theme** | "Tune-Up" — code quality, emulation performance, and UX polish: measured frame-path perf work, hardening of the v0.37 achievement/collection surfaces, the full achievement-list UI, collection management, and an a11y/polish batch. |

User directive (2026-07-06): "Orchestrate a release focused on improving
code quality, emulation performance, and overall user experience polish."

Grounding facts (three research scouts, 2026-07-06):

- **Perf, evidence-based:** every native frame re-uploads the full RGBA
  texture via `texImage2D` (`crtWebglRenderer.ts:108-128`, P0);
  `publish_frame` takes two mutexes back-to-back per frame while the rAF
  drain contends (`video.rs:155-172`, P0); mid-game geometry changes
  reallocate the scratch frame buffer (`frame.rs:49-73`); the EJS extracted-
  core cache never GCs old EJS versions (`core_extract.rs`); #35 wants real
  on-device shader-cost numbers and #36 wants `ejs-perf.log` growth bounded.
- **Quality, confirmed v0.37 follow-ups:** `poll_achievement_unlocks` loses
  drained events on a transient DB error mid-batch and its test helper
  duplicates the command body (drift risk, magic `100`);
  `get_achievement_summary` re-reads + re-hashes the ROM on every detail
  mount; `create_collection` accepts a whitespace-only name server-side;
  collections commands have no tests at all; `validate_at` never exercises
  the real client; achievements code logs via bare `eprintln!` instead of
  the W360 telemetry convention; preview iframe lacks
  `pointer-events: none`; two pre-existing clippy `type_complexity` errors;
  no component tests for TvShell/TvHero/NativePlayer/InPagePlayer.
- **UX:** `renameCollection`/`deleteCollection` IPC exists but has NO UI;
  an empty collection filter shows a blank grid (no message); the detail
  page shows only "N of M" with no achievement list or badge art (design-doc
  v0.38 candidate); unlocks earned while a game plays as the TV attract
  backdrop arrive late in a burst (frontend gates polling off all spectator
  presentations); #34's four keyboard-a11y gaps are individually XS–S.
- Grimoire-Requirement tracker read returned zero open issues (valid,
  2026-07-06).

---

## 2. Major Features

### W380 — Native frame publishing: lock + allocation hygiene (perf)

Reduce per-frame synchronization and allocation cost in the native video
path. (1) `publish_frame` (`runtime/video.rs`) currently takes the
`latest_frame` and `aspect_ratio` mutexes back-to-back every frame while
the frontend's rAF drain contends on the same locks — restructure to a
single short critical section (one lock guarding a small struct, or an
atomic-seq + buffer-swap design); document the chosen scheme. (2)
`to_rgba8_into` (`frame.rs`) reallocates its scratch buffer on geometry
change — pre-size to the core's declared max geometry at session start.
(3) Add cheap perf counters to the existing perf-stats surface (lock-wait
or contention proxy, realloc count) so the win is measurable, not asserted.
The frame pacing tests and A/V behavior must be bit-identical.

- **Acceptance:** all existing pacing/video/session tests green (including
  the stub-core end-to-end tests); new unit tests cover the restructured
  publish/drain path and the pre-sized buffer (geometry-change fixture);
  perf counters visible in the perf log; no public API change to the
  frontend IPC; clippy/lint clean; `recipe.py smoke` passes.
- **Branch:** `w380-frame-publish-perf`
- **Design:** extend `performance-tooling-design.md` with a §Frame-path
  measurements section (in-branch).

### W381 — Renderer perf + real shader-cost measurement (closes #35)

Frontend half of the frame-path work. (1) `crtWebglRenderer.ts` re-uploads
the full frame with `texImage2D` every draw — switch to allocate-once
(`texStorage2D`/initial `texImage2D`) + `texSubImage2D` per frame when
dimensions are unchanged, reallocating only on resize. (2) Add
`EXT_disjoint_timer_query_webgl2`-based GPU timing (feature-detected,
no-op when absent) recording draw cost into the existing perf-tools
surface, replacing #35's analytical shader-cost budget with real numbers —
record a measurement (or the no-extension outcome) in the design doc and
close #35. Fallback paths (putImageData) unchanged.

- **Acceptance:** renderer unit tests updated (the GL stub models
  texSubImage2D semantics — no vacuous mocks, per the W301 lesson); CRT
  visual output unchanged (existing tests + smoke screenshots); timer-query
  path is feature-detected and inert when unsupported; perf log gains the
  draw-cost field; #35 closable; all suites green; `recipe.py smoke` passes.
- **Branch:** `w381-renderer-perf`
- **Design:** extend `performance-tooling-design.md` + `crt-filter-design.md`
  §measurement (in-branch).

### W382 — Achievements command hardening (v0.37 follow-ups)

Close the confirmed quality findings in `commands/achievements.rs`:
(1) `poll_achievement_unlocks` — stop losing drained events on a transient
DB error: accumulate per-event results, return collected toasts, and
re-queue or telemetry-report failed persists instead of `?`-aborting
mid-batch. (2) Extract the shared poll/persist body into one free function
the command and the `poll_unlocks_at` test helper both call (the
`list_native_systems_at` precedent); kill the magic `100` timestamp.
(3) `get_achievement_summary` — stop re-reading + re-hashing the ROM on
every detail-page mount: cache path→hash (in-memory map keyed by path+mtime
or equivalent; simplest correct scheme wins). (4) Route the module's bare
`eprintln!` logs through the W360 error-telemetry convention.
(5) Defensive session-scoped timestamp per the review note.

- **Acceptance:** a test proves a mid-batch persist failure no longer
  drops the remaining drained events (fault-injecting repo stub); command
  and test helper share one body (no duplicated loop); a repeat
  `get_achievement_summary` call for the same game does not re-read the
  ROM (tested via a counting/fixture path); no `eprintln!` remains in the
  module; all suites green; `recipe.py smoke` passes.
- **Branch:** `w382-achievements-hardening`
- **Design:** `retroachievements-design.md` (no new sections needed;
  update §Evaluation notes if the polling contract changes).

### W383 — Test depth: RA client, component layer, clippy debt

(1) `validate_retroachievements_account` — make the command-layer test
exercise the real validation path against a fixture HTTP server (point
`validate_at` at `RetroAchievementsClient::with_base_url`), covering Valid
and Invalid, not just the NotConfigured short-circuit. (2) Ensure
`core/retroachievements/client.rs` fixture coverage includes the summary/
set-fetch paths the commands rely on (extend the existing httptest-pattern
suite where gaps exist). (3) Add first component tests for `TvShell` and
`TvHero` (render, no "Retro Game Player" label, chrome buttons present —
the assertion W377's acceptance wanted) and a minimal mount test each for
`NativePlayer`/`InPagePlayer` in preview presentation (no session record
IPC issued — the purity assertion W273/W376 lacked at component level).
(4) Clear the two pre-existing clippy `--all-targets` `type_complexity`
errors (`core/search/download.rs:293`,
`play/native/runtime/tests/hw_render.rs:264`) via type aliases.

- **Acceptance:** new tests fail on the mutations they guard (spot-verify
  one per group); `cargo clippy --all-targets -- -D warnings` passes for
  the two named files; no production-code behavior change beyond the type
  aliases; all suites green; `recipe.py smoke` passes.
- **Branch:** `w383-test-depth`
- **Design:** none (test-only + mechanical alias fixes).

### W385 — Collection management UX (rename/delete + feedback)

Finish the collections surface: (1) rename + delete affordances in the
collection picker rows (inline actions or a small menu — pick the pattern
consistent with the Aura wiring rules), delete behind a confirmation
dialog stating games are not deleted; wire the existing
`renameCollection`/`deleteCollection` IPC. (2) Library: an explicit
"This collection is empty" state when a collection filter yields zero
members (today: blank grid). (3) Picker: loading state while fetching and
a surfaced error state (today: silent swallow). (4) Server-side guard:
`create_collection`/`rename_collection` reject empty/whitespace-only names
with a Validation error. (5) First test suite for `commands/collections.rs`
(create/rename/delete/add/remove incl. Conflict, Validation, NotFound
paths).

- **Acceptance:** rename + delete work end-to-end with confirmation
  (component tests); empty-collection filter shows the message (test);
  picker loading/error states render (tests); whitespace-only name is
  rejected server-side (command test) and the picker guard still catches
  it client-side; collections command tests cover the error paths; all
  suites green; `recipe.py smoke` passes.
- **Branch:** `w385-collections-management`
- **Design:** `collections-design.md` §Management UX (authored
  pre-dispatch).

### W386 — Keyboard a11y + polish batch (closes #34)

The #34 punch list plus adjacent paper cuts, each XS–S: (1) TvSystemMenu —
sync real DOM focus (`ref.focus()`) with controller focus so Tab and
screen readers track arrow nav. (2) `CreateGamesFolderDialog` +
`ProviderDialog` — take the exclusive `ui` controller claim while open so
Back/Escape can't fall through to shell navigation (TvSystemMenu
precedent). (3) `useKeyboardNav` — dedicated renderHook test suite
(defaultPrevented, native-control guards, gameplay-claim branches).
(4) TvRail windowed row — audit + fix aria treatment for off-screen
virtualized tiles. (5) Focus-visible audit across settings panes' custom
inputs (range sliders etc.), adding explicit rules where browser defaults
leak through. (6) RetroAchievements pane — auto-validate on Save (single
action; keep the separate Validate button) and clarify the key-stored-
in-Keychain help text. (7) `pointer-events: none` on the TV attract
preview layer's iframe rule (the W376 hardening note).

- **Acceptance:** each fix carries its test (component/renderHook tests;
  aria/focus assertions); #34 closable with all four sub-items addressed;
  controller nav and TV tests stay green; all suites green;
  `recipe.py smoke` passes.
- **Branch:** `w386-a11y-polish`
- **Design:** none (all patterns exist; #34 is the spec).

### W387 — EJS hygiene: cache GC + perf-log bounds (closes #36)

(1) `core_extract.rs` — on startup or first extraction, remove extracted-
core directories belonging to EJS versions other than the current one
(the cache key layout already namespaces by version; stale versions are
never read again). Log what was removed via telemetry, never fail the
boot on a GC error. (2) #36 — bound `ejs-perf.log` growth (size-capped
rotation or truncation on session start; pick the simplest bounded scheme)
and tighten `player.html`'s `postMessage` origin from `*` to the loopback
origin it actually serves on.

- **Acceptance:** a fixture with a stale-version extracted dir is removed
  while the current version's cache survives (test); GC failure is
  swallowed via telemetry, not fatal (test); perf log stops growing
  unboundedly across sessions (test at the rotation seam); postMessage
  origin is the served loopback origin (test asserts the wiring AND the
  player still boots via smoke); #36 closable; all suites green;
  `recipe.py smoke` passes.
- **Branch:** `w387-ejs-hygiene`
- **Design:** `boot-latency-spike.md` §Outcome note for the GC;
  `performance-tooling-design.md` for the log bound (in-branch).

### W384 — Achievement list UI + badge art + attract-unlock flush (Pass 2)

The user-facing achievements follow-on. (1) New IPC command returning the
full achievement list for a game from the cached set + local unlocks
(id, title, description, points, badge name, unlocked_at?) — cache-only,
no network fetch on the detail page. (2) Detail page: an expandable
achievement list under the existing "N of M" count (unlocked vs locked
visual states, points shown; aura patterns). (3) Badge art: best-effort
fetch of RA badge images via the client (documented RA media URL shape)
into a bounded disk cache reusing the W371 cache conventions; graceful
placeholder when absent/offline. (4) Fix the background-attract unlock
gap: unlocks earned while a session plays as the TV attract *backdrop*
(a real, recording session — `background` presentation) must flush on
return to foreground with correct behavior, not sit in the channel
indefinitely; keep `preview` (no-trace) fully excluded.

- **Acceptance:** detail page renders the full list from fixtures
  (component tests: unlocked/locked/empty/unconfigured states); list IPC
  makes zero network calls (tested); badge images cache-hit on second
  render and degrade to placeholder offline (test at the client seam);
  background-presentation unlocks surface on foreground return (test);
  all suites green; `recipe.py smoke` passes.
- **Branch:** `w384-achievement-list`
- **Design:** `retroachievements-design.md` §Achievement list (authored
  pre-dispatch).

---

## 3. Parallel Implementation Strategy

**Pass 1 (parallel, file-disjoint):** W380 (Rust `play/native/runtime/`
video/frame), W381 (TS renderer + perf tools), W382 (Rust
`commands/achievements.rs` + achievements module logging), W383 (test
files + two mechanical alias fixes; new component test files only),
W385 (collections full-stack: picker/library UI + `commands/collections.rs`
+ repo guard), W386 (TV menu/rail + dialogs + settings panes + tv-home.css
pointer-events + keyboard-nav tests), W387 (`core_extract.rs` +
`server.rs` perf-log seam + `player.html` origin).

Conflict notes:

- W380 (Rust runtime) and W381 (TS renderer) are the two halves of one
  perf theme but share zero files — the IPC frame contract is explicitly
  frozen this release.
- W383's component tests mount NativePlayer/InPagePlayer (which import the
  renderer W381 edits) but only add new `.test.tsx` files — no source
  overlap. If a W381 renderer-constructor change breaks a W383 mount test
  at merge time, the fix is mechanical (merge W381 before W383).
- W382 owns `commands/achievements.rs`; W383 touches
  `commands/retroachievements.rs` tests — different files.
- W385 owns `commands/collections.rs` + CollectionPicker/LibraryPage;
  W386 touches dialogs/TvSystemMenu/TvRail/settings panes — no shared
  files (both add theme-level focus CSS only if W386 does; W385 adds no
  CSS files).
- W386's tv-home.css one-line pointer-events rule vs. nobody else touching
  tv-home.css this release — safe.
- W387's `player.html` edit vs. nobody else — safe.
- **Merge order within Pass 1:** W386 → W385 → W383 → W387 → W381 → W382
  → W380 (frame-loop riskiest last for clean bisection).

**Pass 2 (after all Pass-1 merges):** W384 alone — it extends
`commands/achievements.rs` (W382's file, so it must build on W382's
refactor), the detail page, and the RA client/cache (badge art), and
touches NativePlayer's unlock-polling gate (W383 adds mount tests for it).

Dispatch model: `release-phase-model: Auto` (write-capable workflow),
variant Fast; branch names carry the `-v038pN-NN` suffix.

---

## 4. Out of Scope for v0.38

- **Server submission of unlocks / leaderboards / hardcore mode** — the
  remaining RA back-half; v0.39 candidate (design doc records the path).
- **Achievements beyond NES/SNES** — expansion after more native systems
  are proven; plumbing is system-agnostic.
- **IPC frame-transport redesign** (shared memory / binary channel — perf
  scout #7) and **CRT shader variants** (scout #8, L, high risk) — the
  measurement W381 lands this release decides whether either is worth it.
- **i18n** — known deferred; all strings remain English.
- **Smart collections, bulk add, collection artwork** — design-doc
  non-goals carried forward.
- **Vulkan/MoltenVK HW-render (#50), fleet self-update (#39), Aura
  upstream types (#40), docs debt (#44/#51), metadata enrichment (#24),
  natural-language search (#47), placeholder art (#46)** — unchanged
  backlog.
- **Issue hygiene #42 (closing stale #23/#28/#29)** — orchestrator task at
  release closeout, not a work item; previously classifier-blocked, may
  need user action.
- **Grimoire-Requirement items** — none open at planning time (tracker
  read returned zero, 2026-07-06).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.38 |
|---|---|---|---|---|
| `w380-frame-publish-perf` (W380) | ☐ | ☐ | ☐ | ☐ |
| `w381-renderer-perf` (W381) | ☐ | ☐ | ☐ | ☐ |
| `w382-achievements-hardening` (W382) | ☐ | ☐ | ☐ | ☐ |
| `w383-test-depth` (W383) | ☐ | ☐ | ☐ | ☐ |
| `w385-collections-management` (W385) | ☐ | ☐ | ☐ | ☐ |
| `w386-a11y-polish` (W386) | ☐ | ☐ | ☐ | ☐ |
| `w387-ejs-hygiene` (W387) | ☐ | ☐ | ☐ | ☐ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.38 |
|---|---|---|---|---|
| `w384-achievement-list` (W384) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

(populated by release-phase-merge as branches land)
