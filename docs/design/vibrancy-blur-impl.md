# Vibrancy Blur — Implementation Note (W10)

> **Up:** [↑ Design docs](README.md) · [↑ Native-Vibrancy Seam spec](native-vibrancy-design.md)
>
> **Status:** implemented (W10, version/0.1). This is a short implementation
> note; the canonical spec is in `native-vibrancy-design.md` §4.

## Module layout

```
src-tauri/src/
  core/
    vibrancy/
      mod.rs            — re-exports blur_pipeline + blur_cache
      blur_pipeline.rs  — pure image pipeline (load → downscale → blur → PNG)
      blur_cache.rs     — disk cache + BlurredHero DTO
  commands/
    vibrancy.rs         — #[tauri::command] adapter (spawn_blocking → get_or_compute)
src/ipc/
  vibrancy.ts           — typed TS wrapper (getBlurredHero) + BlurredHero interface
```

## Constants (no magic numbers)

| Constant | Value | File |
|---|---|---|
| `BLUR_TARGET_PX` | `96` | `blur_pipeline.rs` |
| `BLUR_SIGMA` | `4.0` | `blur_pipeline.rs` |

## Pipeline summary

1. `blur_pipeline::decode_image` — `image::load_from_memory` → `DynamicImage`.
2. `blur_pipeline::run` — `resize(96, 96, Lanczos3)` → `blur(4.0)` → `PngEncoder`.
3. `blur_cache::get_or_compute` — stat `blur-cache/<game_id>.png`; hit → read;
   miss → run pipeline → `fs::write`; return `BlurredHero`.
4. `commands::vibrancy::get_blurred_hero` — `spawn_blocking` wrapper; registers
   as the Tauri IPC command `get_blurred_hero`.

## Tauri state

`Paths` is now registered as Tauri managed state in `lib.rs` setup (W10 block)
so `commands::vibrancy` can access `blur_cache_dir()` without re-resolving the
app-support root.

## TS surface

`src/ipc/vibrancy.ts` exports `getBlurredHero({ gameId, artPath })` and the
`BlurredHero` interface. Both are re-exported from `src/ipc/commands.ts`
(append line `export * from "./vibrancy";`).

## Crate additions (Cargo.toml)

```toml
base64 = "0.22"
image = { version = "0.25", default-features = false, features = ["png", "jpeg", "gif", "webp"] }
```

## Tests

- `blur_pipeline` — `pipeline_produces_valid_png_from_small_image`, `large_image_is_downscaled`, `zero_width_image_returns_error`.
- `blur_cache` — `first_call_writes_cache_second_call_hits_cache`, `missing_art_returns_not_found`.
