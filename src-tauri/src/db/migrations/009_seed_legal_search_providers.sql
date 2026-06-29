-- 009_seed_legal_search_providers.sql (v0.19 "Reach")
--
-- Broaden the seeded search targets with a vetted set of additional providers
-- whose public search pages work with Harmony's direct-link strategy: each is
-- SERVER-RENDERED (a static HTML fetch yields real per-title anchor links, so the
-- scraper can preview them) and each is a legitimate, legal home for content or
-- metadata. JavaScript-only storefronts (GOG, GameJolt) were deliberately
-- excluded — a static fetch of those returns template placeholders, not links.
--
-- CONTRACT (unchanged, file-search-design.md §2): Harmony ships no game content,
-- never auto-downloads, and only constructs a {query} link the user opens in
-- their OWN browser. Each template below was verified to resolve over https and
-- to honor its {query} search parameter. Users can disable, remove, or add their
-- own providers at any time.
--
--   • Steam            — licensed commercial storefront (official store pages).
--   • PDRoms           — curated homebrew / public-domain games and ports.
--   • Demozoo          — demoscene productions (author-released demos/intros/games).
--   • Pouet            — demoscene production database (author-released works).
--   • Lemon Amiga      — Amiga games reference database (metadata; no ROMs hosted).
--   • Zophar's Domain  — game-music rips + homebrew preservation resource.
--   • ROMhacking.net   — fan-made ROM hacks / translations distributed as patches.
--
-- INSERT OR IGNORE on UNIQUE(name) keeps this idempotent: a database that already
-- has a provider of the same name is left untouched.
INSERT OR IGNORE INTO search_providers (name, url_template, enabled, kind) VALUES
  ('Steam',           'https://store.steampowered.com/search/?term={query}',          1, 'download'),
  ('PDRoms',          'https://www.pdroms.de/?s={query}',                              1, 'download'),
  ('Demozoo',         'https://demozoo.org/productions/?q={query}',                    1, 'download'),
  ('Pouet',           'https://www.pouet.net/prodlist.php?prod={query}',               1, 'download'),
  ('Lemon Amiga',     'https://www.lemonamiga.com/games/list.php?list_title={query}',  1, 'reference'),
  ('Zophar''s Domain','https://www.zophar.net/music/search?search={query}',            1, 'download'),
  ('ROMhacking.net',  'https://www.romhacking.net/hacks/?title={query}',               1, 'download');
