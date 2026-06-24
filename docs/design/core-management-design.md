# Core Management — Harmony v0.1 (W5)

> **Up:** [↑ Design docs](README.md) · [↑ Architecture master contract](architecture-design.md)

> **Status:** implementation detail beneath the master contract. The IPC command
> surface (§2.2), the `cores` table (§3), the `AppError` contract (§2), and the
> app-support `cores/` location (§4.1) are owned by
> [architecture-design.md](architecture-design.md); where this doc disagrees, the
> **master contract wins**. Implemented by **W5**.

## Motivation

Harmony launches ROMs through libretro cores, which are per-system `.dylib`
plugins. Users need to discover which cores Harmony offers, install the right
one for a system, keep it current, and pick the active core per system. W5
provides the backend that fetches Apple-Silicon cores from the libretro
buildbot, proves each is a genuine arm64 binary before trusting it, installs it
under Application Support, and records installed/active state in SQLite.

## Scope

- A curated **system → core** map (the only cores Harmony offers in v0.1).
- A **buildbot client** that builds the arm64 download URL and fetches the
  archive (and its `Last-Modified` for update checks).
- **arm64 verification** of the extracted dylib — non-arm64 binaries are rejected.
- An **install manager** orchestrating download → unzip → verify → place → persist.
- Five **IPC commands** (D1 §2.2); network/IO runs off the UI thread.
- A typed TS wrapper (`src/ipc/cores.ts`) re-exported from the barrel.

Out of scope (deferred): non-curated/arbitrary cores, x86_64/Rosetta fallback,
core-option configuration, the Cores UI screen (W16).

## Module map (`src-tauri/src/core/cores/`)

Domain logic is Tauri-free and unit-testable; the `commands/cores.rs` adapter is
the only Tauri-aware layer.

```
core/cores/
  system_map.rs   # curated system → buildbot core ids (named constants)
  arch.rs         # Mach-O / arm64 verification (header parse + optional `lipo`)
  buildbot.rs     # buildbot base URL + URL building + download / Last-Modified
  install.rs      # orchestration: fetch+verify (no DB) ↔ persist (DB)
commands/cores.rs # #[tauri::command] adapters + CoreDto (camelCase, +available)
```

### Curated system → core map

| System | Cores (default first) |
|---|---|
| `nes`  | `mesen`, `fceumm` |
| `snes` | `snes9x`, `bsnes` |
| `n64`  | `mupen64plus_next` |

Core ids are the exact buildbot filename stems, so `mesen` →
`mesen_libretro.dylib.zip`. Adding a system/core is a one-line edit in
`system_map.rs`; nothing else hard-codes core ids.

### Buildbot client

Base URL (a named constant, no magic strings):

```
https://buildbot.libretro.com/nightly/apple/osx/arm64/latest/<core>_libretro.dylib.zip
```

`download_archive` GETs the archive bytes; `last_modified` reads the
`Last-Modified` header and parses the RFC-1123 HTTP-date into epoch-seconds
(stdlib-only, no date crate). URL building is pure and unit-tested; only the two
network functions touch the wire.

### arm64 verification

`is_arm64_macho(bytes)` parses the leading Mach-O header — recognizing thin
64-bit binaries (both byte orders) and fat/universal binaries (scanning every
arch entry) — and returns true only when an arm64 slice
(`CPU_TYPE_ARM | CPU_ARCH_ABI64`) is present. `verify_arm64_dylib(path)` reads
the file header and, when the `lipo` tool is available, additionally requires
`lipo -archs` to report `arm64`, matching Apple's toolchain. A non-arm64 binary
is rejected with `AppError::Unsupported`. The pure parse is unit-tested against
fixture header bytes (thin arm64, byte-swapped, x86_64, fat, garbage) — no
network or `lipo` needed.

### Install manager

`install` = `fetch_verified` (validate pair → download → unzip the
`<core>_libretro.dylib` entry → write to a `.part` temp → **arm64-verify** →
rename into place) then `persist_installed` (insert/update the `cores` row).
Files land at `cores/<system>/<core>_libretro.dylib` under Application Support
(via the W4 `Paths::cores_dir()`). `update` HEADs the buildbot and re-fetches
only when `Last-Modified` is newer (`is_newer`), re-verifying the new dylib.
`set_active` marks a `(system, core)` active; the W3 `CoresRepo` partial-unique
index enforces exactly one active core per system.

The fetch/verify half takes **no** `Db`; the persist half takes **no** network.
This split lets the adapter run the blocking network/IO on a
`spawn_blocking` task while the DB write stays on the async body that holds the
managed `Db` borrow — so nothing blocks the webview UI thread and the
non-`Clone` `Db` handle never has to cross a thread boundary.

## IPC surface (D1 §2.2)

| Command | Args | Returns |
|---|---|---|
| `list_available_cores` | `{ system?: string }` | `Core[]` |
| `list_installed_cores` | `{}` | `Core[]` |
| `install_core` | `{ system, coreId }` | `Core` |
| `update_core` | `{ id }` | `Core` |
| `set_active_core` | `{ system, coreId }` | `Core` |

`CoreDto` is the repo `Core` row serialized camelCase plus `available` (true for
every curated core). All commands return `AppResult<T>`, so failures cross the
seam as the typed `AppError` union (`unsupported` for non-arm64 / unknown
system, `network`, `io`, `not_found`, `conflict`).

## Errors

| Condition | `AppError` |
|---|---|
| Unknown system / non-curated core | `Unsupported` |
| Downloaded dylib not arm64 | `Unsupported` |
| Buildbot transport / non-2xx | `Network` |
| Unzip / disk write failure | `Io` |
| `update`/`set_active` on absent core | `NotFound` |

## Testing

Pure logic is unit-tested without the network: the system→core map (exact
mappings, unknown-system rejection, pair validation), the arch check (Mach-O
magic/cputype parsing against fixture bytes — thin/fat/swapped/x86_64/garbage,
plus on-disk verify of a stub), buildbot URL + HTTP-date parsing, and the
install manager (dest path, catalog listing, uncurated-pair rejection before any
fetch, zip extraction, and place-verified accept/reject around the arm64 gate).
Live buildbot downloads are deliberately not exercised in tests.
