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
- **Links out, never hosts or fetches content for the user.** The app only
  constructs a `{query}` link and opens the user's chosen result in their own
  browser. Providers vary in what they host — the seeded set spans licensed
  storefronts (Steam), public-domain / homebrew and demoscene repositories
  (PDRoms, Demozoo, Pouët), preservation libraries (Internet Archive), reference
  databases, *and* general ROM sites. Harmony curates a default set and the user
  adds or removes any provider; the legality of any given link is the user's
  responsibility, not a guarantee the app makes. (Earlier drafts of this doc
  asserted "legal sources only"; that overclaimed — the seeded set has included
  general ROM sites since v0.12, so the wording is corrected here in v0.19.)
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

## 7. Relevance & structured search (v0.18 "Focus")

v0.16/v0.17 preview and browse what a provider returned, but the scrape is
deliberately source-agnostic — `extract_links` takes **every** `<a href>` with
non-empty text. So a results page's nav bar, footer, pagination, and "Login /
Register" chrome all become "results", in raw DOM order, with no notion of *what
the user searched for*. v0.18 closes that gap on three fronts.

### 7.1 Drop the junk at the scrape (W180)

`extract_links` gains a conservative chrome filter, applied per candidate anchor
after URL resolution and before the result is kept:

- **Pagination / ordinals:** drop pure-numeric or single-character anchor text
  (`1`, `2`, `›`, `»`).
- **Exact-match chrome:** drop anchor text that is *exactly* (case-insensitive,
  trimmed) a known nav/legal/social word — `home`, `login`, `log in`, `sign in`,
  `sign up`, `register`, `next`, `previous`, `prev`, `more`, `back`, `top`,
  `menu`, `search`, `about`, `contact`, `privacy`, `terms`, `help`, `faq`,
  `cart`, `donate`, `forum`, `blog`, `rss`, `twitter`, `facebook`, `discord`.
- **Length floor:** drop titles shorter than 2 characters.

The filter is intentionally conservative — it matches *whole-string* chrome and
pagination only, so a real title like "Home Alone (USA)" or "Contra" is never
dropped. It is source-agnostic (no per-site rules) and unit-tested.

### 7.2 Rank by relevance, indicate the match (W182/W183)

Junk that survives the scrape filter is handled in the UI by a transparent,
testable ranking heuristic (`resultRanking.ts`, pure):

- **`scoreItem`** scores an item against the structured query: term-coverage of
  the game-name tokens over the item's `title` + `url`, plus bonuses for a
  console-token match, a region match, a full-coverage match, and a title-prefix
  match. Higher = more relevant.
- **`matchStrength`** classifies an item as `strong` (all name terms present),
  `partial` (some), or `none` (zero) — independent of console/region so a legit
  result whose title omits the console is never demoted to `none`.
- **`rankItems`** stably orders a group's rows by score (descending), tie-broken
  by original scrape order. This is the new **Relevance** sort — and the
  default; Found / Title A→Z / Z→A remain.

The match is **indicated**, not just ordered: `strong`/`partial` rows render a
**Match** / **Partial** chip (`var(--aura-primary)` / muted) so the
searched-for game is visible at a glance. Weak (`none`) rows are **demoted** to
the bottom by default and only **hidden** when the user opts in via a
**Hide unlikely matches** toggle (off by default) — never silently dropped, so a
mis-scored result is always recoverable.

### 7.3 Structured search beyond the game name (W181/W184/W185)

Search gains a **console** select (sourced from the existing `list_consoles`
catalog — `name`/`abbreviation`/`key` become ranking tokens) and a **region**
select. Both always feed the client-side ranking. Whether they are *also*
appended to the text sent to a given provider is a **per-provider** decision: a
new `compose_filters` flag (migration 008, off by default, toggled in
`ProviderDialog`) — because appending "SNES" to a site whose titles never carry
the console name would shrink its hits, while for most ROM/archive providers it
usefully narrows at the source. `run_search` therefore takes structured
`console` + `region` params and composes them into the query only for providers
that opted in; everyone else still searches on the bare game name.

This keeps the no-download contract intact (still only fetching provider
search-results HTML) and the scrape source-agnostic (W180 filters, it does not
add per-site parsers).

## 8. Differentiators & reach (v0.19 "Reach")

v0.16–v0.18 made one provider's results browsable and relevant. v0.19 ships the
two deferred differentiators (§5) — cross-provider dedupe and link liveness —
and broadens the reach of providers, all without touching the no-download
contract.

### 8.1 Cross-provider dedupe → game-first view (W192/W194)

The same game often appears across several providers. A pure module
`resultDedup.ts` collapses them:

- **`normalizeTitle`** reduces a scraped title to a canonical key —
  lowercased, with bracketed region/format/quality groups `(USA) [!] (Rev A)`
  and any trailing file extension stripped, punctuation collapsed. Conservative:
  it never drops words, so two genuinely different titles cannot merge.
- **`dedupeAcrossProviders`** merges items sharing a key into one
  `MergedResult` carrying every provider **source** (same URL listed twice never
  double-counts; an empty-normalized title falls back to a per-URL key so nothing
  is silently dropped).

A **Group: By provider | By game** toggle (provider-first stays the default)
switches `SearchPage` between the existing collapsible groups and a flat
game-first list. Each merged row shows the title, the Match/region badges, and an
**"N providers"** pill that expands to the per-provider sources — NZBHydra's
"available from N providers", inverted toward user intent. Filter, relevance
ranking, hide-weak, and multi-select all apply to the merged view (a merged row's
checkbox selects its representative source).

### 8.2 Link liveness — opt-in HEAD probe (W191/W193/W194)

A previewed 404 is the worst browsing outcome, so v0.19 adds an **opt-in**
liveness check. A backend `probe_links` command (`core::search::liveness`) issues
a cheap **`HEAD`** request per URL — a probe, **not** a content download (headers
only) — and classifies it:

- `alive` (2xx/3xx), `dead` (only a definitive 404/410), `unknown` (an anti-bot
  403, a 429, a method-rejected 405, a 5xx, or any transport error — never
  claimed dead on a maybe).

It is bounded by a hard URL cap (64), a short timeout (6 s), and capped
concurrency (8) processed in sequential batches — a courtesy to the probed hosts
that satisfies §6's "probe, not a fetch; per-host rate limit; off by default".
The UI exposes a **Check links** toggle (off by default); when on, each row shows
a small alive/dead/unknown dot, and a merged row aggregates its sources (alive if
any source is reachable, dead only if all probed sources are dead). The pure
display mapping lives in `linkStatus.ts`.

### 8.3 Broader provider reach + contract honesty (W190)

Migration 009 seeds seven additional vetted providers whose **server-rendered**
search pages work with the static scrape (JS-only storefronts like GOG/GameJolt
were excluded — a static fetch returns placeholders, not links): **Steam**
(licensed storefront), **PDRoms** (homebrew/public-domain), **Demozoo** + **Pouët**
(demoscene), **Lemon Amiga** (reference), **Zophar's Domain** (music rips), and
**ROMhacking.net** (patches/translations).

This release also corrects the doc/UI **"legal sources only"** overclaim (§1):
the seeded set has included general ROM sites since v0.12, so the contract is
restated honestly — Harmony links out and never downloads, providers vary in what
they host, and the legality of any given link is the user's responsibility. The
manual **Add provider** path remains the way to add any source not seeded by
default.
