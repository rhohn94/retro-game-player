# rcheevos (vendored)

RetroAchievements' official C evaluator/hasher library, vendored for W370
(v0.37 "Trophies" — native RetroAchievements foundation, see
`docs/design/retroachievements-design.md`).

- **Upstream:** <https://github.com/RetroAchievements/rcheevos>
- **Tag:** `v12.3.0`
- **Commit:** `e9ca3694c862b61235595176dac4b22677848c93`
- **License:** MIT (see `LICENSE` in this directory) — compatible with this
  project's GPL-3.0-only license.

## What's vendored (and what isn't)

This is a **subset** of the upstream release, scoped to exactly the two
capabilities the design doc calls for: RA-correct ROM hashing and per-frame
achievement-trigger evaluation. Nothing here talks to the network or RA's Web
API (that's `rc_client`/`rapi`, owned by W371, not vendored).

Included (canonical source list per upstream's own `test/Makefile`, minus the
pieces below):

- `src/rc_compat.c`, `src/rc_util.c`, `src/rc_version.c` — shared helpers the
  rest of the library depends on.
- `src/rcheevos/*` — the trigger/condition/memref evaluator
  (`rc_runtime_do_frame` and friends).
- `src/rhash/hash.c`, `src/rhash/hash_rom.c`, `src/rhash/md5.c` — ROM hashing
  (`rc_hash_generate_from_buffer`), ROM-only.

Deliberately **not** vendored (all disabled at compile time via
`RC_HASH_NO_DISC` / `RC_HASH_NO_ZIP` / `RC_HASH_NO_ENCRYPTED`, defined in
`src-tauri/build.rs`):

- `src/rhash/cdreader.c`, `hash_disc.c` — CD/disc-image hashing (PS1 etc.);
  out of scope for NES/SNES.
- `src/rhash/hash_zip.c` — zipped-ROM hashing; Harmony hashes the ROM bytes it
  already has in memory, not zip archives directly.
- `src/rhash/hash_encrypted.c`, `aes.c` — 3DS/NCCH decryption; irrelevant to
  NES/SNES.
- `src/rc_client*.c`, `src/rapi/*` — the full online client SDK (login,
  achievement-set fetch, rich presence). W371 builds its own thin
  `reqwest`-based client against RA's public Web API instead of linking this
  (see `docs/design/retroachievements-design.md` §Client + accounts);
  pulling in `rc_client` would also drag in a large surface (session
  management, hardcore mode, leaderboards) this release explicitly excludes.
- `test/`, `validator/`, `.github/`, build files (`Package.swift`,
  `.editorconfig`, etc.) — upstream's own test harness and CI, not needed to
  build the library.

## Build

Compiled by `src-tauri/build.rs` via the `cc` crate as a static library and
linked directly into the `retro_game_player_lib` binary — no dynamic loading,
matching this vendored C source's role as a first-party dependency (unlike the
libretro cores themselves, which are `dlopen`ed via `libloading` at runtime,
see `src-tauri/src/play/native/host.rs`).

## Updating

Re-run the same subset copy from a newer upstream tag (see the file list
above), bump the tag/commit recorded here, and re-check
`RC_HASH_NO_*`-guarded code paths in `src/rhash/hash.c` still cover the same
set of upstream source files this README excludes.
