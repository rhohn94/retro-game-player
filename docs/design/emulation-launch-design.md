# Emulation Launch Design — Harmony v0.1 (W7)

> **Up:** [↑ Design docs](README.md)
> **Status:** implemented (v0.1), generalized by v0.31 W311 and v0.33 W332
> **Work item:** W7 — RetroArch Launch
> **Contract authority:** [architecture-design.md §2.3](architecture-design.md)

## Purpose

Harmony is a launcher, not an emulator. W7 implements the bridge from a selected
game to a running RetroArch process: locate the executable, resolve the active
libretro core, construct a safe argument list, and spawn a detached process.
This is the **external launch path**, reached from the "Play" button — it is
independent of and complementary to the in-app players (the native libretro
host and the EmulatorJS iframe) that `PlaySwitch` mounts on a game's detail
page; those are covered by
[native-emulation-design.md](native-emulation-design.md) and
[in-page-play-design.md](in-page-play-design.md).

Since W7, the single `launch_game` command has been generalized (v0.31 W311)
to dispatch on the game's stored `launch_descriptor` rather than always
assuming RetroArch: a `.app` bundle, a Steam title, an arbitrary executable,
or (v0.33 W332) a CrossOver-wrapped Windows app can all be launched the same
way a ROM+core pair is. This doc describes the original RetroArch branch in
full; the non-RetroArch branches are designed in
[non-retro-library-design.md](non-retro-library-design.md) §Launch descriptors
and [crossover-integration-design.md](crossover-integration-design.md)
§Launch.

## Module layout

```
src-tauri/src/core/launch/
  mod.rs                — module aggregation (pub re-exports)
  locator.rs             — find the RetroArch executable
  args.rs                — build the RetroArch argv list (space-safe, separate args)
  launcher.rs            — spawn the detached RetroArch process
  descriptor.rs          — LaunchDescriptor tagged union (retroarch/app/steam/exec/crossover),
                            persisted as JSON in games.launch_descriptor (v0.31 W311, v0.33 W332)
  external.rs            — build the argv/open-target for a non-RetroArch descriptor
  external_launcher.rs   — spawn a non-RetroArch descriptor's process
  observer.rs            — best-effort liveness polling for external launches whose
                            spawned Child exits immediately (`open`/`cxstart`), used to
                            bracket play-session tracking

src-tauri/src/commands/launch.rs  — three Tauri IPC commands; launch_game dispatches on
                                    the game's launch_descriptor (RetroArch branch, or an
                                    external app/steam/exec/crossover branch) and brackets
                                    a play-stats session around the whole process lifetime
                                    (v0.26 W264)

src/ipc/launch.ts                 — typed TS wrappers
```

## RetroArch location resolution

Resolution order (first match wins):

1. **User override** (`AppConfig.retroarch_path`) — set via `set_retroarch_path`.
   If set but the path no longer exists, surfaces `AppError::Io` immediately.
2. **`/Applications/RetroArch.app`** — the standard system-wide install.
3. **`~/Applications/RetroArch.app`** — a user-level install.
4. **Launch Services** (`mdfind kMDItemCFBundleIdentifier == 'org.libretro.RetroArch'`)
   — handles non-standard install locations reported to Spotlight.

If nothing is found, `locate_retroarch` returns `null` (TS) / `Ok(None)` (Rust)
and `launch_game` surfaces `AppError::Dependency` with an "Install RetroArch"
message. The frontend is expected to respond by offering the manual-picker
affordance (a file-open dialog wired to `set_retroarch_path`).

## Argument construction

`args::build(executable, core_dylib, rom_path, fullscreen)` returns
`RetroArchArgs { executable, args: Vec<String> }`.

The argv list is always: `-L <core_dylib_path> [-f] <rom_path>`.

Key properties:

- **Space-safe**: paths are separate `Vec<String>` elements, passed directly to
  `Command::args()`. No shell string concatenation; no quoting. The OS handles
  argument boundaries at the `execve` level.
- **Content path always last**: RetroArch treats its final positional argument as
  the content file; `-f` (fullscreen) is inserted before it.
- **`-f` is optional**: supplied when `fullscreen` is `true`, derived from
  `AppConfig.launch_fullscreen` unless overridden per-call.

## Launch flow (`launch_game`)

`launch_game` first loads the game row and reads its `launch_descriptor`. A
missing descriptor or an explicit `{"kind": "retroarch"}` value takes the
RetroArch branch below; any other descriptor kind (`app`/`steam`/`exec`/
`crossover`) is handed to `external::build` + `external_launcher::spawn`
instead (see [non-retro-library-design.md](non-retro-library-design.md) and
[crossover-integration-design.md](crossover-integration-design.md)).

RetroArch branch (`launch_via_retroarch`):

1. Load `AppConfig` — read `retroarch_path` override and `launch_fullscreen`.
2. `locator::locate` — resolve the executable (see above).
3. `LibraryRepo::get_game(game_id)` — fetch `path` (ROM) and `system`.
4. `CoresRepo::get_active(system)` — fetch the active libretro core's `installed_path`.
5. `args::build` — construct the argv list.
6. `launcher::spawn` — call `Command::new(exe).args(args).spawn()` (detached).

The spawned process is detached: Harmony does not block waiting for the game
session to end.

**Play-session tracking (v0.26 W264).** RetroArch runs as its own top-level
process, so there is no in-app mount/unmount to hang start/end tracking on
the way the in-app players do. Instead `launch_game` starts a play-stats
session immediately after spawning, then hands the child process to a
background thread that waits on it and ends the session (persisting the
duration via a fresh DB connection) the moment it exits. The same
start/wait/end bracketing extends to `exec` descriptors, whose spawned child
IS the game process; `app`/`steam`/`crossover` descriptors spawn through
`open`/`cxstart`, which return immediately, so those are bracketed instead by
a best-effort process-name poll (`observer::wait_until_stopped`) — Steam
titles have no predictable process name to poll at all, so their session is
ended immediately after launch rather than tracked indefinitely (an
undercount is preferred over a session that never closes).

## IPC command surface (§2.3)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `launch_game` | `{ gameId: number; fullscreen?: boolean }` | `void` | `async fn launch_game(game_id: i64, fullscreen: Option<bool>, db: State<'_, Db>, app: AppHandle) -> AppResult<()>` (`fullscreen` only affects the RetroArch branch; `app` is used to start/end the play-stats session) |
| `locate_retroarch` | `{}` | `string \| null` | `async fn locate_retroarch() -> AppResult<Option<String>>` |
| `set_retroarch_path` | `{ path: string }` | `void` | `async fn set_retroarch_path(path: String) -> AppResult<()>` |

## Error variants used

| Situation | `AppError` variant |
|---|---|
| RetroArch not found | `Dependency("Install RetroArch…")` |
| Override path no longer exists | `Io(…)` |
| No active core for system | `NotFound(…)` |
| Core has no installed dylib | `NotFound(…)` |
| `set_retroarch_path` empty string | `Validation(…)` |
| Spawn failure | `Io(…)` |

## Testing strategy

- **`locator` tests**: candidate-path list contents and length; `executable_for`
  bundle-path expansion; `locate` with a missing override returns `AppError::Io`;
  `locate` with no installations returns `Ok(None)` (unit-safe, no FS required).
- **`args` tests**: arg count with/without `-f`; content path always last;
  space-containing paths are preserved verbatim (no quoting); correct flag order.
- RetroArch is never actually launched in tests (`launcher::spawn` is not called
  from unit tests).
