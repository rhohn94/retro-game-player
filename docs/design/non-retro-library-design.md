# Non-Retro Library — v0.31 (Horizon H1, first slice)

> **Up:** [↑ Design index](README.md)
> **Status:** agreed for v0.31 — implemented by W310–W315
> **Origin:** roadmap §Horizon H1 (user scope directive 2026-07-03)

## Motivation

RGP's ambition ring two: the app becomes the frontend for *all* games on the
Mac, not only retro ROMs. Today the library model, scanners, and play paths
all assume a ROM file with a hash and a system. Non-retro titles (Steam
installs, plain `.app` bundles, manually added games) can't join the shelves,
TV mode, favorites, or play-time tracking. This release makes them
first-class library citizens that launch externally — the same product
surface, new game sources and launchers.

## Scope

**In (v0.31):** ROM-less library rows; a pluggable game-source abstraction
with three sources (Steam appmanifest scan, `/Applications` scan with game
heuristics, manual entry); a launch-descriptor abstraction generalizing the
RetroArch-only external play path (`open -a`, `steam://rungameid/<id>`,
custom exec + args); app-focus-based play-session tracking for externally
launched titles; Steam CDN header/hero art on shelves and TV mode.

**Non-goals (roadmap-fixed):** storefront purchases, install/uninstall
management, in-page play for native titles (they launch externally by
definition). **Deferred within H1 (v0.32+ candidates):** GOG/itch scanners,
SteamGridDB art for non-Steam titles, CrossOver anything (H2).

## Design

### Data model (W310)

Schema authority remains [architecture-design.md §3](architecture-design.md#3-sqlite-schema);
W310 appends a new versioned migration (never edits a released one, per
[persistence-design.md](persistence-design.md)) and updates the master
contract's §3 DDL in the same branch:

- `games.rom_path`, `games.rom_hash`, `games.system_id` become nullable.
- New columns: `games.source` (`rom` | `steam` | `app` | `manual`, default
  `rom`), `games.launch_descriptor` (JSON, null for `rom` rows), and
  `games.external_id` (e.g. Steam appid; unique per source where present).
- Rust row structs + TS DTOs mirror the change; repos gain
  source-aware upsert (re-scan must not duplicate; match on
  `(source, external_id)`).
- Invariant: a row has *either* a rom identity *or* a launch descriptor —
  enforced by a CHECK constraint and a repo test.

### Launch descriptors & launcher abstraction (W311)

Generalize `src-tauri/src/core/launch/` (see
[emulation-launch-design.md](emulation-launch-design.md)) behind a
`Launcher` dispatch on descriptor kind:

```
LaunchDescriptor =
  | { kind: "retroarch" }                       // existing path, unchanged
  | { kind: "app",   bundle_path }              // open -a <bundle>
  | { kind: "steam", appid }                    // open steam://rungameid/<id>
  | { kind: "exec",  program, args: [String] }  // custom, space-safe argv
```

Same argv-safety rules as the RetroArch path (separate args, no shell
strings). The existing three IPC launch commands stay; `launch_game`
dispatches on the game's descriptor. Play sessions for external titles
start at launch and stop via NSWorkspace app-termination/focus observation
(best-effort; document the accuracy caveat), reusing the existing
play-session rows.

### Game sources (W312 Steam, W313 apps + manual)

A `GameSource` trait (`scan() -> Vec<DiscoveredGame>`) beside the existing
ROM folder scanner — the ROM scanner is *not* rewritten onto it in v0.31.

- **Steam:** parse `appmanifest_*.acf` under
  `~/Library/Application Support/Steam/steamapps` (VDF text; name, appid,
  installdir). No Steam API calls; missing Steam dir → empty result, not an
  error.
- **Apps:** enumerate `/Applications` (and `~/Applications`) `.app` bundles;
  heuristics to shortlist games (Info.plist `LSApplicationCategoryType`
  `public.app-category.games*`, known publisher allowlist); user confirms
  the shortlist before rows are created (no silent library flooding).
  Excludes bundles already owned by the Steam source.
- **Manual:** a form (name + pick an app bundle or executable) as the
  escape hatch; creates a `manual` row with an `app`/`exec` descriptor.

### Art & metadata (W314)

Steam titles get library/hero/header art from the public Steam CDN
(`https://steamcdn-a.akamaihd.net/steam/apps/<appid>/…`), cached through the
existing `art_cache` pipeline ([metadata-art-design.md](metadata-art-design.md)).
Non-Steam titles fall back to the `.app` bundle icon (rendered to PNG) and
the existing placeholder art. No SteamGridDB in v0.31.

### UI (W315)

Shelves, filtering, favorites, play-time, detail page, and TV launch flow
([tv-mode-design.md](tv-mode-design.md)) treat non-retro rows as
first-class: no console badge for them (a source badge instead), detail
page hides emulator-specific affordances (cores, save states, in-page play)
and shows "Launches via Steam / macOS". A library section/filter for
"Desktop" games. Settings gains a "Game sources" pane to trigger/re-run
Steam + app scans and add manual entries.

## Acceptance

- [ ] Migration applies on an existing v0.30 DB and is idempotent; ROM rows
      untouched; CHECK invariant enforced (repo test).
- [ ] Steam scan on a machine with Steam installed yields rows with correct
      name/appid; re-scan creates zero duplicates; no Steam → zero rows, no
      error.
- [ ] `.app` scan shortlist is confirm-gated; confirmed entries appear in
      the library with bundle-icon art.
- [ ] Manual entry via the form appears and launches.
- [ ] Launching a `steam`/`app`/`exec` descriptor opens the right target
      (unit tests on argv/URL construction; smoke via `recipe.py smoke`).
- [ ] Play session recorded for an externally launched title (start on
      launch; stop observed on app termination).
- [ ] Steam art renders on shelf + TV hero; non-Steam shows icon/placeholder.
- [ ] Existing retro flows (RetroArch launch, in-page play) unregressed —
      full test suite + smoke green.

## Follow-ups

- GOG/itch scanners; SteamGridDB for non-Steam art (v0.32 candidates).
- ROM scanner migration onto the `GameSource` trait.
- H2 CrossOver bottle enumeration/launch (builds on the descriptor model).
