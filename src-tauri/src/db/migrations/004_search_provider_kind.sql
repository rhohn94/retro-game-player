-- 004_search_provider_kind.sql (v0.11 "Quarry")
-- Add a `kind` to search providers so the UI can distinguish reference/metadata
-- providers (seeded in v0.6) from download-oriented ones, and seed a small set
-- of LEGAL, links-only download sources so "find downloads" is useful out of the
-- box. Existing rows default to 'reference'.
--
-- CONTRACT (unchanged, file-search-design.md §2): Harmony ships no game content,
-- never auto-downloads, and only constructs a {query} link the user opens in
-- their own browser. The seeded download sources are legitimate, legal homes for
-- public-domain / homebrew / freely-distributable content (the Internet Archive
-- is a library; itch.io is a legal indie storefront) — Harmony never fetches
-- from them. Users can disable, remove, or add their own providers.
ALTER TABLE search_providers ADD COLUMN kind TEXT NOT NULL DEFAULT 'reference';

INSERT OR IGNORE INTO search_providers (name, url_template, enabled, kind) VALUES
  ('Internet Archive', 'https://archive.org/search?query={query}', 1, 'download'),
  ('itch.io',          'https://itch.io/search?q={query}',         1, 'download');
