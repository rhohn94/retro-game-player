# Metadata & Art Design — Harmony v0.1 (W8)

> **Up:** [↑ Design docs](README.md)
> **Status:** authoritative · v0.1

## Overview

W8 implements cover-art fetching, on-disk caching, and the typed IPC surface
for the two metadata commands (`fetch_boxart`, `get_cached_art`). It consumes
the W3 `art_cache` repo and the W4 `Paths::art_cache_dir()` resolver. No
emulator metadata (DATs, ratings) is in scope for v0.1.

---

## 1. Module map

```
src-tauri/src/core/metadata/
  mod.rs           — exposes the four sub-modules
  name_sanitizer.rs — No-Intro → CDN-safe percent-encoded segment
  cdn_client.rs    — HTTP client + system→CDN-folder map + ArtTier enum
  art_cache.rs     — on-disk write + ArtCacheRepo + LibraryRepo.set_game_art
  fallback.rs      — 3-tier fetch orchestration (async)

src-tauri/src/commands/metadata.rs
  fetch_boxart     — #[tauri::command] adapter
  get_cached_art   — #[tauri::command] adapter

src/ipc/metadata.ts
  fetchBoxart(gameId)   — invoke wrapper
  getCachedArt(gameId)  — invoke wrapper
```

---

## 2. CDN URL scheme

Base: `https://thumbnails.libretro.com`

Full URL template:
```
{base}/{System CDN folder}/{Tier dir}/{Sanitized No-Intro name}.png
```

Example:
```
https://thumbnails.libretro.com/Nintendo - Nintendo Entertainment System/Named_Boxarts/Super%20Mario%20Bros.%203%20(USA).png
```

System CDN folders are mapped by `cdn_client::system_to_cdn_folder(system)`.

---

## 3. No-Intro name sanitizer

Before percent-encoding, these characters are substituted with `_`:

| Original | Replacement |
|---|---|
| `&` | `_` |
| `*` | `_` |
| `/` | `_` |
| `:` | `_` |
| `<` | `_` |
| `>` | `_` |
| `\` | `_` |
| `\|` | `_` |
| `?` | `_` |
| `"` | `_` |

After substitution the segment is percent-encoded (spaces → `%20`, etc.).

---

## 4. 3-tier fallback

| Step | Name variant | CDN directory |
|---|---|---|
| 1 | Full No-Intro `clean_name` | `Named_Boxarts` |
| 2 | Short name (pre-`(` portion) | `Named_Boxarts` |
| 3 | Full `clean_name` | `Named_Titles` |
| 4 | Full `clean_name` | `Named_Snaps` |

Steps 2–4 are skipped if the preceding step produced a hit. A complete miss
returns an empty string (`fetch_boxart`) or `null` (`get_cached_art`); the
frontend displays a placeholder.

---

## 5. On-disk layout

Under `art_cache_dir()` (W4):
```
art-cache/
  <system>/
    <sanitized_name>_<tier>.png
```

Example:
```
art-cache/nes/Super%20Mario%20Bros.%203%20(USA)_boxart.png
```

---

## 6. Database integration

On a successful fetch:
1. `ArtCacheRepo::upsert(game_id, tier_key, path, fetched_at)` persists the entry.
2. `LibraryRepo::set_game_art(game_id, best_path)` denormalises the
   highest-priority tier path into `games.art_path` for fast grid reads.

`get_cached_art` queries `ArtCacheRepo::list_for_game` and selects the
highest-priority tier (boxart > title > snap) without touching the network.

---

## 7. IPC command surface

Per architecture-design.md §2.4:

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `fetch_boxart` | `{ gameId: number }` | `string` (art_path or `""`) | `async fn fetch_boxart(game_id: i64, db: State<Db>) -> AppResult<String>` |
| `get_cached_art` | `{ gameId: number }` | `string \| null` | `async fn get_cached_art(game_id: i64, db: State<Db>) -> AppResult<Option<String>>` |

---

## 8. Error handling

| Condition | AppError variant |
|---|---|
| Game not found in DB | `NotFound` |
| System has no CDN mapping | `Unsupported` |
| HTTP transport failure (non-404) | `Network` |
| Disk write failure | `Io` |
| CDN returns 404 for all tiers | → graceful: empty string / `null` |

---

## 9. Testing strategy

- `name_sanitizer` — unit tests covering real No-Intro names with `&`, `:`,
  `/`, `?`, region tags, and plain names. No network required.
- `cdn_client` — tests for `ArtTier` values, `build_cdn_url` format, and the
  system map. No network required.
- `fallback` — tests verify URL sequence ordering and `short_name` extraction.
  No network required.
- `art_cache` — integration tests using `Db::open_in_memory()` + `tempfile`
  verify disk write, `art_cache` row, and `games.art_path` update.

---

## High-resolution tiers

> v0.26 W263 extension. The v0.1 pipeline above (§1–9) already stores raw CDN
> bytes with no client-side downscaling — "full CDN resolution" was true from
> the start. What W263 adds is **per-tier independence**: the three tiers
> (`Named_Boxarts`, `Named_Titles`, `Named_Snaps`) can each be fetched and
> cached on their own, rather than only ever surfacing whichever tier the
> 3-tier fallback chain happened to stop at first. This is the groundwork for
> full-bleed TV/hero surfaces (tv-mode-design.md), which want the most
> atmospheric available shot — not necessarily the boxart.

### Tier model

Same three tiers as §2/§4, unchanged:

| Tier | `ArtTier` variant | `db_key()` | CDN dir |
|---|---|---|---|
| Boxart | `ArtTier::Boxart` | `"boxart"` | `Named_Boxarts` |
| Title screen | `ArtTier::Title` | `"title"` | `Named_Titles` |
| Gameplay snap | `ArtTier::Snap` | `"snap"` | `Named_Snaps` |

`art_cache` already has a `(game_id, tier)` unique row per tier (§6), so no
migration was needed — W263 is purely new fetch/read paths over the existing
schema. `core::metadata::cdn_client::ArtTier::from_db_key` parses the IPC
`tier: String` argument back into the enum (`None` → `AppError::Validation`).

### Per-tier fetch (`fetch_tier` / `fetch_game_art`)

`core::metadata::fallback::fetch_tier(db, paths, game_id, system, clean_name,
tier)` fetches exactly ONE named tier, independent of the other two:

1. Try the full No-Intro `clean_name` under the requested tier.
2. For `ArtTier::Boxart` only (mirrors the existing tier-2 short-name
   convention in `fetch_with_fallback`), retry with the short name (everything
   before the first `(`) if it differs from the full name. Title/snap never
   get a short-name retry — No-Intro title-screen/snap filenames are always
   keyed on the full name on the CDN.
3. A 404 on every attempted name is a graceful miss (`Ok(None)`) — never an
   error. An unsupported system is still `AppError::Unsupported`; a transport
   failure is still `AppError::Network`.

Idempotent + concurrent-safe: `ArtCacheService::store` upserts on
`(game_id, tier)`, so two overlapping `fetch_tier` calls for the same pair
both converge on one row holding the last-written bytes/path — no partial or
duplicate state.

IPC adapter: `fetch_game_art(game_id: i64, tier: String) -> AppResult<String>`
(`commands/metadata.rs`) — parses `tier`, resolves the game's
`system`/`clean_name`, calls `fetch_tier`, and returns the on-disk path or an
empty string on a per-tier miss (same "frontend shows a placeholder" contract
as `fetch_boxart`).

### Reading what's cached (`cached_tiers` / `get_cached_art_tiers`)

`ArtCacheService::cached_tiers(game_id) -> Vec<(tier_key, path)>` is the
per-tier counterpart to `best_cached_path` (§6): instead of collapsing to one
"best" path, it returns every tier actually on disk, ordered by
`TIER_PRIORITY` (boxart, title, snap) regardless of fetch/insertion order.
Local-only — no network call, no CDN round-trip; a game that has never been
queried returns an empty vec.

IPC adapter: `get_cached_art_tiers(game_id: i64) ->
AppResult<Vec<CachedArtTierDto>>`, `CachedArtTierDto { tier: String, path:
String }` (camelCase over the wire: `{ tier, path }`).

### Fallback order (surface-aware, frontend-owned)

The *tier-selection* fallback order is a pure function on the frontend —
`heroArtFor(cachedTiers, surface)` in `src/features/library/art.ts` — since it
depends only on which tiers are ALREADY cached (an IPC read), not on network
state, so it needs no Rust round-trip and is trivially unit-testable in
isolation:

| Surface | Preferred order | Rationale |
|---|---|---|
| `"hero"` | snap → title → boxart | Full-bleed hero wants the most atmospheric/in-motion-feeling shot; a gameplay snap reads better full-bleed than a static box cover. |
| `"tile"` | boxart → title → snap | The desktop grid tile is unchanged from pre-W263 — it wants the crisp, recognizable box cover first. |

A surface whose preferred tiers are all uncached falls through to whatever
tiers ARE cached, in that surface's order; a game with nothing cached at all
resolves to `null`, and the caller renders its placeholder (grid tile) or the
pre-blurred `HeroBackdrop` "blurred" variant (hero) — i.e. the full chain is
"snap → title → boxart → blur" for the hero surface, per the v0.26 plan §2
acceptance line, with "blur" being the caller's existing placeholder/backdrop
behavior rather than a 4th tier inside `heroArtFor` itself.

### Frontend hook (`useGameArt`)

`src/features/library/useGameArt.ts` — alongside `useBoxart` (§ unchanged),
not replacing it:

- `useBoxart(game, allowFetch)` — desktop grid/detail single-tier resolver,
  `Game.artPath`-first, then `get_cached_art`/`fetch_boxart`. **Untouched** by
  this work item.
- `useGameArt(game, tier, { surface, allowFetch })` — resolves through
  `get_cached_art_tiers` + `heroArtFor(tiers, surface)` first; if nothing is
  cached and `allowFetch` is set, falls back to a one-shot
  `fetch_game_art(gameId, tier)` for the caller's requested tier specifically.

Both hooks share the same local-cache-first / optional-fetch *shape* and the
same `artUrl` asset-protocol conversion + silent-degrade-to-`null` error
handling, but query different IPC surfaces and are not merged into one
parameterised hook — see the "genuinely coincidental duplication" carve-out in
docs/coding-standards.md (documented inline in `useGameArt.ts`).

### Full-bleed hero variant (`HeroBackdrop`)

`HeroBackdrop` (`src/features/library/HeroBackdrop.tsx`) gains a `variant`
prop, default `"blurred"` (existing behavior, byte-for-byte unchanged for
every current call site, which never passes `variant`):

| Variant | Source | Treatment |
|---|---|---|
| `"blurred"` (default) | `get_blurred_hero` (W10 pre-blurred bitmap) | Scaled +5% oversize, `opacity: 0.55`, no scrim — unchanged. |
| `"full-bleed"` | `get_cached_art_tiers` + `heroArtFor(tiers, "hero")` | Native resolution, `object-fit: cover` equivalent (`background-size: cover`, `inset: 0`, `opacity: 1`), plus a `.rgp-hero-backdrop__scrim` gradient (top-to-bottom fade of `--aura-bg` via `color-mix`) for text legibility. No backend blur round-trip. |

No current call site opts into `"full-bleed"` — this item only adds the
capability; the TV home hero (W261, tv-mode-design.md) is the intended first
consumer.

### Testing

- `cdn_client::from_db_key` — round-trips every `ArtTier` through its
  `db_key()`/`from_db_key()` pair; rejects an unknown string.
- `fallback` — `fetch_tier`'s pure URL-construction pieces (full-name vs.
  short-name attempts, per tier) covered the same way as the existing 3-tier
  `fallback_url_sequence_order` test — no network/runtime required.
- `art_cache::cached_tiers` — priority ordering independent of
  insertion/fetch order; empty-vec for an uncached game; partial-cache
  (boxart-only) shape.
- `art.ts::heroArtFor` — full matrix over both surfaces × every
  cached/uncached tier combination (TS `vitest`, no IPC/DOM needed).
- Mock-IPC fixtures (`scripts/mock-ipc.mjs`) + guard test
  (`scripts/mock-ipc.test.mjs`) cover `get_cached_art_tiers` (shape-checked
  against `CachedArtTierDto`) and `fetch_game_art` (string return).
