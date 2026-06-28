# Core Discovery, Browse & Search Design (v0.7 "Forge")

> Discovery (browse), search, and download for emulator cores — built on the
> existing, real download/verify/install path. Ticket
> [#5](https://github.com/rhohn94/harmony/issues/5).

---

## Motivation

The cores **download/install path already works**: `install_core` fetches the
libretro buildbot archive, unzips it, verifies the dylib is arm64, atomically
writes it (temp → verify → rename), and persists it. What was missing for a true
*discovery* experience was a **broader catalog** to discover and a **search /
browse UI** — `CoresPage` browsed one system at a time with no search.

## Goals

- A real catalog to browse and discover (more than the original ~5 cores).
- Search the whole catalog by core name or system.
- Install from search/browse results using the existing real download path.

## Non-goals (tracked follow-ups)

- **Streaming download progress** (bytes %/ETA) — install runs off-thread with a
  spinner; per-byte progress needs a Tauri event channel + streaming reqwest.
- **SHA256 checksums** — integrity today is arm64 arch verification + atomic
  write (the buildbot publishes no simple per-nightly hash).
- **A remote/dynamic catalog index** — the curated `system_map` stays the source
  of truth.
- New systems beyond nes/snes/n64 (those need scan/mapper support).

## Broadened catalog (W71)

`src-tauri/src/core/cores/system_map.rs` is the single source of truth for what
Harmony offers per system. It was broadened to well-known libretro cores:

- **nes**: mesen, fceumm, nestopia, quicknes
- **snes**: snes9x, bsnes, snes9x2010
- **n64**: mupen64plus_next, parallel_n64

The first id per system remains the recommended default. The real download path
still validates `(system, core_id)` against this map before any network call.

## Browse + search experience (W72)

- **`src/features/cores/coreFilter.ts`** — pure, React-free: `flattenCores`
  (per-system map → ordered flat list), `filterCores` (free-text over core id +
  system), `groupBySystem`. Unit-tested in `coreFilter.test.ts`.
- **`CoresPage`** — a search box drives the mode: empty query keeps the existing
  per-system master/detail; a non-empty query switches to a **flat, all-systems
  result list** grouped by system. Each result is the existing `CoreRow`, so
  install / update / set-active continue through `useCores` and the real backend.

## Validation (W73)

- Rust: the broadened `system_map` tests + the existing install/verify/arch tests
  (download path unchanged).
- JS: `coreFilter.test.ts` (7 tests) over the pure browse/search logic.
- Mock-IPC fixtures mirror the broadened catalog; `scripts/inspect-cores.mjs`
  screenshots the default browse view and a searched state; `visual-inspect`
  verified on all routes.
