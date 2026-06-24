//! Controller-bindings IPC adapters (W14). Thin `#[tauri::command]` wrappers
//! over the W3 [`ControllerBindingsRepo`](crate::db::repo::controller_bindings),
//! exposing the minimal persistence surface the frontend spatial-nav layer needs
//! (architecture-design.md §2.10):
//!
//! - `list_bindings` — fetch persisted `(device_family, action) -> button`
//!   overrides, optionally filtered to one family. The frontend folds these over
//!   its per-family compiled-in defaults; an empty list means "use defaults".
//! - `set_binding` — upsert one override and return the persisted row.
//!
//! Mirrors the typed TS surface in `src/ipc/controllers.ts`.

use tauri::State;

use crate::db::{
    repo::{controller_bindings::ControllerBindingsRepo, Repository},
    Db,
};
use crate::error::AppResult;

/// A controller binding as returned to the frontend (mirrors TS
/// `ControllerBinding`). Field names are already snake-free / camel-neutral, so
/// no rename is needed — `deviceFamily` is the lone camel field.
#[derive(serde::Serialize)]
pub struct ControllerBindingDto {
    pub id: i64,
    #[serde(rename = "deviceFamily")]
    pub device_family: String,
    pub action: String,
    pub button: String,
}

impl From<crate::db::repo::controller_bindings::ControllerBinding> for ControllerBindingDto {
    fn from(b: crate::db::repo::controller_bindings::ControllerBinding) -> Self {
        Self {
            id: b.id,
            device_family: b.device_family,
            action: b.action,
            button: b.button,
        }
    }
}

/// List persisted bindings, optionally filtered by device family (`None` = all).
#[tauri::command]
pub fn list_bindings(
    device_family: Option<String>,
    db: State<'_, Db>,
) -> AppResult<Vec<ControllerBindingDto>> {
    let repo = ControllerBindingsRepo::new(db.inner());
    repo.list(device_family.as_deref())
        .map(|bs| bs.into_iter().map(ControllerBindingDto::from).collect())
}

/// Upsert one `(device_family, action)` override, returning the persisted row.
#[tauri::command]
pub fn set_binding(
    device_family: String,
    action: String,
    button: String,
    db: State<'_, Db>,
) -> AppResult<ControllerBindingDto> {
    let repo = ControllerBindingsRepo::new(db.inner());
    let id = repo.set_button(&device_family, &action, &button)?;
    repo.get(id).map(ControllerBindingDto::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_serializes_camelcase_device_family() {
        let dto = ControllerBindingDto::from(
            crate::db::repo::controller_bindings::ControllerBinding {
                id: 1,
                device_family: "playstation".into(),
                action: "confirm".into(),
                button: "cross".into(),
            },
        );
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(v["deviceFamily"], "playstation");
        assert_eq!(v["action"], "confirm");
        assert_eq!(v["button"], "cross");
    }
}
