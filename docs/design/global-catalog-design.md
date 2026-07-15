# Global Catalog — Personal | Global library browse

> **Up:** [↑ Design docs](README.md) · **Sib:** [console-browse](console-browse-design.md),
> [direct-download](direct-download-design.md), [metadata-art](metadata-art-design.md)

## Motivation

Users should discover games they do **not** own using the same gallery UI as
their personal library, then jump to Search (with console prefilled) to download
into the library. Console detail already had a text catalog list; Global Catalog
promotes that index to the main Library surface.

## Scope (E1 shipped slice)

- Library toolbar toggle: **Personal catalog** | **Global catalog** (persisted).
- Global mode: console select + title search + paged grid (48 titles).
- Tiles reuse library chrome; badges **In library** / **Available**.
- Owned → `/game/:id`; unowned → `/search` with `{ query, consoleKey }`.
- `list_catalog_titles` DTO extended: `catalogId`, `system`, `gameId`.

## Follow-ups

- E2: box art by `(system, title)` via libretro CDN (no `games.id`).
- E3: dedicated unowned detail shell (metadata + Get).
- E4: lazy Wikipedia description on detail.
- E5: optional cross-system search with strict perf bounds.

## Non-goals

- Shipping ROM content; silent auto-download; replacing console `CatalogBrowser`.

## Trust note

Global Catalog is a **title index** (libretro-database names). Download sources
remain user-chosen providers; prefer preservation collections over research ROM
farms (migration 019 priority reband).
