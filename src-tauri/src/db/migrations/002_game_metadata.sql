-- 002_game_metadata.sql (v0.6 "Lens")
-- Nullable metadata columns for library filtering. Existing rows stay NULL; new
-- rows default NULL until a future enrichment source populates them. SQLite
-- ALTER TABLE ADD COLUMN is a cheap metadata-only change (no table rewrite).
ALTER TABLE games ADD COLUMN year      INTEGER;  -- release year
ALTER TABLE games ADD COLUMN developer TEXT;     -- developer / studio
ALTER TABLE games ADD COLUMN publisher TEXT;     -- publisher
ALTER TABLE games ADD COLUMN aliases   TEXT;     -- JSON array of alternate titles

CREATE INDEX IF NOT EXISTS idx_games_year      ON games(year);
CREATE INDEX IF NOT EXISTS idx_games_developer ON games(developer);
CREATE INDEX IF NOT EXISTS idx_games_publisher ON games(publisher);
