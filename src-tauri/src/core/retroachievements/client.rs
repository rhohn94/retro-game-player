//! RetroAchievements Web API client (v0.37 W371,
//! retroachievements-design.md §Client + accounts).
//!
//! Mirrors the shape of [`crate::core::metadata::steamgriddb_client::SteamGridDbClient`]:
//! this module owns only URL construction, the authenticated request, and
//! response parsing over `reqwest::blocking`, with a 10s timeout and a
//! test-injectable base URL (production defaults to
//! [`super::RETROACHIEVEMENTS_BASE_URL`]) so tests point the client at a
//! local fixture HTTP server instead of the real API.
//!
//! RA's public Web API authenticates every request with the account's
//! username + Web API key as query params — `z=<user>&y=<key>` — appended
//! to every endpoint this client calls. Two endpoints are used, both
//! documented public RA Web API surface:
//!   - `API_GetUserSummary.php` — credential validation (login check): a
//!     valid `z`/`y` pair returns the user's own summary; an invalid key
//!     returns an `Error` field (RA's convention for a rejected key) rather
//!     than an HTTP error status.
//!   - `API_GetGameID.php` (hash → RA game id) then
//!     `API_GetGameInfoAndUserProgress.php` (game id → achievement
//!     definitions + badge names) — the two-step "hash → game id →
//!     achievement definitions" fetch the design doc specifies.
//!
//! No other endpoints are called — this client does not submit unlocks,
//! fetch leaderboards, or anything beyond validation + set-fetch (explicit
//! v0.37 non-goal).

use super::achievement_set::{AchievementDefinition, AchievementSet};
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::time::Duration;

/// Timeout for a single RetroAchievements request — matches
/// `SteamGridDbClient::REQUEST_TIMEOUT`'s 10s budget.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// `API_GetUserSummary.php` — used only as the credential-validation probe;
/// only the `Error` field (if present) is inspected.
const USER_SUMMARY_PATH: &str = "API_GetUserSummary.php";
/// `API_GetGameID.php` — resolves an RA ROM hash to RA's internal game id.
const GAME_ID_PATH: &str = "API_GetGameID.php";
/// `API_GetGameInfoAndUserProgress.php` — fetches achievement definitions +
/// badge names for a resolved game id.
const GAME_INFO_PATH: &str = "API_GetGameInfoAndUserProgress.php";

/// `API_GetUserSummary.php` response — RA returns `200 OK` with an `Error`
/// field for a rejected key rather than a non-2xx status, so validation
/// must inspect the body, not just the HTTP status.
#[derive(Debug, Deserialize)]
struct UserSummaryResponse {
    #[serde(default)]
    #[serde(rename = "Error")]
    error: Option<String>,
}

/// `API_GetGameID.php` response — `0` means the hash matched no known game.
#[derive(Debug, Deserialize)]
struct GameIdResponse {
    #[serde(default)]
    #[serde(rename = "Error")]
    error: Option<String>,
    #[serde(rename = "GameID")]
    #[serde(default)]
    game_id: u64,
}

/// One achievement entry inside `API_GetGameInfoAndUserProgress.php`'s
/// `Achievements` map.
#[derive(Debug, Deserialize)]
struct RawAchievement {
    #[serde(rename = "ID")]
    id: u64,
    #[serde(rename = "Title")]
    title: String,
    #[serde(rename = "Description")]
    #[serde(default)]
    description: String,
    #[serde(rename = "Points")]
    #[serde(default)]
    points: u32,
    #[serde(rename = "MemAddr")]
    #[serde(default)]
    mem_addr: String,
    #[serde(rename = "BadgeName")]
    #[serde(default)]
    badge_name: Option<String>,
}

/// `API_GetGameInfoAndUserProgress.php` response — only the fields this
/// client consumes are modeled; RA's real payload has many more (user
/// progress counters, box art urls, …) that are out of scope for v0.37.
#[derive(Debug, Deserialize)]
struct GameInfoResponse {
    #[serde(default)]
    #[serde(rename = "Error")]
    error: Option<String>,
    #[serde(rename = "ID")]
    #[serde(default)]
    id: u64,
    #[serde(rename = "Title")]
    #[serde(default)]
    title: String,
    #[serde(rename = "Achievements")]
    #[serde(default)]
    achievements: std::collections::HashMap<String, RawAchievement>,
}

/// Credential validation outcome: `Ok` when the username + key pair is
/// accepted, `Err` describing why otherwise (bad key, transport failure).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RaLoginResult {
    /// True when RA accepted the credential.
    pub valid: bool,
    /// RA's own error message when `valid` is false and RA supplied one
    /// (e.g. "Invalid API Key"); `None` for a successful validation.
    pub message: Option<String>,
}

/// Thin, stateless client over the RetroAchievements public Web API. Holds
/// only the username + Web API key + base URL; every call is a fresh
/// request (matching `SteamGridDbClient`'s no-connection-pooling-beyond-
/// reqwest-defaults contract).
pub struct RetroAchievementsClient {
    base_url: String,
    username: String,
    api_key: String,
}

impl RetroAchievementsClient {
    /// Build a client against the real RetroAchievements API.
    pub fn new(username: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self::with_base_url(super::RETROACHIEVEMENTS_BASE_URL, username, api_key)
    }

    /// Build a client against an arbitrary base URL — the seam tests use to
    /// point at a local fixture server instead of the real API.
    pub fn with_base_url(
        base_url: impl Into<String>,
        username: impl Into<String>,
        api_key: impl Into<String>,
    ) -> Self {
        Self {
            base_url: base_url.into(),
            username: username.into(),
            api_key: api_key.into(),
        }
    }

    fn http_client(&self) -> AppResult<reqwest::blocking::Client> {
        reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| AppError::Network(format!("failed to build HTTP client: {e}")))
    }

    /// Build the shared `z=<user>&y=<key>` auth query-string prefix every
    /// endpoint appends its own params to.
    fn auth_query(&self) -> String {
        format!(
            "z={}&y={}",
            urlencoding_encode(&self.username),
            urlencoding_encode(&self.api_key)
        )
    }

    /// Validate the configured username + API key against RA's
    /// `API_GetUserSummary.php`. Never panics on a bad key or a network
    /// failure that returns a body — those come back as `valid: false`
    /// rather than an `Err`; only a transport-level failure (connection
    /// refused, timeout, malformed JSON) surfaces as `Err`, matching
    /// v0.36's error-telemetry conventions (callers route it through
    /// `swallow`/frontend telemetry — no silent drops, no panics).
    pub fn validate_credential(&self) -> AppResult<RaLoginResult> {
        let url = format!(
            "{}/{}?{}&u={}",
            self.base_url,
            USER_SUMMARY_PATH,
            self.auth_query(),
            urlencoding_encode(&self.username)
        );
        let body: UserSummaryResponse = self.get_json(&url)?;
        match body.error {
            Some(message) => Ok(RaLoginResult {
                valid: false,
                message: Some(message),
            }),
            None => Ok(RaLoginResult {
                valid: true,
                message: None,
            }),
        }
    }

    /// Fetch the achievement set for a game identified by its RA-correct ROM
    /// hash (W370's `rc_hash` output — never `core::library::hasher.rs`'s
    /// hash). Resolves hash → RA game id, then fetches that game's
    /// achievement definitions + badge names. Returns `Ok(None)` when the
    /// hash matches no known RA game (not an error — most homebrew/hacks
    /// have no RA set); a transport or parse failure surfaces as `Err`.
    pub fn fetch_achievement_set(&self, hash: &str) -> AppResult<Option<AchievementSet>> {
        let Some(game_id) = self.resolve_game_id(hash)? else {
            return Ok(None);
        };
        self.fetch_achievement_set_by_game_id(game_id)
    }

    /// `API_GetGameID.php?m=<hash>` — resolves an RA ROM hash to RA's
    /// internal game id, or `None` if the hash is unrecognized.
    fn resolve_game_id(&self, hash: &str) -> AppResult<Option<u64>> {
        let url = format!(
            "{}/{}?{}&m={}",
            self.base_url,
            GAME_ID_PATH,
            self.auth_query(),
            urlencoding_encode(hash)
        );
        let body: GameIdResponse = self.get_json(&url)?;
        if body.error.is_some() || body.game_id == 0 {
            return Ok(None);
        }
        Ok(Some(body.game_id))
    }

    /// `API_GetGameInfoAndUserProgress.php?g=<game_id>` — fetches
    /// achievement definitions + badge names for a resolved game id.
    fn fetch_achievement_set_by_game_id(&self, game_id: u64) -> AppResult<Option<AchievementSet>> {
        let url = format!(
            "{}/{}?{}&u={}&g={}",
            self.base_url,
            GAME_INFO_PATH,
            self.auth_query(),
            urlencoding_encode(&self.username),
            game_id
        );
        let body: GameInfoResponse = self.get_json(&url)?;
        if body.error.is_some() {
            return Ok(None);
        }

        let mut achievements: Vec<AchievementDefinition> = body
            .achievements
            .into_values()
            .map(|raw| AchievementDefinition {
                id: raw.id,
                title: raw.title,
                description: raw.description,
                points: raw.points,
                trigger: raw.mem_addr,
                badge_name: raw.badge_name,
            })
            .collect();
        // RA's `Achievements` map has no guaranteed key order — sort by id
        // so the returned set (and its cache/JSON round-trip) is
        // deterministic across fetches and across test runs.
        achievements.sort_by_key(|a| a.id);

        Ok(Some(AchievementSet {
            game_id: body.id,
            title: body.title,
            achievements,
        }))
    }

    /// Issue a `GET` and deserialize the JSON body. Mirrors
    /// `SteamGridDbClient::get_json` exactly (no bearer header here — RA's
    /// auth is query-string based, already baked into `url`).
    fn get_json<T: for<'de> Deserialize<'de>>(&self, url: &str) -> AppResult<T> {
        let client = self.http_client()?;
        let resp = client.get(url).send().map_err(|e| {
            AppError::Network(format!("RetroAchievements request failed: {e}"))
        })?;

        if !resp.status().is_success() {
            return Err(AppError::Network(format!(
                "RetroAchievements returned HTTP {} for {}",
                resp.status(),
                url
            )));
        }

        resp.json::<T>().map_err(|e| {
            AppError::Network(format!("failed to parse RetroAchievements response: {e}"))
        })
    }
}

/// Minimal percent-encoding for a query-string value — mirrors
/// `steamgriddb_client::urlencoding_encode` exactly (no new crate dependency
/// for the handful of characters that show up in usernames/keys/hashes).
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

    /// Serves a tiny fixture RetroAchievements API, scripted per-test via the
    /// `routes` closure keyed on the request's raw URL (path + query).
    /// Mirrors `steamgriddb_client::tests::fixture_server`'s tiny_http
    /// pattern (also used by `core::search::discovery`).
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
                let _ = request.respond(
                    tiny_http::Response::from_string(body).with_status_code(status),
                );
            }
        });
        (port, handle)
    }

    #[test]
    fn validate_credential_returns_valid_on_login_ok() {
        let (port, _h) = fixture_server(|url| {
            assert!(url.starts_with("/API_GetUserSummary.php?"));
            assert!(url.contains("z=good-user"));
            assert!(url.contains("y=good-key"));
            (200, r#"{"User":"good-user","Rank":100}"#.to_string())
        });
        let client = RetroAchievementsClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "good-user",
            "good-key",
        );

        let result = client.validate_credential().unwrap();
        assert_eq!(
            result,
            RaLoginResult {
                valid: true,
                message: None,
            }
        );
    }

    #[test]
    fn validate_credential_returns_invalid_on_bad_key() {
        let (port, _h) = fixture_server(|_url| {
            (200, r#"{"Error":"Invalid API Key"}"#.to_string())
        });
        let client = RetroAchievementsClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "user",
            "bad-key",
        );

        let result = client.validate_credential().unwrap();
        assert_eq!(
            result,
            RaLoginResult {
                valid: false,
                message: Some("Invalid API Key".to_string()),
            }
        );
    }

    #[test]
    fn fetch_achievement_set_resolves_hash_then_game_info() {
        let (port, _h) = fixture_server(|url| {
            if url.starts_with("/API_GetGameID.php") {
                assert!(url.contains("m=abc123"));
                (200, r#"{"GameID":42}"#.to_string())
            } else if url.starts_with("/API_GetGameInfoAndUserProgress.php") {
                assert!(url.contains("g=42"));
                (
                    200,
                    r#"{
                        "ID": 42,
                        "Title": "Test Game",
                        "Achievements": {
                            "2": {"ID":2,"Title":"Second","Description":"d2","Points":5,"MemAddr":"0xH0002=1","BadgeName":"222"},
                            "1": {"ID":1,"Title":"First","Description":"d1","Points":10,"MemAddr":"0xH0001=1","BadgeName":"111"}
                        }
                    }"#
                    .to_string(),
                )
            } else {
                (404, "not found".to_string())
            }
        });
        let client = RetroAchievementsClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "user",
            "key",
        );

        let set = client.fetch_achievement_set("abc123").unwrap().unwrap();
        assert_eq!(set.game_id, 42);
        assert_eq!(set.title, "Test Game");
        assert_eq!(set.achievements.len(), 2);
        // Deterministic id-sorted order regardless of the map's own order.
        assert_eq!(set.achievements[0].id, 1);
        assert_eq!(set.achievements[0].trigger, "0xH0001=1");
        assert_eq!(set.achievements[0].badge_name.as_deref(), Some("111"));
        assert_eq!(set.achievements[1].id, 2);
    }

    #[test]
    fn fetch_achievement_set_returns_none_for_unrecognized_hash() {
        let (port, _h) = fixture_server(|url| {
            if url.starts_with("/API_GetGameID.php") {
                (200, r#"{"GameID":0}"#.to_string())
            } else {
                (404, "should not be called".to_string())
            }
        });
        let client = RetroAchievementsClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "user",
            "key",
        );

        assert_eq!(client.fetch_achievement_set("unknown-hash").unwrap(), None);
    }

    #[test]
    fn fetch_achievement_set_surfaces_network_failure_gracefully() {
        // No server listening at all on this port — a connection failure,
        // not a panic, and not a silently-swallowed `Ok`.
        let client = RetroAchievementsClient::with_base_url(
            "http://127.0.0.1:1", // reserved/unassigned port — connection refused
            "user",
            "key",
        );

        let err = client.fetch_achievement_set("abc123").unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn validate_credential_surfaces_network_failure_gracefully() {
        let client = RetroAchievementsClient::with_base_url("http://127.0.0.1:1", "user", "key");

        let err = client.validate_credential().unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn validate_credential_surfaces_http_failure() {
        let (port, _h) = fixture_server(|_url| (500, "boom".to_string()));
        let client = RetroAchievementsClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "user",
            "key",
        );

        let err = client.validate_credential().unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn validate_credential_surfaces_malformed_json() {
        let (port, _h) = fixture_server(|_url| (200, "not json".to_string()));
        let client = RetroAchievementsClient::with_base_url(
            format!("http://127.0.0.1:{port}"),
            "user",
            "key",
        );

        let err = client.validate_credential().unwrap_err();
        assert!(matches!(err, AppError::Network(_)));
    }

    #[test]
    fn urlencoding_encode_escapes_reserved_characters() {
        assert_eq!(urlencoding_encode("plain"), "plain");
        assert_eq!(urlencoding_encode("a b&c"), "a%20b%26c");
    }
}
