//! libretro buildbot client (W5). Builds the canonical download URL for an
//! Apple-Silicon core archive and performs the network fetch / freshness check.
//!
//! URL building ([`archive_url`], [`dylib_archive_name`], [`dylib_file_name`])
//! is pure and unit-tested; only [`download_archive`] and [`last_modified`]
//! touch the network. The base URL is a named constant — no magic strings.

use crate::error::{AppError, AppResult};

/// Buildbot nightly Apple-Silicon (arm64) core directory. The latest build of
/// `<core>_libretro.dylib.zip` lives directly beneath this prefix.
pub const BUILDBOT_ARM64_BASE: &str =
    "https://buildbot.libretro.com/nightly/apple/osx/arm64/latest";

/// The `_libretro` filename suffix every buildbot core shares.
const LIBRETRO_SUFFIX: &str = "_libretro";
/// The installed/extracted dynamic-library extension on macOS.
const DYLIB_EXT: &str = "dylib";
/// The buildbot archive extension.
const ZIP_EXT: &str = "zip";

/// The on-disk dylib filename for a core id, e.g. `mesen` → `mesen_libretro.dylib`.
pub fn dylib_file_name(core_id: &str) -> String {
    format!("{core_id}{LIBRETRO_SUFFIX}.{DYLIB_EXT}")
}

/// The buildbot archive filename for a core id, e.g.
/// `mesen` → `mesen_libretro.dylib.zip`.
pub fn dylib_archive_name(core_id: &str) -> String {
    format!("{}.{ZIP_EXT}", dylib_file_name(core_id))
}

/// The full buildbot download URL for a core id.
pub fn archive_url(core_id: &str) -> String {
    format!("{BUILDBOT_ARM64_BASE}/{}", dylib_archive_name(core_id))
}

/// Download the core archive bytes from the buildbot. Blocking; callers run it
/// off the UI thread. Network/HTTP failures map to [`AppError::Network`].
pub fn download_archive(core_id: &str) -> AppResult<Vec<u8>> {
    let url = archive_url(core_id);
    let resp = blocking_get(&url)?;
    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "buildbot returned {} for {url}",
            resp.status()
        )));
    }
    let bytes = resp
        .bytes()
        .map_err(|e| AppError::Network(format!("reading {url}: {e}")))?;
    Ok(bytes.to_vec())
}

/// The buildbot `Last-Modified` header for a core archive (epoch-seconds), used
/// to decide whether an update is available. `None` when the header is absent or
/// unparesable; network failure maps to [`AppError::Network`].
pub fn last_modified(core_id: &str) -> AppResult<Option<i64>> {
    let url = archive_url(core_id);
    let resp = blocking_get(&url)?;
    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "buildbot returned {} for {url}",
            resp.status()
        )));
    }
    Ok(resp
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_http_date_epoch))
}

/// Issue a blocking GET, mapping transport errors to [`AppError::Network`].
fn blocking_get(url: &str) -> AppResult<reqwest::blocking::Response> {
    reqwest::blocking::get(url).map_err(|e| AppError::Network(format!("GET {url}: {e}")))
}

/// Parse an RFC-1123 HTTP-date (`Wed, 21 Oct 2015 07:28:00 GMT`) into
/// epoch-seconds. Returns `None` for any unrecognized format. Kept dependency-
/// free (no chrono) by parsing the fixed-width fields directly.
fn parse_http_date_epoch(s: &str) -> Option<i64> {
    // Strip the optional leading weekday + comma, e.g. "Wed, ".
    let s = s.trim();
    let rest = s.split_once(", ").map(|(_, r)| r).unwrap_or(s);
    let mut it = rest.split_whitespace();
    let day: i64 = it.next()?.parse().ok()?;
    let month = month_index(it.next()?)?;
    let year: i64 = it.next()?.parse().ok()?;
    let time = it.next()?;
    let mut tp = time.split(':');
    let hour: i64 = tp.next()?.parse().ok()?;
    let min: i64 = tp.next()?.parse().ok()?;
    let sec: i64 = tp.next()?.parse().ok()?;
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + min * 60 + sec)
}

/// 1-based month index for a three-letter English month abbreviation.
fn month_index(m: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    MONTHS.iter().position(|x| *x == m).map(|i| i as i64 + 1)
}

/// Days since the Unix epoch (1970-01-01) for a proleptic-Gregorian Y/M/D.
/// Howard Hinnant's `days_from_civil` algorithm — no external date crate.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dylib_and_archive_names() {
        assert_eq!(dylib_file_name("mesen"), "mesen_libretro.dylib");
        assert_eq!(dylib_archive_name("mesen"), "mesen_libretro.dylib.zip");
        assert_eq!(
            dylib_archive_name("mupen64plus_next"),
            "mupen64plus_next_libretro.dylib.zip"
        );
    }

    #[test]
    fn archive_url_targets_the_arm64_buildbot() {
        assert_eq!(
            archive_url("snes9x"),
            "https://buildbot.libretro.com/nightly/apple/osx/arm64/latest/snes9x_libretro.dylib.zip"
        );
        assert!(archive_url("bsnes").starts_with(BUILDBOT_ARM64_BASE));
    }

    #[test]
    fn parses_rfc1123_http_date() {
        // 2015-10-21T07:28:00Z is a well-known epoch value: 1445412480.
        assert_eq!(
            parse_http_date_epoch("Wed, 21 Oct 2015 07:28:00 GMT"),
            Some(1_445_412_480)
        );
    }

    #[test]
    fn parses_epoch_zero() {
        assert_eq!(
            parse_http_date_epoch("Thu, 01 Jan 1970 00:00:00 GMT"),
            Some(0)
        );
    }

    #[test]
    fn rejects_garbage_dates() {
        assert_eq!(parse_http_date_epoch("not a date"), None);
        assert_eq!(parse_http_date_epoch(""), None);
        assert_eq!(parse_http_date_epoch("Wed, 21 Zzz 2015 07:28:00 GMT"), None);
    }
}
