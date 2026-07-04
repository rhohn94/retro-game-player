//! Per-core libretro option GUI backend (v0.29 W282,
//! docs/design/core-options-design.md). Targets **only** native FFI-hosted
//! cores (`play::native`, currently `fceumm` NES) — RetroArch-external and
//! EmulatorJS cores manage their own option surfaces and are explicitly out
//! of scope (design doc's Scope section).
//!
//! Two collaborators, each independently unit-tested:
//! - [`probe`] — headlessly boots a core `.dylib` far enough to observe its
//!   `RETRO_ENVIRONMENT_SET_VARIABLES` declaration, without ever loading a
//!   ROM or requiring the caller to run a real play session.
//! - [`persistence`] — reads/writes persisted option values through the
//!   existing `settings` key/value table, namespaced by `(system, core,
//!   option_key)`.
//!
//! [`resolve_effective_options`] composes the two into what the frontend
//! actually needs: each declared option paired with its current effective
//! value (the persisted value, or the core's own declared default when
//! nothing has been persisted yet — never a blank/crashing value, matching
//! the design doc's acceptance criterion).

mod persistence;
mod probe;

pub use persistence::{get_persisted_value, set_persisted_value};
pub use probe::probe_declared_options;

use crate::db::Db;
use crate::error::AppResult;
use crate::play::native::CoreVariable;
use std::path::Path;

/// One core-declared option paired with its effective current value — the
/// shape [`commands::core_options`](crate::commands::core_options) serializes
/// to the frontend.
#[derive(Debug, Clone, PartialEq)]
pub struct EffectiveOption {
    pub key: String,
    pub description: String,
    pub choices: Vec<String>,
    pub value: String,
}

/// Probes `core_path` for its declared options, then resolves each one's
/// effective value: the persisted value for `(system, core_id, key)` if one
/// exists, else the core's own declared default ([`CoreVariable::default_value`]).
/// A core that declares no options returns an empty `Vec` (not an error).
pub fn resolve_effective_options(
    db: &Db,
    system: &str,
    core_id: &str,
    core_path: &Path,
) -> AppResult<Vec<EffectiveOption>> {
    let declared = probe_declared_options(core_path)?;
    declared
        .into_iter()
        .map(|var| effective_option(db, system, core_id, var))
        .collect()
}

fn effective_option(
    db: &Db,
    system: &str,
    core_id: &str,
    var: CoreVariable,
) -> AppResult<EffectiveOption> {
    let value = persistence::get_persisted_value(db, system, core_id, &var.key)?
        .unwrap_or_else(|| var.default_value().to_string());
    Ok(EffectiveOption {
        key: var.key,
        description: var.description,
        choices: var.choices,
        value,
    })
}

/// Builds the `key -> effective value` map a native-play session seeds into
/// [`crate::play::native::set_core_variables`] before boot, so a core that
/// queries `GET_VARIABLE` during `retro_init` sees exactly what the Cores
/// screen has persisted (or the core's own default) — the same resolution
/// [`resolve_effective_options`] uses, without the probe round trip a live
/// session doesn't need (the real boot's own `retro_init` is the
/// declaration moment; probing first would boot the core twice).
///
/// Takes the already-declared list (from a session's own `VariablesDeclared`
/// event) rather than re-probing, since a live session already has one.
pub fn resolve_session_variables(
    db: &Db,
    system: &str,
    core_id: &str,
    declared: &[CoreVariable],
) -> AppResult<std::collections::HashMap<String, String>> {
    let mut values = std::collections::HashMap::with_capacity(declared.len());
    for var in declared {
        let value = persistence::get_persisted_value(db, system, core_id, &var.key)?
            .unwrap_or_else(|| var.default_value().to_string());
        values.insert(var.key.clone(), value);
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Db {
        Db::open_in_memory().unwrap()
    }

    fn region_var() -> CoreVariable {
        CoreVariable {
            key: "fceumm_region".into(),
            description: "Region".into(),
            choices: vec!["auto".into(), "ntsc".into(), "pal".into()],
        }
    }

    #[test]
    fn resolve_session_variables_falls_back_to_declared_default_when_unpersisted() {
        let db = memory_db();
        let values =
            resolve_session_variables(&db, "nes", "fceumm", std::slice::from_ref(&region_var()))
                .unwrap();
        assert_eq!(values.get("fceumm_region"), Some(&"auto".to_string()));
    }

    #[test]
    fn resolve_session_variables_prefers_the_persisted_value() {
        let db = memory_db();
        persistence::set_persisted_value(&db, "nes", "fceumm", "fceumm_region", "pal").unwrap();
        let values =
            resolve_session_variables(&db, "nes", "fceumm", std::slice::from_ref(&region_var()))
                .unwrap();
        assert_eq!(values.get("fceumm_region"), Some(&"pal".to_string()));
    }

    #[test]
    fn effective_option_falls_back_to_declared_default_when_unpersisted() {
        let db = memory_db();
        let opt = effective_option(&db, "nes", "fceumm", region_var()).unwrap();
        assert_eq!(opt.value, "auto");
        assert_eq!(opt.key, "fceumm_region");
        assert_eq!(opt.choices, vec!["auto", "ntsc", "pal"]);
    }

    #[test]
    fn effective_option_prefers_the_persisted_value() {
        let db = memory_db();
        persistence::set_persisted_value(&db, "nes", "fceumm", "fceumm_region", "ntsc").unwrap();
        let opt = effective_option(&db, "nes", "fceumm", region_var()).unwrap();
        assert_eq!(opt.value, "ntsc");
    }
}
