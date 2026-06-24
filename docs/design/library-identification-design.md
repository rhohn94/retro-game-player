# Library Scan & Identification — Harmony v0.1 (W6)

> **Up:** [↑ Design docs](README.md) · [↑ Architecture master contract](architecture-design.md)

> **Status:** implementation detail beneath the master contract. The library
> command surface, the `games` / `content_folders` schema, and the `AppError`
> contract are owned by [architecture-design.md](architecture-design.md) (D1);
> where this doc and the master contract disagree, the **master contract wins**.
> Implemented by **W6**; the library UI (grid / hero / detail) is **W13**.

## Motivation

Harmony scans user-configured content folders, identifies the ROMs it finds
against No-Intro DATs, and persists each as a `games` row the library grid (W13)
renders. Identification turns an opaque filename into a clean game name + system
+ suggested core, and flags anything it cannot place so the user is never left
guessing. This doc covers the **backend** pipeline: folder config, the recursive
walker, ROM hashing (with the NES header subtlety), the DAT parser/index, the
matcher, the file→system→core mapper, and the persistence + dedup glue.

## Module map (`src-tauri/src/core/library/`)

Pure, Tauri-free, one file per concern (architecture §1.2, §6):

```
core/library/
  mod.rs       # module wiring + re-exports
  ines.rs      # iNES header detect + strip (NES ROMs)
  hasher.rs    # CRC32 + MD5 over (header-stripped) ROM bytes
  walker.rs    # recursive content-folder walk → ROM candidates
  dat.rs       # No-Intro Logiqx-XML DAT parser + CRC32/SHA1 index
  matcher.rs   # DAT lookup → clean name, else filename fallback
  mapper.rs    # extension → system → suggested-core mapping
  scan.rs      # orchestration: walk → hash → match → persist (the only DB seam)
```

The thin IPC adapter lives in `commands/library.rs`; the typed TS wrappers in
`src/ipc/library.ts` (re-exported from `src/ipc/commands.ts`).

## Pipeline

1. **Folder config.** `add_content_folder` validates a non-empty, existing
   directory and persists a `content_folders` row via the library repo (W3).
   `list_content_folders` / `remove_content_folder` round out CRUD; removal
   cascades to that folder's games via the FK.
2. **Walk.** `walker::walk` recurses the folder (symlinks not followed),
   yielding every regular file whose lowercased extension is a recognized ROM
   extension. Unreadable entries are skipped, never fatal. Results are sorted by
   path for deterministic scans.
3. **Map.** Each candidate's extension is mapped to a `system`
   (`nes` / `snes` / `n64`) and a suggested `core_hint` (`mesen` / `snes9x` /
   `mupen64plus_next`). The extension table and core hints are **named
   constants** — no magic strings.
4. **Hash.** `hasher::hash_rom` computes CRC32 + MD5. For NES ROMs it first
   **strips the 16-byte iNES header** (`NES\x1A` magic) so the digests match
   No-Intro, which hashes the header-stripped body. Non-NES systems hash raw
   bytes.
5. **Identify.** `matcher::Matcher` looks the CRC32 up in the `DatIndex`. A hit
   yields the clean No-Intro name with `dat_matched = true`; a miss falls back to
   the sanitized filename stem with `dat_matched = false` (the "unidentified"
   flag the UI surfaces).
6. **Persist + dedup.** `scan::scan_folder_path` inserts a `NewGame` per ROM,
   skipping any `games.path` already present (the UNIQUE column makes a rescan
   idempotent). A racing UNIQUE collision is treated as a benign dedup. The
   returned `ScanReport { folderId, scanned, identified, unidentified, added }`
   summarizes the run; `rescan` accumulates one report across all enabled
   folders.

## DAT format

A No-Intro DAT is Logiqx XML — a `<datafile>` of `<game name="…">` elements,
each with `<rom name crc md5 sha1 …/>` children. `dat::parse_dat` (quick-xml)
carries the current game name down to its rom rows; `DatIndex` keys entries by
lowercase CRC32 (primary) and SHA1 (secondary) for O(1) matching. v0.1 ships
**no bundled DAT** (`commands::library::load_dat` returns `None`), so scans
currently flag every ROM unidentified; W8/W13 wire a DAT source into that seam
without touching the pipeline.

## Command surface (architecture §2.1)

`add_content_folder`, `list_content_folders`, `remove_content_folder`,
`scan_folder`, `rescan`, `list_games`, `get_game`. Adapters own the camelCase
wire DTOs (`ContentFolderDto`, `GameDto`, `ScanReport`) and map repo rows into
them; the domain stays pure.

## Testing

Unit tests run against in-test fixtures only (no real ROM folder needed):

- **iNES strip** (`ines.rs`): detect + strip a synthetic header; leave a
  headerless ROM untouched; reject short input.
- **Hashing** (`hasher.rs`): known-answer CRC32 + MD5 for `""` and `"abc"`; NES
  header-stripping yields the bare-body digest; non-NES hashes raw.
- **DAT parser** (`dat.rs`): parse an embedded Logiqx XML string; lowercase
  hashes; CRC/SHA1 lookup (case-insensitive); empty DAT; malformed XML errors.
- **Matcher** (`matcher.rs`): matched ROM → clean name; unmatched → filename
  fallback + unidentified flag; blank stem → `Unknown`.
- **Walker / scan** (`walker.rs`, `scan.rs`): recursive discovery over a temp
  dir; non-ROM skip; persistence + dedup-on-rescan over an in-memory DB.

## Open questions

- SHA1 is parsed and indexed but not yet computed per-ROM (CRC32 is the v0.1
  match key); add SHA1 hashing if CRC collisions or SHA1-only DAT entries appear.
- Where the bundled/first-run DAT comes from (shipped asset vs. fetched) is
  deferred to the W8/W13 `load_dat` seam.
