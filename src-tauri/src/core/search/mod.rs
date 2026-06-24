//! Search domain core (W9): provider model + template substitution.
//!
//! This module is intentionally side-effect-free so all logic is unit-testable
//! without a live database or Tauri runtime. Persistence is handled by
//! `db::repo::search_providers` (W3).

pub mod provider;
pub mod template;
