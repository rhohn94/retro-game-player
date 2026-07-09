# Library Filtering + Built-in Providers Design (v0.6 "Lens")

> Built-in, links-only search providers, and a multi-facet filtering experience
> over the library (console — including a synthetic "Desktop" tab for
> non-retro rows, year, developer, publisher, a user collection, title, popular
> aliases). Ticket [#4](https://github.com/rhohn94/retro-game-player/issues/4);
> extended by v0.31 "Frontier" W315 (Desktop tab) and v0.37 "Trophies" W373
> (collection filter).

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
- Filter the library by **console (plus a synthetic "Desktop" tab for
  non-retro rows), year, developer, publisher, a user collection, title, and
  popular aliases**, combining facets with AND.
- **Graceful degradation**: a metadata facet only appears when the loaded games
  actually carry values for it (and the collection select only appears once at
  least one collection exists).

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

## Filtering experience (W62; extended by v0.31 W315 and v0.37 W373)

- **`src/features/library/filter.ts`** — pure, React-free logic: `facetValues`
  (distinct present values per facet, plus a `hasDesktop` flag) + `filterGames`
  (AND across console / year / developer / publisher / collection, with a
  free-text query matching the title OR any alias). Fully unit-tested in
  `filter.test.ts`.
  - The console facet has a synthetic `DESKTOP_SYSTEM` ("Desktop") value
    selecting every non-retro row (Steam/App/Manual games, which carry no
    `system`); it's computed via `isNonRetro(g)`, not a real console id.
  - Collection membership isn't a `Game` field — it lives in the
    `collection_games` junction (collections-design.md) — so `filterGames`
    takes a caller-resolved `collectionMemberIds` set for the selected
    collection rather than reading a property off `Game`. Passing `null`
    means either no collection is selected (no-op) or the member set for a
    selected collection is still loading, in which case the filter matches
    nothing rather than everything so the grid never flashes stale results.
- **`LibraryFilters`** — the filter bar: a console pill tablist (including the
  "Desktop" tab once any non-retro row exists, trailing the real consoles), a
  collection `<select>` beside it (only rendered once at least one collection
  exists), a title/alias search box, and year/developer/publisher `<select>`s
  that **only render when the games carry values** for that facet. Token-styled,
  keyboard-accessible; a "Clear" button appears once any facet is active.
- **`LibraryPage`** owns the `FilterCriteria` state, resolves the selected
  collection's member ids via `listGamesByCollection` and passes them into
  `filterGames`, and renders the filtered grid; it distinguishes "no games at
  all" (the create-folder affordance) from "no games match your filters".

## Validation (W63)

- Rust: migration tests (metadata columns present, built-ins seeded, idempotent),
  repo metadata round-trip, and `scanned_game_has_null_metadata`.
- JS: `filter.test.ts` (17 tests, grown with the Desktop tab and collection
  facet) over the pure facet/filter logic.
- Mock-IPC fixtures carry metadata + the seeded providers, so the filter bar and
  built-ins render headlessly; `visual-inspect` verified on all routes.
