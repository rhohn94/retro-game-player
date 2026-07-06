-- 016_achievement_unlocks.sql (v0.37 W372 — RetroAchievements unlock persistence)
--
-- Local-first record of which achievements a game has unlocked (see
-- docs/design/retroachievements-design.md §Unlock UX + persistence). Purely
-- additive: one new table, no existing table touched, so no FK-off rebuild
-- dance is required (matching 015_collections.sql's own additive shape).
--
-- `achievement_id` is RA's own numeric achievement id (stable across
-- sessions, matches `core::retroachievements::achievement_set::
-- AchievementDefinition::id`), NOT a locally-generated key. The
-- `(game_id, achievement_id)` uniqueness constraint is what makes recording
-- an unlock idempotent: the native runtime's rcheevos evaluator is
-- edge-triggered and should never re-fire for an already-unlocked
-- achievement, but a defensive `INSERT OR IGNORE` against this constraint
-- means even a stray duplicate event (e.g. a save-state reload replaying the
-- triggering frame) lands at most one row.
--
-- Deleting a game cleans up its unlock rows (no orphaned unlock pointing at a
-- gone game); there is deliberately no reverse cascade (an achievement
-- definition is RA-hosted, not a local row this schema owns).

CREATE TABLE IF NOT EXISTS achievement_unlocks (
  game_id        INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL,
  unlocked_at    INTEGER NOT NULL,
  PRIMARY KEY (game_id, achievement_id)
);
