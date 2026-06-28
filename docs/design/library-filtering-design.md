# Library Filtering + Built-in Providers Design (v0.6 "Lens")

> Built-in, links-only search providers, and a multi-facet filtering experience
> over the library (console, year, developer, publisher, title, popular aliases).
> Ticket [#4](https://github.com/rhohn94/harmony/issues/4).

---

## Motivation

Search shipped with an empty provider list, and the library could only be
filtered by console. This release seeds curated built-in providers so search is
useful out of the box, and adds a rich filter bar so a growing library is
navigable across all the facets a user thinks in — including metadata facets the
model did not previously carry.

## Goals

- A curated set of **built-in, links-only** search providers available on first
  run (Harmony only opens a constructed link; it never fetches or downloads).
- Filter the library by **console, year, developer, publisher, title, and
  popular aliases**, combining facets with AND.
- **Graceful degradation**: a metadata facet only appears when the loaded games
  actually carry values for it.

## Non-goals

- **Populating** year/developer/publisher/aliases from a real source. No
  enrichment (Familiar / ScreenScraper / DAT metadata) is wired yet, so real
  scans leave these `NULL`. The columns + UI are forward-compatible and shown via
  mock data; population is a tracked follow-up.
- Server-side/SQL filtering (client-side is sufficient at this scale).
- Filtering search *results* (search returns links only; orthogonal to the
  library filter).

## Built-in providers (W61)

Seeded by migration `003_seed_search_providers.sql` with `INSERT OR IGNORE` on
the `UNIQUE(name)` constraint — idempotent, runs once per database, and
downstream-safe (existing DBs gain them on next open). The seeds are
reference/search sites (MobyGames, IGDB, Wikipedia, GameFAQs); each is just a
`{query}` URL template. The user can disable or remove any of them.

## Game metadata columns (W61)

Migration `002_game_metadata.sql` adds nullable `year` (INTEGER), `developer`,
`publisher`, and `aliases` (TEXT, a JSON array) columns to `games`
(`ALTER TABLE ADD COLUMN` — a cheap metadata-only change). The `Game`/`NewGame`
structs, `map_game`, `add_game`, the `GameDto` (which parses `aliases` JSON into
a real `Vec<String>`), and the TS `Game` all carry the fields. The scan leaves
them `None`.

## Filtering experience (W62)

- **`src/features/library/filter.ts`** — pure, React-free logic: `facetValues`
  (distinct present values per facet) + `filterGames` (AND across console / year /
  developer / publisher, with a free-text query matching the title OR any alias).
  Fully unit-tested in `filter.test.ts`.
- **`LibraryFilters`** — the filter bar: a console pill tablist, a title/alias
  search box, and year/developer/publisher `<select>`s that **only render when
  the games carry values** for that facet. Token-styled, keyboard-accessible.
- **`LibraryPage`** owns the `FilterCriteria` state and renders the filtered grid;
  it distinguishes "no games at all" (the create-folder affordance) from "no
  games match your filters".

## Validation (W63)

- Rust: migration tests (metadata columns present, built-ins seeded, idempotent),
  repo metadata round-trip, and `scanned_game_has_null_metadata`.
- JS: `filter.test.ts` (9 tests) over the pure facet/filter logic.
- Mock-IPC fixtures carry metadata + the seeded providers, so the filter bar and
  built-ins render headlessly; `visual-inspect` verified on all routes.
