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

## §Rename (W269, v0.26) — Harmony → Retro Game Player

The v0.26 product rename changed the Tauri `identifier` from `com.harmony.app`
to `com.retro-game-player.app`. Since macOS keys the app-support root
(§4.1) off the identifier, this moves `Paths::app_support()`'s root from
`~/Library/Application Support/com.harmony.app/` to
`~/Library/Application Support/com.retro-game-player.app/` — an existing
user's DB, `config/app-config.json`, `art-cache/`, `cores/`, `saves/`, etc.
would otherwise appear to vanish on first launch of the renamed build.

**Migration (`src-tauri/src/config/migrate.rs`):** `config::migrate::run` is
called from `harmony_setup` **before** `Paths::app_support()` (and therefore
before any DB/config init). It resolves both the legacy (`com.harmony.app`)
and new (`com.retro-game-player.app`) roots under the OS app-support base and:

- new root missing/empty + old root exists → `fs::rename` the old root into
  the new root's path (falls back to a recursive copy on a cross-device
  rename failure, leaving the old root in place rather than risking data loss
  on a partial copy);
- both roots already have data → no-op, logged (never silently merges or
  deletes either copy);
- neither root exists → no-op (genuinely fresh install).

The move logic (`migrate_app_data(old_dir, new_dir)`) is a plain
`Path`-in/`Result`-out function with no Tauri dependency, unit-tested for all
three cases above plus nested-subdirectory and empty-new-dir edge cases (see
the `#[cfg(test)]` module in `migrate.rs`).

**Left unchanged by this rename:** `DB_FILE_NAME` (`harmony.db`) and the
`deployed-apps/harmony/` fleet subtree (`DEPLOYED_APP_DIR`) — only the
bundle `identifier` (and therefore the app-support root folder name) changed;
renaming the on-disk DB filename or the deployed-instance tree was out of
scope for W269.

#### v0.26.2 (W271) — DB path repair after the directory move

W269's migration moved the *files* but never rewrote the *database rows* that
store **absolute** paths into the app-support root. After the rename, on a
migrated machine, every such row pointed into the now-nonexistent
`…/com.harmony.app/` tree — doubly broken for images, because the stale paths
also fall outside the asset-protocol scope (`$APPDATA/art-cache/**`,
`$APPDATA/console-art/**`), which resolves against the *new* identifier.
User-visible symptom: **no images anywhere in the app** (all 20 console
photos via `console_meta.image_path`, game box art via `games.art_path`, the
v0.26 art tiers via `art_cache.path`), plus stale `cores.installed_path` rows
(cosmetic on the Cores page — the native-play launch path re-resolves the
core file under the live app-support root, which is why play kept working).

Fix: migration `011_repair_renamed_app_paths.sql` string-replaces the
identifier path segment (`/com.harmony.app/` → `/com.retro-game-player.app/`)
in those four columns, guarded by `LIKE` so it is a no-op on fresh installs
and idempotent on repaired ones. The rewritten paths are correct because the
files themselves *did* move (or were copied) by `migrate_app_data`.

**Root design flaw + durable follow-up:** these columns should store paths
*relative to the app-support root*, resolved at read time — then an
identifier change can never dangle them again. Deferred (touches every art
read/write site); candidate for v0.29 Craft.

### Post-rename identifier decisions (W269B, v0.26)

W269 deliberately left three "harmony" literals in place pending a decision.
W269B resolves all three:

- **Keychain `KEYCHAIN_SERVICE`** (`src-tauri/src/core/familiar/keychain.rs`)
  — **renamed with a fallback-read migration.** The service name is now
  `com.retro-game-player.app`; the old `com.harmony.app` name is kept as
  `LEGACY_KEYCHAIN_SERVICE` and consulted only when a read against the new
  name misses. A legacy hit is forward-written under the new name (so later
  reads no longer need the fallback) and the legacy entry is left in place —
  never deleted — so a downgrade still finds its key. Rationale: unlike the
  app-data directory (which has an explicit move-on-first-run migration, see
  above), the Keychain has no directory to rename — a bare rename would
  silently orphan an existing user's stored Familiar Bearer key. The
  fallback/forward-write decision is implemented as a pure, unit-tested
  function (`resolve`) separate from the Keychain I/O. See
  `familiar-enrichment-design.md` for the consuming module's view.
- **Fleet `INSTANCE_ID_PREFIX`** (`src-tauri/src/fleet/identity.rs`, `"harmony"`)
  — **kept permanently, no code change.** It is fleet wire-identity rather
  than branding: external Mission Control tooling may pattern-match the
  prefix, and a mixed-prefix fleet (some instances `harmony-*`, others
  `retro-game-player-*`) is worse than a consistent one. See
  `fleet-ensign-design.md`.
- **Familiar `CONSUMER_ID_VALUE`** (`src-tauri/src/core/familiar/mod.rs`,
  `"harmony"`) — **kept permanently, coordinated-change-only, no code
  change.** It is the `X-Consumer-Id` wire value the external Familiar
  service may allowlist; renaming it unannounced could break enrichment for
  already-configured users. Any future change must be coordinated with the
  Familiar service side, not shipped unilaterally. See
  `familiar-enrichment-design.md`.

Everything else in this document (§1–§5) describes the W4-era design as
originally shipped and is otherwise unaffected by the rename.
