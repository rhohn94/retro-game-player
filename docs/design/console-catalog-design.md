# Console Catalog (Gen 1–6) — Design

> **Up:** [↑ Docs](../README.md) · **Sib:** [core-discovery](core-discovery-design.md),
> [interaction-wiring](interaction-wiring-design.md)

## 1. Goal

Expand Harmony's default console coverage from the original three (NES, SNES,
N64) to **all home consoles of generations 1–6**, so discovery, scanning, the
core catalog, and the library console filter span the classic era
([#7](https://github.com/rhohn94/harmony/issues/7)).

## 2. Two sources of truth (kept decoupled)

| Concern | Owner | Drives |
|---|---|---|
| Which systems have installable cores | `core/cores/system_map.rs` (`SYSTEM_CORES`) | core browse/search, install, set-active |
| Which file extensions identify a system on scan | `core/library/mapper.rs` (`SYSTEMS`) | folder scan / ROM identification, `core_hint` |

The two live in different domains (`cores` vs `library`) and never cross-import
in production code (per `core/mod.rs`). Each `mapper` row's `default_core` is the
recommended (first) core for that system in `system_map`; a **test-only**
consistency check (`default_cores_match_catalog`) pins them so they cannot drift.

## 3. Accuracy: only real arm64 cores

The install path is a live buildbot fetch
(`<core>_libretro.dylib.zip` from `…/apple/osx/arm64/latest/`) → arm64 verify →
atomic write. A core id that the buildbot does not ship for arm64 would 404. So
every core id in the catalog was selected from the **actual** arm64 buildbot
index (195 cores) — not guessed. Recommended cores per system:

- **Gen 2:** atari2600 → stella · atari5200 → a5200 · atari7800 → prosystem ·
  intellivision → freeintv · colecovision → gearcoleco · odyssey2 → o2em
- **Gen 3:** nes → mesen · mastersystem → genesis_plus_gx
- **Gen 4:** snes → snes9x · genesis → genesis_plus_gx · pcengine → mednafen_pce ·
  neogeo → fbneo
- **Gen 5:** ps1 → pcsx_rearmed · n64 → mupen64plus_next · saturn → mednafen_saturn ·
  3do → opera · jaguar → virtualjaguar
- **Gen 6:** dreamcast → flycast · ps2 → play · gamecube → dolphin

**Omitted (documented):** Gen 1 dedicated/Pong consoles (no cartridge-ROM
emulation path) and the original Xbox (no libretro core — xemu is standalone).

## 4. Scan vs. discovery (the ambiguous-extension problem)

Cartridge systems carry a *distinct* ROM extension, so a scan can name the
system from the file alone (`a26`→atari2600, `sms`→mastersystem, `md`→genesis,
`pce`→pcengine, `neo`→neogeo, `j64`→jaguar, …). CD-based systems share container
formats (`.cue`/`.chd`/`.iso`/`.bin`) that **cannot** identify a system on their
own, so mapping any of them to one system would mis-scan the others. Therefore:

- `mapper::SYSTEMS` only adds **unambiguous** extensions (16 systems). The two
  optical systems with a distinct container — Dreamcast (`.gdi`/`.cdi`) and
  GameCube (`.rvz`/`.gcm`) — are scannable; Saturn/3DO/PS2/Odyssey² are not.
- `system_map` still lists those systems (their cores are installable and
  discoverable); only auto-scan-by-extension is deferred for them. Manual
  per-ROM system assignment for shared container formats is a backlog follow-up.

`mapper::extensions_are_unique_across_systems` guards that no extension ever maps
to two systems.

## 5. Frontend: automatic

No frontend change is needed. The library console filter derives its pills from
the loaded games' `system` values (`facetValues`), and the Cores screen lists
whatever `list_available_cores` returns — both pick up the new systems as soon
as the catalog/scan produce them. The headless mock IPC was broadened so the
Cores screen shows the new breadth under visual inspection.

## 6. Out of scope

- Pretty display names per system (the UI shows the canonical key, as it already
  does for nes/snes/n64) — a polish follow-up.
- Handhelds (Game Boy, GBA, etc.) — the ticket scopes home consoles.
- Manual system assignment for ambiguous CD container formats.
- Broadening `fleet/manifest.rs::DECLARED_CORE_SYSTEMS` (telemetry dependency
  edges) beyond the primary three — left as-is to avoid 17 mostly-absent edges.
