# Release Planning — v0.32

> status: draft
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.32.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.32` |
| **Previous** | v0.31 (Frontier — non-retro library, Horizon H1 first slice) |
| **Theme** | "Sources Complete" — finish Horizon H1: the remaining game sources (GOG, itch), art for non-Steam titles (SteamGridDB), and the ROM scanner migrated onto the `GameSource` trait. |

---

## 2. Major Features

### W320 — GOG + itch scanners

Two new `GameSource` implementations discovering installed GOG and itch
titles on macOS, additive alongside the Steam (W312) and app/manual (W313)
sources — same scan-report shape, same pane wiring.

- **Acceptance:** GOG installs (`.app` bundles under the GOG Galaxy install
  root and/or GOG's install-manifest records) and itch installs (the itch
  app's install locations / `butler` database where present) are discovered
  and upserted with `source` + launch descriptors; scan reports surface
  counts in `GameSourcesPane`; keyless operation; unit tests with fixture
  manifests; absence of GOG/itch installs is a clean zero-count scan, not an
  error.
- **Branch:** `feat/w320-gog-itch-sources`
- **Design:** `docs/design/non-retro-library-design.md` §v0.32 (to be added
  by this item; scaffolded before dispatch).

### W321 — SteamGridDB art provider

Art for non-Steam titles (apps, manual entries, GOG/itch) via the
SteamGridDB API, reusing the W314 art-cache pipeline as the fallback when no
Steam CDN art applies.

- **Acceptance:** a SteamGridDB client keyed by a user-supplied API key
  (settings UI field, stored like other settings; feature inert without a
  key); name-based lookup fetches grid/hero art into the existing
  `art_cache`; fallback order Steam CDN → SteamGridDB → bundled icon is
  deterministic and tested; API failures degrade to no-art with a log line,
  never block scans.
- **Branch:** `feat/w321-steamgriddb-art`
- **Design:** `docs/design/non-retro-library-design.md` §v0.32.

### W322 — ROM scanner migration onto `GameSource`

The "later refactor" carryover: the legacy retro ROM scanner becomes a
`GameSource` implementation so retro is just another source and the scan
orchestration is uniform.

- **Acceptance:** ROM scanning runs through the `GameSource` trait with
  behaviour parity (same rows, hashes, art, core hints as before — regression
  tests prove it); no UI regression on shelves/detail/TV for retro titles;
  legacy scan entry points delegate or are removed; `recipe.py smoke` passes.
- **Branch:** `refactor/w322-rom-scanner-gamesource`
- **Design:** `docs/design/non-retro-library-design.md` §v0.32.

### W323 — Art-fetch detachment + icon-failure logging

v0.31 Pass-3 reviewer follow-ups: `scan_steam_source` awaits art serially
inside `upsert_discovered` (N offline titles ⇒ up to ~N×30s hold), and
`bundle_icon.rs` sips failures degrade silently.

- **Acceptance:** scan commands return counts without waiting for art (art
  acquisition detached/queued; UI updates when art lands or on next load);
  a test covers scan-completes-fast-with-art-pending; `bundle_icon.rs`
  conversion failures emit a log line.
- **Branch:** `perf/w323-art-fetch-detach`
- **Design:** covered by `docs/design/non-retro-library-design.md` §Art;
  no new doc needed.

### W324 — Hardening rider

Three XS carryovers from the v0.31 §5 follow-ups, batched:

1. `migrations.rs`: scope-guard so FK re-enable holds even if a
   `requires_fk_off` migration fails.
2. Extract `GameSourcesPane.tsx` gating helpers into a shared pure module and
   make `gameSourcesGating.test.ts` import the real logic.
3. Add `source` / `launchDescriptor` / `externalId` to the `src/ipc/familiar.ts`
   local `Game` mirror.

- **Acceptance:** each item covered by a unit test (FK invariant test, gating
  test importing the shared helpers, type-level/DTO test); no behaviour
  change beyond the guard.
- **Branch:** `fix/w324-hardening-rider`
- **Design:** n/a (hardening; no feature surface).

---

## 3. Parallel Implementation Strategy

| Pass | Items | Rationale |
|---|---|---|
| 1 | W322 + W324 | W322 settles the `GameSource` trait before new scanners target it; W324 is disjoint (migrations.rs, pane helpers, familiar.ts). |
| 2 | W320 + W323 | W320 builds on the settled trait; W323 confines itself to `sources/steam.rs` art awaiting + `bundle_icon.rs`. |
| 3 | W321 | Art pipeline work lands after W323's detachment settles the art-acquisition shape. |

**Conflict map** (predicted overlapping files):

- `core/sources/mod.rs`, `commands/sources.rs`, `ipc/sources.ts`: W322 and
  W320 both touch — separated into Pass 1 vs Pass 2.
- Art pipeline (`steam_art.rs` / art-cache / fetch path): W323 and W321 both
  touch — separated into Pass 2 vs Pass 3.
- `GameSourcesPane.tsx`: W324 (helper extraction) and W320 (new source rows)
  both touch — separated into Pass 1 vs Pass 2.
- Merge order within a pass: W322 before W324; W320 before W323.

**Done-criteria:** every branch green on
`pnpm test && cargo test`, typecheck, lint; branches touching a served or UI
surface (W320–W323) additionally pass `recipe.py smoke`.

---

## 4. Out of Scope for v0.32

- **H2 CrossOver integration** — future release; gets its own design doc +
  plan when the user schedules it (roadmap §Horizon).
- **Storefront purchases, install/uninstall management, in-page play for
  native titles** — roadmap-fixed non-goals.
- **Metadata refresh semantics of `upsert_game_by_source`** (re-scans don't
  refresh year/developer/publisher/aliases) — documented behaviour; revisit
  with the metadata-enrichment epic (#24).
- **Backlog issues** #21, #24, #28, #29, #31, #33, #34, #35, #36, #38, #39,
  #40, #42, #43, #44 — remain backlog; none tagged v0.32.
- **Grimoire-Requirement items** — none open at planning time (tracker read
  returned zero).

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.32 |
|---|---|---|---|---|
| `refactor/w322-rom-scanner-gamesource` (W322) | ☐ | ☐ | ☐ | ☐ |
| `fix/w324-hardening-rider` (W324) | n/a | ☐ | ☐ | ☐ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.32 |
|---|---|---|---|---|
| `feat/w320-gog-itch-sources` (W320) | ☐ | ☐ | ☐ | ☐ |
| `perf/w323-art-fetch-detach` (W323) | n/a | ☐ | ☐ | ☐ |

### Pass 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.32 |
|---|---|---|---|---|
| `feat/w321-steamgriddb-art` (W321) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

(empty — populated as branches land)
