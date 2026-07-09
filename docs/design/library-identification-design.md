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
  mapper.rs      # extension → system → suggested-core mapping (gen 1–6 + handhelds + Wii)
  disc_ident.rs  # content-sniffing identification for .cue/.chd/.bin (W343)
  scan.rs        # thin back-compat shim; delegates to core::sources::rom::RomSource (W322)
```

The scan orchestration itself (walk → hash → match → persist, the only DB seam)
now lives on `core::sources::rom::RomSource` — folded in during v0.32 (W322) so
the ROM folder scanner is "just another `GameSource`" alongside the Steam and
installed-app scanners (see `docs/design/non-retro-library-design.md`).
`scan::scan_folder_path` is kept only so existing call sites (`commands::library`,
tests) don't need to change.

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
3. **Map.** Each candidate's extension is mapped to a `system` and a suggested
   `core_hint` via a single ordered table (`mapper::SYSTEMS`), one row per
   system that has a distinct, unambiguous ROM extension. As of v0.34 this
   spans console generations 1–6 plus handhelds and Wii — not just the
   original `nes` / `snes` / `n64` trio: Atari 2600/5200/7800, Intellivision,
   ColecoVision, Sega Master System, Genesis, PC Engine, Neo Geo, PS1 (`.pbp`
   only — disc-based PS1 identification is a separate path, see
   §Disc-image sniffing), Atari Jaguar, Dreamcast, GameCube, Wii, and
   Game Boy / Color / Advance. Each system's `default_core` is checked by
   test against `core/cores/system_map.rs`'s recommended core for that
   system, so a scanned ROM never suggests a core the install catalog
   disagrees with. CD-based systems that share ambiguous container formats
   (Saturn, 3DO, PS2, Odyssey²) are deliberately absent from this table.
4. **Hash.** `hasher::hash_rom` computes CRC32 + MD5. For NES ROMs it first
   **strips the 16-byte iNES header** (`NES\x1A` magic) so the digests match
   No-Intro, which hashes the header-stripped body. Non-NES systems hash raw
   bytes.
5. **Identify.** `matcher::Matcher` looks the CRC32 up in the `DatIndex`. A hit
   yields the clean No-Intro name with `dat_matched = true`; a miss falls back to
   the sanitized filename stem with `dat_matched = false` (the "unidentified"
   flag the UI surfaces).
6. **Persist + dedup.** `scan::scan_folder_path` (a thin shim delegating to
   `core::sources::rom::RomSource::scan_folder`, W322) inserts a `NewGame` per
   ROM, skipping any `games.path` already present (the UNIQUE column makes a
   rescan idempotent). A racing UNIQUE collision is treated as a benign dedup.
   The returned `ScanReport { folderId, scanned, identified, unidentified, added }`
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

- **`.cue`** (`sniff_cue_file`) — parses the cue sheet's `FILE` lines
  (case-insensitive keyword, space- or tab-separated, quoted or bare
  filenames), resolves the **first referenced data track** relative to the
  cue's own directory, and sniffs that `.bin`. The identification's
  `canonical_path` is always the `.cue` itself, never the `.bin` — this is
  what collapses a multi-track cue/bin set to exactly one library row keyed
  on the cue sheet. A cue sheet lists one `FILE` per track (or reuses one
  `FILE` across several `TRACK`s); the first data track always carries the
  disc's boot sector/filesystem, so sniffing it alone is sufficient — later
  tracks (often CD-DA audio) are irrelevant to system identification.
  `referenced_files` separately exposes **every** `FILE`-line path for the
  scan layer's claim set (see §Scan-path wiring).
- **`.bin`** (`sniff_bin_file`) — sniffs a bare `.bin` file directly;
  `canonical_path` is the file itself. (Bare `.iso` is **out of scope** this
  release — the dispatcher routes only `.cue`/`.chd`/`.bin`.)
- **`.chd`** (`sniff_chd_file`) — see below; header + metadata only, never
  decompresses hunks — which means **real PS1 `.chd` files are not
  identified in v0.34** (documented limitation, issue #49).

### Signatures used (conservatism contract)

Real PS1 dumps come in two sector layouts, and the sniffer handles both:
**cooked 2048-byte sectors** (an extracted data track; ISO9660 PVD user
data at byte 32768) and **raw MODE2/2352 sectors** as cue/bin dumps store
them (each sector = 12-byte ECMA-130 sync pattern + 3-byte MSF address +
mode byte + 8-byte CD-XA subheader + 2048 user bytes + EDC/ECC; the PVD
user data therefore sits at byte 16·2352 + 24). `locate_pvd` probes sector
16 under both layouts and confirms with the `CD001` magic at PVD byte
offset 1.

A PS1 match always requires a **`SYSTEM.CNF` `BOOT` line** plus **one**
corroborating Sony signature — there is no "probably" tier, and no single
signal is sufficient alone:

1. **`BOOT` (not `BOOT2`) cdrom boot line** (required). Real files read
   `BOOT = cdrom:\SLUS_xxx.xx;1` — matched as `BOOT`, optional
   spaces/tabs, `=`, optional spaces/tabs, then `cdrom`
   (case-insensitive). `BOOT2` is PS2's boot key and is explicitly
   rejected; this line is the actual PS1-vs-PS2 discriminator.
2. **PVD System Identifier `PLAYSTATION`** (corroborator 1). Sony stamps
   `PLAYSTATION` into the PVD's System Identifier field (PVD bytes 8–39,
   ISO9660 §8.4.5) — *not* the pre-PVD system area. PS2 CD discs carry the
   same value, which is why the boot line is required alongside it.
3. **System-area licence text** (corroborator 2). The raw system area
   (sectors 0–15) carries `Licensed by Sony Computer Entertainment`,
   mastered with irregular runs of spaces — the check compares
   whitespace-normalized bytes. Accepted with the boot line even when the
   PVD is unreadable.

A valid `CD001` PVD with a non-PlayStation System Identifier, a boot line
with no corroborator, or `PLAYSTATION` with a `BOOT2` line (a PS2 CD) all
yield `None` — pinned by the `ps2_disc_with_playstation_system_id_is_rejected`,
`generic_iso9660_disc_is_rejected`, and
`boot_line_alone_without_corroboration_is_rejected` tests.

All checks run over a **bounded 4 MiB read window** from the start of the
file (`SNIFF_WINDOW_BYTES`) — real PS1 discs place the PVD under 40 KiB in
and master `SYSTEM.CNF` among the first files, so this keeps sniffing cheap
even for multi-hundred-MB/GB images without reading the whole disc.

### CHD: header + metadata only — real PS1 CHDs are NOT identified (v0.34)

**Documented limitation:** real-world PS1 `.chd` files are **not**
identified in v0.34. chdman-produced CD metadata (`CHT2`/`CHTR` tags)
contains only track-geometry text (`TRACK:N TYPE:… FRAMES:…`) — never a
`PLAYSTATION` marker or a `SYSTEM.CNF` boot line — so header/metadata-only
parsing always returns `None` for a real PS1 CHD, and the disc stays
unscanned (conservative: no false positives, no wrong-system rows).
Identifying real CHDs requires hunk decompression (a codec dependency plus
real I/O + CPU per scanned file), which is out of scope this release;
tracked as [rhohn94/retro-game-player#49](https://github.com/rhohn94/retro-game-player/issues/49).
The `realistic_chdman_cd_metadata_is_not_identified` test pins this, and
the positive CHD tests are explicitly labeled **synthetic** (hand-tagged
metadata) — they exercise the parser, not a real-world PS1 CHD.

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
3. Scans the concatenated metadata bytes for a `PLAYSTATION` substring or a
   PS1 `BOOT` line — CHD metadata is free-form descriptive text with no
   fixed sector layout (unlike a raw ISO image), so the stricter
   PVD-structure check doesn't apply here. Per the limitation above, real
   chdman metadata never contains either marker; this path only fires for
   hand-tagged/synthetic CHDs.

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
3. **Every** file referenced by **every** `FILE` line of every `.cue` is
   computed up front into a `claimed_bins` set (not just the first track —
   a later track would otherwise become its own candidate). Any `.bin` in
   that set is **excluded from sniffing entirely** — its content lives
   inside a cue/bin set that the `.cue` itself already represents, so it
   must never become its own candidate, independently identified or not.
   Claim comparison is **case-insensitive** (canonicalized + case-folded
   absolute paths): macOS's default filesystem is case-insensitive, so a
   cue's `FILE` reference may spell the on-disk name differently.
4. The remaining disc candidates are sniffed via `disc_ident::sniff_disc_image`;
   each positive identification becomes one `NewGame` row (system, hashes,
   DAT match, `core_hint` looked up from `mapper::core_hint_for_system`)
   keyed on the identification's `canonical_path`, persisted through the
   same dedup-by-path helper the unambiguous pass uses. **Disc-row hashes
   are prefix-window hashes:** `crc32`/`md5` are computed over at most the
   leading 16 MiB (`DISC_HASH_PREFIX_BYTES`) rather than the whole
   multi-GB image — DAT matching does not apply to disc rows this release,
   so the hash only needs to be a stable dedup/change fingerprint. A
   `.cue` is tiny text far below the window and is therefore hashed in
   full; `size_bytes` is always the file's true on-disk size, not the
   window's. The `identified` counter is only incremented after the hash
   window has been read successfully (an unreadable file counts as scanned
   only).
5. Anything not positively identified — an unrecognized `.bin`, a `.cue`
   whose referenced track doesn't sniff positively, a non-v5 or marker-less
   `.chd` — contributes nothing: not a row, not an "unidentified" flag. It
   stays unscanned, exactly as before W343.

### Testing

- **`disc_ident.rs`** unit tests build fixtures that **mirror real dump
  byte layouts** (the shared `fixtures` module): raw MODE2/2352 sectors
  with the ECMA-130 sync pattern, BCD MSF addresses and CD-XA subheaders; a
  proper ISO9660 PVD with a space-padded System Identifier field; canonical
  `SYSTEM.CNF` text (`BOOT = cdrom:\SLUS_005.94;1` with spaces + CRLF); and
  the real irregularly-spaced licence text. They cover: identification
  under both raw and cooked layouts; the PS2 near-miss (`PLAYSTATION`
  System Identifier + `BOOT2`) rejected; generic ISO9660 rejected; boot
  line alone rejected; licence-text + boot line accepted without a valid
  PVD; boot-line spelling variants (spaces, tabs, no spaces, uppercase
  `CDROM`); cue parsing (case-insensitive keyword, tabs, quoted and bare
  filenames, multi-`FILE` sheets, missing/dangling reference, unparseable
  sheet); and CHD edge cases (wrong tag, truncated header, zero
  `metaoffset`, marker-less metadata, plus the realistic-chdman-metadata
  negative pinning the v0.34 limitation).
- **`core::sources::rom`** integration tests scan a temp folder containing
  these same fixture shapes end-to-end: a cue/bin pair scans to one `ps1`
  row keyed on the `.cue`; a **synthetic-metadata** `.chd` fixture scans to
  a `ps1` row (labeled synthetic — real CHDs are not identified, issue
  #49); a non-PS1 `.bin` stays unscanned; a multi-track cue still collapses
  to one row — including when a later `FILE`-referenced track would sniff
  positive on its own, and when the cue's `FILE` reference differs from the
  on-disk name only by case; disc-row `size_bytes` is the true file size
  under prefix-window hashing; a rescan doesn't duplicate the cue/bin row;
  and a mixed folder proves the unambiguous `.nes` extension path is
  unaffected by the new disc pass.

## Open questions

- SHA1 is parsed and indexed but not yet computed per-ROM (CRC32 is the v0.1
  match key); add SHA1 hashing if CRC collisions or SHA1-only DAT entries appear.
- Where the bundled/first-run DAT comes from (shipped asset vs. fetched) is
  deferred to the W8/W13 `load_dat` seam.
- `SYSTEM.CNF`'s `BOOT` line is matched as flat text within the sniff
  window rather than via a full ISO9660 directory-tree walk to the actual
  file; a future pass could parse the directory tree properly if the
  flat-scan heuristic ever proves too loose in practice.
- Real PS1 `.chd` identification requires hunk decompression — out of scope
  in v0.34 and tracked as
  [rhohn94/retro-game-player#49](https://github.com/rhohn94/retro-game-player/issues/49)
  (see §CHD above).
- Disc-row hashes are prefix-window hashes (16 MiB); if DAT matching is
  ever extended to disc rows, the hashing strategy must be revisited
  (redump DATs hash whole tracks).
