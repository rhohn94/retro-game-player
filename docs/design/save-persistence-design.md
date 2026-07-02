# Save persistence — SRAM + save states on both play paths (v0.23 "Continuity")

> **Up:** [↑ Design docs](README.md)

Harmony currently loses all progress: the native path excludes serialize/SRAM,
and the EmulatorJS path's saves live invisibly in webview IndexedDB. v0.23
gives both paths one on-disk save story so a game's progress survives app
restarts, path switches, and (later) library moves.

## Goals / non-goals

**Goals:** battery/SRAM persistence, slot save-states, auto-save on exit +
"Continue", one shared disk layout for both paths.
**Non-goals (this release):** rewind, cloud sync, save import/export UI,
RetroArch-path saves (RetroArch manages its own), cross-path state
compatibility (see Compatibility below).

## 1. Disk layout (shared by W230 + W231)

```
~/Library/Application Support/com.harmony.app/saves/
  <system>/<rom-stem>.srm          battery SRAM (raw RETRO_MEMORY_SAVE_RAM)
  <system>/<rom-stem>.state<N>     manual slots N = 1..4 (path-tagged, see below)
  <system>/<rom-stem>.state.auto   auto-save written on session exit
  <system>/<rom-stem>.saves.json   slot metadata: {slot, path_kind, created_at, play_path}
```

- `<rom-stem>` = the ROM filename stem (matches RetroArch convention so users
  can migrate saves in/out); collisions across folders are acceptable v1
  (same-stem same-system = same game in practice for No-Intro libraries).
- Writes are atomic (`tmp` + rename), never clobber on failure.
- **Compatibility:** `.srm` (raw SRAM bytes) IS cross-path compatible —
  fceumm-native and fceumm-WASM read the same battery format. `.state` blobs
  are **path-tagged** in `saves.json` (`play_path: "native" | "ejs"`) because a
  native `retro_serialize` blob and an EJS state are not interchangeable; the
  UI only offers slots recorded by the active path and labels foreign-path
  slots as unavailable.

## 2. Native path (W230)

- `ffi.rs` adds `retro_serialize_size`, `retro_serialize`, `retro_unserialize`,
  `retro_get_memory_data`, `retro_get_memory_size`.
- New `play/native/saves.rs`: pure functions for layout/paths + atomic IO;
  `NativeRuntime` gains `save_state(slot)`, `load_state(slot)`,
  `flush_sram()`, all executed **on the core thread** via the existing command
  channel (libretro calls are not thread-safe off the run loop).
- SRAM lifecycle: load `.srm` into `RETRO_MEMORY_SAVE_RAM` after
  `retro_load_game`; flush on stop and every 30 s if dirty (compare a hash,
  not a byte copy per frame).
- Auto-state: on `stop`, write `.state.auto` (best-effort; a core that returns
  serialize_size 0 is feature-detected and degrades to SRAM-only).
- IPC: `save_native_state(slot)`, `load_native_state(slot)`,
  `list_saves(game_id)` (shared with W231's data), returning slot metadata.

## 3. EmulatorJS bridge (W231)

- `player.html` hooks EmulatorJS's save-data API: on SRAM change (EJS exposes
  `getSaveFile`/save events) and on manual save-state, POST the bytes to the
  loopback server: `POST /saves/<id>/sram`, `POST /saves/<id>/state/<slot>`.
- `play/server.rs` writes through the same `saves.rs` layout helpers (shared
  module; server keeps its own read-only DB connection for path resolution,
  writes go under `saves/` only — never into the library).
- On boot, `player.html` requests `GET /saves/<id>/sram` and loads it into the
  emulator before start; states load on demand via the overlay (W232).
- Best-effort: any bridge failure logs and continues — never blocks play.

## 4. Slots UI + Continue (W232)

- Overlay gains Save state / Load state entries → a 4-slot picker with
  timestamps (from `saves.json`), controller/keyboard/mouse navigable.
- Detail page: when `list_saves` shows an auto or manual state for the active
  path, the primary play affordance becomes **"Continue"** (boots, then
  restores the newest state); a secondary "Start fresh" keeps the cold boot.
- Native path currently has no overlay (scope note in `NativePlayer.tsx`) —
  W232 renders the shared overlay component around both players.

## Verification

- Rust unit tests: layout paths, atomic write, SRAM dirty-hash flush,
  serialize feature-detection; server endpoint tests for the bridge routes.
- Manual: Zelda (battery) on native — save in-game, quit Harmony, relaunch,
  Continue → progress intact; same flow in-page; state slot round-trip on both.
