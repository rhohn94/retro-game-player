-- 001_init.sql  (idempotent: guarded by user_version in the runner)
-- Source of truth: architecture-design.md §3 (D1). Keep byte-for-byte in sync.

CREATE TABLE IF NOT EXISTS content_folders (
  id        INTEGER PRIMARY KEY,
  path      TEXT    NOT NULL UNIQUE,
  enabled   INTEGER NOT NULL DEFAULT 1,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY,
  folder_id   INTEGER NOT NULL REFERENCES content_folders(id) ON DELETE CASCADE,
  path        TEXT    NOT NULL UNIQUE,
  system      TEXT    NOT NULL,            -- 'nes' | 'snes' | 'n64'
  crc32       TEXT,                        -- header-stripped, lowercase hex
  md5         TEXT,
  clean_name  TEXT    NOT NULL,            -- No-Intro title or filename fallback
  dat_matched INTEGER NOT NULL DEFAULT 0,
  core_hint   TEXT,                        -- suggested core_id for this system
  art_path    TEXT,                        -- cached boxart on disk (NULL until fetched)
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_system ON games(system);
CREATE INDEX IF NOT EXISTS idx_games_crc32  ON games(crc32);
CREATE INDEX IF NOT EXISTS idx_games_folder ON games(folder_id);

CREATE TABLE IF NOT EXISTS cores (
  id             INTEGER PRIMARY KEY,
  system         TEXT    NOT NULL,
  core_id        TEXT    NOT NULL,         -- e.g. 'mesen' | 'snes9x' | 'mupen64plus_next'
  installed_path TEXT,                     -- NULL = available-but-not-installed
  version        TEXT,
  last_modified  INTEGER,                  -- buildbot Last-Modified epoch (update check)
  active         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(system, core_id)
);
CREATE INDEX IF NOT EXISTS idx_cores_system ON cores(system);
-- exactly one active core per system is enforced in core/cores (set_active_core
-- clears the prior active in the same transaction); partial unique index guard:
CREATE UNIQUE INDEX IF NOT EXISTS idx_cores_one_active
  ON cores(system) WHERE active = 1;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON-encoded scalar; typed in core/settings
);

CREATE TABLE IF NOT EXISTS controller_bindings (
  id            INTEGER PRIMARY KEY,
  device_family TEXT NOT NULL,             -- 'xbox' | 'playstation' | '8bitdo' | 'switchpro'
  action        TEXT NOT NULL,             -- 'confirm' | 'back' | 'nav_up' | … | 'quit'
  button        TEXT NOT NULL,             -- semantic gamepad button id
  UNIQUE(device_family, action)
);

CREATE TABLE IF NOT EXISTS search_providers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url_template TEXT NOT NULL,              -- contains the {query} placeholder
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS art_cache (
  id         INTEGER PRIMARY KEY,
  game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tier       TEXT NOT NULL,               -- 'boxart' | 'title' | 'snap' | 'placeholder'
  path       TEXT NOT NULL,               -- on-disk cached file
  fetched_at INTEGER NOT NULL,
  UNIQUE(game_id, tier)
);
CREATE INDEX IF NOT EXISTS idx_art_cache_game ON art_cache(game_id);
