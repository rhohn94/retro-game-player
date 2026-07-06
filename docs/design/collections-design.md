# Library collections

> **Up:** [↑ Design index](README.md)

## Motivation

Collections are the last unshipped half of issue #21 ("Library life"):
favorites, recently-played, and play-time landed in v0.26, but users still
cannot group games their own way ("Couch co-op", "RPGs", "Kids"). Shelves
that reflect the user's own curation are core to the library-feels-like-
*yours* north star, on both the desktop grid and the TV rails.

## Scope

- User-created, user-named collections; a game may belong to many.
- Surfaces: detail-page membership picker (with inline create), library
  filter/drill-down beside the existing system filter, and one TV rail per
  non-empty collection after the Favorites rail (capped).
- Non-goals: smart/rule-based collections, ordering games within a
  collection (insertion order suffices), import/export, sync, cover-art
  collages for collection tiles.

## Design

**Schema.** Migration `015_collections.sql`:
`collections(id INTEGER PK, name TEXT NOT NULL UNIQUE, created_at INTEGER
NOT NULL, sort INTEGER NOT NULL DEFAULT 0)` and
`collection_games(collection_id REFERENCES collections ON DELETE CASCADE,
game_id REFERENCES games ON DELETE CASCADE, added_at INTEGER NOT NULL,
PRIMARY KEY (collection_id, game_id))`. Junction table over JSON column:
queryable both directions, FK-cascade semantics for free, matches the
migration-test conventions of 012–014.

**Repo.** New `db/repo/library/collections.rs` submodule (the v0.36 split
layout): create/rename/delete collection, add/remove membership,
list-collections-with-counts, list-games-by-collection (reusing the shared
row-mapper from the v0.36 W364 helpers). One `impl LibraryRepo` block, unit
tests per method.

**IPC.** Commands mirroring the repo surface 1:1 in
`commands/collections.rs` (one TS wrapper each in `src/ipc/collections.ts`,
per the one-wrapper-per-command header convention).

**UI.** Detail page: an "Add to collection" affordance beside the favorite
heart opening a picker (existing aura patterns — aura-select/menu per
[the Aura wiring rules](ux/design-language.md)); inline "New collection…"
row. Library: collection chips/dropdown beside the system filter
(`LibraryFilters.tsx`), drill-down shows only members. TV: extend
`buildRails()`/`useTvLibrary` with one rail per non-empty collection after
Favorites, capped at the existing rail-count conventions; controller nav
must keep passing `railNav` tests.

## Acceptance

- [ ] Additive-upgrade migration test from a pre-015 fixture DB.
- [ ] Cascade tests: deleting a collection never deletes games; deleting a
      game cleans its memberships.
- [ ] Repo + IPC tests per method (incl. duplicate-name and double-add).
- [ ] Detail-page picker component test (add, remove, inline-create).
- [ ] Library filter shows collection members only.
- [ ] TV home renders collection rails; controller nav tests green.
- [ ] `recipe.py smoke` passes; issue #21 closable.

## Management UX (v0.38 W385)

v0.37 shipped create/membership only; the `renameCollection` /
`deleteCollection` IPC existed with no UI. W385 completes the surface:

- **Picker row actions.** Each collection row in the detail-page picker
  gains rename and delete affordances (inline icon actions or a compact
  row menu — whichever reads cleanest under the Aura wiring rules; rename
  edits in place reusing the inline-create input pattern). Delete opens a
  confirmation dialog that states plainly that games are not deleted, only
  the grouping. The dialog takes the exclusive `ui` controller claim (the
  TvSystemMenu precedent) so Back/Escape closes it, never the page.
- **Empty-collection state.** A collection filter with zero members shows
  an explicit "This collection is empty" message in the library grid
  (today: indistinguishable from a broken page). TV rails already skip
  empty collections by design — unchanged.
- **Picker load/error states.** The picker shows a lightweight loading
  state while fetching and a visible error message on fetch failure
  (today: silent swallow ⇒ empty-looking picker).
- **Server-side name guard.** `create_collection` and `rename_collection`
  reject empty/whitespace-only names with a Validation error — the
  frontend guard stays, but the command no longer trusts it.

## Follow-ups

- Smart collections (rules over system/favorite/recency).
- Collection artwork treatment for rails/tiles.
- Bulk add (multi-select in the grid) — interacts with a future
  grid-selection model.
