# Provider Discovery — Design

Master contract: `architecture-design.md` §2.5. Builds on
`download-search-design.md` (the search/no-download contract) and
`download-browsing-ux-design.md` (browsing). Introduced in v0.20 "Atlas".

## 1. Goal

Make adding a search provider **first-class**: instead of hand-crafting a URL
template, the user discovers providers from a curated, searchable catalog and
adds them in one click, gets clear inline guidance when authoring a custom one,
can auto-derive a template from a pasted URL, and can test a provider live before
saving. This makes the manual path — the way to add *any* source — genuinely
pleasant, rather than an expert-only escape hatch.

## 2. The contract (unchanged) + the discovery boundary

The load-bearing contract is untouched: Harmony **never downloads content**; it
constructs a `{query}` link and previews the public results page, and the user
opens their chosen link in their own browser. The validator's fetch is the same
results-page fetch `run_search` already does.

**Discovery boundary (deliberate):** the catalog lists only **legitimate**
sources (storefronts, indie/homebrew and demoscene archives, preservation
libraries, reference databases). Discovery is (a) a searchable in-app catalog and
(b) auto-detecting a template from a URL the user supplies. It is **not** an
open-web crawler that finds game-*download* sites — for "ROMs/games" that is
functionally a piracy-site finder, which Harmony does not build. Any source not
in the catalog is added by the user through the provider dialog, which never
gates what a user may add themselves.

## 3. Curated catalog (W201)

`core/search/catalog.rs` is a static, embedded list of `CatalogProvider`
entries (`name`, `url_template`, `kind`, `media` tag, `description`,
`js_rendered`). Adding an entry is a one-line edit; every entry is asserted by
tests to be an https `{query}` link with a known kind. `list_provider_catalog`
returns the catalog with an `added` flag (a provider with the same name or
template is already configured). Adding an entry just creates a normal
`search_providers` row, so it is then editable/removable like any other.

`js_rendered` marks providers whose search page is client-rendered (itch.io,
GameJolt, GOG): the current static scrape finds no links on them, so the gallery
flags them honestly ("needs JS · soon") rather than offering a provider that
silently returns nothing. The JS-render fetch tier (next release) unlocks them.

## 4. Live validator — "Test provider" (W200)

`validate_provider(url_template, sample_query?)` substitutes a sample query
(default "mario"), fetches the resulting page via the shared `fetch_body` path,
and returns `{ searchUrl, linkCount, sampleTitles (≤5), likelyJsRendered, error
}`. A fetch failure comes back as `error` (not a thrown command error) so the
dialog shows it inline. `likelyJsRendered` is a conservative pure heuristic
(`looks_client_rendered`): true only when the page renders fewer than three
anchors **and** carries a known SPA shell marker (`id="root"`, `__NEXT_DATA__`,
`data-reactroot`, …) — so a genuinely sparse results page is never mislabeled.

## 5. Detect template from a URL (W202)

`detectTemplate(url, sample)` (pure TS) derives a `{query}` template from a
pasted results URL plus the term the user searched: it locates the term — trying
the raw, percent-encoded, and `+`-encoded forms — and substitutes `{query}`,
preserving the rest of the URL's casing. Returns the URL unchanged if it already
contains `{query}`; fails with a clear reason on a non-http/invalid URL, a
missing term, or a term not present in the URL.

## 6. Guided authoring (W203) + gallery (W204)

- **`ProviderDialog`** gains: an inline "what's a provider" help block; a
  **Type** selector (reference / download — threaded to a new `kind` parameter
  on `add_provider`/`update_provider` + `repo.set_kind`); the **Detect from URL**
  helper; and a **Test provider** button surfacing the validator result
  (link count + sample titles, a JS-rendered note, or the error). Per-vendor
  flags (compose-filters, direct-download) move under "Advanced options".
- **`ProviderCatalog`** is a searchable, media-filterable gallery reached from a
  **Browse providers** button (and the empty state). One click adds an entry;
  added entries show "✓ Added"; JS-rendered entries are badged.

### Settings > Providers (pre-dates this design)

`src/features/settings/panes/ProvidersPane.tsx` is a separate, simpler
provider list (name/template add, enable toggle, remove) that pre-dates the
discovery UX above and still ships alongside it as a Settings section. It does
not gain `kind`, Detect, Test-provider, or the catalog gallery — those live
only on the `ProviderDialog`/`ProviderCatalog` path from the Search screen.
Both surfaces read/write the same `search_providers` table, so a provider
added or edited in one is visible in the other.

## 7. Surfaces touched (v0.20)

- Rust: `core/search/catalog.rs` (new), `core/search/fetch.rs`
  (`fetch_diagnostics` + `looks_client_rendered`), `commands/search.rs`
  (`validate_provider`, `list_provider_catalog`, `kind` params),
  `db/repo/search_providers.rs` (`set_kind`), command registration.
- TS: `ipc/search.ts` (DTOs + `validateProvider`/`listProviderCatalog` + `kind`),
  `features/search/detectTemplate.ts` (new), `ProviderDialog.tsx` (rewritten),
  `ProviderCatalog.tsx` (new), `SearchPage.tsx` (entry points).

## 8. Out of scope (v0.20)

- **JS-render fetch tier** — unlocking itch.io/GameJolt/GOG via an offscreen
  WebView that renders the page before the generic scrape. Still not built as
  of this writing (no `js_rendered`-aware fetch path exists yet); these
  providers remain badged "needs JS · soon" in the catalog gallery.
- **Open-web provider discovery** — not built (see §2).
- **Per-provider API adapters** — deferred behind the JS-render tier ("APIs
  later").

## 9. API auto-discovery from a base URL (v0.25 "Scout", W250)

v0.20's Detect (§5) derives a template from a *results* URL the user already
has. W250 goes one step earlier: given only a site's **base URL**, probe its
search API programmatically. New module `core/search/discovery.rs`;
`discover_provider(base_url) -> Vec<Discovered>` command.

**Mechanisms, ranked best-first** (union returned; per-mechanism failures
swallowed; empty = honest "nothing found"):

1. **OpenSearch description** — homepage `<link rel="search"
   type="application/opensearchdescription+xml">` + `/opensearch.xml`
   fallback; parse the description's `text/html` `<Url template>`
   (`{searchTerms}` → `{query}`, optional `{param?}` stripped, XML entities
   unescaped). The standards path.
2. **MediaWiki** — `/api.php?action=opensearch&format=json` returning a JSON
   array ⇒ store the wiki's HTML `index.php?search={query}` page.
3. **WordPress** — `/wp-json/` returning a JSON object ⇒ `/?s={query}`.
4. **HTML search form** — a homepage GET `<form>` with a text/search input ⇒
   `action?…&name={query}`, hidden fields preserved. Weakest, hence last.

**HTML-first, by design:** `run_search` scrapes HTML, so discovery yields HTML
`{query}` templates (MediaWiki's search *page*, not its JSON API). A JSON
result pipeline is out of scope (Backlog).

**Boundary unchanged (§2):** discovery fetches only the user-supplied site's
own pages over the `fetch.rs` safeguards — never an open-web provider crawl.

**Surface:** ProviderDialog gains "Discover search API from a site URL" (open
by default, above Detect): the best candidate fills name + template in place;
all candidates are one-click apply rows. The existing Test-provider validator
then confirms links before Save.

**Verification:** fixture unit tests per mechanism + the ranking (local
`tiny_http` site); real-provider acceptance
(`manual_discovers_wikipedia_from_its_base_url`, `--ignored`) — base URL
`https://en.wikipedia.org` alone recovers
`https://en.wikipedia.org/w/index.php?title=Special:Search&search={query}`
(run 2026-07-02). archive.org is a true negative (no OpenSearch descriptor,
JS-rendered homepage search).
