//! Unified IPC error contract. Every `#[tauri::command]` returns
//! `AppResult<T>`; `AppError` serializes to a typed, discriminated JSON object
//! the TS side (`src/ipc/error.ts`) narrows on via its `kind` tag. Keep this
//! enum in lock-step with that mirror. Master contract: architecture-design.md §2.

use serde::Serialize;

/// Unified IPC error. The `kind` tag is the discriminant TS narrows on; the
/// payload string is carried under `detail`.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum AppError {
    /// Entity absent (game / core / provider id).
    #[error("not found: {0}")]
    NotFound(String),
    /// Filesystem / process failure.
    #[error("io error: {0}")]
    Io(String),
    /// SQLite / migration failure.
    #[error("db error: {0}")]
    Db(String),
    /// Buildbot / thumbnails / familiar transport failure.
    #[error("network error: {0}")]
    Network(String),
    /// Bad argument (e.g. empty url_template).
    #[error("validation error: {0}")]
    Validation(String),
    /// Unsupported input (e.g. non-arm64 dylib, unknown system).
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// External dependency missing (e.g. RetroArch absent).
    #[error("dependency error: {0}")]
    Dependency(String),
    /// Unique-constraint / already-exists.
    #[error("conflict: {0}")]
    Conflict(String),
    /// Catch-all; indicates a bug.
    #[error("internal error: {0}")]
    Internal(String),
}

/// Convenience alias every command and core function returns.
pub type AppResult<T> = Result<T, AppError>;

// From impls let `?` lift common std errors into the unified contract without
// duplicating mapping glue. Domain items add further `From` impls as needed.
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

/// Serde (de)serialization failures map to `Internal` — they signal a malformed
/// config/telemetry payload or a code bug, not a user-facing IO/validation fault.
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AppError serializes to the discriminated `{kind, detail}` shape the TS
    /// union (`src/ipc/error.ts`) expects.
    #[test]
    fn serializes_with_kind_and_detail() {
        let err = AppError::NotFound("game 7".to_string());
        let json = serde_json::to_value(&err).expect("serialize");
        assert_eq!(json["kind"], "not_found");
        assert_eq!(json["detail"], "game 7");
    }

    #[test]
    fn each_variant_uses_snake_case_kind() {
        let cases = [
            (AppError::Io("x".into()), "io"),
            (AppError::Db("x".into()), "db"),
            (AppError::Network("x".into()), "network"),
            (AppError::Validation("x".into()), "validation"),
            (AppError::Unsupported("x".into()), "unsupported"),
            (AppError::Dependency("x".into()), "dependency"),
            (AppError::Conflict("x".into()), "conflict"),
            (AppError::Internal("x".into()), "internal"),
        ];
        for (err, expected_kind) in cases {
            let json = serde_json::to_value(&err).expect("serialize");
            assert_eq!(json["kind"], expected_kind);
        }
    }

    #[test]
    fn io_error_lifts_into_app_error() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let app: AppError = io.into();
        assert!(matches!(app, AppError::Io(_)));
    }

    #[test]
    fn serde_json_error_lifts_into_internal() {
        let bad: serde_json::Error =
            serde_json::from_str::<i32>("not json").expect_err("should fail");
        let app: AppError = bad.into();
        assert!(matches!(app, AppError::Internal(_)));
    }
}
