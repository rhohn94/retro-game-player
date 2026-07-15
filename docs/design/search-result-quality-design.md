# Search result quality — P0 hygiene pack

> **Up:** [↑ Design docs](README.md)

## Motivation

A live probe of “Sonic the Hedgehog” showed ~89% of scraped links were
**zero-query-match** site chrome (nav, console index labels, language codes),
**0%** file-like URLs, and Match badges that could fire from the **search URL
query string** rather than the row title. Users cannot tell which links are
worth opening or downloading.

## Scope (P0 — this release)

1. **Title-only match strength** — Match / Partial badges ignore URL query
   strings; stopwords (`the`, `a`, `of`, …) are not required terms.
2. **Site-chrome denylist** — Drop rows that are almost certainly navigation
   (Home, ROMs, Emulators, Tags, bare console names, 2-letter lang codes, …)
   when they do not contain query content terms.
3. **Hide unlikely matches default ON** — `match === "none"` rows hidden unless
   the user unchecks the toolbar.
4. **Collapse empty-of-signal groups** — After chrome + weak filter, groups with
   no remaining rows start collapsed (in addition to errors / reference).
5. **File-like signal** — Detect ROM/archive extensions in title or path; boost
   rank; show a compact **File** chip on the row.

## Non-goals (P0)

- Per-provider HTML parsers / CSS selectors (P1).
- Detail-page → direct file resolution (P1).
- Auto provider health / disable on 403 (P1).
- Cover-art grid, size/age columns (P2).

## Design

### Query content terms

```
tokens(query) − STOPWORDS → content terms
```

Empty content terms → no filtering by match (show all non-chrome).

### Match strength

Evaluated on **title only** against content terms:

| Strength | Rule |
|----------|------|
| strong   | every content term appears in the title |
| partial  | some but not all |
| none     | none |

### Ranking score

Still boosts full title coverage; demotes chrome (`−1000`); small boost for
file-like paths. Console/region bonuses still apply on the title.

### Visibility pipeline

```
items → drop site chrome → live filter → rank/sort → hide none (if hideWeak)
```

## Acceptance

- Searching “Sonic the Hedgehog” does not mark “Home” / “ROMs” as ✓ Match solely
  because the provider URL contains the query.
- With default settings, ROMSGAMES-style nav lists do not fill the results panel.
- A title like `Sonic the Hedgehog (USA).zip` ranks above chrome and shows Match
  + File when extension is present.
- Unchecking “Hide unlikely matches” restores non-matches (chrome still dropped).

## Phase 2 scrape (implemented)

- Structure-aware `extract_links`: drop nav/header/footer regions; boost
  main/results; host profiles for DuckDuckGo and Archive.org.
- Optional `+rom` query suffix for meta/download providers (see
  [web-meta-search-design](web-meta-search-design.md)).

## Phase 3 (implemented)

- **Declarative host profiles** (`core/search/profiles.rs`) for SERP result
  selectors and detail-page file selectors (DDG, Archive.org, Vimm, Romspedia, …).
- **SERP health**: `ok` | `captcha` | `js_shell` | `empty` | `error` on each
  provider group; captcha clears chrome links; UI auto-collapses unhealthy
  groups and shows a small badge.
- **Multi-hop auto-import** (up to 3 GETs) when detail pages chain HTML
  interstitials before a real file.

## Phase 4 (implemented)

- **Query composition** (`core/search/query_compose.rs`):
  - Title **aliases** (`oot` → ocarina of time, `smb3`, `s3k`, …)
  - **Quoted** multi-word titles on meta hosts
  - **`+zip`** suffix (opt-in) and existing **`+rom`**
  - **−noise** negatives on meta (`-emulator -wiki -youtube …`)
- **Health memory** (frontend localStorage): after 3 consecutive captcha /
  js_shell / error outcomes, soft-skip that provider; **Resume N skipped**
  control in the query bar.
- **Zip-by-query**: multi-ROM zip landing prefers the entry matching the
  search/title hint (USA / `[!]` dump preference as tie-breaker).
- **Ranking**: alias-aware Match badges; small boost for known file hosts
  (archive.org, …).

## Follow-ups

More host profiles / aliases as users report sites; console compose-by-default.
