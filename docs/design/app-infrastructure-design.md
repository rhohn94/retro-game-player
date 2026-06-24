# App Infrastructure Design — Harmony (W4)

> **Up:** [↑ Design docs](README.md)

> **Status:** authoritative for the W4 slice (paths, config, error extensions,
> run telemetry). Subordinate to [architecture-design.md](architecture-design.md)
> §2 (error contract) and §4 (directory layouts) — that file wins on conflict.

## Motivation

Every other backend slice needs three cross-cutting primitives in place before
it can do its own work: a single, non-guessed answer for *where files live*, a
*typed config* it can read, and a *unified error type* it returns. W4 provides
these plus the `run.json` run-telemetry writer the Fleet item (W11) later
consumes. The guiding rule from the master contract: paths are resolved in one
place (`config/paths.rs`) and **never hard-coded elsewhere**.

## Scope

Covered: the macOS path resolver (app-support + deployed-instance), the
file-backed `AppConfig` model, the `serde_json` extension to the existing
`AppError`, and the `run.json` telemetry record. Not covered: the `settings` DB
table (W3 persistence + W15 settings UI), Fleet identity / status endpoints
(W11), Keychain secrets (W12).

## 1. Path API (`src-tauri/src/config/paths.rs`)

`Paths` is the canonical resolver. Construct it once and pass it down.

| Constructor | Meaning |
|---|---|
| `Paths::app_support() -> AppResult<Paths>` | Anchor at `<OS app-support>/com.harmony.app/`, create the root. The production entry point. |
| `Paths::with_root(p) -> AppResult<Paths>` | Anchor at an explicit root (tests / sandboxing). |

App-support accessors (§4.1) — each **dir** accessor creates the dir; **file**
accessors ensure the parent:

| Method | Resolves |
|---|---|
| `root()` | `…/com.harmony.app/` |
| `db_file()` | `…/harmony.db` ← **W3 reconciles its temp resolver to this** |
| `config_dir()` | `…/config/` |
| `app_config_file()` | `…/config/app-config.json` |
| `cores_dir()` | `…/cores/` |
| `art_cache_dir()` | `…/art-cache/` |
| `blur_cache_dir()` | `…/blur-cache/` |
| `logs_dir()` | `…/logs/` |
| `ensure_all()` | eagerly create every subdir above |

Deployed-instance accessors (§4.2):

| Method | Resolves |
|---|---|
| `deployed_root()` | `…/deployed-apps/harmony/` |
| `deployed_versions_dir()` | `…/deployed-apps/harmony/versions/` |
| `deployed_version_dir(v)` | `…/versions/{v}/` (created) |
| `deployed_current()` | `…/versions/current` (symlink path; W11 plants the link) |

The OS app-support base comes from the `dirs` crate (`dirs::data_dir()`), which
returns `~/Library/Application Support` on macOS. Public string constants
(`BUNDLE_ID`, `DB_FILE_NAME`, `APP_CONFIG_FILE_NAME`, `RUN_FILE_NAME`) avoid
magic strings at call sites.

## 2. Config model (`src-tauri/src/config/mod.rs`)

`AppConfig` is the typed, file-backed config stored at `config/app-config.json`.
It is distinct from the per-key `settings` DB table — it holds bootstrap-time
settings the app needs around the DB.

Fields (all `#[serde(default)]`, so partial/older files load forward-compatibly):
`schema_version: u32`, `retroarch_path: Option<String>`,
`familiar_base_url: String` (default `http://127.0.0.1:8765`),
`launch_fullscreen: bool` (default `true`).

API: `AppConfig::load(&Paths)` (missing file → defaults), `save(&Paths)`,
`load_or_init(&Paths)` (load + write-back, materializes defaults on first run).
Round-trip and partial-file behavior are unit-tested.

## 3. Error contract extension (`src-tauri/src/error.rs`)

`AppError` already carries every variant W4 needs (`Io`, `Db`, `Network`,
`Validation`, `Internal`, …) per architecture-design.md §2. W4 adds **only** a
`From<serde_json::Error> for AppError` impl mapping (de)serialization faults to
`Internal` (malformed config/telemetry = a payload/code bug, not a user fault).
No second error enum is introduced. Serialization and the new `From` are tested.

## 4. `run.json` telemetry (`src-tauri/src/telemetry.rs`)

`RunRecord` is written to `deployed-apps/harmony/versions/{version}/run.json`
(§4.2). Fields (snake_case; forward-compatible with W11 Fleet):

| Field | Type | Notes |
|---|---|---|
| `schema_version` | integer | `RUN_SCHEMA_VERSION = 1`; W11 branches on it |
| `instance_id` | string | placeholder `harmony-local-0` until W11 plants the Ensign identity |
| `version` | string | app version (`CARGO_PKG_VERSION`) |
| `started_at` | i64 | Unix epoch seconds |
| `stopped_at` | i64 \| null | null while running |
| `status` | enum | `running` \| `stopped` |

API: `RunRecord::start(version)`, `mark_stopped()`, `write(&Paths, version)`,
and the `record_run_start(&Paths, version)` convenience used by setup.

## 5. Wiring (`src-tauri/src/lib.rs`)

`harmony_setup` gains an append-friendly W4 block: resolve `Paths::app_support`,
`ensure_all()`, `AppConfig::load_or_init`, then `record_run_start`. The block is
self-contained so W3 (db open/migrate) and W11 (fleet) append independently.

## Open questions

- `RunRecord` is stamped on start; clean-shutdown `mark_stopped` + re-write is
  modeled but not yet hooked to a Tauri exit event (deferred to W11, which owns
  run lifecycle alongside the fleet server).
