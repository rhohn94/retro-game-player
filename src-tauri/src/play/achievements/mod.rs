//! RetroAchievements native runtime (W370, v0.37 "Trophies"). Wraps the
//! vendored rcheevos C library (`vendor/rcheevos/`, see its README for the
//! exact upstream tag/subset) behind a safe surface: RA-correct ROM hashing
//! ([`hash`]), a per-frame trigger evaluator ([`host::AchievementRuntime`])
//! fed from `play::native::runtime::core_loop`, and a bounded unlock event
//! stream ([`events`]) the frontend drains. All `unsafe` FFI calls live in
//! [`ffi`] (raw bindings) and [`host`] (the only module that dereferences
//! them) — mirrors `play::native::host`'s same "one owner of unsafe per
//! vendored C surface" convention.
//!
//! See docs/design/retroachievements-design.md for the full design; this
//! release's non-goals (server submission, leaderboards, hardcore mode,
//! systems beyond NES/SNES) are listed there, not repeated here.

mod definitions;
mod events;
mod ffi;
mod hash;
mod host;

pub use definitions::{AchievementDefinition, AchievementSet};
pub use events::UnlockEvent;
pub use hash::{hash_rom, AchievementSystem};
pub use host::AchievementRuntime;
