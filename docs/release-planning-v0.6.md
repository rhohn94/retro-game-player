# Release Planning — v0.6

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.6.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.6` |
| **Previous** | `v0.5` (Threshold — create-a-games-folder) |
| **Theme** | "Lens" — built-in search providers, and a frontend filtering experience over the library across console, year, developer, publisher, title, and popular aliases. Fifth release of the GUI-and-cores program. |
| **Ticket** | [#4](https://github.com/rhohn94/harmony/issues/4) |

**Context.** Search ships with an empty provider list today; this release seeds
a curated set of built-in, links-only providers (Harmony never auto-downloads).
For filtering, the `Game` model currently carries only `system` + `cleanName` —
it has no year / developer / publisher / aliases. This release adds those as
**nullable** game-metadata columns (forward-compatible; populated by future
enrichment — none exists yet, so real scans leave them null) and builds a
multi-facet filtering experience that combines console + a title/alias text
search + year/developer/publisher selects, **degrading gracefully** so a facet
only appears when the visible games actually carry values for it.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W61** | Backend: metadata columns + built-in providers | Migration `002_game_metadata.sql` adds nullable `year`/`developer`/`publisher`/`aliases` columns to `games`; `Game`/`NewGame`/`map_game`/`add_game`, `GameDto`, and the TS `Game` carry the new fields (`aliases` exposed as `string[]`, stored as a JSON array). Migration `003_seed_search_providers.sql` seeds a curated set of built-in, links-only providers idempotently (`INSERT OR IGNORE`). `latest_version()` and the migration tests reflect v3; a repo test round-trips the metadata; a test asserts the built-ins are present after migration. |
| **W62** | Frontend: multi-facet filtering experience | A pure, unit-tested `filter.ts` (`facetValues(games)` + `filterGames(games, criteria)`, AND-combined; the text query matches title or any alias). A `LibraryFilters` UI extends the existing console tabs with a search box and year/developer/publisher selects that **only render when the games carry those values**. Filtering is keyboard-accessible and animated per the v0.4 motion language. |
| **W63** | Verify | Mock-IPC fixtures gain metadata on the games and reflect the seeded providers so the filter UI and built-ins render headlessly; `node scripts/visual-inspect.mjs` passes on all routes; a filter screenshot is captured. Rust + JS unit tests green; all gates green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Dependency order: W61 (DB + model so the
fields exist end-to-end) → W62 (the filtering experience consuming them) → W63
(verify). Filtering is **client-side** over the already-loaded games (the library
is small; no new query command needed), kept in a pure module so it is testable
without React. Built-in providers are seeded via a migration (idempotent, runs
once per DB, downstream-safe) rather than runtime setup ceremony. Each work item
committed atomically; full gate suite before merge.

## 4. Out of scope

- **Populating** year/developer/publisher/aliases from a real source — no
  enrichment (Familiar / ScreenScraper / DAT metadata) is wired yet, so real
  scans leave these null; that population is a tracked follow-up. The columns +
  UI are forward-compatible and demonstrated via mock data.
- Server-side / SQL-level filtering (client-side is sufficient at this scale).
- Search-result filtering (search returns links only and is orthogonal to the
  library filter).
- Core discovery/download (v0.7).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W61 — metadata columns + built-in providers | version/0.6 (in-session) | ☑ | Migrations 002 (nullable year/developer/publisher/aliases on `games`) + 003 (seed MobyGames/IGDB/Wikipedia/GameFAQs, `INSERT OR IGNORE`); Game/NewGame/map_game/add_game, GameDto (aliases→`Vec<String>`), TS Game extended; migration + repo metadata tests; 194 Rust tests + clippy clean. |
| W62 — multi-facet filtering experience | version/0.6 (in-session) | ☑ | Pure `filter.ts` (facetValues + filterGames, AND, title/alias query) + 9 unit tests; `LibraryFilters` bar (console pills + search + year/dev/pub selects, hidden when empty); LibraryPage distinguishes no-games vs no-matches. |
| W63 — verify | version/0.6 (in-session) | ☑ | Mock fixtures carry metadata + seeded providers; mock-ipc guard updated for new keys; visual-inspect verified=true guiOk=true on 4 routes; filter bar confirmed in the library screenshot; 53 JS tests green. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.6 → dev | ☑ | merged `--no-ff`; 194 Rust + 53 JS tests + visual-inspect green on dev |
| dev → main promoted + tagged v0.6 | ☑ | |
| pushed to origin | ☐ | HUMAN-GATED — do not push without explicit go |
