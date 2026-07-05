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
  mod.rs         # module wiring + re-exports
  ines.rs        # iNES header detect + strip (NES ROMs)
  hasher.rs      # CRC32 + MD5 over (header-stripped) ROM bytes
  walker.rs      # recursive content-folder walk → ROM + disc-container candidates
  dat.rs         # No-Intro Logiqx-XML DAT parser + CRC32/SHA1 index
  matcher.rs     # DAT lookup → clean name, else filename fallback
  mapper.rs      # extension → system → suggested-core mapping
  disc_ident.rs  # content-sniffing identification for .cue/.chd/.bin (W343)
  scan.rs        # orchestration: walk → hash → match → persist (the only DB seam)
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

## Disc-image sniffing (v0.34 W343)

`.cue`/`.chd`/`.bin` are container formats several CD-based systems share
(Saturn, 3DO, PS2, Odyssey² alongside PS1) — the `mapper` scope note above
already excludes them from the extension table because the extension alone
never identifies a system. Before W343 these files were simply invisible to
a scan; now `core::library::disc_ident` **content-sniffs** them for a
positive PS1 signature, and anything it cannot positively identify stays
unscanned exactly as before — this module never guesses.

### Module (`core/library/disc_ident.rs`)

Pure, dependency-free (no new crates): given a path, dispatch on its
(lowercased) extension to one of three sniffers, each returning
`Option<DiscIdentification { system, canonical_path }>`:

- **`.cue`** (`sniff_cue_file`) — parses the cue sheet's `FILE "…" …` lines,
  resolves the **first referenced data track** relative to the cue's own
  directory, and sniffs that `.bin`. The identification's `canonical_path`
  is always the `.cue` itself, never the `.bin` — this is what collapses a
  multi-track cue/bin set to exactly one library row keyed on the cue sheet.
  A cue sheet lists one `FILE` per track (or reuses one `FILE` across
  several `TRACK`s); the first data track always carries the disc's boot
  sector/filesystem, so sniffing it alone is sufficient — later tracks
  (often CD-DA audio) are irrelevant to system identification.
- **`.bin`** (`sniff_bin_file`) — sniffs a bare `.bin`/`.iso` file directly;
  `canonical_path` is the file itself.
- **`.chd`** (`sniff_chd_file`) — see below; header + metadata only, never
  decompresses hunks.

### Signatures used (conservatism contract)

Two independent, positive-only signals; a match on **either** is sufficient,
and neither being present yields `None` — there is no "probably" tier:

1. **ISO9660 Primary Volume Descriptor + PlayStation licence string.** The
   PVD is fixed by the ISO9660 standard at sector 16 (2048-byte sectors);
   its `CD001` standard identifier is checked at byte offset 1 of that
   sector before trusting anything else. Sony additionally stamps the
   literal string `PLAYSTATION` into the system-area bytes (sectors 0–15)
   of every first-party PS1 disc; both together are the strongest signal.
   A valid `CD001` PVD with **no** licence string (e.g. a Saturn/3DO/PS2
   disc sharing the same container) is explicitly **not** a match — the
   dedicated test `pvd_without_licence_string_is_not_identified` pins this.
2. **`SYSTEM.CNF` boot marker.** A PS1 disc's root directory carries a
   `SYSTEM.CNF` file whose `BOOT=` line names a `cdrom:`-scheme executable
   (`BOOT=cdrom:\SLUS_000.01;1`, for example). v0.1 of the sniffer looks for
   the literal `BOOT=cdrom:` marker text within the sniffed window rather
   than walking the full ISO9660 directory tree to locate and parse the
   file — a full directory-tree walk is deferred; the marker text is
   sufficiently rare and PS1-specific to stand alone as a positive signal.

Both checks run over a **bounded 1 MiB read window** from the start of the
file (`SNIFF_WINDOW_BYTES`) — real PS1 discs place both signatures within
the first few sectors, so this keeps sniffing cheap even for multi-hundred-
MB/GB images without reading the whole disc.

### CHD: header + metadata only, never decompress hunks

A `.chd` (MAME's Compressed Hunks of Data format) stores its sector data in
compressed hunks; decompressing them to inspect sector bytes the way
`sniff_bin_bytes` does would cost real I/O + CPU per scanned file and pull
in a codec dependency this otherwise-pure module should not carry. Instead
`sniff_chd_file`:

1. Reads the fixed 124-byte **CHD v5 header** (tag `MComprHD`, then
   big-endian `length`/`version`/…/`metaoffset` fields per MAME's `chd.h`
   layout) and validates the tag, version (`5`), and header length before
   trusting anything else in it. Any older/unsupported CHD version
   (different tag or header length) yields `None` rather than misreading a
   layout this module doesn't understand.
2. Walks the metadata chain starting at `metaoffset`: each entry is a
   16-byte prefix (`tag[4]`, `length_and_flags[4]` — length in the low 24
   bits — `next[8]`) followed by `length` bytes of entry data; `next == 0`
   ends the chain. The walk is capped at 256 entries so a pathological/
   cyclic chain cannot hang a scan.
3. Scans the concatenated metadata bytes for the same two marker strings
   (`PLAYSTATION` / `BOOT=cdrom:`) as plain substrings — CHD metadata is
   free-form descriptive text with no fixed sector layout (unlike a raw ISO
   image), so the stricter PVD-structure check doesn't apply here; a track/
   description metadata tag mentioning either marker is enough.

If the metadata cannot positively identify the disc — wrong tag, truncated
header, zero `metaoffset`, or no marker text in the metadata chain — the
sniffer returns `None`. It never decompresses a single hunk.

### Scan-path wiring

`core::sources::rom::RomSource::scan_and_persist` (the `PersistingSource`
that owns ROM-folder scanning) is extended, not replaced:

1. The existing unambiguous-extension pass (`walker::walk` → `mapper` →
   hash → match → persist) runs exactly as before — untouched.
2. `walker::walk_disc_candidates` separately collects every `.cue`/`.chd`/
   `.bin` file in the folder (a new walker function; `is_rom_extension`
   still excludes these three from the unambiguous pass, so there's no
   double-counting).
3. Every `.cue`'s first referenced `.bin` is computed up front into a
   `claimed_bins` set. Any `.bin` in that set is **excluded from sniffing
   entirely** — its content lives inside a cue/bin set that the `.cue`
   itself already represents, so it must never become its own candidate,
   independently identified or not.
4. The remaining disc candidates are sniffed via `disc_ident::sniff_disc_image`;
   each positive identification becomes one `NewGame` row (system, hashes,
   DAT match, `core_hint` looked up from `mapper::core_hint_for_system`)
   keyed on the identification's `canonical_path`, persisted through the
   same dedup-by-path helper the unambiguous pass uses.
5. Anything not positively identified — an unrecognized `.bin`, a `.cue`
   whose referenced track doesn't sniff positively, a non-v5 or marker-less
   `.chd` — contributes nothing: not a row, not an "unidentified" flag. It
   stays unscanned, exactly as before W343.

### Testing

- **`disc_ident.rs`** unit tests build tiny synthetic fixtures in memory —
  a sparse ISO9660 image with the PVD + licence string at the correct
  offsets, a `SYSTEM.CNF`-marker-only image, a non-PS1 filler buffer, a
  minimal CHD v5 header + one metadata entry — covering both positive
  signatures independently, the conservative PVD-without-licence-string
  negative, cue parsing (single track, multi-track, missing/dangling
  reference, unparseable sheet), and CHD edge cases (wrong tag, truncated
  header, zero `metaoffset`, marker-less metadata).
- **`core::sources::rom`** integration tests scan a temp folder containing
  these same fixture shapes end-to-end: a cue/bin pair scans to one `ps1`
  row keyed on the `.cue`; a `.chd` fixture scans to a `ps1` row; a non-PS1
  `.bin` stays unscanned; a multi-track cue (one PS1 data track + one
  non-PS1 "audio" track) still collapses to one row; a rescan doesn't
  duplicate the cue/bin row; and a mixed folder proves the unambiguous
  `.nes` extension path is unaffected by the new disc pass.

## Open questions

- SHA1 is parsed and indexed but not yet computed per-ROM (CRC32 is the v0.1
  match key); add SHA1 hashing if CRC collisions or SHA1-only DAT entries appear.
- Where the bundled/first-run DAT comes from (shipped asset vs. fetched) is
  deferred to the W8/W13 `load_dat` seam.
- `SYSTEM.CNF`'s `BOOT=cdrom:` marker is matched as raw marker text within
  the sniff window rather than via a full ISO9660 directory-tree walk to the
  actual file; a future pass could parse the directory tree properly if the
  marker-text heuristic ever proves too loose in practice.
- CHD metadata-text sniffing depends on the metadata a given dumping tool
  chose to embed; a CHD with no descriptive metadata at all (valid but
  sparse) will conservatively stay unidentified rather than false-positive —
  a future enhancement could special-case known CD-metadata tags (e.g. a
  `CHT2`/`CHTR` track-info tag family) more precisely than a raw substring
  scan if this proves too conservative in practice.
