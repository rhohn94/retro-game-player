# Direct download — wire the v0.16 per-vendor seam into a real download → import → play loop

> **Up:** [↑ Design docs](README.md) · **Sib:** [download-search-design](download-search-design.md),
> [library-import-design](library-import-design.md)

## 1. Goal

Complete the in-app loop: **search → preview → download → land in library →
play** — without leaving Harmony. Today the loop breaks at "download": the user
is bounced to their browser, saves a file somewhere, then has to drag it back
into Harmony. v0.16 deliberately scaffolded the seam for this
([download-search-design.md](download-search-design.md) §5): a per-provider
`direct_download` flag (migration 007, off for every provider including seeds),
round-tripped through repo/IPC/dialog, with a disabled "⬇ Direct download ·
soon" marker in results. This design wires the actual download onto that seam.

## 2. Contract evolution (the honest version)

The historical invariant — "Harmony never downloads content" — evolves the same
way it did in v0.16 (when result-page fetching superseded "never fetch
server-side"). The new invariant:

> **Harmony downloads a file only when the user explicitly clicks Download on
> that file, and only from a provider the user has explicitly enabled direct
> download for.** No seeded provider ships with it enabled; enabling it is a
> deliberate per-vendor act. Harmony still ships no game content and never
> fetches content on its own initiative. Legality of any source remains the
> user's responsibility (v0.19 contract wording).

Structural guarantees preserved:
- `run_search` keeps **no** content-fetch path (the existing pinning test stays
  green); download is a separate, user-initiated command.
- The Search screen contract copy updates: "…opens your chosen link in your
  browser — or, for providers you've enabled, downloads your chosen file into
  your library." README/W236 language follows.

## 3. Backend

### `core/search/download.rs` (new)

`download_file(url, provider_id) -> DownloadedFile` — streaming GET to a
staging dir, with `fetch.rs`-style safeguards:

| Guard | Value |
|---|---|
| Provider gate | provider exists ∧ `direct_download = 1`, else `Validation` error |
| Scheme allow-list | `http`/`https` only |
| Size cap | 256 MiB default (config), enforced while streaming |
| Timeout | 60 s connect/idle (not total — large files stream) |
| Staging | `app-support/downloads/<uuid>.part` → rename on completion; orphaned `.part` swept at startup |
| Concurrency | one active download per provider; 3 global |

Progress is emitted as a Tauri event (`download://progress` with
`{id, received, total?}`) so the UI renders inline progress without polling;
cancel via a `cancel_download(id)` command (drops the stream, removes `.part`).

### Landing: reuse the v0.12 import pipeline

On completion, the file routes through the existing
`core/library/import.rs::import_file` machinery
([library-import-design.md](library-import-design.md)) — identify by extension,
copy into `<games_dir>/<system>/`, hash-dedupe, register, auto-enrich:

- **Bare ROM extension** → import directly; staging copy removed after import.
- **`.zip`** → enumerate entries (Rust `zip` crate), import every
  recognized-ROM entry (common case: one); multi-ROM zips import each. A zip
  with no recognized ROM lands in the failure state below.
- **`.rar` / other archives** → not supported v1 (aligned with dropping the
  GPL-incompatible UnRAR blob, W237/#26); clear error naming the format.
- **Unrecognized file** → kept in staging with a "not a recognized ROM —
  Reveal in Finder / Discard" resolution UI; never silently deleted, never
  copied into the games dir.

## 4. UX

- The disabled "⬇ Direct download · soon" marker on an opted-in provider's
  result rows becomes a live **⬇ Download** action; non-opted-in providers keep
  the browser link-out exactly as today.
- Inline row progress (determinate when `Content-Length` is present) with
  Cancel; on success the row shows **"✓ In library — Play"** deep-linking to the
  game detail page (which auto-boots per the in-page-play vibe).
- Failures render in-row (size cap, timeout, bad archive), never a modal.
- The provider dialog checkbox drops its "coming soon" hedge; its help text
  states the responsibility contract.

## 5. Testing

- Pure: staging-path derivation, zip ROM-entry recognition, cap enforcement
  against a local fixture server (`tiny_http` test harness, as `fetch.rs` does).
- Contract: the `run_search`-has-no-fetch-path pinning test unchanged; a new
  test asserts `download_file` rejects a provider with `direct_download = 0`.
- Integration: download a fixture zip from a local test server → lands
  imported, hash-deduped on re-download.

## 6. Out of scope (v1)

- Torrent/magnet, resume/partial-content, a download-queue manager page
  (inline rows only), auto-download of best match, seeding any provider with
  the flag on, `.rar`/`.7z` archives.

## 7. Scheduling

Proposed as a **v0.24 "Everywhere"** item — it composes with that release's
theme (every game plays inside Harmony; now every found game *lands* inside
Harmony too). Estimated ~90K tokens (L): new `download.rs` + events + zip
handling dominate; UI is contained in the existing result-row components.
