# File-Search Design — Harmony v0.1

> **Up:** [↑ Design docs](README.md)
> **Work items:** W9 (backend), W17 (UI)
> **Status:** W9 and W17 implemented; the UI has since grown well past W17's
> scope (v0.16–v0.20+ preview/browse/discovery features — see
> [download-search-design.md](download-search-design.md),
> [download-browsing-ux-design.md](download-browsing-ux-design.md), and
> [provider-discovery-design.md](provider-discovery-design.md)). This doc
> stays the record of the original backend contract + baseline W17 UI.

---

## 1. Purpose

Harmony lets users configure named **search providers** — each is a URL
template containing a `{query}` placeholder. When the user searches, the app
substitutes the query (percent-encoded, RFC 3986) into each active provider's
template and returns the resulting links. The user then opens a link in the
system browser to see the search results.

---

## 2. Hard requirements (non-negotiable)

| Requirement | Rationale |
|---|---|
| **Never download content for the user** | The app is source-agnostic. It surfaces results; the user decides whether and what to download, in their own browser. Harmony never fetches or stores a content file. *(Still in force.)* |
| **~~Never fetch the target URL server-side~~** | *Superseded in v0.16 "Trove".* To preview what a provider found, the backend now fetches and scrapes the provider's **search-results page** (metadata only — never a content file), under strict safeguards. See [download-search-design.md](download-search-design.md) §2. |
| **Ships with empty provider list** | No user provider is pre-bundled. Users add the services they trust (a small set of legal download sources is seeded). |

The first and third rows are design invariants. The second was relaxed in v0.16
for the in-app result preview; the genuinely-load-bearing invariant — Harmony
never downloads content for the user — is unchanged.

---

## 3. Data model

```sql
CREATE TABLE IF NOT EXISTS search_providers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url_template TEXT NOT NULL,   -- must contain {query}
  enabled      INTEGER NOT NULL DEFAULT 1
);
```

Schema lives in `db/migrations/001_init.sql` (W3). Repo: `db/repo/search_providers.rs`.

### SearchProvider DTO

| Field | Rust | TypeScript |
|---|---|---|
| `id` | `i64` | `number` |
| `name` | `String` | `string` |
| `url_template` | `String` | `urlTemplate: string` |
| `enabled` | `bool` | `boolean` |

### SearchResult DTO (original W9 shape — superseded by `ProviderResults`)

This was `run_search`'s original return shape: one `title`/`url` link per
provider, `title` equal to `providerName`, with no page-fetch. **v0.16 "Trove"
superseded it** — `run_search` now returns `ProviderResults[]`, each carrying
the provider's scraped preview items (their own `title`/`url` scraped from the
results page) plus `searchUrl`, `directDownload`, and a per-provider `error`.
See [download-search-design.md](download-search-design.md) §7 (`ipc/search.ts`)
for the current DTO shapes.

---

## 4. IPC command surface (architecture-design.md §2.5)

The original W9 surface:

| Command | Args | Returns | Notes |
|---|---|---|---|
| `list_providers` | — | `SearchProvider[]` | ordered by id |
| `add_provider` | `name`, `urlTemplate` | `SearchProvider` | validates `{query}` placeholder |
| `update_provider` | `id`, `name?`, `urlTemplate?`, `enabled?` | `SearchProvider` | partial update |
| `remove_provider` | `id` | `void` | — |
| `run_search` | `query`, `providerId?` | `SearchResult[]` | links only; never fetches |

**Since grown** (v0.16–v0.20): `run_search` gained `console`/`region` params
and now returns `ProviderResults[]` (see above); `validate_provider`,
`discover_provider`, and `list_provider_catalog` were added for provider
discovery ([provider-discovery-design.md](provider-discovery-design.md)); and
`probe_links` was added for link liveness
([download-browsing-ux-design.md](download-browsing-ux-design.md) §8.2). It
still fetches only provider search-results pages (or, for `probe_links`, issues
a header-only `HEAD`) — never a content file.

---

## 5. Module layout

```
src-tauri/src/
  core/search/
    mod.rs          — module declarations
    provider.rs     — SearchProvider/SearchResult types + validate_template()
    template.rs     — percent_encode() + substitute() with unit tests
  commands/
    search.rs       — thin Tauri command adapters; no business logic
  db/repo/
    search_providers.rs  — CRUD (W3); extended with rename/set_url_template (W9)

src/ipc/
  search.ts         — typed TS wrappers: listProviders, addProvider, …, runSearch
  commands.ts       — barrel re-exports search.ts (append-only)
```

---

## 6. Template substitution

`template::substitute(url_template, query)`:

1. Validates `{query}` is present in the template (returns `AppError::Validation` if not).
2. Percent-encodes the query following RFC 3986 unreserved characters (`A-Z a-z 0-9 - . _ ~` pass through; everything else is `%XX`, UTF-8 byte-by-byte).
3. Replaces `{query}` with the encoded string.
4. Returns the constructed URL — **not fetched**.

Example: `"https://duckduckgo.com/?q={query}"` + `"super mario"` → `"https://duckduckgo.com/?q=super%20mario"`.

---

## 7. Unit tests

- `template::tests` — encoding spaces, special chars, unreserved pass-through, multi-provider independence, malformed template, empty query, unicode UTF-8 encoding.
- `provider::tests` — validate_template rejects empty, missing placeholder; accepts valid.
- `db::repo::search_providers::tests` — CRUD round-trip, duplicate-name conflict (from W3).

---

## 8. Open questions / future

- Future: provider import/export, reorder by drag-and-drop, per-provider search shortcut.

---

## UI (W17)

**Route:** `/search` — `src/features/search/SearchPage.tsx`.

### Components

`SearchPage.tsx` started as a single file; **W362 (v0.36)** decomposed it into
a thin container plus data hooks and presentational subcomponents (behavior
unchanged). The pieces most relevant to this doc's original scope:

| File | Role |
|---|---|
| `SearchPage.tsx` | Container: wires the hooks below into `SearchQueryBar` / `ProviderChipsBar` / `ResultsPanel` |
| `ProviderDialog.tsx` | Add / edit provider sheet (`<aura-dialog>`) — see [provider-discovery-design.md](provider-discovery-design.md) for its guided-authoring features |
| `ProviderCatalog.tsx` | Curated provider gallery (v0.20) — see [provider-discovery-design.md](provider-discovery-design.md) |
| `hooks/useSearchProviders.ts` | Provider list state + add/edit/remove/catalog dialogs |
| `hooks/useSearchExecution.ts` | Query/console/region state, `run_search` execution, results |
| `hooks/useLinkProbe.ts` | Opt-in liveness probe over the current result set (v0.19, W362) — see [download-browsing-ux-design.md](download-browsing-ux-design.md) §8.2 |
| `hooks/useResultSelection.ts` | Multi-select + batch "open selected" state |
| `search.test.ts` | Unit tests for form validation and SearchResult shape invariants |

The results-browsing UI itself (filtering, sorting, badges, dedupe,
liveness) is documented in
[download-search-design.md](download-search-design.md) and
[download-browsing-ux-design.md](download-browsing-ux-design.md); this doc
does not restate it.

### Link-open seam

Opening a result link goes through `openUrl` in `src/ipc/opener.ts` — a typed
wrapper (W225) around `@tauri-apps/plugin-opener`'s `open` — called from the
result-row components (`ResultRow.tsx`, `MergedResultsView.tsx`,
`ProviderResultGroup.tsx`) and from `useResultSelection`'s batch "open
selected". The backend constructs the URL; the frontend never fetches it.
Requires:
- Rust: `tauri-plugin-opener = "2"` in `Cargo.toml`; `.plugin(tauri_plugin_opener::init())` in `lib.rs`.
- Capability: `"opener:default"` appended to `src-tauri/capabilities/default.json`.
- JS: `@tauri-apps/plugin-opener` in `package.json` dependencies.

### Empty state

When `listProviders()` returns an empty array, the page renders an `EmptyState`
card guiding the user to add their first provider via the add-provider dialog.

### Controller navigation

Focus order: query `<aura-field>` → provider chip buttons (toggle / edit / remove)
→ Add button → result rows (each a `<button>`). `confirm` on a result row calls
`open(url)`. The `<aura-dialog>` sheet (add/edit) traps focus; `Escape` closes it.

### Shared-file lines added (W17)

- `src/routes.tsx` line ~10: `import { SearchPage } from "./features/search/SearchPage";`
- `src/routes.tsx` line ~51: `element: <SearchPage />,` (replaces W17 placeholder)
- `src-tauri/capabilities/default.json`: `"opener:default"` appended to permissions array
- `src-tauri/Cargo.toml`: `tauri-plugin-opener = "2"` appended to `[dependencies]`
- `src-tauri/src/lib.rs`: `.plugin(tauri_plugin_opener::init())` added to builder chain
- `package.json`: `"@tauri-apps/plugin-opener": "^2.5.4"` added to dependencies
