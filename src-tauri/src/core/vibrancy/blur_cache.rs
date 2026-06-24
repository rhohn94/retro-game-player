//! On-disk cache for pre-blurred hero images (W10).
//!
//! Each game's blurred cover art is stored as `blur-cache/<game_id>.png`
//! under the Harmony app-support root. The cache key is the stable integer
//! `games.id` PK. A cache hit (non-empty file already exists) short-circuits
//! the expensive blur pipeline so subsequent calls for the same game are
//! instant reads.

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

use crate::config::paths::Paths;
use crate::core::vibrancy::blur_pipeline;
use crate::error::{AppError, AppResult};

/// The `BlurredHero` DTO returned from `get_blurred_hero` (master contract §2.6).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurredHero {
    /// `data:image/png;base64,…` inline data URI — the small blurred bitmap.
    /// `null` only if encoding failed (should not happen in practice).
    pub data_uri: Option<String>,
    /// Absolute path to `blur-cache/<game_id>.png`.
    pub cache_path: String,
    /// Blurred bitmap width (px, post-downscale).
    pub width: u32,
    /// Blurred bitmap height (px, post-downscale).
    pub height: u32,
}

/// Derive the cache file path for a given game ID under `blur-cache/`.
pub fn cache_file_path(paths: &Paths, game_id: i64) -> AppResult<PathBuf> {
    let dir = paths.blur_cache_dir()?;
    Ok(dir.join(format!("{game_id}.png")))
}

/// Look up or generate the blurred hero for `game_id`.
///
/// - Cache hit (file exists and is non-empty): reads from disk — no recompute.
/// - Cache miss: loads `art_path`, runs the blur pipeline, writes the result,
///   then returns it.
///
/// Errors:
/// - `AppError::NotFound` — `art_path` does not exist on disk.
/// - `AppError::Io` — cache read/write failure.
/// - `AppError::Internal` — PNG decode/encode failure.
pub fn get_or_compute(paths: &Paths, game_id: i64, art_path: &str) -> AppResult<BlurredHero> {
    let cache_file = cache_file_path(paths, game_id)?;

    // Cache hit: return the existing file without re-blurring.
    if cache_file.exists() {
        let bytes = std::fs::read(&cache_file)?;
        if !bytes.is_empty() {
            return blurred_hero_from_bytes(bytes, &cache_file);
        }
    }

    // Cache miss: check the art file exists before attempting to load it.
    let art = std::path::Path::new(art_path);
    if !art.exists() {
        return Err(AppError::NotFound(format!(
            "cover art not found at path: {art_path}"
        )));
    }

    // Load, blur, and encode.
    let src_bytes = std::fs::read(art)?;
    let src_image = blur_pipeline::decode_image(&src_bytes)?;
    let blur_result = blur_pipeline::run(src_image)?;

    // Write cache file.
    std::fs::write(&cache_file, &blur_result.png_bytes)?;

    blurred_hero_from_bytes(blur_result.png_bytes, &cache_file)
}

/// Build a `BlurredHero` from already-encoded PNG bytes + the cache file path.
fn blurred_hero_from_bytes(bytes: Vec<u8>, cache_file: &std::path::Path) -> AppResult<BlurredHero> {
    // Decode to read dimensions.
    let img = image::load_from_memory(&bytes)
        .map_err(|e| AppError::Internal(format!("cache PNG decode error: {e}")))?;
    let width = img.width();
    let height = img.height();

    let data_uri = format!("data:image/png;base64,{}", BASE64.encode(&bytes));
    let cache_path = cache_file
        .to_str()
        .ok_or_else(|| AppError::Internal("cache path is not valid UTF-8".to_string()))?
        .to_string();

    Ok(BlurredHero {
        data_uri: Some(data_uri),
        cache_path,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, RgbaImage};

    /// Helper: write a tiny valid PNG to a temp path so the pipeline can load it.
    fn write_test_png(path: &std::path::Path) {
        let img = RgbaImage::from_pixel(4, 4, image::Rgba([255u8, 128, 0, 255]));
        DynamicImage::ImageRgba8(img)
            .save_with_format(path, image::ImageFormat::Png)
            .expect("write test PNG");
    }

    /// First call produces a cached file; second call reads from cache (no panic
    /// on recompute). Both return a valid BlurredHero.
    #[test]
    fn first_call_writes_cache_second_call_hits_cache() {
        let tmp = std::env::temp_dir()
            .join(format!("harmony-blur-cache-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        // Write a tiny source PNG.
        let art_path = tmp.join("cover.png");
        write_test_png(&art_path);

        let paths = Paths::with_root(tmp.join("com.harmony.app")).expect("paths");

        // First call: cache miss → compute and write.
        let hero1 = get_or_compute(&paths, 42, art_path.to_str().unwrap())
            .expect("first call should succeed");
        assert!(hero1.data_uri.is_some());
        assert!(hero1.width > 0);
        assert!(hero1.height > 0);

        let cache_file = cache_file_path(&paths, 42).unwrap();
        assert!(cache_file.exists(), "cache file should exist after first call");

        // Second call: cache hit → should return same dimensions.
        let hero2 = get_or_compute(&paths, 42, art_path.to_str().unwrap())
            .expect("second call should succeed");
        assert_eq!(hero1.width, hero2.width);
        assert_eq!(hero1.height, hero2.height);
        assert_eq!(hero1.cache_path, hero2.cache_path);

        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Returns `AppError::NotFound` when the art path does not exist on disk.
    #[test]
    fn missing_art_returns_not_found() {
        let tmp = std::env::temp_dir()
            .join(format!("harmony-blur-notfound-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let paths = Paths::with_root(tmp.join("com.harmony.app")).expect("paths");

        let result = get_or_compute(&paths, 99, "/nonexistent/path/cover.png");
        assert!(
            matches!(result, Err(AppError::NotFound(_))),
            "expected NotFound, got: {result:?}"
        );

        std::fs::remove_dir_all(&tmp).ok();
    }
}
