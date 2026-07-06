-- 015_collections.sql (v0.37 W373 — Library collections)
--
-- User-created, user-named collections (issue #21's remaining half — see
-- docs/design/collections-design.md). Purely additive: two new tables, no
-- existing table touched, so no FK-off rebuild dance is required (unlike
-- 012-014, which extended an existing CHECK on `games`).
--
-- `collections` holds the user-facing shelf metadata; `collection_games` is
-- the many-to-many membership junction. Both directions of the FK cascade so
-- deleting a collection never touches `games` (only its own membership rows
-- disappear) and deleting a game cleans up every collection's membership row
-- for it (no orphaned membership pointing at a gone game).
--
-- `sort` is reserved for a future manual collection ordering (the collections
-- LIST, not games within one — see the design doc's non-goals); defaulted to
-- 0 today so every existing/new row is equally ordered until that ships.

CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_games (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_games_game ON collection_games(game_id);
