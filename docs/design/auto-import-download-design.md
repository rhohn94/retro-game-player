# Auto-import downloads (page → file → library)

> **Up:** [↑ Design docs](README.md)

## Motivation

Direct download already auto-imports **when the URL is a ROM or zip**. In
practice search results almost always point at **HTML detail pages**, so the
GET stages a web page (no extension / `.html`), `land_download` returns
`Unrecognized`, and the game never appears in the library.

## Goal

On ⬇ Download:

1. Fetch the clicked URL.
2. If the body is a **game file** (ROM/zip) → import into the library (unchanged).
3. If the body is **HTML** → find the best **direct file link** on the page
   (same-host preferred, `.zip` / recognized ROM extensions), download that
   file, then import.
4. If no file link is found → clear in-row message + Reveal/Discard the staged
   page (not a silent no-op).

## Scope

- One HTML hop max (page → file). No recursive crawl.
- Candidates must have an **importable extension** in the URL path:
  `zip` or any `map_extension` ROM ext (`.nes`, `.md`, `.sfc`, …).
- Safeguards unchanged: http(s) only, size cap, cancel, staging dir.
- `.rar` / `.7z` still not imported (clear error if that is the only candidate).

## Non-goals

- Per-site download APIs / captcha / JS-only download buttons.
- Torrents / magnets.
- Multi-file queue manager.

## Acceptance

- HTML fixture page linking to `game.nes` or `pack.zip` → library row + Play.
- Raw `.nes` URL → library row (regression).
- HTML with no file links → reason text, staged file revealable, no library row.
- Second hop that is still HTML → same failure path, no infinite loop.

## Follow-ups

- `Content-Disposition` filename.
- HEAD preflight for `Content-Type`.
- Site-specific parsers when extension-less `/download?id=` is required.
