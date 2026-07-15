//! Box art for Global Catalog titles (no `games` row).
//!
//! Stores PNGs under `art-cache/catalog/<system>/<sanitized>_boxart.png` and
//! fetches from the same libretro-thumbnails CDN as library art.

use super::cdn_client::{build_cdn_url, fetch_png, system_to_cdn_folder, ArtTier};
use super::name_sanitizer::sanitize;
use crate::config::paths::Paths;
use crate::error::AppResult;
use std::path::PathBuf;

fn catalog_file_path(paths: &Paths, system: &str, sanitized: &str) -> PathBuf {
    let base = paths.art_cache_dir().unwrap_or_else(|_| PathBuf::from("art-cache"));
    base.join("catalog")
        .join(system)
        .join(format!("{sanitized}_boxart.png"))
}

/// Return a cached path for `(system, clean_name)` if present on disk.
pub fn cached_title_boxart(paths: &Paths, system: &str, clean_name: &str) -> Option<String> {
    let path = catalog_file_path(paths, system, &sanitize(clean_name));
    if path.is_file() {
        Some(path.to_string_lossy().into_owned())
    } else {
        // Also try short name (pre-paren).
        let short = short_name(clean_name);
        if short != clean_name {
            let p2 = catalog_file_path(paths, system, &sanitize(&short));
            if p2.is_file() {
                return Some(p2.to_string_lossy().into_owned());
            }
        }
        None
    }
}

/// Fetch boxart for a title into the catalog art cache. Returns path or empty on miss.
pub async fn fetch_title_boxart(
    paths: &Paths,
    system: &str,
    clean_name: &str,
) -> AppResult<String> {
    if let Some(p) = cached_title_boxart(paths, system, clean_name) {
        return Ok(p);
    }
    let Some(cdn_folder) = system_to_cdn_folder(system) else {
        return Ok(String::new());
    };
    let full = sanitize(clean_name);
    let short = sanitize(&short_name(clean_name));
    for name in [full.as_str(), short.as_str()] {
        if name.is_empty() {
            continue;
        }
        let url = build_cdn_url(cdn_folder, ArtTier::Boxart, name);
        match fetch_png(&url).await {
            Ok(Some(bytes)) if !bytes.is_empty() => {
                let dest = catalog_file_path(paths, system, name);
                if let Some(parent) = dest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if std::fs::write(&dest, &bytes).is_ok() {
                    return Ok(dest.to_string_lossy().into_owned());
                }
            }
            _ => continue,
        }
    }
    Ok(String::new())
}

fn short_name(clean_name: &str) -> String {
    clean_name
        .split('(')
        .next()
        .unwrap_or(clean_name)
        .trim()
        .to_string()
}
