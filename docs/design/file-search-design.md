# File-Search Design — Harmony v0.1

> **Up:** [↑ Design docs](README.md)
> **Work items:** W9 (backend), W17 (UI — future)
> **Status:** W9 implemented; W17 pending

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
| **Links only — never auto-download** | The app is source-agnostic. It constructs and surfaces URLs; the user decides whether and what to follow. The backend never issues a network request on behalf of a search. |
| **Never fetch the target URL server-side** | Prevents unintended data exfiltration, unexpected bandwidth use, and server-side parsing complexity. |
| **Ships with empty provider list** | No provider is pre-bundled. Users add the services they trust. |

These are not configuration toggles — they are design invariants enforced in
`core/search/template.rs` and `commands/search.rs`.

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

### SearchResult DTO

| Field | TypeScript | Notes |
|---|---|---|
| `providerId` | `number` | links back to the provider |
| `providerName` | `string` | |
| `title` | `string` | equals `providerName` (no page-fetch) |
| `url` | `string` | fully-constructed; open in system browser |

---

## 4. IPC command surface (architecture-design.md §2.5)

| Command | Args | Returns | Notes |
|---|---|---|---|
| `list_providers` | — | `SearchProvider[]` | ordered by id |
| `add_provider` | `name`, `urlTemplate` | `SearchProvider` | validates `{query}` placeholder |
| `update_provider` | `id`, `name?`, `urlTemplate?`, `enabled?` | `SearchProvider` | partial update |
| `remove_provider` | `id` | `void` | — |
| `run_search` | `query`, `providerId?` | `SearchResult[]` | links only; never fetches |

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

## 8. Open questions / W17 integration

- W17 (file-search UI screen) owns the React layer at `src/features/search/`. It calls `runSearch`, receives `SearchResult[]`, and passes each `url` to Tauri's `shell.open()` to open in the system browser.
- Future: provider import/export, reorder by drag-and-drop, per-provider search shortcut.
