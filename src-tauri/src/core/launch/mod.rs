//! RetroArch launch subsystem (W7).
//!
//! Three sub-modules, one responsibility each:
//! - [`locator`] — find the RetroArch executable on macOS.
//! - [`args`]    — build the argv list (space-safe, separate args).
//! - [`launcher`] — spawn the detached RetroArch process.

pub mod args;
pub mod launcher;
pub mod locator;
