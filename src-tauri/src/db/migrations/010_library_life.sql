-- 010_library_life.sql (v0.26 W264 — "library life" data foundation)
--
-- Additive-only columns on `games` backing favorites, recently-played, and
-- play-time aggregates (docs/design/library-life-design.md). No backfill: a
-- pre-existing row simply gets the column defaults (not a favorite, never
-- played, zero play time), which is the correct meaning for "we didn't track
-- this before now" rather than a guess.
--
--   favorite            — 0/1 flag toggled from the game detail page.
--   last_played_at      — Unix epoch seconds of the most recent play session's
--                          end, NULL until the game is ever played.
--   play_count           — number of completed play sessions (start/end pairs).
--   total_play_time_ms  — cumulative server-measured session duration.
ALTER TABLE games ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN last_played_at INTEGER;
ALTER TABLE games ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN total_play_time_ms INTEGER NOT NULL DEFAULT 0;
