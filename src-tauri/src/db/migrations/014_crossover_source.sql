-- 014_crossover_source.sql (v0.33 W331 — CrossOver game source)
--
-- Extends the `games.source` CHECK constraint (introduced by
-- 012_romless_games.sql, previously extended by 013_gog_itch_sources.sql) to
-- accept one more non-ROM source: 'crossover' (CrossOver bottle/Windows-app
-- installs). SQLite cannot `ALTER` an existing CHECK constraint, so this
-- migration rebuilds `games` again via the same documented 12-step pattern as
-- 012/013 — same foreign_keys-off requirement (see
-- `Migration::requires_fk_off` / `db/migrations.rs`), same reasoning:
-- `DROP TABLE games` would otherwise cascade-delete every `art_cache` row
-- referencing it.
--
-- No data migration is needed beyond the straight copy: no existing row can
-- have source = 'crossover' yet (that value didn't exist before this
-- migration), so every row's `source` value is already valid under both the
-- old and new CHECK list.

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
                       CHECK (source IN ('rom', 'steam', 'app', 'manual', 'gog', 'itch', 'crossover')),
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
  total_play_time_ms, source, launch_descriptor, external_id
FROM games;

DROP TABLE games;
ALTER TABLE games_new RENAME TO games;

CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
CREATE INDEX IF NOT EXISTS idx_games_crc32  ON games(crc32);
CREATE INDEX IF NOT EXISTS idx_games_folder ON games(folder_id);
CREATE INDEX IF NOT EXISTS idx_games_year      ON games(year);
CREATE INDEX IF NOT EXISTS idx_games_developer ON games(developer);
CREATE INDEX IF NOT EXISTS idx_games_publisher ON games(publisher);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_path_unique
  ON games(path) WHERE path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source_external_id
  ON games(source, external_id) WHERE external_id IS NOT NULL;
