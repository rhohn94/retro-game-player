//! `.app` bundle icon extraction (v0.31 W314 — see
//! `docs/design/non-retro-library-design.md` §Art & metadata).
//!
//! Non-Steam sources (`app` / `manual` rows backed by an app bundle) have no
//! CDN art; the fallback is the bundle's own `.icns` icon, converted to a
//! PNG and cached through the same [`super::art_cache::ArtCacheService`]
//! machinery. Resolution:
//!   1. Read `Contents/Info.plist`'s `CFBundleIconFile` to find the `.icns`
//!      file (falls back to `AppIcon.icns` if the key is absent, the common
//!      Xcode-template default).
//!   2. Locate the icon under `Contents/Resources/`.
//!   3. Shell out to `sips -s format png <icns> --out <png>` (the `sips -s
//!      format png` acceptance-criteria approach — no `iconutil` roundtrip is
//!      needed since `sips` converts `.icns` directly).
//!
//! Any failure (bundle missing, no icon key, `sips` absent/erroring) is not
//! propagated as an error — it degrades to `Ok(None)` so the caller falls
//! back to the placeholder art path, mirroring the CDN fetch's
//! graceful-degradation contract.

use super::art_cache::ArtCacheService;
use crate::config::paths::Paths;
use crate::db::Db;
use crate::error::AppResult;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Namespace under `art-cache/` used for bundle-icon art.
pub const BUNDLE_ICON_NAMESPACE: &str = "app";

/// `art_cache.tier` key used for a bundle-icon render — there is only one
/// resolution tier (unlike the ROM boxart/title/snap ladder), so it's always
/// filed as the top display-priority tier.
const BUNDLE_ICON_TIER: &str = "boxart";

/// File extension bundle icons are cached as (post-`sips` conversion).
const BUNDLE_ICON_EXTENSION: &str = "png";

/// The `Info.plist` field this module reads.
#[derive(Debug, Deserialize)]
struct IconInfoPlist {
    #[serde(rename = "CFBundleIconFile")]
    icon_file: Option<String>,
}

/// The Xcode-template default icon filename, used when `CFBundleIconFile`
/// is absent from `Info.plist`.
const DEFAULT_ICON_FILENAME: &str = "AppIcon.icns";

/// Resolve the on-disk `.icns` path for `bundle_path` (a `/path/to/App.app`
/// directory), or `None` if it can't be determined (missing plist, missing
/// icon file on disk).
fn resolve_icns_path(bundle_path: &Path) -> Option<PathBuf> {
    let plist_path = bundle_path.join("Contents/Info.plist");
    let icon_filename = plist::from_file::<_, IconInfoPlist>(&plist_path)
        .ok()
        .and_then(|p| p.icon_file)
        .unwrap_or_else(|| DEFAULT_ICON_FILENAME.to_string());

    // CFBundleIconFile may or may not carry the .icns extension.
    let icon_filename = if icon_filename.ends_with(".icns") {
        icon_filename
    } else {
        format!("{icon_filename}.icns")
    };

    let icns_path = bundle_path.join("Contents/Resources").join(icon_filename);
    if icns_path.is_file() {
        Some(icns_path)
    } else {
        None
    }
}

/// Convert `icns_path` to a PNG at `png_out_path` via `sips`. Returns `true`
/// on success (exit status 0 and the output file exists), `false` for any
/// failure — including `sips` being unavailable, which must not be treated
/// as an error (degrade to placeholder).
fn convert_icns_to_png(icns_path: &Path, png_out_path: &Path) -> bool {
    let status = std::process::Command::new("sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(icns_path)
        .arg("--out")
        .arg(png_out_path)
        .output();

    match status {
        Ok(output) => output.status.success() && png_out_path.is_file(),
        Err(_) => false,
    }
}

/// Render `bundle_path`'s icon to a cached PNG and persist it as `game_id`'s
/// art via [`ArtCacheService`]. Returns the on-disk path on success, or
/// `None` for any failure (missing bundle/icon, conversion failure) — the
/// caller then falls back to the existing placeholder art path.
pub fn fetch_bundle_icon_art(
    db: &Db,
    paths: &Paths,
    game_id: i64,
    bundle_path: &str,
    sanitized_name: &str,
) -> AppResult<Option<String>> {
    let bundle = Path::new(bundle_path);
    let Some(icns_path) = resolve_icns_path(bundle) else {
        return Ok(None);
    };

    let art_dir = paths.art_cache_dir()?.join(BUNDLE_ICON_NAMESPACE);
    std::fs::create_dir_all(&art_dir)?;
    let tmp_png = art_dir.join(format!(
        "{}_{}.{}.tmp",
        sanitized_name, BUNDLE_ICON_TIER, BUNDLE_ICON_EXTENSION
    ));

    if !convert_icns_to_png(&icns_path, &tmp_png) {
        let _ = std::fs::remove_file(&tmp_png);
        return Ok(None);
    }

    let bytes = match std::fs::read(&tmp_png) {
        Ok(b) => b,
        Err(_) => {
            let _ = std::fs::remove_file(&tmp_png);
            return Ok(None);
        }
    };
    let _ = std::fs::remove_file(&tmp_png);

    let svc = ArtCacheService::new(db, paths);
    let path = svc.store_with_extension(
        game_id,
        BUNDLE_ICON_NAMESPACE,
        sanitized_name,
        BUNDLE_ICON_TIER,
        &bytes,
        BUNDLE_ICON_EXTENSION,
    )?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_plist(bundle: &Path, icon_file: Option<&str>) {
        let contents_dir = bundle.join("Contents");
        fs::create_dir_all(&contents_dir).unwrap();
        let body = match icon_file {
            Some(name) => format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
                 <plist version=\"1.0\"><dict>\n\
                 <key>CFBundleIconFile</key><string>{name}</string>\n\
                 </dict></plist>"
            ),
            None => "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
                 <plist version=\"1.0\"><dict></dict></plist>"
                .to_string(),
        };
        fs::write(contents_dir.join("Info.plist"), body).unwrap();
    }

    fn write_icon(bundle: &Path, filename: &str) {
        let res_dir = bundle.join("Contents/Resources");
        fs::create_dir_all(&res_dir).unwrap();
        fs::write(res_dir.join(filename), b"FAKE_ICNS_BYTES").unwrap();
    }

    #[test]
    fn resolves_icon_file_named_by_plist() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Some.app");
        write_plist(&bundle, Some("CustomIcon"));
        write_icon(&bundle, "CustomIcon.icns");

        let resolved = resolve_icns_path(&bundle).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "CustomIcon.icns");
    }

    #[test]
    fn resolves_icon_file_with_extension_already_present() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Some.app");
        write_plist(&bundle, Some("CustomIcon.icns"));
        write_icon(&bundle, "CustomIcon.icns");

        let resolved = resolve_icns_path(&bundle).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "CustomIcon.icns");
    }

    #[test]
    fn falls_back_to_default_icon_filename_when_plist_key_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Some.app");
        write_plist(&bundle, None);
        write_icon(&bundle, "AppIcon.icns");

        let resolved = resolve_icns_path(&bundle).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "AppIcon.icns");
    }

    #[test]
    fn returns_none_when_icon_file_missing_on_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Some.app");
        write_plist(&bundle, Some("Missing"));
        // Note: no write_icon call — the referenced icon does not exist.

        assert!(resolve_icns_path(&bundle).is_none());
    }

    #[test]
    fn returns_none_when_bundle_has_no_info_plist() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("NoPlist.app");
        fs::create_dir_all(&bundle).unwrap();

        assert!(resolve_icns_path(&bundle).is_none());
    }

    /// `fetch_bundle_icon_art` degrades to `Ok(None)` (never an error) for a
    /// bundle with no resolvable icon — the acceptance-criteria contract
    /// ("otherwise the existing placeholder art path applies").
    #[test]
    fn fetch_bundle_icon_art_degrades_to_none_for_unresolvable_bundle() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();

        let bundle = tmp.path().join("NoIcon.app");
        fs::create_dir_all(&bundle).unwrap();

        let result = fetch_bundle_icon_art(&db, &paths, 1, bundle.to_str().unwrap(), "NoIcon");
        assert_eq!(result.unwrap(), None);
    }

    /// `sips` cannot convert our fixture (arbitrary bytes, not a real
    /// `.icns`), so `convert_icns_to_png` must return `false` — the seam
    /// this test exercises directly rather than depending on network/OS
    /// binary specifics inside `fetch_bundle_icon_art`.
    #[test]
    fn convert_icns_to_png_returns_false_for_invalid_icns_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Some.app");
        write_icon(&bundle, "AppIcon.icns");
        let icns_path = bundle.join("Contents/Resources/AppIcon.icns");
        let out_path = tmp.path().join("out.png");

        assert!(!convert_icns_to_png(&icns_path, &out_path));
    }
}
