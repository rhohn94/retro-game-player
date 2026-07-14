-- 017_rom_provider_priority_and_seeds.sql
-- Private research / testability pack:
--   1. priority column so search can surface ROM / download providers high
--   2. direct_download ON for existing + new ROM-site seeds
--   3. expanded ROM-site search URL templates (links only; no content shipped)
--
-- Priority bands (lower = higher in results):
--   10  research ROM archives
--   30  other kind=download
--   80  kind=reference
--  100  default (user-added)

ALTER TABLE search_providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;

-- Baseline bands for everything already seeded.
UPDATE search_providers SET priority = 80 WHERE kind = 'reference';
UPDATE search_providers SET priority = 30 WHERE kind = 'download';

-- Existing v0.12 ROM-site four: pin high + enable direct download for research.
UPDATE search_providers
SET priority = 10, direct_download = 1
WHERE name IN ('RomsGames', 'Romspedia', 'RomsFun', 'WoWROMs');

-- Expanded research ROM-site seeds (https {query} templates; INSERT OR IGNORE).
INSERT OR IGNORE INTO search_providers
  (name, url_template, enabled, kind, direct_download, compose_filters, priority)
VALUES
  ('CoolROM',        'https://coolrom.com.au/search?q={query}',                    1, 'download', 1, 0, 10),
  ('EmulatorGames',  'https://www.emulatorgames.net/?s={query}',                   1, 'download', 1, 0, 10),
  ('ROMSPURE',       'https://romspure.cc/search?q={query}',                       1, 'download', 1, 0, 10),
  ('Retrostic',      'https://www.retrostic.com/search?search={query}',            1, 'download', 1, 0, 10),
  ('Gamulator',      'https://www.gamulator.com/?s={query}',                       1, 'download', 1, 0, 10),
  ('Romspedia EU',   'https://romspedia.com/search?term={query}&region=europe',    1, 'download', 1, 0, 10),
  ('ROMsMania',      'https://romsmania.cc/?s={query}',                            1, 'download', 1, 0, 10),
  ('Romulation',     'https://www.romulation.org/roms/search?query={query}',       1, 'download', 1, 0, 10);
