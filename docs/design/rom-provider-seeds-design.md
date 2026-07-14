# ROM provider seeds, priority, and discovery UX

> **Up:** [↑ Design docs](README.md)

## Motivation

Private research / testability: exercise the full **search → preview →
direct download → import → play** path without hand-adding providers each
session. General game searches must surface ROM archives **above** reference
metadata so results are not buried.

## Scope

- Migration `017`: expand ROM-site URL templates; `direct_download = 1` for
  research ROM seeds; `priority` column (10 / 30 / 80 / 100 bands).
- Search list order: `ORDER BY priority ASC, id ASC` + frontend non-empty pin.
- Download success: `filePath` on `download://done` + **Reveal file** in UI.
- Discovery GUI: Browse sources (All · Games · ROMs · Reference), Settings
  Providers parity (kind/DD/Browse).

## Non-goals

- Bundling or hosting game content.
- Open-web crawler for new ROM sites.
- Auto-download best match without a click.
- Public distribution framing as a ROM store.

## Design

### Priority bands

| Band | Value | Who |
|------|-------|-----|
| Research ROM archives | 10 | 005 + 017 ROM seeds |
| Other download | 30 | IA, itch, Steam, PDRoms, … |
| Reference | 80 | Wikipedia, MobyGames, … |
| Default / user-added | 100 | unless catalog suggests otherwise |

### Direct download

Research ROM seeds ship with `direct_download` **on**. Other download seeds
remain **off** until the user opts in. Catalog one-click add respects
`suggest_direct_download` + `priority` from `catalog.rs`.

### Verification reveal

Successful import emits `filePath` (library copy). UI offers **reveal file**
alongside **In library — Play**. Unrecognized still uses staged-path Reveal /
Discard.

### Discovery UX

- **Search → Browse sources** and **Settings → Game sources** share
  `ProviderCatalog`.
- Plain language; fluid dialog width `min(560px, 92vw)`; ROM chip filter.
- Seeded ROM rows show **✓ Included** when already in DB.

## Acceptance

- Fresh migrate: ≥11 ROM research providers, priority 10, DD on.
- `list_providers` / search groups order ROM archives before reference.
- Download success reveals library path in Finder.
- Catalog filter **ROMs** lists research archives; Settings can toggle DD.

## Open questions

- Live-verify every expanded template periodically (sites change query params).

## Follow-ups

- Console-context Search prefill (system + query).
- File-like URL ranking / HTML preflight for more reliable DD.
