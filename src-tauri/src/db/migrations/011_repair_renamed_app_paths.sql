-- 011_repair_renamed_app_paths.sql (v0.26.2 W271 — post-rename DB path repair)
--
-- W269's rename migration (config::migrate) moved the app-support directory
-- from ~/Library/Application Support/com.harmony.app/ to
-- …/com.retro-game-player.app/ when the bundle identifier changed, but rows
-- storing ABSOLUTE paths into that root were never rewritten — on a migrated
-- machine they dangle (user-visible: no images anywhere in the app; see
-- app-infrastructure-design.md §Rename → "v0.26.2 (W271)"). The files
-- themselves DID move (rename or copy fallback), so rewriting the identifier
-- path segment makes each row point at the real file again.
--
-- The LIKE guard keeps this a no-op on fresh installs and idempotent on
-- already-repaired rows; NULL columns never match LIKE, so they stay NULL.
-- Relative or unrelated paths lack the '/com.harmony.app/' segment and are
-- untouched.

UPDATE games
   SET art_path = REPLACE(art_path, '/com.harmony.app/', '/com.retro-game-player.app/')
 WHERE art_path LIKE '%/com.harmony.app/%';

UPDATE art_cache
   SET path = REPLACE(path, '/com.harmony.app/', '/com.retro-game-player.app/')
 WHERE path LIKE '%/com.harmony.app/%';

UPDATE console_meta
   SET image_path = REPLACE(image_path, '/com.harmony.app/', '/com.retro-game-player.app/')
 WHERE image_path LIKE '%/com.harmony.app/%';

UPDATE cores
   SET installed_path = REPLACE(installed_path, '/com.harmony.app/', '/com.retro-game-player.app/')
 WHERE installed_path LIKE '%/com.harmony.app/%';
