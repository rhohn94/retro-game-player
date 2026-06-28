-- 003_seed_search_providers.sql (v0.6 "Lens")
-- Seed a curated set of built-in, links-only search providers so the search
-- screen is useful out of the box. These are reference/search sites: Harmony
-- only constructs a link from the {query} template and opens it in the system
-- browser — it never fetches or downloads anything (file-search-design.md §2).
--
-- INSERT OR IGNORE on the UNIQUE(name) constraint makes this idempotent and
-- safe for databases that already have a provider of the same name. The user
-- can disable or remove any of these afterwards.
INSERT OR IGNORE INTO search_providers (name, url_template, enabled) VALUES
  ('MobyGames',  'https://www.mobygames.com/search/?q={query}',            1),
  ('IGDB',       'https://www.igdb.com/search?type=1&q={query}',           1),
  ('Wikipedia',  'https://en.wikipedia.org/w/index.php?search={query}',    1),
  ('GameFAQs',   'https://gamefaqs.gamespot.com/search?game={query}',      1);
