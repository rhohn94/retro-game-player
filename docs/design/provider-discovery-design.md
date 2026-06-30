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

## 7. Surfaces touched (v0.20)

- Rust: `core/search/catalog.rs` (new), `core/search/fetch.rs`
  (`fetch_diagnostics` + `looks_client_rendered`), `commands/search.rs`
  (`validate_provider`, `list_provider_catalog`, `kind` params),
  `db/repo/search_providers.rs` (`set_kind`), command registration.
- TS: `ipc/search.ts` (DTOs + `validateProvider`/`listProviderCatalog` + `kind`),
  `features/search/detectTemplate.ts` (new), `ProviderDialog.tsx` (rewritten),
  `ProviderCatalog.tsx` (new), `SearchPage.tsx` (entry points).

## 8. Out of scope (v0.20)

- **JS-render fetch tier** — unlocking itch.io/GameJolt/GOG is the next release
  (v0.21): an offscreen WebView renders the page before the generic scrape.
- **Open-web provider discovery** — not built (see §2).
- **Per-provider API adapters** — deferred behind the JS-render tier ("APIs
  later").
