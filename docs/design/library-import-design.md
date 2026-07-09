# Library Import & Auto-Metadata (v0.12 "Curator")

> **Up:** [↑ Design docs](README.md) · **Sib:** [games-directory](games-directory-design.md),
> [metadata-art](metadata-art-design.md), [download-search](download-search-design.md),
> [console-browse](console-browse-design.md)

## Motivation

Before v0.12 a game entered the library only by configuring a content folder and
running a scan. There was no first-class "add this game" action, and metadata
beyond cover art (which the libretro CDN already supplies) was never populated —
the `description` of a game was always blank. This release adds the missing path:
import a ROM directly (drag-and-drop or a native file picker), copy it into the
managed Games directory, register it, and automatically download relevant
metadata (cover art + a Wikipedia description). It also broadens the links-only
download search with a curated set of emulator ROM sites.

## Scope

**Covers:**
- **Import** a ROM by drag-and-drop onto the window or via the native file picker
  (`tauri-plugin-dialog`). Imported files are identified by extension, copied into
  `<games_dir>/<system>/`, and registered as library games — ready to play.
- **Auto-metadata on add:** after import, each new game fetches cover art
  (existing libretro-thumbnails path) and a Wikipedia summary + article URL.
- A manual **"Refresh metadata"** action on the game detail page.
- **ROM-site download providers:** a curated set of emulator/ROM sites seeded as
  `kind='download'` search providers (links-only).

**Does not cover:**
- Metadata-only library entries (a game with no ROM file) — every library entry
  is backed by a real, launchable file. (Scoping decision; see Follow-ups.)
- Auto-populating `year` / `developer` / `publisher` from Wikipedia (the summary
  endpoint does not reliably expose them); those columns stay enrichment-ready.
- Importing folders / archives (`.zip`) — single ROM files only.

## Design

**Import pipeline** ([`core/library/import.rs`](../../src-tauri/src/core/library/import.rs),
Tauri-free + unit-tested): `import_file(db, games_dir, src, dat)` →
identify system via [`mapper`](../../src-tauri/src/core/library/mapper.rs) (unknown
extension is rejected) → hash (CRC32+MD5) → **content dedup first**, before any
copy: a `(crc32, system)` match against an existing `games` row short-circuits
to that row (`already_present`), so re-importing the same ROM from a different
folder or under a different filename never copies or inserts anything → DAT/filename
clean-name via [`matcher`](../../src-tauri/src/core/library/matcher.rs) → place under
`<games_dir>/<system>/` (register-in-place when the file is already inside the
Games dir; otherwise copy to a never-clobber unique name, appending ` (1)`, ` (2)`, …
before the extension on a filename collision) → ensure the Games dir is a
`content_folder` → insert the game, with the `games.path` UNIQUE constraint as a
race-safe backstop (a losing racer, or a path already registered, resolves to the
existing row rather than erroring). The command
[`import_games`](../../src-tauri/src/commands/library.rs) resolves (or
first-run-creates) `AppConfig.games_dir`, runs each file (currently always without
a DAT index — `dat` is passed as `None`, so imported games are never DAT-matched
even when a folder scan of the same system would be), and returns a per-file
result (`imported` / `exists` / `unsupported` / `error`).

**Drag-and-drop** is wired in [`LibraryPage`](../../src/features/library/LibraryPage.tsx)
via Tauri's built-in webview `onDragDropEvent` (no plugin); the **file picker**
uses `tauri-plugin-dialog` (`pickRomFiles` in
[`import.ts`](../../src/features/library/import.ts)).

**Metadata enrichment** ([`enrich_game_metadata`](../../src-tauri/src/commands/metadata.rs)):
runs the cover-art fallback chain and a new
[Wikipedia client](../../src-tauri/src/core/metadata/wikipedia.rs)
(search → REST `page/summary`), persisting `games.description` + `wikipedia_url`
(migration 005). Best-effort: an unsupported system, a CDN miss, or a Wikipedia
miss leaves the un-enriched field untouched and never fails the call. The frontend
triggers enrichment per newly imported game so the grid appears immediately.

**ROM-site providers** (migration 005) extend the v0.11 links-only contract
(file-search-design.md §2): Harmony only constructs a `{query}` link the user
opens in their own browser — it never fetches or downloads. Each seeded template
was verified to resolve and honor its query parameter.

## Acceptance

- Dropping or picking a recognized ROM adds it to the library, copies it under
  `<games_dir>/<system>/`, and it is immediately launchable.
- Re-importing the same file is idempotent (`exists`, no duplicate row/copy); a
  different file with the same name does not clobber the first.
- An unrecognized extension returns `unsupported`, not a crash.
- After import (or "Refresh metadata"), a game with a Wikipedia article shows a
  description + a working "Read more on Wikipedia" link; missing metadata degrades
  to the prior placeholder behavior.
- The Search screen lists the seeded ROM-site providers under the ⬇ download
  group; all templates are `https://…{query}…` and open in the browser.
- `recipe.py smoke` renders the Library + detail routes with the new affordances.

## Open questions

None.

## Follow-ups

- Metadata-only "wishlist" library entries (add a title you don't own yet).
- Wikidata-backed `year` / `developer` / `publisher` enrichment.
- Archive (`.zip`) import with inner-file selection for ambiguous CD containers.
