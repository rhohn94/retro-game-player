# Release Planning — v0.37

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.37.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.37` |
| **Previous** | v0.36 (Spring Cleaning — code-quality release) |
| **Theme** | "Trophies" — RetroAchievements foundation on the native path (NES/SNES: login, RA-correct hashing, per-frame trigger evaluation, unlock toasts, local tracking) plus library collections, completing issue #21. |

User directive (2026-07-06): proceed autonomously with designing, researching,
planning, and orchestrating the next release.

Grounding facts (three research scouts, 2026-07-06):

- Most of #21 already shipped in v0.26 (migration `010_library_life.sql`:
  favorite / last_played_at / play_count / total_play_time_ms columns; IPC
  `set_favorite` / `record_play_start/end` / `list_recently_played` /
  `list_favorites`; TV rails; detail-page heart). **Collections is the only
  unshipped half** — no schema, commands, or UI exist.
- Native host already loads `retro_get_memory_data/size` from every core
  (`host.rs`) — used today only for SRAM saves; achievement triggers need
  `RETRO_MEMORY_SYSTEM_RAM` reads per frame after `retro_run()` in
  `core_loop.rs`. No new libretro FFI surface needed.
- Proven infrastructure to reuse: `SteamGridDbClient` (keyed reqwest client,
  test-injectable base URL, v0.32 W321), `KeyStore` trait + macOS
  `KeychainStore` (`core/familiar/keychain.rs`), settings-pane key-entry
  patterns.
- Vendored EmulatorJS 4.2.3 has zero achievement support — the EJS fallback
  ships silent degradation (documented asymmetry, native-only feature).
- RA hashing is NOT our library hash: RetroAchievements hashes consoles by
  their own rules (e.g. NES strips the 16-byte iNES header) — use rcheevos'
  `rc_hash`, never `core/library/hasher.rs`.
- #31 (decompressed-core caching) is fully specified by
  `boot-latency-spike.md` (two paths); #38 (TV banner over hero) has the
  v0.28 W277 overlap precedent — note W277 shipped hero-shrink + rail
  overlap; #38 was filed AFTER v0.28 asking to remove the reserved banner
  row entirely.
- Grimoire-Requirement tracker read returned zero open issues (valid,
  2026-07-06).

---

## 2. Major Features

### W370 — rcheevos runtime: FFI, hashing, trigger evaluation (native NES/SNES)

Vendor the rcheevos C library (libretro's official achievement evaluator)
and bind it from Rust following the proven `host.rs` FFI pattern: build-time
static link via a build script (preferred — rcheevos is small, pure C, no
deps) or `libloading` if static linking fights the Tauri build. Expose: (1)
RA-correct ROM hashing via `rc_hash` for NES and SNES; (2) an achievement
runtime that loads trigger definitions (JSON from W371's client, or a local
fixture format for tests) and evaluates them against per-frame memory peeks
— wire a peek callback over `retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)`
into `core_loop.rs` immediately after each `retro_run()`; (3) an unlock
event stream (channel) the frontend can drain, following the existing
frame/input IPC patterns. Feature must be a no-op (zero per-frame cost
beyond one branch) when no achievement set is loaded.

- **Acceptance:** rcheevos builds cleanly into the app (lint/clippy clean);
  `rc_hash` produces the documented RA hash for an NES image with and
  without an iNES header (fixture test) and for SNES; a stub-core test
  (existing `cc`-built stub-core convention) with a scripted memory value
  triggers an unlock event exactly once; a session with no achievement set
  shows no measurable frame-loop regression (existing pacing tests stay
  green); all tests pass; `recipe.py smoke` passes.
- **Branch:** `w370-rcheevos-runtime`
- **Design:** `retroachievements-design.md` §§FFI, Hashing, Evaluation
  (authored pre-dispatch).

### W371 — RetroAchievements client, key storage, settings login

`RetroAchievementsClient` in `src-tauri/src/core/` modeled on
`SteamGridDbClient` (reqwest, timeout, test-injectable base URL): login
(username + API key per RA's Web API conventions — see design doc), fetch
the achievement set for a game hash (definitions + badge metadata), cached
on disk keyed by hash. Store the credential via the `KeyStore` trait
(extend the keychain module's service naming as Familiar did). Settings
gains a RetroAchievements pane (username field, API-key field, validate
button, connection status) following the SteamGridDB pane pattern. The
whole feature is optional: no credential → everything stays inert.

- **Acceptance:** client unit tests against a fixture HTTP server (httptest
  pattern already in repo) cover login-ok, bad-key, fetch-set, and
  network-failure (graceful, no panic — route failures through the v0.36
  error-telemetry conventions); credential round-trips through KeyStore
  (memory stub in tests); settings pane renders and validates (existing
  pane test pattern + smoke); no credential ⇒ zero network calls (tested);
  all suites green; `recipe.py smoke` passes.
- **Branch:** `w371-ra-client-settings`
- **Design:** `retroachievements-design.md` §§Client, Accounts, Settings.

### W372 — Unlock experience + local persistence (Pass 2)

Wire W370's unlock event stream and W371's fetched definitions into the
player: an unlock toast in the in-game overlay (non-intrusive, auto-dismiss,
queued if multiple), a per-game unlock count on the detail page, and local
persistence — migration adding an `achievement_unlocks` table (game_id,
achievement_id, unlocked_at) written on unlock and read for the detail
count. Server submission is explicitly out of scope (local-first); the
design doc records the submission path as the v0.38 follow-up.

- **Acceptance:** stub-core-triggered unlock surfaces a toast (component
  test with the W360 render harness) and lands one row (repo test,
  idempotent on re-trigger); detail page shows the count when a set is
  known and nothing when RA is unconfigured; migration follows the
  additive-upgrade test convention; all suites green; `recipe.py smoke`
  passes.
- **Branch:** `w372-unlock-experience`
- **Design:** `retroachievements-design.md` §§Unlock UX, Persistence.

### W376 — Attract mode: 1-second dwell + all in-page consoles (user directive)

User directive (2026-07-06, mid-release rider): "Decrease attract mode
timer to just 1 second. Make sure attract mode works on all consoles."
Two parts: (1) `TV_ATTRACT_DWELL_MS` 5000 → 1000 (one constant in
`useAttractDwell.ts` + the mirrored `--rgp-tv-attract-dwell-ms` CSS var +
tests + `tv-mode-design.md`). (2) Extend the TV hover-attract preview from
native-capable games to **EJS-path games** (the recorded W273 follow-up),
preserving the W273 purity contract end-to-end on the EJS path: no
library-life play-session record, no SRAM/save writes through the iframe
glue (suppress the overlay save bridge in preview mode), input never
attaches, audio ducked to the attract gain. External-only tiles (RetroArch
launch descriptors — e.g. GC/Wii) have no in-page surface and keep static
art; document that limit honestly in `tv-mode-design.md`.

- **Acceptance:** dwell fires at 1000ms (test updated, CSS var mirrored);
  an EJS-only system's tile boots a live preview behind the home with
  ducked audio; play counts / recency / saves are byte-identical before and
  after an EJS preview (purity tests, mirroring the native ones); input
  never leaks to the preview; teardown on focus move / launch / home exit
  matches native behavior; external-only tiles never attempt a preview;
  `tv-mode-design.md` updated (dwell value + EJS scope + external limit);
  all suites green; `recipe.py smoke` passes.
- **Branch:** `w376-attract-all-consoles`
- **Design:** `tv-mode-design.md` §W273 (extend in place).

### W377 — TV-mode aesthetics: drop chrome header + scrims, drop-shadow legibility (user directive)

User directive (2026-07-06, mid-release rider): "Revise aesthetics of TV
mode: Remove 'Retro Game Player' header and the dark background overlay.
Instead, give text a drop shadow to aid with legibility." Three parts:
(1) remove the shell header row (`rgp-tv-shell__label` / `__header` in
`TvShell.tsx` + `tv-shell.css`) — the freed vertical space goes to content
(interacts with W375's banner-over-hero work; W377 runs after W375 lands).
(2) Remove the dark background overlay layers: the full-bleed attract
`preview-scrim` (`tv-home.css` — `color-mix(… 45%, transparent)` wash) and
the hero gradient scrim treatment, so backdrop art / attract previews show
un-washed. (3) Restore legibility with drop shadows on the text itself:
extend the existing `text-shadow` precedent (`tv-home.css` hero copy) to
all TV-mode copy over art — hero title/meta, rail titles, tile labels,
shell chrome buttons. Keep controller-nav focus treatments intact; update
`tv-mode-design.md` and the two-viewport screenshot check like W375.

- **Acceptance:** the "Retro Game Player" header is gone (shell test
  updated) and no vertical space is reserved for it; the preview scrim and
  hero scrim washes are removed (backdrop/preview renders un-dimmed by
  overlay layers); every TV-mode text surface over art carries a drop
  shadow and stays legible at 1920×1080 and 1512×982 (visual-inspect
  smoke); controller nav and existing rail/tile tests stay green;
  `tv-mode-design.md` updated; all suites green; `recipe.py smoke` passes.
- **Branch:** `w377-tv-aesthetics`
- **Design:** `tv-mode-design.md` (extend §v0.37).

### W373 — Collections (closes #21)

The unshipped half of issue #21. Migration `015_collections.sql`:
`collections` (id, name, created_at, sort) + `collection_games` junction
(FK cascade, tested like migrations 012–014). Repo methods
(create/rename/delete collection, add/remove game, list collections with
counts, list games by collection) in a new `db/repo/library/collections.rs`
submodule (v0.36 layout). IPC commands mirroring the repo surface. UI:
detail-page "Add to collection" picker (create-inline affordance), library
filter/drill by collection alongside the system filter, and a TV rail per
non-empty collection (extend `buildRails()`/`useTvLibrary` after the
existing Favorites rail, capped sensibly).

- **Acceptance:** migration upgrade test from a pre-015 fixture passes; FK
  cascade covered (deleting a collection never deletes games; deleting a
  game cleans its memberships); repo + IPC tests per method; detail-page
  picker and library filter behave in component tests; TV home renders
  collection rails (existing rail test pattern) and controller nav still
  passes; all suites green; `recipe.py smoke` passes; issue #21 closable.
- **Branch:** `w373-collections`
- **Design:** `collections-design.md` (authored pre-dispatch).

### W374 — Decompressed-core caching for in-page boots (#31)

Implement the `boot-latency-spike.md` recommendation: skip the per-boot
7z decompression of EmulatorJS cores. Prefer the Rust-side pre-extraction
path (decompress once into the existing core disk cache, serve raw
`.js`/`.wasm`/`.worker.js` from the loopback server, teach the loader to
accept pre-extracted files); fall back to the spike's page-patch path
(IndexedDB keyed `<filename>#decompressed`, versioned by `rep.buildStart`)
only if the current core-cache layout makes pre-extraction impractical —
record which path was taken and why in the spike doc.

- **Acceptance:** second boot of the same in-page game skips the 7z worker
  (assert via the perf log or a served-path test); cache invalidates on
  core version change (tested); first-boot behavior unchanged; all suites
  green; `recipe.py smoke` passes; issue #31 closable.
- **Branch:** `w374-core-cache`
- **Design:** `boot-latency-spike.md` (exists — update §Outcome).

### W375 — TV banner over hero art (#38)

Remove the reserved app-banner row in TV mode by layering the banner
directly over the hero art, using the W277 rail-overlap precedent
(DOM-order + negative margin / token approach in `tv.css`/`tv-home.css`);
keep legibility with the existing scrim treatment. Verify at the two
documented viewports (1920×1080, 1512×982).

- **Acceptance:** the banner no longer reserves vertical space (more rail
  content visible); hero copy band stays legible over art (screenshot
  check at both viewports via the visual-inspect smoke); controller nav
  unaffected; all suites green; `recipe.py smoke` passes; issue #38
  closable.
- **Branch:** `w375-tv-banner-overlay`
- **Design:** `tv-mode-design.md` (exists — extend §v0.37).

---

## 3. Parallel Implementation Strategy

**Pass 1 (parallel, file-disjoint):** W370 (vendor/rcheevos +
`play/native/core_loop.rs` + new achievements module), W371
(`core/` client + keychain + settings pane), W373 (db migration 015 +
`db/repo/library/collections.rs` + library/TV UI), W374 (`play/server.rs`
+ inpage core cache + EJS loader seam), W375 (`tv.css`/`tv-home.css`/
`TvHome.tsx`).

**Pass 2 (after all Pass-1 merges):** W372 (consumes W370's event stream +
W371's client; its migration numbers after W373's 015; touches the player
overlay and detail page) ∥ W376 (attract rider — TV attract surfaces +
EJS preview glue: `useAttractDwell.ts`, `TvHome.tsx` attract wiring,
`InPagePlayer`/`player.html` preview mode, `presentation.ts`) ∥ W377
(TV aesthetics — `TvShell.tsx`, `tv-shell.css`, `tv-home.css` scrim/
text-shadow work). All three are dispatchable in parallel (W372 is fully
disjoint; W376 and W377 overlap only in `tv-home.css`), but merge order
is fixed: **W372 → W376 → W377**, because W377 removes the preview scrim
that W376's EJS preview renders behind — W377's branch resolves that
seam last, on top of W376's landed wiring.

Conflict notes:

- W377 depends on W375 having landed (both restyle the hero band in
  `tv-home.css`; W375 keeps "the existing scrim treatment" for the banner
  overlay, W377 then replaces scrims with drop shadows release-wide) and
  on W376's preview glue (scrim removal changes what sits over the EJS
  attract preview). Hence W377 merges last in Pass 2.
- W373 and W375 both touch TV home: W373 adds rails via
  `useTvLibrary`/`buildRails`; W375 is hero/banner CSS + `TvHome.tsx`
  markup. Overlap risk is real but small — merge W375 before W373; if the
  merge conflicts in `TvHome.tsx`, resolution is additive (both keep).
- W374's loopback-server edits (`play/server.rs`) are disjoint from W370's
  `play/native/` work.
- Merge order within Pass 1: W375 → W374 → W371 → W373 → W370.

Dispatch model: `release-phase-model: Auto` (write-capable workflow),
variant Fast; branch names carry the `-v037pN-NN` suffix.

---

## 4. Out of Scope for v0.37

- **Achievement submission to the RA server, leaderboards, hardcore mode,
  rich presence** — v0.38+ (design doc records the submission path).
- **Achievements on Genesis/N64/other native systems** — expansion after
  the NES/SNES proof; plumbing is system-agnostic.
- **Achievements on the EJS fallback path** — vendored EmulatorJS 4.2.3 has
  no rcheevos support; silent, documented degradation this release.
- **Full per-game achievement list UI** — detail page shows unlock count
  only; the list view is a v0.38 candidate.
- **Guided Windows-install flow** — still needs its own design cycle
  (scout confirmed the CrossOver design doc has zero flow detail); not
  tasked this release.
- **Vulkan/MoltenVK HW-render (#50), fleet self-update (#39), Aura
  upstream types (#40), docs debt (#44/#51)** — unchanged backlog.
- **Grimoire-Requirement items** — none open at planning time (tracker
  read returned zero, 2026-07-06).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.37 |
|---|---|---|---|---|
| `w370-rcheevos-runtime` (W370) | ☑ | ☑ | ☑ | ☑ |
| `w371-ra-client-settings` (W371) | ☑ | ☑ | ☑ | ☑ |
| `w373-collections` (W373) | ☑ | ☑ | ☑ | ☑ |
| `w374-core-cache` (W374) | ☑ | ☑ | ☑ | ☑ |
| `w375-tv-banner-overlay` (W375) | ☑ | ☑ | ☑ | ☑ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.37 |
|---|---|---|---|---|
| `w372-unlock-experience` (W372) | ☐ | ☐ | ☐ | ☐ |
| `w376-attract-all-consoles` (W376) | ☐ | ☐ | ☐ | ☐ |
| `w377-tv-aesthetics` (W377) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

**Pass 1 (all reviews non-blocking; W374's two blocking findings fixed on
its `-f1` branch before merge):**

- **W370:** rc_hash fixture tests assert self-consistency, not a pinned
  known-answer MD5 constant — add a literal expected-hash assertion.
  Reviewer independently verified correctness against the vendored C.
- **W370:** found + guarded a real out-of-bounds read in vendored rcheevos
  `rc_hash_nes` (unconditional 4-byte memcmp on buffers < 4 bytes) via a
  `MIN_HASHABLE_BYTES` guard in `hash.rs` — worth reporting upstream to
  RetroAchievements/rcheevos.
- **W370/W371:** two pre-existing `clippy --all-targets` type_complexity
  errors (`core/search/download.rs:293`,
  `play/native/runtime/tests/hw_render.rs:264`) predate this release —
  untouched, out of scope.
- **W370:** `play::native::clock` pacing test flaky under parallel load
  (passes in isolation; unrelated code) — pre-existing suite flakiness.
- **W371:** `validate_at` command-layer test double hardcodes `Valid`
  instead of exercising the real client path (client itself is
  fixture-tested); point it at a fixture server for end-to-end proof.
- **W371:** disk cache doc says "bounded" but has no size cap/eviction —
  it's one-file-per-hash; rename or add a real bound later.
- **W372 (input):** consume `RetroAchievementsClient` + `AchievementSetCache`
  (W371) and `NativeRuntime::load_achievement_set`/`drain_unlocks` (W370,
  deliberately left unwired to `commands/`).
- **W373:** FK violation on `add_game_to_collection` maps to `Conflict`
  (not `NotFound`) via the shared `map_sqlite` pattern; `create_collection`
  lacks a server-side empty-name guard (frontend-only); client dup-check is
  case-insensitive vs. case-sensitive DB UNIQUE (documented tradeoff).
- **W373:** deferred per design doc — smart collections, collection artwork,
  bulk add via grid multi-select.
- **W374:** narrow TOCTOU gap in `core_extract.rs ensure_extracted`
  (`is_extracted` = dir-non-empty check; two concurrent extractions could
  race) — single-user desktop, low risk.
- **W374:** sevenz-rust transitive deps not in THIRD-PARTY-NOTICES.md
  (consistent with existing convention — that doc tracks vendored code).
- **W375:** `tv.css` scrim comment says header overlays top-LEFT; actual
  placement is top-RIGHT (`__top-chrome`) — stale comment, W377 will
  rework this area anyway.
- **W375:** open TV system menu visually overlaps the relocated top-right
  banner label (pre-existing z-index docking) — cosmetic; W377 removes the
  label entirely.
- **Merge:** two additive conflicts auto-resolved (both-keep):
  `commands/mod.rs` (W371 vs W373 registrations), `play/mod.rs`
  (W374 `core_extract` vs W370 `achievements`).
