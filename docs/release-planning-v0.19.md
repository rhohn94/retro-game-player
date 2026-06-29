# Release Planning — v0.19

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.19.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.19` |
| **Previous** | `v0.17` (Sift — browsable preview), `v0.18` (Focus — relevance + structured search) |
| **Theme** | "Reach" — ship the two deferred download-browsing differentiators (cross-provider dedupe + link liveness, `download-browsing-ux-design.md` §5) and broaden the seeded providers to more legal, scrape-compatible sources. Also reconcile the doc/UI "legal sources only" overclaim with reality (the seed has included general ROM sites since v0.12). |

Builds directly on the v0.16 scrape + v0.17 browse toolbar + v0.18 ranking. This
release **does** touch the backend (a new `probe_links` liveness command + a
provider-seed migration) but the load-bearing contract is untouched: Harmony
**never downloads content**. Liveness is a `HEAD` **probe** (headers only, not a
fetch), and every previewed link is still opened by the user in their own
browser. Design: [`download-browsing-ux-design.md`](design/download-browsing-ux-design.md) §8.

### Scope decision (user-directed)

Two product decisions from the user framed this release:

1. **Existing ROM sites** (RomsGames, Romspedia, RomsFun, WoWROMs — seeded since
   v0.12): **kept enabled as-is**. The "legal sources only" wording is corrected
   to match reality rather than the providers being removed.
2. **New providers**: seed the vetted **legal, server-rendered** candidate set.
   The agent **declined** to research/curate *additional* copyrighted-ROM piracy
   sites (expanding piracy facilitation), and instead keeps the manual
   **Add provider** path as the way to add any unseeded source.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W190** | Seed legal, server-rendered providers | Migration 009 seeds Steam, PDRoms, Demozoo, Pouët, Lemon Amiga, Zophar's Domain, ROMhacking.net — each an https `{query}` template verified server-rendered (a static fetch yields real anchors). JS-only storefronts (GOG, GameJolt) excluded. Idempotent (`INSERT OR IGNORE`). Rust test asserts each is present and an https `{query}` link. |
| **W191** | Link-liveness probe (backend) | `core::search::liveness` + a `probe_links` command: a `HEAD` request per URL classified alive (2xx/3xx) / dead (only 404/410) / unknown (403/405/429/5xx/transport). A probe, not a download. Bounded: URL cap (64), short timeout (6 s), capped concurrency (8) in sequential batches. Pure `classify_status` unit-tested; `probe_links` cap + non-http handling tested without network. |
| **W192** | Cross-provider dedupe module | Pure `resultDedup.ts`: `normalizeTitle` (strip bracketed region/format/quality groups + trailing extension + punctuation, never dropping words) and `dedupeAcrossProviders` (merge same-key items across providers into a `MergedResult` with per-provider sources; no double-count of an identical URL; empty-key → per-URL fallback). Unit-tested (vitest). |
| **W193** | Liveness display helpers + IPC | Pure `linkStatus.ts` (`statusIndicator` state→dot/colour/label, `buildStatusMap` url→state) + `probeLinks` IPC wrapper + `LinkState`/`LinkStatus` DTOs mirroring Rust. Unit-tested. |
| **W194** | SearchPage: game-first view + liveness UI | A **Group: By provider \| By game** toggle (provider default) renders either the existing collapsible groups or a flat merged list with per-row "N providers" expanders. A **Check links** toggle (off by default) probes visible links and shows alive/dead/unknown dots (merged rows aggregate their sources). Filter/rank/hide-weak/multi-select apply to both views. |
| **W195** | Docs + contract reconciliation | `download-browsing-ux-design.md` §8 (dedupe + liveness + reach) and §1 invariant corrected from "legal sources only" to the honest links-out wording; Search header copy gains a one-line responsibility note; roadmap v0.19 section; this plan; version bump to 0.19.0. |

---

## 3. Strategy

Single integration master, Noir (autonomous), in-session sequential — the items
share `SearchPage.tsx` and the search pipeline (scraper → `run_search`/`probe_links`
→ IPC → DTO), so parallel worktrees would collide. Order: backend (migration +
liveness command) → pure TS modules (dedup, linkStatus) → SearchPage wiring →
docs. Gates after each layer.

---

## 4. Out of scope / deferred

- **Curating more piracy ROM sites** — explicitly declined; manual Add covers it.
- **JS-rendering fetch tier** — would unlock GOG/GameJolt/Flathub; not in scope.
- **Size/Age/file-type columns** (§4 item 11 [M]) — still needs per-provider
  metadata scraping; deferred.
- **Search history / favorite providers** (§4 item 12) — later nicety.
- **Liveness persistence / background re-probe** — each pass is on-demand only.

---

## 5. Implementation ledger

| ID | Status | Branch | Notes |
|---|---|---|---|
| W190 | ☑ merged | feat/v0.19-reach | Migration 009 + seed test. |
| W191 | ☑ merged | feat/v0.19-reach | `liveness.rs` + `probe_links` + registration; 5 tests. |
| W192 | ☑ merged | feat/v0.19-reach | `resultDedup.ts`; 13 tests. |
| W193 | ☑ merged | feat/v0.19-reach | `linkStatus.ts` + `probeLinks` IPC; 5 tests. |
| W194 | ☑ merged | feat/v0.19-reach | Group-by toggle, merged view, liveness dots; verified headless. |
| W195 | ☑ merged | feat/v0.19-reach | Design §8, §1 reconcile, roadmap, plan, version bump. |
| Release | ☑ shipped | dev→main, tag v0.19 | All gates green; pushed. |
