# Release Planning — v0.11

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.11.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.11` |
| **Previous** | `v0.10` (Lineage — gen 1–6 console catalog) |
| **Theme** | "Quarry" — search for game downloads: discover and link downloadable games from the search screen and a game's detail page, strictly links-only. |

Closes [#6](https://github.com/rhohn94/harmony/issues/6). Extends the existing
links-only search domain with a provider `kind` and seeded **legal** download
sources, plus a "Find downloads for this title" jump. The no-fetch /
no-bundled-content contract is preserved and tested. Design:
[`download-search-design.md`](design/download-search-design.md).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W111** | Provider `kind` + legal download seeds | Migration 004 adds a `kind` column (default `reference`) and seeds 2 legal, links-only download providers (Internet Archive, itch.io) with `kind='download'`; repo/DTOs carry `kind`; migration is idempotent. No piracy/ROM-site links are shipped. |
| **W112** | Download-aware search UX | The Search screen labels download providers (`⬇`) and states the link-only contract explicitly; results stay `openUrl` links; provider enable/disable is respected. |
| **W113** | Find downloads for a title | The game detail page has a "Find downloads" action that navigates to `/search` with the title pre-filled; the Search page auto-runs it once providers load. |
| **W114** | Contract test + verify | A test asserts the seeded download providers are link-only templates (`https://…{query}`) and that the search path constructs links without fetching; full gate suite green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). The download search reuses the existing
provider/template machinery — `run_search` is unchanged (it only substitutes
templates, so "no bytes fetched" is structural). Backend adds one nullable-safe
column + seeds; the frontend adds labeling, a contract affordance, and a
pre-filled jump. Each item committed atomically; full gates before merge.

## 4. Out of scope

- Scraping or parsing result pages (would breach the no-fetch contract).
- Any link to a copyrighted-ROM / warez source — Harmony seeds only legal homes
  for public-domain/homebrew content; users may add their own providers.
- Per-provider result previews/counts.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W111 — provider kind + legal seeds | version/0.11 (in-session) | ☑ | migration 004 adds `kind` (default reference) + seeds Internet Archive & itch.io as `download`; repo/IPC/core DTOs carry `kind`; idempotent. |
| W112 — download-aware search UX | version/0.11 (in-session) | ☑ | `downloads.ts` kind helpers (tested); SearchPage labels `⬇` download providers + states the link-only contract in the header. |
| W113 — find downloads for a title | version/0.11 (in-session) | ☑ | GameDetailPage "Find downloads" → `/search` with the title in router state; SearchPage auto-runs once providers load. |
| W114 — contract test + verify | version/0.11 (in-session) | ☑ | `migration_seeds_legal_download_providers` pins link-only templates; 201 Rust + 65 JS tests, typecheck/lint/clippy/build/visual-inspect/4-of-4 real-gesture — all green. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.11 → dev | ☑ | merged `--no-ff`; 201 Rust + 65 JS tests green on dev |
| dev → main promoted + tagged v0.11 | ☑ | |
| deployed | ☑ | /Applications/Harmony.app + deployed-apps/current at 0.11.0 |
| pushed to origin | ☑ | main + dev + tag v0.11 (fast-forward, no force) |
