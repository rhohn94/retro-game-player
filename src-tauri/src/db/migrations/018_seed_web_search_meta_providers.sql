-- 018_seed_web_search_meta_providers.sql
-- Meta web-search providers for better *discovery* of game pages.
--
-- DuckDuckGo HTML endpoint is scrape-friendly and returns organic titles
-- (Archive.org, vaults, etc.) instead of site chrome from individual ROM hosts.
-- Direct download stays OFF — SERP links are almost always HTML pages; the
-- auto-import HTML→file hop handles real files when present.
--
-- Yandex is intentionally NOT seeded: bot fetches hit SmartCaptcha and return
-- zero organic results under our static HTML scrape (see design note).

INSERT OR IGNORE INTO search_providers
  (name, url_template, enabled, kind, direct_download, compose_filters, priority)
VALUES
  (
    'DuckDuckGo',
    'https://html.duckduckgo.com/html/?q={query}',
    1,
    'download',
    0,
    1,
    5
  );
