-- 019_trust_tier_priorities.sql
-- Prefer preservation / meta discovery over research ROM farms in search order.
--
-- Priority bands (lower = higher in results):
--    5  meta discovery (DuckDuckGo)
--    8  preservation libraries (Internet Archive) — DD on for hop/import
--   10  homebrew / public-domain / demoscene (trusted collections)
--   25  research ROM archives (still available; no longer top of list)
--   30  other download / storefronts
--   80  reference
--  100  default

-- T1 — preservation: surface + enable direct download (HTML→file hop applies).
UPDATE search_providers
SET priority = 8, direct_download = 1
WHERE name = 'Internet Archive';

UPDATE search_providers
SET priority = 10
WHERE name IN (
  'PDRoms',
  'Lexaloffle BBS',
  'OpenGameArt',
  'Demozoo',
  'Pouet',
  'ROMhacking.net',
  'Zophar''s Domain'
);

-- T0 — meta stays high (seeded at 5 in 018).
UPDATE search_providers SET priority = 5 WHERE name = 'DuckDuckGo';

-- T3 — research ROM sites: demote below trusted collections.
UPDATE search_providers
SET priority = 25
WHERE name IN (
  'RomsGames',
  'Romspedia',
  'RomsFun',
  'WoWROMs',
  'CoolROM',
  'EmulatorGames',
  'ROMSPURE',
  'Retrostic',
  'Gamulator',
  'Romspedia EU',
  'ROMsMania',
  'Romulation'
);
