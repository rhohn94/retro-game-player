# Release Planning — v0.17

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.17.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.17` |
| **Previous** | `v0.15` (Arcade — in-page play), `v0.16` (Trove — in-app result preview) |
| **Theme** | "Sift" — once Harmony previews what each provider found (v0.16), v0.17 makes that preview *browsable*: fold, filter, sort, badge, and batch-open the results so the user can sift to the one link they want. |

Builds directly on the v0.16 preview and the collapsible-groups iteration
already on `dev`. Design:
[`download-browsing-ux-design.md`](design/download-browsing-ux-design.md)
(roadmap + comparable-app research); evolves
[`download-search-design.md`](design/download-search-design.md).

Every item is **[T]** — it operates on the already-scraped `title` + `url`
only. No backend, IPC, migration, or scraping changes. The load-bearing
contract is untouched: Harmony **never downloads content**; every action opens
the user's chosen link in the system browser.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W170** | Collapsible provider groups | Each `ProviderResultGroup` is a controlled collapsible: header toggle (rotating chevron + name + count/error badge), animated body, empty/errored groups start collapsed, and a panel-level Expand-all / Collapse-all toolbar. *(Landed ahead of the release on `dev`; folded in here.)* |
| **W171** | Live result filter | A fast-filter text box above the results instantly narrows visible rows by case-insensitive substring over `title` + `url`. Per-group counts and the panel summary reflect the filtered totals; groups with no surviving rows collapse to a "no matches" note. Pure predicate (`resultFilter.ts`), unit-tested. Clearing the box restores all rows. |
| **W172** | Sort + persisted preference | Result rows within each group can be sorted **Found** (original scrape order), **Title A→Z**, or **Title Z→A**, chosen from a control in the results toolbar. The choice persists across searches and app restarts (localStorage). Pure comparators (`resultSort.ts`), unit-tested; stable sort preserves scrape order within ties. |
| **W173** | Multi-select + open in browser | Per-row checkboxes, a per-group select-all, and a selection summary footer with an **Open N in browser** action that opens every selected `url` via `tauri-plugin-opener`. A confirm guards opening more than a threshold (10) of tabs at once. Selection clears on a new search. Pure selection helpers, unit-tested. |
| **W174** | Title-parsed badges | Compact chips parsed by regex from the scraped anchor text: region (USA/EUR/JPN/World/…), revision (Rev A / v1.1), dump-quality markers (`[!]` verified, `[b]` bad, `[o]` overdump), and file type (zip/7z/rom/iso/…). Pure parser (`resultBadges.ts`), unit-tested; renders nothing when the title carries no recognizable tokens. |

---

## 3. Strategy

Single integration-master session, no PM, Noir paradigm, in-session
orchestration (release-phase-model Auto). All four open items touch the same
surface (`SearchPage.tsx`) and operate on the same result list, so parallel
worktree agents would collide — they are implemented sequentially in-session,
with the browsing logic extracted into small **pure, unit-tested modules**
(`resultFilter`, `resultSort`, `resultBadges`, selection helpers) so
`SearchPage` stays a thin view and the logic is covered framework-free (vitest).

W170 is already merged to `dev` (commits `baf63f7` + `ba0584f`); v0.17 carries
it. The remaining items land on a `feat/v0.17-download-browsing` branch off the
updated `dev`, merged `--no-ff` after full gates.

Full gates before merge: `pnpm test`, `cargo test`, typecheck, eslint, clippy,
`pnpm tauri build`, and `recipe.py smoke` (exit 0, `guiOk=true`). Because the
smoke harness renders `/search` without triggering a live search, the populated
filter/sort/select/badge states are verified by the pure-module unit tests plus
a headless mock-IPC-driven screenshot pass during implementation.

---

## 4. Out of scope

- **Cross-provider dedupe** ("available from N providers") — the standout
  game-first differentiator, deferred to a later release (needs title
  normalization heuristics).
- **Link-liveness check** (alive/dead via `HEAD`) — deferred; the one `[N]`
  item, gated behind a setting when it lands.
- Grid/cover-art density toggle, size/age/file-type **columns** + range filters
  (`[M]`, need richer scraped metadata), and search history / favorite
  providers — all later-iteration niceties per the roadmap.
- Any actual direct-download action (still scaffolding only, from v0.16).
- Any change to scraping, fetch safeguards, the backend, or the no-download
  contract.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W170 — collapsible groups | feat/download-browsing-ux | ☑ | merged to dev `--no-ff` (`ba0584f`) ahead of the release |
| W171 — live result filter | feat/v0.17-download-browsing | ☑ | `resultFilter.ts` (5 tests) + toolbar filter input + per-group/summary counts |
| W172 — sort + persisted pref | feat/v0.17-download-browsing | ☑ | `resultSort.ts` (stable, natural; 8 tests) + localStorage + toolbar select |
| W173 — multi-select + open | feat/v0.17-download-browsing | ☑ | `resultSelection.ts` (tri-state; 5 tests) + row/group checkboxes + selection footer (confirm > 10) |
| W174 — title-parsed badges | feat/v0.17-download-browsing | ☑ | `resultBadges.ts` (region/revision/quality/filetype; 7 tests) + chip render |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| feat/v0.17-download-browsing → dev | ☐ | merge `--no-ff` after full gates |
| dev → main promoted + tagged v0.17 | ☐ | |
| pushed to origin | ☐ | main + dev + tag v0.17 (fast-forward, no force) |
