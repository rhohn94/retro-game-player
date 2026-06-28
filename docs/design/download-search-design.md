# Download Search — Design

> **Up:** [↑ Docs](../README.md) · **Sib:** [file-search](file-search-design.md),
> [interaction-wiring](interaction-wiring-design.md)

## 1. Goal

Help the user **find downloadable games** from the search screen and from a
game's detail page, while keeping Harmony's hard contract intact
([#6](https://github.com/rhohn94/harmony/issues/6)).

## 2. The contract (non-negotiable)

Per [file-search-design.md](file-search-design.md) §2 and the project rules:
**Harmony ships no game content, never auto-downloads, and presents results as
links only** that the user opens in their own browser. "Download search"
therefore means *discover-and-link*, never *fetch*. This is structural, not just
policy: `run_search` only calls `template::substitute` to build a URL string —
there is no HTTP-fetch path in the search domain at all. The
`migration_seeds_legal_download_providers` test pins that every seeded download
template is a link (`https://…{query}`), and the UI states the contract
explicitly.

## 3. Provider kinds

Search providers gain a `kind` column (migration 004): `"reference"`
(metadata/info — the v0.6 seeds) or `"download"`. Existing rows and user-added
providers default to `"reference"`; the download providers are seeded.

### Which download sources?

Only **legal** ones. Harmony does not — and will not — ship links to ROM/warez
sites; doing so would have the app facilitate infringement. The seeds are
legitimate homes for public-domain / homebrew / freely-distributable content:

- **Internet Archive** (`archive.org`) — a library hosting large legal/abandonware
  and public-domain collections.
- **itch.io** — a legal indie/homebrew storefront with many free downloads.

The user can disable, remove, or add their own providers (e.g. a personal
preservation source) — Harmony treats them all the same: construct a link, open
the browser.

## 4. UX

- **Search screen** labels download providers with a `⬇` marker and states the
  link-only contract in the header ("Results are links only — Harmony opens them
  in your browser and never downloads files for you").
- **Game detail → "Find downloads"** navigates to `/search` with the game's
  clean title in router state; the Search page pre-fills the query and auto-runs
  once providers have loaded (at most once per mount). Results group by provider
  as before; each is an `openUrl` link.
- Provider enable/disable and ordering are respected by `run_search` (it only
  uses enabled providers), so a user can turn download sources off entirely.

## 5. Surfaces touched

| Layer | Change |
|---|---|
| `migrations/004_*.sql` + `migrations.rs` | add `kind` column; seed 2 legal download providers |
| `db/repo/search_providers.rs` | `kind` on `SearchProvider`/`NewSearchProvider`, map, insert |
| `commands/search.rs` + `core/search/provider.rs` | `kind` on the IPC/core DTOs |
| `ipc/search.ts` | `kind` on `SearchProvider` |
| `features/search/downloads.ts` (+test) | pure kind helpers |
| `features/search/SearchPage.tsx` | `⬇` labels, contract affordance, pre-fill + auto-run |
| `features/library/GameDetailPage.tsx` | "Find downloads" → pre-filled search |

## 6. Out of scope

- Scraping/parsing result pages (would breach the no-fetch contract).
- Bundling or hinting at any specific copyrighted-ROM source.
- Per-provider result counts or previews (we only construct the link).
