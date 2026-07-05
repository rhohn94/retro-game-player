//! SteamGridDB HTTP API client (v0.32 W321 — see
//! `docs/design/non-retro-library-design.md` §SteamGridDB art (W321)).
//!
//! Mirrors the shape of [`super::steam_cdn`] (the Steam public-CDN client):
//! this module owns only URL construction, the authenticated request, and
//! response parsing; [`super::steamgriddb_art::fetch_steamgriddb_art`] drives
//! the fetch/cache orchestration through [`super::art_cache::ArtCacheService`].
//!
//! Unlike the Steam CDN, SteamGridDB is a keyed, name-search API: a title
//! with no Steam appid (apps, manual entries, GOG, itch) is looked up by name
//! via `GET /api/v2/search/autocomplete/<term>`, and the best grid image for
//! the top match is fetched via `GET /api/v2/grids/game/<id>`. Every request
//! carries `Authorization: Bearer <api_key>`.
//!
//! The base URL is injectable (`SteamGridDbClient::new`) so tests can point
//! the client at a local fixture HTTP server (mirroring
//! `core::search::discovery`'s `discover(base_url)` pattern) rather than
//! calling the real API.

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::time::Duration;

/// Production SteamGridDB API base URL.
pub const STEAMGRIDDB_BASE_URL: &str = "https://www.steamgriddb.com/api/v2";

/// Timeout for a single SteamGridDB request — matches the Steam CDN client's
/// budget (`steam_cdn::REQUEST_TIMEOUT`), since both sit on the same
/// best-effort art-acquisition background thread.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// One autocomplete search hit.
#[derive(Debug, Clone, Deserialize)]
struct SearchResult {
    id: u64,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    success: bool,
    #[serde(default)]
    data: Vec<SearchResult>,
}

/// One grid-image result.
#[derive(Debug, Clone, Deserialize)]
struct GridResult {
    url: String,
}

#[derive(Debug, Deserialize)]
struct GridResponse {
    success: bool,
    #[serde(default)]
    data: Vec<GridResult>,
}

/// A resolved SteamGridDB image ready to download: the game id the search
/// matched (for logging) and the best grid image's CDN URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamGridDbMatch {
    pub game_id: u64,
    pub image_url: String,
}

/// Thin, stateless client over the SteamGridDB HTTP API. Holds only the API
/// key + base URL; every call is a fresh request (no persistent connection
/// pooling beyond what `reqwest::Client` itself does internally).
pub struct SteamGridDbClient {
    base_url: String,
    api_key: String,
}

impl SteamGridDbClient {
    /// Build a client against the real SteamGridDB API.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_base_url(STEAMGRIDDB_BASE_URL, api_key)
    }

    /// Build a client against an arbitrary base URL — the seam tests use to
    /// point at a local fixture server instead of the real API.
    pub fn with_base_url(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            api_key: api_key.into(),
        }
    }

    fn http_client(&self) -> AppResult<reqwest::blocking::Client> {
        reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| AppError::Network(format!("failed to build HTTP client: {e}")))
    }

    /// Search by title and return the best (first) match's grid-art URL, or
    /// `None` if the search returned no hits or the matched game has no grid
    /// art. A transport failure or non-2xx HTTP status surfaces as `Err` —
    /// callers (`steamgriddb_art::fetch_steamgriddb_art`) are responsible for
    /// swallowing that into graceful degradation, matching the Steam CDN
    /// client's `fetch_image` contract.
    pub fn find_best_grid_art(&self, title: &str) -> AppResult<Option<SteamGridDbMatch>> {
        let Some(game_id) = self.search_best_match(title)? else {
            return Ok(None);
        };
        let Some(image_url) = self.best_grid_url(game_id)? else {
            return Ok(None);
        };
        Ok(Some(SteamGridDbMatch { game_id, image_url }))
    }

    /// `GET /search/autocomplete/<term>` — returns the top hit's game id, or
    /// `None` on a zero-result search.
    fn search_best_match(&self, title: &str) -> AppResult<Option<u64>> {
        let url = format!(
            "{}/search/autocomplete/{}",
            self.base_url,
            urlencoding_encode(title)
        );
        let body: SearchResponse = self.get_json(&url)?;
        if !body.success {
            return Ok(None);
        }
        Ok(body.data.first().map(|r| r.id))
    }

    /// `GET /grids/game/<id>` — returns the first (highest-ranked, per the
    /// API's own default ordering) grid image's URL, or `None` if the game
    /// has no grid art on file.
    fn best_grid_url(&self, game_id: u64) -> AppResult<Option<String>> {
        let url = format!("{}/grids/game/{}", self.base_url, game_id);
        let body: GridResponse = self.get_json(&url)?;
        if !body.success {
            return Ok(None);
        }
        Ok(body.data.first().map(|r| r.url.clone()))
    }

    /// Issue an authenticated `GET` and deserialize the JSON body.
    fn get_json<T: for<'de> Deserialize<'de>>(&self, url: &str) -> AppResult<T> {
        let client = self.http_client()?;
        let resp = client
            .get(url)
            .bearer_auth(&self.api_key)
            .send()
            .map_err(|e| AppError::Network(format!("SteamGridDB request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Network(format!(
                "SteamGridDB returned HTTP {} for {}",
                resp.status(),
                url
            )));
        }

        resp.json::<T>()
            .map_err(|e| AppError::Network(format!("failed to parse SteamGridDB response: {e}")))
    }

    /// Download the raw bytes of a resolved grid-art image URL (the CDN URL
    /// `find_best_grid_art` returned — a separate, unauthenticated host from
    /// the API itself).
    pub fn download_image(&self, image_url: &str) -> AppResult<Vec<u8>> {
        let client = self.http_client()?;
        let resp = client
            .get(image_url)
            .send()
            .map_err(|e| AppError::Network(format!("SteamGridDB image request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Network(format!(
                "SteamGridDB image CDN returned HTTP {} for {}",
                resp.status(),
                image_url
            )));
        }

        resp.bytes().map(|b| b.to_vec()).map_err(|e| {
            AppError::Network(format!("failed to read SteamGridDB image body: {e}"))
        })
    }
}

/// Minimal percent-encoding for a search term in a URL path segment — no new
/// crate dependency for the handful of characters (spaces, `&`, `:`, ...)
/// that show up in game titles.
fn urlencoding_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration as StdDuration;

    /// Serves a tiny fixture SteamGridDB API: autocomplete + grids endpoints,
    /// scripted per-test via the `routes` closure. Mirrors
    /// `core::search::discovery::fixture_site`'s tiny_http pattern.
    fn fixture_server(
        routes: impl Fn(&str) -> (u16, String) + Send + 'static,
    ) -> (u16, std::thread::JoinHandle<()>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let handle = std::thread::spawn(move || {
            for _ in 0..8 {
                let Ok(request) = server.recv_timeout(StdDuration::from_secs(2)) else {
                    break;
                };
                let Some(request) = request else { break };
                let (status, body) = routes(request.url());
                let _ = request.respond(tiny_http::Response::from_string(body).with_status_code(status));
            }
        });
        (port, handle)
    }

    #[test]
    fn find_best_grid_art_resolves_search_then_grid() {
        let (port, _h) = fixture_server(|url| {
            if url.starts_with("/search/autocomplete/") {
                (200, r#"{"success":true,"data":[{"id":42}]}"#.to_string())
            } else if url == "/grids/game/42" {
                (
                    200,
                    r#"{"success":true,"data":[{"url":"https://cdn.example/42.png"}]}"#.to_string(),
                )
            } else {
                (404, "not found".to_string())
            }
        });
        let client = SteamGridDbClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "test-key",
        );

        let found = client.find_best_grid_art("Celeste").unwrap();
        assert_eq!(
            found,
            Some(SteamGridDbMatch {
                game_id: 42,
                image_url: "https://cdn.example/42.png".to_string(),
            })
        );
    }

    #[test]
    fn find_best_grid_art_returns_none_on_empty_search() {
        let (port, _h) = fixture_server(|_url| (200, r#"{"success":true,"data":[]}"#.to_string()));
        let client = SteamGridDbClient::with_base_url(format!("http://127.0.0.1:{port}"), "k");

        assert_eq!(client.find_best_grid_art("Unknown Game XYZ").unwrap(), None);
    }

    #[test]
    fn find_best_grid_art_returns_none_when_matched_game_has_no_grids() {
        let (port, _h) = fixture_server(|url| {
            if url.starts_with("/search/autocomplete/") {
                (200, r#"{"success":true,"data":[{"id":7}]}"#.to_string())
            } else {
                (200, r#"{"success":true,"data":[]}"#.to_string())
            }
        });
        let client = SteamGridDbClient::with_base_url(format!("http://127.0.0.1:{port}"), "k");

        assert_eq!(client.find_best_grid_art("No Art Game").unwrap(), None);
    }

    #[test]
    fn find_best_grid_art_surfaces_error_on_http_failure() {
        let (port, _h) = fixture_server(|_url| (401, "unauthorized".to_string()));
        let client = SteamGridDbClient::with_base_url(format!("http://127.0.0.1:{port}"), "bad-key");

        let err = client.find_best_grid_art("Anything").unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn find_best_grid_art_surfaces_error_on_malformed_json() {
        let (port, _h) = fixture_server(|_url| (200, "not json".to_string()));
        let client = SteamGridDbClient::with_base_url(format!("http://127.0.0.1:{port}"), "k");

        let err = client.find_best_grid_art("Anything").unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn download_image_returns_bytes_on_success() {
        let (port, _h) = fixture_server(|_url| (200, "IMAGE_BYTES".to_string()));
        let client = SteamGridDbClient::with_base_url(format!("http://127.0.0.1:{port}"), "k");

        let bytes = client
            .download_image(&format!("http://127.0.0.1:{port}/img.png"))
            .unwrap();
        assert_eq!(bytes, b"IMAGE_BYTES");
    }

    #[test]
    fn download_image_errors_on_http_failure() {
        let (port, _h) = fixture_server(|_url| (500, "boom".to_string()));
        let client = SteamGridDbClient::with_base_url(format!("http://127.0.0.1:{port}"), "k");

        let err = client
            .download_image(&format!("http://127.0.0.1:{port}/img.png"))
            .unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn urlencoding_encode_escapes_spaces_and_reserved_chars() {
        assert_eq!(urlencoding_encode("Half-Life 2"), "Half-Life%202");
        assert_eq!(urlencoding_encode("Portal: Still Alive"), "Portal%3A%20Still%20Alive");
        assert_eq!(urlencoding_encode("plain"), "plain");
    }
}
