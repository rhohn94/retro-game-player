//! One-time app-data migration for the Harmony → Retro Game Player rename
//! (W269). Changing the Tauri `identifier` moves the OS app-support root from
//! `…/com.harmony.app/` to `…/com.retro-game-player.app/` (§4.1); without this
//! step, existing users would see an empty library on first launch after the
//! upgrade even though their DB/art-cache/config are intact on disk under the
//! old dir.
//!
//! [`migrate_app_data`] is the Tauri-free move logic (pure `Path`s in, a
//! result out) so it is unit-testable without a running app; [`run`] wraps it
//! with the production old/new roots resolved via [`paths::BUNDLE_ID`] and
//! logs the outcome. Call this BEFORE any DB/config init (master contract
//! architecture-design.md §4).

use super::paths::BUNDLE_ID;
use std::path::Path;

/// Legacy (pre-rename) bundle identifier; the old app-support root folder name.
const LEGACY_BUNDLE_ID: &str = "com.harmony.app";

/// Outcome of a migration attempt, returned for logging/testing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// Fresh install: neither dir existed, or the new dir already had data —
    /// nothing to do.
    NoOpFreshInstall,
    /// Both an old and a (non-empty) new dir exist — ambiguous, left alone.
    NoOpBothExist,
    /// The old dir was moved into place as the new dir.
    Moved,
}

/// Move `old_dir` to `new_dir` in place if `new_dir` is missing/empty and
/// `old_dir` exists, so existing user data (DB, art-cache, config, saves)
/// survives the identifier rename. Never overwrites or deletes data:
///
/// - `new_dir` missing/empty + `old_dir` exists → rename `old_dir` → `new_dir`
///   (falls back to a recursive copy if `fs::rename` fails, e.g. a
///   cross-device move, then leaves `old_dir` in place rather than deleting
///   user data on a possibly-partial copy).
/// - `new_dir` already has data (fresh install already ran, or a previous
///   migration already happened) → no-op, regardless of `old_dir`.
/// - neither exists → no-op (genuinely fresh install).
///
/// Tauri-free: takes plain paths so it is unit-testable without a running app.
pub fn migrate_app_data(old_dir: &Path, new_dir: &Path) -> std::io::Result<MigrationOutcome> {
    if dir_has_contents(new_dir) {
        // The new dir already has data — either a fresh install already
        // populated it, or a prior run already migrated. Leave both alone.
        return Ok(if old_dir.is_dir() {
            MigrationOutcome::NoOpBothExist
        } else {
            MigrationOutcome::NoOpFreshInstall
        });
    }

    if !old_dir.is_dir() {
        // Nothing to migrate — genuinely fresh install.
        return Ok(MigrationOutcome::NoOpFreshInstall);
    }

    // The new dir may exist but be empty (e.g. created eagerly by an earlier
    // partial init); remove it so `rename` can occupy the path cleanly.
    if new_dir.exists() {
        std::fs::remove_dir(new_dir)?;
    }
    if let Some(parent) = new_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    match std::fs::rename(old_dir, new_dir) {
        Ok(()) => Ok(MigrationOutcome::Moved),
        Err(_) => {
            // Cross-device or other rename failure — fall back to a recursive
            // copy. Leave `old_dir` in place afterward (don't risk deleting the
            // user's only copy if the copy was partial).
            copy_dir_recursive(old_dir, new_dir)?;
            Ok(MigrationOutcome::Moved)
        }
    }
}

/// `true` if `dir` exists and contains at least one entry.
fn dir_has_contents(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

/// Recursively copy every entry under `src` into `dst` (created if absent).
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

/// Production entry point: resolve the legacy/new app-support roots beneath
/// `app_support_base` (the OS application-support dir) and migrate if needed.
/// Logs the outcome to stderr (no logging framework wired yet at this point in
/// startup — see `harmony_setup` call order in `lib.rs`).
pub fn run(app_support_base: &Path) -> std::io::Result<MigrationOutcome> {
    let old_dir = app_support_base.join(LEGACY_BUNDLE_ID);
    let new_dir = app_support_base.join(BUNDLE_ID);
    let outcome = migrate_app_data(&old_dir, &new_dir)?;
    match outcome {
        MigrationOutcome::Moved => {
            eprintln!(
                "[migrate] moved app data from {} to {} (Harmony -> Retro Game Player rename)",
                old_dir.display(),
                new_dir.display()
            );
        }
        MigrationOutcome::NoOpBothExist => {
            eprintln!(
                "[migrate] both {} and {} exist; leaving both in place",
                old_dir.display(),
                new_dir.display()
            );
        }
        MigrationOutcome::NoOpFreshInstall => {}
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sandbox(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rgp-migrate-{tag}-{}-{}",
            std::process::id(),
            fastrand_like_suffix()
        ));
        std::fs::create_dir_all(&dir).expect("sandbox dir");
        dir
    }

    /// Cheap unique suffix without pulling in a `rand` dependency — combines
    /// the current time with a static counter so parallel test threads in the
    /// same process still get distinct sandbox dirs.
    fn fastrand_like_suffix() -> u128 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        nanos + n as u128
    }

    /// Fresh install: neither old nor new dir exists → no-op, new dir still
    /// absent (caller creates it afterward via `Paths::with_root`).
    #[test]
    fn fresh_install_is_noop() {
        let base = sandbox("fresh");
        let old_dir = base.join("com.harmony.app");
        let new_dir = base.join("com.retro-game-player.app");

        let outcome = migrate_app_data(&old_dir, &new_dir).expect("migrate");

        assert_eq!(outcome, MigrationOutcome::NoOpFreshInstall);
        assert!(!old_dir.exists());
        assert!(!new_dir.exists());
        std::fs::remove_dir_all(&base).ok();
    }

    /// Existing old dir with data, no new dir: the old dir is moved in place
    /// as the new dir, preserving its contents (DB file, subdirs).
    #[test]
    fn existing_old_dir_is_moved() {
        let base = sandbox("moved");
        let old_dir = base.join("com.harmony.app");
        std::fs::create_dir_all(old_dir.join("config")).expect("mkdir");
        std::fs::write(old_dir.join("harmony.db"), b"sqlite-bytes").expect("write db");
        std::fs::write(old_dir.join("config").join("app-config.json"), b"{}")
            .expect("write config");
        let new_dir = base.join("com.retro-game-player.app");

        let outcome = migrate_app_data(&old_dir, &new_dir).expect("migrate");

        assert_eq!(outcome, MigrationOutcome::Moved);
        assert!(!old_dir.exists(), "old dir should be gone after a rename move");
        assert!(new_dir.is_dir());
        assert_eq!(
            std::fs::read(new_dir.join("harmony.db")).expect("db survives"),
            b"sqlite-bytes"
        );
        assert!(new_dir.join("config").join("app-config.json").is_file());
        std::fs::remove_dir_all(&base).ok();
    }

    /// Both dirs exist with data: ambiguous — never delete or merge silently;
    /// leave both in place and report the no-op so the caller can log it.
    #[test]
    fn both_exist_is_noop_and_logged() {
        let base = sandbox("both");
        let old_dir = base.join("com.harmony.app");
        let new_dir = base.join("com.retro-game-player.app");
        std::fs::create_dir_all(&old_dir).expect("mkdir old");
        std::fs::write(old_dir.join("harmony.db"), b"old-bytes").expect("write old db");
        std::fs::create_dir_all(&new_dir).expect("mkdir new");
        std::fs::write(new_dir.join("harmony.db"), b"new-bytes").expect("write new db");

        let outcome = migrate_app_data(&old_dir, &new_dir).expect("migrate");

        assert_eq!(outcome, MigrationOutcome::NoOpBothExist);
        assert_eq!(
            std::fs::read(old_dir.join("harmony.db")).expect("old survives"),
            b"old-bytes"
        );
        assert_eq!(
            std::fs::read(new_dir.join("harmony.db")).expect("new survives"),
            b"new-bytes"
        );
        std::fs::remove_dir_all(&base).ok();
    }

    /// An empty new dir (e.g. created by an eager `ensure_dir` before this
    /// check ran) must not block the move — it's indistinguishable from "not
    /// created yet" from the user's perspective.
    #[test]
    fn empty_new_dir_does_not_block_move() {
        let base = sandbox("empty-new");
        let old_dir = base.join("com.harmony.app");
        std::fs::create_dir_all(&old_dir).expect("mkdir old");
        std::fs::write(old_dir.join("harmony.db"), b"old-bytes").expect("write old db");
        let new_dir = base.join("com.retro-game-player.app");
        std::fs::create_dir_all(&new_dir).expect("mkdir empty new");

        let outcome = migrate_app_data(&old_dir, &new_dir).expect("migrate");

        assert_eq!(outcome, MigrationOutcome::Moved);
        assert!(!old_dir.exists());
        assert_eq!(
            std::fs::read(new_dir.join("harmony.db")).expect("db survives"),
            b"old-bytes"
        );
        std::fs::remove_dir_all(&base).ok();
    }

    /// Nested subdirectories (art-cache, saves, etc.) survive the move too,
    /// not just top-level files.
    #[test]
    fn nested_subdirs_survive_move() {
        let base = sandbox("nested");
        let old_dir = base.join("com.harmony.app");
        std::fs::create_dir_all(old_dir.join("art-cache").join("boxart")).expect("mkdir nested");
        std::fs::write(
            old_dir.join("art-cache").join("boxart").join("1.png"),
            b"png-bytes",
        )
        .expect("write nested file");
        let new_dir = base.join("com.retro-game-player.app");

        let outcome = migrate_app_data(&old_dir, &new_dir).expect("migrate");

        assert_eq!(outcome, MigrationOutcome::Moved);
        assert_eq!(
            std::fs::read(new_dir.join("art-cache").join("boxart").join("1.png"))
                .expect("nested file survives"),
            b"png-bytes"
        );
        std::fs::remove_dir_all(&base).ok();
    }
}
