-- 012_romless_games.sql (v0.31 W310 — ROM-less library model)
--
-- Non-retro titles (Steam installs, plain .app bundles, manually added games)
-- must be able to join the `games` table without a ROM identity. SQLite has no
-- `ALTER COLUMN ... DROP NOT NULL` / no way to add a CHECK constraint to an
-- existing table via ALTER, so this migration rebuilds `games` via the
-- documented 12-step pattern: create the new shape, copy every existing row
-- across unchanged, drop the old table, rename the new one into place, then
-- recreate its indexes. `DROP TABLE games` here would cascade-delete every
-- `art_cache` row referencing it unless FK enforcement is off — but
-- `PRAGMA foreign_keys` is a no-op once a transaction is already open, so
-- this script does NOT toggle it itself; the migration runner
-- (`db/migrations.rs::run`, `Migration::requires_fk_off`) turns it off
-- BEFORE opening this migration's transaction and back on immediately after,
-- which is the only place in the codebase where that toggle can actually
-- take effect.
--
--   folder_id           — becomes nullable: a ROM row keeps its owning
--                          content_folders row; a non-ROM row has none.
--   path                — becomes nullable ("rom_path" in the release-plan
--                          shorthand): the on-disk ROM path, NULL for
--                          non-ROM sources.
--   system               — becomes nullable ("system_id" in the release-plan
--                          shorthand): the emulated system, NULL for non-ROM
--                          sources.
--   source               — 'rom' | 'steam' | 'app' | 'manual', default 'rom'
--                          so every pre-existing row is correctly tagged
--                          without a backfill.
--   launch_descriptor   — JSON launch descriptor (see
--                          non-retro-library-design.md), NULL for 'rom' rows
--                          (they launch through the existing RetroArch path).
--   external_id          — source-scoped external identifier (e.g. a Steam
--                          appid), NULL for 'rom' rows.
--
-- Invariant enforced by CHECK: every row has EITHER a rom identity
-- (path AND system) OR a launch_descriptor. Uniqueness on (source,
-- external_id) is enforced by a partial unique index (SQLite treats NULLs as
-- distinct in a UNIQUE index, so multiple external_id-less rows already
-- coexist without needing the WHERE guard — it's added anyway for clarity
-- and to make the intent self-documenting).

CREATE TABLE games_new (
  id                 INTEGER PRIMARY KEY,
  folder_id          INTEGER REFERENCES content_folders(id) ON DELETE CASCADE,
  path               TEXT,
  system             TEXT,
  crc32              TEXT,
  md5                TEXT,
  clean_name         TEXT    NOT NULL,
  dat_matched        INTEGER NOT NULL DEFAULT 0,
  core_hint          TEXT,
  art_path           TEXT,
  size_bytes         INTEGER NOT NULL DEFAULT 0,
  added_at           INTEGER NOT NULL,
  year               INTEGER,
  developer          TEXT,
  publisher          TEXT,
  aliases            TEXT,
  description        TEXT,
  wikipedia_url      TEXT,
  favorite           INTEGER NOT NULL DEFAULT 0,
  last_played_at     INTEGER,
  play_count         INTEGER NOT NULL DEFAULT 0,
  total_play_time_ms INTEGER NOT NULL DEFAULT 0,
  source             TEXT    NOT NULL DEFAULT 'rom'
                       CHECK (source IN ('rom', 'steam', 'app', 'manual')),
  launch_descriptor  TEXT,
  external_id        TEXT,
  CHECK (
    (path IS NOT NULL AND system IS NOT NULL)
    OR launch_descriptor IS NOT NULL
  )
);

INSERT INTO games_new (
  id, folder_id, path, system, crc32, md5, clean_name, dat_matched, core_hint,
  art_path, size_bytes, added_at, year, developer, publisher, aliases,
  description, wikipedia_url, favorite, last_played_at, play_count,
  total_play_time_ms, source, launch_descriptor, external_id
)
SELECT
  id, folder_id, path, system, crc32, md5, clean_name, dat_matched, core_hint,
  art_path, size_bytes, added_at, year, developer, publisher, aliases,
  description, wikipedia_url, favorite, last_played_at, play_count,
  total_play_time_ms, 'rom', NULL, NULL
FROM games;

DROP TABLE games;
ALTER TABLE games_new RENAME TO games;

CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
CREATE INDEX IF NOT EXISTS idx_games_crc32  ON games(crc32);
CREATE INDEX IF NOT EXISTS idx_games_folder ON games(folder_id);
CREATE INDEX IF NOT EXISTS idx_games_year      ON games(year);
CREATE INDEX IF NOT EXISTS idx_games_developer ON games(developer);
CREATE INDEX IF NOT EXISTS idx_games_publisher ON games(publisher);
-- `path` was UNIQUE on the old table; preserve that for rows that still have
-- one (a partial index, since non-ROM rows now legitimately have NULL path).
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_path_unique
  ON games(path) WHERE path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source_external_id
  ON games(source, external_id) WHERE external_id IS NOT NULL;
