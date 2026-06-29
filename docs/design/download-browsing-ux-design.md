# Download-browsing UX design

Master contract: `architecture-design.md` §2.5; builds on `download-search-design.md`
(v0.16 "Trove" preview model) and `file-search-design.md` (the search invariants).

## 1. Context

The Search screen (`src/features/search/SearchPage.tsx`) queries each enabled
provider, fetches its results page, scrapes candidate links, and shows them
grouped per provider. This doc covers how those grouped results are **browsed**.

**Hard invariants (unchanged — these bound every idea below):**

- Harmony **never downloads content**. Every result is a link the user opens in
  the system browser via `tauri-plugin-opener`.
- **Legal sources only**; the app links out, it does not host or fetch content
  for the user.
- The only per-result data we have is what we scrape: **anchor text (title) +
  absolute URL**. Some listings additionally expose a size / date / file-type
  string; most do not. No seeders, no quality profiles, no first-party metadata.

Every feature below is tagged by its data dependency:

- **[T]** — works with just title + URL (no extra scraping).
- **[M]** — needs richer scraped metadata (size/date/type strings in the listing).
- **[N]** — needs a cheap network liveness probe (a `HEAD`/short `GET` — allowed,
  it is *not* a content download).

## 2. Landed this iteration — collapsible provider groups [T]

`ProviderResultGroup` is now a controlled collapsible (JDownloader's package-tree
model, refined for our provider grouping):

- Header is a toggle: a rotating ▶ chevron, the provider name, and a **count
  badge** (link count, or a red `error` pill when the fetch failed).
- The body animates open/closed (Framer height-auto, `DUR.base`/`EASE_STANDARD`).
- **Empty and errored groups start collapsed** so populated providers lead;
  populated groups start open.
- A panel toolbar (shown only with >1 group) summarizes "N links across M
  providers" and offers **Expand all / Collapse all**.
- The open-search-page link and the direct-download marker sit *beside* the
  toggle (sibling buttons), so acting on them never collapses the group, and the
  markup stays valid (no nested interactive elements).

## 3. Inspiration — how comparable apps present aggregated results

| App | The transferable pattern |
|---|---|
| **Prowlarr / Sonarr / Radarr** (interactive search) | Flat **sortable** table pooled across indexers; provider shown as a per-row column/badge; colored **quality/source badges**; persisted sort. Anti-pattern to avoid: status hidden behind a single hover-only icon — surface a short inline reason. |
| **JDownloader LinkGrabber** | Two-level **Provider → links** collapsible tree; a catch-all **"Various"** bucket; stream groups in collapsed, expand on demand; per-row context menu; per-link **online/offline/unknown** liveness icons. |
| **NZBHydra2** | **Merge + dedupe across providers**; one logical result with an **"available from N providers"** expandable group; sort by title/size/age/provider; word-exclusion filter; honest result-cap + "load more" (sorting only sorts what's loaded). |
| **DownThemAll!** "Make your Selection" | Triages exactly our raw material (link + anchor text): **live fast-filter box** (wildcards/regex), **multi-select + Select-All**, batch action, selected-count footer. |
| **itch.io app / Steam** | Grid (cover-art) vs compact-list **density toggle**; cautionary tale — itch's **name-only filter** is its most-complained-about gap, so ship at least one structured facet beyond name. |

## 4. Prioritized roadmap

Ranked value-vs-effort. The first slice is all **[T]** — no new scraping, no
network probes — and is the recommended next increment.

1. **Live fast-filter box over title + URL** [T] — one input that instantly
   narrows visible results (substring; optional `*`/`?`). Highest value, lowest
   effort. Filters within and across groups; empties hide.
2. **Sortable groups/rows with persisted sort** [T] — sort rows by Title; sort
   groups by name / count; remember the last choice between searches (the
   Sonarr #7813 gap). Size/Age become sort keys only where scraped [M].
3. **Collapsible provider tree with counts** [T] — **done** (§2). Add a
   **"Other/Various"** bucket if/when results arrive ungrouped.
4. **Cross-provider dedupe → "available from N providers"** [T] — NZBHydra's
   signature move: normalize titles (strip region/format tokens, casing) to
   collapse the same game from several providers into one row; expand to choose
   the source. Inverts grouping from provider-first to **game-first** — likely
   closer to user intent. Medium effort (normalization heuristics), no rich
   metadata needed.
5. **Multi-select + "Open all selected in browser"** [T] — checkboxes,
   Select-All, selected-count footer, batch open (with a sane confirm above ~N
   tabs). Our link-out analog to DTA's "Start".
6. **Title-parsed badges** [T] — region (USA/EUR/JPN), revision, dump-quality
   markers, file-type — all regex-extractable from anchor text, rendered as
   compact colored chips like the *arr quality badges.
7. **A structured facet beyond name: Provider chip + System/console chip** [T] —
   avoid itch's name-only complaint; system facet derives from library context
   or title tokens.
8. **Inline status line, not hover-only icons** [T] — if a result is flagged
   (dead, non-game, duplicate), say why inline (the *arr anti-pattern).
9. **Grid (cover-art) vs compact-list density toggle** [T, art optional] —
   cover thumbnails for recognized titles (asset protocol already enabled),
   text row otherwise.
10. **Link liveness check — alive/dead/unknown** [N] — JDownloader's
    online/offline via a cheap `HEAD`; **rule-compatible (no content download)**.
    The highest-value "rich" signal — a 404 link is the worst browsing outcome.
    Async, rate-limited, per-provider courtesy; gate behind a setting.
11. **Size / Age / File-type columns + range filters** [M] — only where the
    listing exposes these strings. Mostly per-provider scraping rules; defer.
12. **Search history + favorite providers** [T] — recent queries, a "favorite"
    toggle. Low effort, later-iteration nicety.

## 5. Recommended slices

- **Next (cheap, all [T]):** 1 (fast-filter), 2 (sort + persist), 5 (multi-select
  open), 6 (title badges) — on top of the collapsible tree already landed.
- **Differentiators (respect the no-download rule):** 4 (dedupe) and 10
  (liveness) are the two standout features that set Harmony apart.
- **Defer:** 9, 11, 12 until metadata/coverage justify them.

## 6. Out of scope / guardrails

- No transfer state, queue, or progress UI — Harmony does not download.
- Liveness [N] is a probe, not a fetch: `HEAD`/short `GET`, capped body, honored
  timeout, per-host rate limit, off by default.
- Any result cap must be **visible** with a "load more" affordance; never let a
  sort imply completeness over un-loaded results (the NZBHydra trap).
