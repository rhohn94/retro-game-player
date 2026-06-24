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
