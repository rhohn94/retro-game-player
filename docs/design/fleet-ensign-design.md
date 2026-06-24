# Fleet / Ensign Design — Harmony (W11)

> **Up:** [↑ Design docs](README.md)

> **Status:** authoritative for the W11 slice (Ensign identity, the Fleet Status
> Contract v1, `fleet-instance.json`, the deployed-layout mirror, and the
> localhost status server). Subordinate to
> [architecture-design.md](architecture-design.md) §2.7 (the `get_fleet_status`
> IPC shape) and §4.2 (the deployed-instance layout) — that file wins on
> conflict.

## Motivation

For an external Mission Control / fleet to observe a Harmony instance, the app
must publish a **stable identity**, a **versioned manifest**, and a **live
status** in shapes the fleet can read without guessing. W11 implements that
contract: an Ensign that mints a restart-stable instance id, writes
`fleet-instance.json` to the deployed root, mirrors the `versions/{vX.Y.Z}/` +
`current` layout, and binds a localhost-only HTTP status endpoint while the app
runs. It also OWNS the identity the W4 telemetry placeholder (`harmony-local-0`)
stood in for.

## Scope

**Covered:** the stable Ensign instance id + its persistence; the Fleet Status
Contract v1 wire types (`FleetStatus`, `FleetManifest`, `DependencyEdge`); the
`fleet-instance.json` writer and `current` symlink; the localhost status server
(`GET /fleet/v1/status` + `/healthz`); declared RetroArch + core dependency
edges; the `get_fleet_status` IPC command + TS wrapper; the Mission Control
registration snippet.

**Not covered:** Mission Control itself; remote/authenticated transport (the
server is loopback-only, unauthenticated by design); per-core version probing
beyond presence (deferred to W5).

## The Fleet Status Contract v1

`schema_version` is a JSON **integer** (`1`) everywhere it appears — in
`FleetStatus` (IPC + HTTP) and in `FleetManifest` (`fleet-instance.json`). This
is a hard requirement; the schema types use `u32` and unit tests assert the
rendered JSON is `1`, never `"1"`.

### `FleetStatus` (live — IPC `get_fleet_status` and `GET /fleet/v1/status`)

```jsonc
{
  "schema_version": 1,                 // INTEGER
  "instance_id": "harmony-local-0",    // harmony-{env}-{ordinal}
  "version": "0.1.0",
  "status": "ok",                      // "ok" | "degraded"
  "uptime_seconds": 42,
  "dependencies": [
    { "name": "retroarch", "present": true },
    { "name": "core:nes",  "present": false },
    { "name": "core:snes", "present": false },
    { "name": "core:n64",  "present": false }
  ]
}
```

`status` derives from the edges: `ok` iff every declared edge is present, else
`degraded`.

### `FleetManifest` (at rest — `fleet-instance.json`)

```jsonc
{
  "schema_version": 1,                 // INTEGER
  "instance_id": "harmony-local-0",
  "env": "local",
  "ordinal": 0,
  "version": "0.1.0",
  "status_port": 8420,
  "dependencies": [ /* same edge shape */ ]
}
```

## Ensign identity (restart-stable)

The id is `harmony-{env}-{ordinal}` (default `harmony-local-0`). It is persisted
as `config/fleet-identity.json` under the app-support root (resolved by
`config::paths::Paths`, never hard-coded). First run mints + writes the default;
later runs load the same file, so the id is constant across restarts. A corrupt
file is treated as absent and replaced.

## Deployed layout (mirrors §4.2)

`fleet-instance.json` is written to
`deployed-apps/harmony/versions/{vX.Y.Z}/fleet-instance.json` (the version dir
is `v`-prefixed from `CARGO_PKG_VERSION`, e.g. `v0.1.0`). The Ensign also plants
`versions/current -> v0.1.0` (relative symlink, idempotently replaced) so the
fleet resolves `current` to the live instance. This sits alongside the W4
`run.json` in the same version dir.

## Localhost status server

A lightweight blocking **`tiny_http`** server (chosen over axum to avoid pulling
an async runtime/tower stack for two routes) binds **`127.0.0.1` only** on the
fixed documented port **`FLEET_STATUS_PORT = 8420`**. Routes:

| Route | Method | Response |
|---|---|---|
| `/healthz` | GET | `200 ok` (liveness) |
| `/fleet/v1/status` | GET | `200` + `FleetStatus` JSON (`application/json`) |
| anything else | GET | `404 not found` |

It runs on a named background thread spawned from `harmony_setup`. Binding is
best-effort — a busy port is logged, not fatal; the IPC command works
regardless. The HTTP body and the IPC return are produced by the **same** pure
`manifest::build_status` builder, so the two faces can never drift.

Port `8420` is a documented constant (no magic number) recorded in
`fleet-instance.json` (`status_port`) and in the registration snippet below.

## Dependency edges

Declared edges: one for RetroArch (`retroarch`, present if
`/Applications/RetroArch.app` exists) and one per declared core system
(`core:nes`, `core:snes`, `core:n64`, present if any `*_libretro.dylib` exists
under `cores/<system>/`). Presence resolution is behind a `DependencyResolver`
trait so the assembly is unit-testable with a stub and W5/W7 can supply a richer
resolver later.

## Mission Control registration snippet

Add this object to Mission Control's `instances.json` `instances` array to
register a local Harmony Ensign:

```jsonc
{
  "id": "harmony-local-0",
  "product": "harmony",
  "env": "local",
  "ordinal": 0,
  "status_url": "http://127.0.0.1:8420/fleet/v1/status",
  "health_url": "http://127.0.0.1:8420/healthz",
  "manifest_path": "deployed-apps/harmony/versions/current/fleet-instance.json",
  "schema_version": 1
}
```

## Module map (`src-tauri/src/fleet/`)

| File | Responsibility |
|---|---|
| `schemas.rs` | Wire types — `FleetStatus`, `FleetManifest`, `DependencyEdge`, `FleetHealth`; `FLEET_SCHEMA_VERSION` |
| `identity.rs` | Stable `Identity` (`harmony-{env}-{ordinal}`); persist/load `fleet-identity.json` |
| `manifest.rs` | Dependency resolver + edge builder; pure `build_status` / `build_manifest`; `write_manifest` + `current` symlink |
| `server.rs` | `Ensign` shared state; `tiny_http` localhost status server (`FLEET_STATUS_PORT`) |
| `mod.rs` | `start()` — resolve identity, write manifest, spawn server, return `Ensign` |

The command adapter is `src-tauri/src/commands/fleet.rs` (`get_fleet_status`),
registered via the append-only macro; the TS wrapper is `src/ipc/fleet.ts`.

## Setup wiring

`harmony_setup` (in `lib.rs`, below the W11 APPEND marker) calls
`fleet::start(&paths, version, &version_dir)` and manages the returned `Ensign`
in Tauri state for `get_fleet_status` to read.

## Testing

Unit tests cover: `schema_version` serializing as an integer `1` (both types,
including a raw-text unquoted check); instance-id format + restart stability +
corrupt-file recovery; edge assembly via a stub resolver; manifest write +
`current` symlink (idempotent); and the server's `/healthz` + `/fleet/v1/status`
routes over an **ephemeral** bound port (no dependency on `8420` being free in
CI), asserting the integer `schema_version` in the served body.

## Open questions

- Whether the status server should bind a configurable port (resolve if `8420`
  collides in practice).
- Whether per-core version (not just presence) belongs in the edges — defer to
  W5 once core version metadata exists.
