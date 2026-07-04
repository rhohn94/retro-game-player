# Release Planning — v0.31

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.31.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.31` |
| **Previous** | v0.30 ("Passport" — Developer-ID signing/notarization pipeline) |
| **Theme** | "Frontier" — non-retro games join the library (Horizon H1, first slice): pluggable game sources, a launcher abstraction beyond RetroArch, ROM-less library rows, Steam art. |

Design authority: [non-retro-library-design.md](../design/non-retro-library-design.md).
No `Grimoire-Requirement` issues were open at planning time (mandatory tracker
read performed 2026-07-04; zero result).

---

## 2. Major Features

### W310 — ROM-less library model
Nullable rom identity (`rom_path`/`rom_hash`/`system_id`), new `source`,
`launch_descriptor` (JSON), `external_id` columns via a new versioned
migration; master-contract §3 DDL updated in the same branch; Rust rows + TS
DTOs mirrored; source-aware upsert keyed on `(source, external_id)`.
**Acceptance:** migration applies to a v0.30 DB and is idempotent; ROM rows
untouched; either-rom-or-descriptor CHECK invariant enforced with a repo test.
**Branch:** `feat/w310-romless-library-model`. **Est:** ~60K.

### W311 — Launcher abstraction (launch descriptors)
`LaunchDescriptor` dispatch (`retroarch` | `app` | `steam` | `exec`) in
`src-tauri/src/core/launch/`; existing IPC commands preserved; argv-safety
rules carried over; app-focus/termination-observed play sessions for external
titles. **Acceptance:** unit tests on argv/URL construction per kind;
RetroArch path unregressed; play session recorded for an external launch.
**Branch:** `feat/w311-launcher-descriptors`. **Est:** ~80K.

### W312 — Steam game source
`GameSource` trait + Steam appmanifest (`.acf`) scanner under
`~/Library/Application Support/Steam/steamapps`; no API calls; absent Steam →
empty result. **Acceptance:** correct name/appid rows; re-scan zero
duplicates; no-Steam is not an error. **Branch:** `feat/w312-steam-source`.
**Est:** ~55K.

### W313 — App scanner + manual entries
`/Applications` + `~/Applications` `.app` enumeration with game heuristics
(`LSApplicationCategoryType`), confirm-gated shortlist; manual-entry form as
escape hatch; "Game sources" settings pane hosting scan/re-scan + manual add.
**Acceptance:** shortlist confirm gate works; confirmed + manual entries
appear and launch. **Branch:** `feat/w313-app-manual-sources`. **Est:** ~60K.

### W314 — Steam CDN art
Steam header/hero art fetched from the public CDN keyed on appid, cached via
the existing `art_cache` pipeline; `.app` bundle-icon fallback; placeholder
otherwise. **Acceptance:** Steam art on shelf + TV hero; icon/placeholder
fallbacks render. **Branch:** `feat/w314-steam-art`. **Est:** ~45K.

### W315 — Non-retro UI (first-class shelves/detail/TV)
Shelves, filtering, favorites, play-time, detail page, TV launch flow treat
non-retro rows first-class; source badge instead of console badge; detail
page hides emulator affordances; "Desktop" library filter/section.
**Acceptance:** non-retro title browsable and launchable from library and TV
mode; retro flows unregressed; `recipe.py smoke` passes.
**Branch:** `feat/w315-nonretro-ui`. **Est:** ~60K.

### W316 — Docs hygiene rider (#41)
Consolidate release-planning locations, remove the duplicated spike doc,
finish the harmony→retro-game-player rename in docs (issue #41).
**Acceptance:** #41's checklist satisfied; doc links intact.
**Branch:** `docs/w316-docs-hygiene`. **Est:** ~25K.

---

## 3. Parallel Implementation Strategy

- **Pass 1 (serial foundation):** W310 alone — every other item consumes its
  schema/types.
- **Pass 2 (parallel):** W311, W312, W313, W316. Disjoint surfaces: launch
  module vs. two new source modules vs. docs-only. **Conflict map:** W312 and
  W313 both create/register under the new sources module — merge **W312
  before W313** (W313 rebases nothing; the merge order resolves the shared
  registration file). W316 is docs-only; merge any time.
- **Pass 3 (parallel):** W314, W315. Both touch shelf/art surfaces — merge
  **W314 before W315**.
- Merge order within a pass otherwise: ledger row order. Tests
  (`pnpm test` + `cargo test`) after every merge; `recipe.py smoke` required
  before the final `version/0.31` → `dev` merge (UI surfaces touched).

---

## 4. Out of Scope for v0.31

- **GOG/itch scanners; SteamGridDB art** — v0.32 candidates
  (design doc §Follow-ups).
- **ROM scanner migration onto `GameSource`** — later refactor.
- **H2 CrossOver integration** — future release; builds on W311 descriptors.
- **Storefront purchases, install/uninstall management, in-page play for
  native titles** — roadmap-fixed non-goals.
- **Issue hygiene #42** (reconcile v0.29-shipped scope in the tracker) —
  handled directly by the integration master at cleanup; not a code branch.
- **v0.30 human follow-ups** (Apple Developer enrollment, real notarization
  run, clean-Mac Gatekeeper verify) — remain human steps, not agent work.
- **Backlog issues** #33, #34, #35, #36, #38, #39, #40, #43, #21, #24, #28,
  #29, #31 — remain backlog; none tagged v0.31.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.31 |
|---|---|---|---|---|
| `feat/w310-romless-library-model` (W310) | ☑ | ☑ | ☑ | ☑ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.31 |
|---|---|---|---|---|
| `feat/w311-launcher-descriptors` (W311) | ☑ | ☑ | ☑ | ☑ |
| `feat/w312-steam-source` (W312) | ☑ | ☑ | ☑ | ☑ |
| `feat/w313-app-manual-sources` (W313) | ☑ | ☑ | ☑ | ☑ |
| `docs/w316-docs-hygiene` (W316) | n/a | ☑ | ☑ | ☑ |

### Pass 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.31 |
|---|---|---|---|---|
| `feat/w314-steam-art` (W314) | ☑ | ☑ | ☑ | ☑ |
| `feat/w315-nonretro-ui` (W315) | ☑ | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- **Fixed in W310 (not a follow-up):** latent migration-runner bug — mid-transaction
  `PRAGMA foreign_keys` was a no-op, so migration 012's table rebuild would have
  cascade-deleted `art_cache` rows; the runner gained `Migration::requires_fk_off`
  (toggled outside the transaction).
- Reviewer (W310, non-blocking): `migrations.rs` FK re-enable is skipped if a
  `requires_fk_off` migration fails — inert today (sole caller `Db::init`
  propagates the error and drops the connection) but worth a scope-guard so the
  FKs-on invariant holds unconditionally.
- Reviewer (W310, non-blocking): `upsert_game_by_source`'s UPDATE branch refreshes
  only clean_name/art_path/size_bytes/launch_descriptor/core_hint — re-scans do
  not refresh year/developer/publisher/aliases; W311+ must not assume full refresh.
- Reviewer (W310, non-blocking): `src/ipc/familiar.ts` local `Game` mirror lacks
  the new source/launchDescriptor/externalId fields — reconcile when the
  canonical DTO consolidation lands.
- **Merge note (Pass 2):** W312/W313 conflicted exactly on the predicted shared
  files (`core/sources/mod.rs`, `commands/{mod,sources}.rs`, `ipc/sources.ts`);
  resolved as additive unions. `GameSourcesPane.tsx` had consumed W313's stub
  Steam type; fixed to the real `SourceScanReport` counts during resolution.
- Reviewer (Pass 2, non-blocking): Steam appid flows unvalidated from `.acf`
  into the `steam://rungameid/` URL — no injection risk (single argv element to
  `open`), but add a numeric-only guard at parse time in `steam.rs`.
- Reviewer (Pass 2, non-blocking): `gameSourcesGating.test.ts` re-implements the
  pane's gating helpers instead of importing them — extract shared pure helpers
  from `GameSourcesPane.tsx` so the test exercises the real logic.
- Reviewer (Pass 2, non-blocking): `confirm_app_entries` stores the
  client-supplied launch descriptor verbatim (same trust level as
  `add_manual_entry`, not a new surface); defense-in-depth option is re-deriving
  the descriptor server-side from the bundle path.
- Reviewer (Pass 2, informational): app-launch play sessions can undercount if
  `pgrep` polls before the app starts or the process name differs from the
  bundle stem — documented accepted tradeoff, not a leak.
- **Fixed before closeout (not a follow-up):** Pass 3 review found a BLOCKING
  path-traversal — the Steam appid flowed unvalidated from `.acf` manifests
  into the art-cache filename and CDN URL. Closed by `fix/w314-appid-validation`
  (merged): numeric-only guard at parse time in `sources/steam.rs` plus a
  defense-in-depth mirror at `fetch_steam_art`, with traversal-payload tests.
  This also closes the Pass 2 non-blocking appid-sanitization note.
- Reviewer (Pass 3, non-blocking): art fetch is awaited serially inside
  `upsert_discovered` — N Steam titles offline can hold `scan_steam_source`
  for up to ~N×30s (other IPC unaffected); consider detaching art acquisition
  or returning counts before art settles.
- Reviewer (Pass 3, non-blocking): `bundle_icon.rs` sips conversion failures
  degrade silently to no-art; add a log line for diagnosability.
