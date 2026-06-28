# Release Planning — v0.7

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.7.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.7` |
| **Previous** | `v0.6` (Lens — built-in providers + library filtering) |
| **Theme** | "Forge" — discovery (browse), search, and download for emulator cores. Final release of the GUI-and-cores program. |
| **Ticket** | [#5](https://github.com/rhohn94/harmony/issues/5) |

**Context.** The cores **download/install path already works end-to-end**:
`install_core` really fetches the libretro buildbot archive
(`src-tauri/src/core/cores/buildbot.rs`), unzips it, verifies the dylib is arm64
(`arch.rs`), atomically writes it (temp → verify → rename), and persists it
(`install.rs`). What's missing for a true *discovery* experience is (a) a
**broader catalog** to discover — the curated map ships only ~5 cores across
nes/snes/n64 — and (b) a **search/browse UI** — `CoresPage` browses one system
at a time with no search and no all-systems view. This release fills those gaps
on top of the existing, real download path (it does not rewrite it).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W71** | Broaden the discoverable catalog | `system_map.rs` is expanded with more well-known libretro core ids per system (the single source of truth for what Harmony offers), so there is a real catalog to browse and discover. `cores_for`/`available` and the existing tests still hold (updated for the new entries); the real download path is unchanged and continues to validate `(system, core_id)` against the map. |
| **W72** | Browse + search experience | A pure, unit-tested `coreFilter.ts` (filter a core list by a free-text query over core id + system). `CoresPage` gains a **search box** and an **"All systems" browse mode** (a flattened, searchable catalog across every system) alongside the existing per-system master/detail; install/update/activate continue to work from results via the existing `CoreRow` + `useCores` flow. The available-vs-installed state is clear in browse mode. |
| **W73** | Verify | Mock-IPC fixtures reflect the broadened catalog so browse/search render headlessly; `node scripts/visual-inspect.mjs` passes on all routes and the cores browse/search UI renders; Rust catalog tests + the new JS filter tests pass; all gates green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Dependency order: W71 (catalog content so
there is something to discover) → W72 (browse + search UI consuming it) → W73
(verify). The release **builds on the existing real download/verify/install
flow** rather than reimplementing it. Search/filter logic lives in a pure module
(like v0.6's `filter.ts`) so it is testable without React. Each work item is
committed atomically; the full gate suite (typecheck, lint, vitest, `cargo test`,
clippy, build, visual-inspect) must pass before merge.

## 4. Out of scope

- **Streaming download progress** (bytes %/ETA) — the install runs off-thread and
  shows a spinner; per-byte progress needs a Tauri event channel + streaming
  reqwest and is a tracked follow-up. Download itself is real and complete.
- **SHA256 checksums** — integrity today is arch verification + atomic write
  (the buildbot publishes no simple per-nightly hash); a checksum is a follow-up.
- **A remote/dynamic catalog index** — the curated `system_map` remains the
  source of truth; fetching a remote catalog is a larger future change.
- New systems beyond the existing nes/snes/n64 (those need scan/mapper support).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W71 — broaden the catalog | version/0.7 (in-session) | ☑ | `system_map.rs` expanded (nes 4 / snes 3 / n64 2 well-known libretro cores); recommended-default preserved; map + install tests updated; real download path unchanged. 194 Rust tests + clippy clean. |
| W72 — browse + search experience | version/0.7 (in-session) | ☑ | Pure `coreFilter.ts` (flatten/filter/group) + 7 unit tests; `CoresPage` search box switches to a flat all-systems result list grouped by system; install/update/activate via existing `CoreRow`/`useCores`/real backend. |
| W73 — verify | version/0.7 (in-session) | ☑ | Mock fixtures mirror the broadened catalog; `scripts/inspect-cores.mjs` screenshots default browse + searched state (snes9x confirmed); visual-inspect verified=true guiOk=true on 4 routes; 60 JS tests green. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.7 → dev | ☐ | |
| dev → main promoted + tagged v0.7 | ☐ | |
| pushed to origin | ☐ | HUMAN-GATED — do not push without explicit go |
