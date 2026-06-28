# Release Planning — v0.10

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.10.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.10` |
| **Previous** | `v0.9` (Contact — interaction-layer repair) |
| **Theme** | "Lineage" — expand the default console list from NES/SNES/N64 to all home consoles of generations 1–6, so discovery, scanning, the core catalog, and filtering cover the classic era. |

Closes [#7](https://github.com/rhohn94/harmony/issues/7). Two decoupled sources
of truth grow: the core catalog (`system_map.rs`) and the scan extension map
(`mapper.rs`). Every core id was chosen from the **real** arm64 libretro buildbot
index (195 cores) so downloads never 404. Design:
[`console-catalog-design.md`](design/console-catalog-design.md).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W101** | Broadened core catalog | `system_map.rs` curates 20 systems (gen 2–6 home consoles + the original three) with ≥1 verified arm64 libretro core each; recommended core is the list head; `available(None)` lists all 40 pairs. Gen 1 dedicated consoles and the original Xbox are documented omissions. |
| **W102** | Scan recognizes new systems | `mapper.rs` adds the **unambiguous** ROM extensions for the new cartridge systems (+ Dreamcast/GameCube optical), each routed to its recommended core; no extension maps to two systems; ambiguous CD container formats are intentionally not auto-scanned. |
| **W103** | Consistency + discoverability | A test pins each `mapper` default core to the catalog's recommended core; the Cores browse/search and the library console filter pick up new systems automatically (frontend derives systems from data); the headless mock shows the new breadth. |
| **W104** | Verify | `cargo test` green (incl. the new catalog/scan/consistency tests); typecheck/lint/vitest/build/visual-inspect green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Backend-data-driven: two curated tables
broadened with verified-real cores, reimplementing `mapper` over a single
`SYSTEMS` table (one row per system). The frontend needs no change — it derives
systems from the data. Each item committed atomically; full gate suite before
merge.

## 4. Out of scope

- Pretty per-system display names (UI shows the canonical key, as today).
- Handhelds (Game Boy line, etc.) — home consoles only per the ticket.
- Manual system assignment for ambiguous CD container formats (`.cue`/`.chd`/…).
- Searching for game downloads ([#6](https://github.com/rhohn94/harmony/issues/6))
  — that is v0.11.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W101 — broadened core catalog | version/0.10 (in-session) | ☑ | `SYSTEM_CORES` → 20 systems / 40 pairs; every core verified against the live arm64 buildbot index (195 cores). |
| W102 — scan recognizes new systems | version/0.10 (in-session) | ☑ | `mapper.rs` reimplemented over one `SYSTEMS` table; 16 scan-mapped systems with unambiguous extensions; uniqueness guarded. |
| W103 — consistency + discoverability | version/0.10 (in-session) | ☑ | `default_cores_match_catalog` test pins the two tables; mock broadened; cores screen + filter pick up new systems automatically (verified via visual-inspect). |
| W104 — verify | version/0.10 (in-session) | ☑ | 204 Rust tests, 62 JS tests, typecheck, lint, clippy, build, visual-inspect (12 systems shown), 4/4 real-gesture checks — all green. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.10 → dev | ☐ | |
| dev → main promoted + tagged v0.10 | ☐ | |
| deployed | ☐ | |
| pushed to origin | ☐ | full standing session authority granted |
