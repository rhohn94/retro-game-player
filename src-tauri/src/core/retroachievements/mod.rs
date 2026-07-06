//! RetroAchievements domain (v0.37 W371, retroachievements-design.md §Client
//! + accounts).
//!
//! Optional account: a username + Web API key unlock per-game
//! achievement-set fetches for the native rcheevos runtime (W370). Absent a
//! credential, the whole feature stays inert — no network calls are ever
//! made (`core::retroachievements::client::RetroAchievementsClient` is only
//! constructed when a credential exists; see
//! `commands::retroachievements::validate_retroachievements_account`).
//!
//! Split one-file-per-concern, mirroring `core::familiar`:
//!   - [`client`]  — the HTTP client (`SteamGridDbClient` shape: reqwest,
//!     10s timeout, test-injectable base URL).
//!   - [`achievement_set`] — the shared, unit-tested serde shape for a
//!     fetched achievement set (definitions + badge names) — the JSON
//!     contract W370's native runtime consumes as trigger-definition input.
//!   - [`cache`] — bounded on-disk JSON cache of fetched sets, keyed by RA
//!     ROM hash.
//!
//! Credential storage reuses `core::familiar::keychain`'s `KeyStore` trait
//! and `KeychainStore::for_account` (a new Keychain account under the same
//! shared service — Familiar precedent, W269B service naming).

pub mod achievement_set;
pub mod cache;
pub mod client;

/// Production RetroAchievements Web API base URL.
pub const RETROACHIEVEMENTS_BASE_URL: &str = "https://retroachievements.org/API";

/// Keychain account name for the RetroAchievements Web API key (mirrors
/// `core::familiar::keychain::FAMILIAR_KEY_ACCOUNT`).
pub const RA_KEY_ACCOUNT: &str = "retroachievements-web-api-key";
