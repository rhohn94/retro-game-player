# Release Planning — v0.25

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.25.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.25` |
| **Previous** | v0.24 (Everywhere — in-page multi-core, direct download, conveniences) |
| **Theme** | "Scout" — user-requested: point Harmony at a site's base URL and its search capabilities are **discovered programmatically** (OpenSearch and friends), plus a broader vetted provider catalog. Displaces "Keepsake" (library life), which shifts to v0.26; the rest of the arc shifts one. |

---

## 2. Major Features

### W250 — Provider API auto-discovery

New `core/search/discovery.rs`: given a site **base URL**, probe a ranked
set of discovery mechanisms and return search-capability candidates, each
carrying a ready-to-use `{query}` URL template + the mechanism that found it:

1. **OpenSearch description** (the standards path): `<link rel="search"
   type="application/opensearchdescription+xml">` on the homepage, plus the
   `/opensearch.xml` well-known fallback; parse the description's `<Url>`
   templates (`{searchTerms}` → `{query}`), preferring `text/html` results
   pages (Harmony's scraper consumes HTML).
2. **MediaWiki detection**: `/api.php?action=opensearch` answering JSON →
   `…/index.php?search={query}` HTML template.
3. **WordPress detection**: `/wp-json/` answering JSON → `/?s={query}`.
4. **HTML search-form parsing**: a GET `<form>` with a text/search input →
   template synthesized from action + input names (hidden fields preserved).

All fetches ride the `fetch.rs` safeguards (https/http only, timeout, body
cap). A `discover_provider` command surfaces candidates in the
ProviderDialog next to v0.20's Detect-from-URL: one click fills
name/template from the top candidate; multiple candidates are listed.

- **Acceptance:** fixture-served unit tests cover each mechanism + the
  ranking; **a real known provider adhering to a supported API shape
  (Internet Archive, OpenSearch) is discovered programmatically from its
  base URL** (network test, run + result recorded); dialog fills from a
  discovery; degradation (nothing discovered) reports cleanly.
- **Branch:** `feat/w250-api-discovery`
- **Design:** `download-search-design.md` §Provider discovery (extend) or a
  short new `provider-discovery-design.md` (created by this item).

### W251 — Provider catalog expansion

Broaden the v0.20 curated "Browse providers" catalog with additional
**legitimate** sources (homebrew/public-domain archives, scene databases,
reference wikis) — each candidate live-probed before inclusion (status 200 +
server-rendered links or honestly flagged `js_rendered`). The standing
boundary holds: no copyrighted-ROM sites are curated; manual Add-provider
remains the user's path for anything else.

- **Acceptance:** every new entry is https + `{query}` (existing test),
  live-verified at curation time, correctly `js_rendered`-flagged, and
  categorized; catalog test suite green.
- **Branch:** `feat/w251-catalog-expansion`
- **Design:** n/a (data curation under the existing catalog design).

### W252 — Version bump + gates + release ritual

Bump to 0.25.0, full gate suite, ledger, roadmap re-sequencing (Scout in,
Keepsake→v0.26 …), archive into `version-history.md`.

- **Acceptance:** all gates green on `version/0.25`; ledger complete.
- **Branch:** `feat/w252-release-ritual`
- **Design:** n/a.

---

## 3. Parallel Implementation Strategy

| Phase | Items | Rationale |
|---|---|---|
| **1** | W250, W251 | Disjoint: new `discovery.rs` + dialog vs. a data-table edit in `catalog.rs`. |
| **2** | W252 | Release closeout, alone. |

Conflict map: `core/search/` touched by both W250 (new file) and W251
(catalog.rs only) — no shared files; `ProviderDialog.tsx` W250 only.

---

## 4. Out of Scope for v0.25

- **A JSON-API result pipeline** — discovery prefers HTML templates because
  `run_search` scrapes HTML; consuming JSON endpoints end-to-end is future
  work (candidates for the JS-render/API tier in the Backlog).
- **Open-web crawling for providers** — discovery starts from a
  user-supplied URL, never a web search (standing boundary).
- **Keepsake (library life #21, remap UI #20)** — shifted to v0.26 by this
  user-requested release.

No open `Grimoire-Requirement` issues exist (checked this pass — tracker
returned zero).

---

## 5. Status Ledger

### Phase 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.25 |
|---|---|---|---|---|
| `feat/w250-api-discovery` (W250) | ☐ | ☐ | ☐ | ☐ |
| `feat/w251-catalog-expansion` (W251) | n/a | ☐ | ☐ | ☐ |

### Phase 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.25 |
|---|---|---|---|---|
| `feat/w252-release-ritual` (W252) | n/a | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- (populated as branches land)
