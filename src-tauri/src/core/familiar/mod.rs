//! Familiar enrichment domain (W12). The Familiar is an OPTIONAL, AI-backed
//! companion service that disambiguates fuzzy ROM titles / ambiguous dumps. It is
//! a **soft dependency**: when it is absent, unauthorized, rate-limited, or slow,
//! Harmony must degrade silently so the AI affordances are simply hidden and
//! every other feature keeps working (architecture-design.md §2.8).
//!
//! This module is split one-file-per-concern:
//!   - [`transport`] — the `HttpTransport` trait abstracting the HTTP call so the
//!     probe state machine is unit-testable without a live server.
//!   - [`probe`]     — the two-stage presence/authorization state machine.
//!   - [`keychain`]  — the macOS Keychain-backed Bearer-key store (never on disk).
//!   - [`cache`]     — an in-memory enrichment-result cache keyed by game id.
//!   - [`client`]    — the high-level `FamiliarClient` the command adapter calls.
//!
//! No magic numbers: every URL path, header name, timeout, and status code lives
//! in the constants block below.

pub mod cache;
pub mod client;
pub mod keychain;
pub mod probe;
pub mod transport;

use std::time::Duration;

/// `GET /healthz` — stage-1 presence probe path.
pub const HEALTHZ_PATH: &str = "/healthz";
/// `GET /integration/v1/capabilities` — stage-2 Bearer-key validation path.
pub const CAPABILITIES_PATH: &str = "/integration/v1/capabilities";
/// `POST /integration/v1/jobs` — enrichment job submission path.
pub const JOBS_PATH: &str = "/integration/v1/jobs";

/// Consumer-identity header every Familiar request carries.
pub const CONSUMER_ID_HEADER: &str = "X-Consumer-Id";
/// Harmony's consumer id value for [`CONSUMER_ID_HEADER`].
pub const CONSUMER_ID_VALUE: &str = "harmony";

/// HTTP 200 — success.
pub const STATUS_OK: u16 = 200;
/// HTTP 401 — unauthorized (bad/absent key) → treat as Familiar absent.
pub const STATUS_UNAUTHORIZED: u16 = 401;
/// HTTP 429 — rate limited → treat as Familiar absent.
pub const STATUS_TOO_MANY_REQUESTS: u16 = 429;

/// Per-request timeout. Timeouts count as "Familiar absent" (silent degrade).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
