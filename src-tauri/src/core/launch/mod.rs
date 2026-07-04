//! Launch subsystem (W7; generalized to non-ROM sources by v0.31 W311, see
//! `docs/design/non-retro-library-design.md` §Launch descriptors).
//!
//! Sub-modules, one responsibility each:
//! - [`locator`]   — find the RetroArch executable on macOS.
//! - [`args`]      — build the RetroArch argv list (space-safe, separate args).
//! - [`launcher`]  — spawn the detached RetroArch process.
//! - [`descriptor`] — the `LaunchDescriptor` tagged union (JSON model).
//! - [`external`]  — build argv/URLs for non-RetroArch descriptor kinds.
//! - [`external_launcher`] — spawn a non-RetroArch external launch.
//! - [`observer`]  — best-effort termination polling for external titles.

pub mod args;
pub mod descriptor;
pub mod external;
pub mod external_launcher;
pub mod launcher;
pub mod locator;
pub mod observer;
