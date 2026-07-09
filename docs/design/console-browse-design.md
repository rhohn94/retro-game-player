# By-Console Browse & Bundled Title Catalog (v0.12 "Curator")

> **Up:** [↑ Design docs](README.md) · **Sib:** [console-catalog](console-catalog-design.md),
> [metadata-art](metadata-art-design.md), [library-import](library-import-design.md)

## Motivation

The v0.10 [console catalog](console-catalog-design.md) broadened *core* coverage
to gen 1–6 home consoles but deliberately left "pretty display names, images, and
descriptions per console" as a follow-up, and exposed no console-centric UI. This
release adds the **"By Console"** view: a browsable, searchable grid of consoles
— each with a downloaded photo and Wikipedia description — that opens into a
detail page showing the user's owned games for that console **and** the console's
entire known game catalog.

## Scope

**Covers:**
- A static, in-code **console catalog** (display name, manufacturer, generation,
  debut year, abbreviation, CPU/GPU/RAM spec, Wikipedia title) for all 24
  consoles — the 20 gen 2–6 home consoles from v0.10 plus the Game Boy family
  (GB, GBC, GBA) and the Wii added in v0.34 (see
  [console-catalog](console-catalog-design.md) §7).
- Per-console **media**: a Wikipedia photo + summary, fetched once and cached
  (`console_meta` table + `console-art/` dir).
- A **bundled per-console title catalog** (every known game title per console),
  generated from the community libretro-database datfiles and embedded in the
  binary — names only, ~28.6k titles across the covered consoles, ~800 KB.
- Two routes: `/consoles` (browse + search, grouped by generation) and
  `/console/:key` (detail: hero + description, a hardware spec table, "Your
  games", and the full searchable/paginated catalog with ownership badges +
  "Find downloads").

**Does not cover:**
- Shipping any game content. The catalog is titles + checksums metadata only;
  Harmony downloads nothing (download-search stays links-only).
- Handhelds or systems outside the covered set (e.g. Game Gear, Game Boy
  Micro, PSP) or generations outside 2–7.
- Cover art for catalog titles the user does not own (owned games use the
  existing libretro art path).

## Design

**Static catalog** ([`core/console/catalog.rs`](../../src-tauri/src/core/console/catalog.rs)):
a `ConsoleInfo` table keyed by the same `system` key used across
`core/cores/system_map.rs`, `core/library/mapper.rs`, and `games.system` — so a
console's "Your games" list is just `list_games(Some(key))`. Each row also
carries a CPU/GPU/RAM hardware spec, rendered as a table on the detail page. A
test pins every key to a curated core-catalog system, another pins the catalog
to exactly 24 entries, and another asserts every row has non-empty hardware
specs.

**Title catalog** ([`core/console/titles.rs`](../../src-tauri/src/core/console/titles.rs)):
`scripts/build-console-catalog.mjs` fetches each console's libretro-database
datfile (`metadat/no-intro` or `metadat/redump`; neogeo uses the Neo Geo CD list
as the closest browsable proxy), parses the clrmamepro `game ( name … )` entries,
collapses region/revision/proto tag groups to a canonical title, de-duplicates,
sorts, and writes `resources/catalog/<system>.json`. Those files are committed and
embedded with `include_dir!`, parsed/memoized once via `OnceLock`. `search()` does
case-insensitive substring filtering + offset/limit pagination; ownership is
computed in the command by normalizing library `clean_name`s to the same canonical
shape.

**Media** ([`core/console/media.rs`](../../src-tauri/src/core/console/media.rs)):
reuses the [Wikipedia client](../../src-tauri/src/core/metadata/wikipedia.rs)
(`fetch_summary_by_title` — consoles have exact article titles) to cache a photo +
description in `console_meta` (migration 006). `list_consoles` returns cached media
only (fast, no network); the frontend lazily calls `get_console(key)` to fetch +
cache any missing photo.

**Frontend** ([`features/consoles/`](../../src/features/consoles/)): `ConsolesPage`
(generation-grouped grid + search), `ConsoleDetailPage` (hero + owned-games grid +
catalog browser), `CatalogBrowser` (server-paged search over thousands of titles,
each row jumping to the links-only download search).

## Acceptance

- `/consoles` lists all 24 consoles grouped by generation with name/maker/year and
  owned/catalog counts; search filters by name/maker/abbreviation.
- Opening a console fetches + caches its photo + description (cached on revisit),
  shows its CPU/GPU/RAM spec table, and lists the user's owned games for it.
- The detail catalog browser searches + paginates the full title list; owned
  titles show an "In library" badge; a title jumps to download search.
- Every console key has a non-empty bundled catalog (test-enforced); the catalog
  data is names-only and Harmony fetches/downloads no game content.
- `recipe.py smoke` renders `/consoles` and `/console/nes`.

## Open questions

None.

## Follow-ups

- Refresh-on-demand for stale console media; a "regenerate catalog" cadence.
- Catalog filtering (region, licensed-only) to tame No-Intro pirate/multicart rows.
- Cover thumbnails for catalog titles via the libretro thumbnail index.
