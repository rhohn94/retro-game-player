# Web meta-search providers (DuckDuckGo; not Yandex)

> **Up:** [↑ Design docs](README.md)

## Motivation

Individual ROM-site scrapes return mostly **site chrome**. Users need
**organic result titles** (Archive.org, vaults, stores) for a query like
“Sonic the Hedgehog”. Meta web search does that — if the SERP is scrapeable.

## Live probe (2026-07)

| Engine | Template | Outcome under static GET |
|--------|----------|---------------------------|
| **Yandex** (`yandex.com/search/?text=`) | Captcha | Redirect to **SmartCaptcha**; 0 organic links |
| **Yandex.ru** | Captcha | Same |
| **DuckDuckGo HTML** (`html.duckduckgo.com/html/?q=`) | Works | Real titles: Archive.org Sonic, vaults, Emu-Land, Romspedia… |
| **Bing** | Poor | Generic scrape finds almost no useful anchors |

**Conclusion:** Seeding Yandex would add empty/error groups, not better results.
**DuckDuckGo HTML** is the practical meta-search for our pipeline.

## Design

### Seed (migration 018)

| Field | Value |
|-------|--------|
| name | DuckDuckGo |
| template | `https://html.duckduckgo.com/html/?q={query}` |
| kind | download |
| direct_download | **0** (SERP → pages; auto-import may resolve files on hop 2) |
| compose_filters | **1** (console/region append into the web query) |
| priority | **5** (above ROM archives at 10) |

### Redirect unwrap

DDG result hrefs look like:

`https://duckduckgo.com/l/?uddg=https%3A%2F%2Farchive.org%2F...`

`fetch::unwrap_redirect_wrapper` peels `uddg=` so open/download target the real site.
Best-effort Yandex `u=` / `url=` unwrap is included if a captcha ever isn’t hit.

### Query tips (product)

With **compose filters** on and console = MD/Genesis, the web query becomes e.g.
`Sonic the Hedgehog MD` / abbreviations — better ranking on DDG. Users can also
type `Sonic genesis rom` manually.

## Non-goals

- Paid Yandex Search API / SerpAPI (credentials, cost).
- Headless browser for captcha (heavy, fragile).
- Google SERP scrape (similar bot walls).

## Acceptance

- Fresh DB includes DuckDuckGo at priority 5.
- Scraping a DDG result page unwraps destinations to archive.org / vaults / etc.
- Yandex is **not** seeded; design documents why.

## Phase 2 (scrape + query suffix)

- **Structure-aware SERP scrape** (`fetch.rs`): DDG profile uses `a.result__a`;
  Archive.org prefers `/details/…`; generic scrape ranks `main`/`article`/
  results containers and drops `nav`/`header`/`footer`.
- **`+rom` query suffix** (UI checkbox, default on, localStorage): appends
  `rom` for DuckDuckGo and compose-enabled download providers so organic
  results skew toward downloadable hits. Skips when the query already has
  `rom`/`roms`.

## Follow-ups

- Provider health: collapse captcha/error SERPs automatically.
- Host profiles beyond DDG / Archive.org.
