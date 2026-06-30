//! Search domain core (W9, v0.16): provider model + template substitution +
//! result-preview fetch.
//!
//! `provider` and `template` are side-effect-free and unit-testable without a
//! live database or Tauri runtime. `fetch` (v0.16) adds the one I/O step — it
//! retrieves a provider's public search-results page and scrapes the candidate
//! links so the UI can preview them; its parsing core (`extract_links`) is pure
//! and tested without a network. Persistence is handled by
//! `db::repo::search_providers` (W3).
//!
//! `liveness` (v0.19) adds an optional, opt-in `HEAD`-only probe that classifies
//! a previewed link as alive / dead / unknown — a probe, not a download.
//!
//! `catalog` (v0.20) is a curated directory of legitimate providers the user can
//! discover and add in one click.

pub mod catalog;
pub mod fetch;
pub mod liveness;
pub mod provider;
pub mod template;
