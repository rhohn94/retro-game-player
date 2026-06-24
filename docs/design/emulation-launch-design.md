# Emulation Launch Design — Harmony v0.1 (W7)

> **Up:** [↑ Design docs](README.md)
> **Status:** implemented (v0.1)
> **Work item:** W7 — RetroArch Launch
> **Contract authority:** [architecture-design.md §2.3](architecture-design.md)

## Purpose

Harmony is a launcher, not an emulator. W7 implements the bridge from a selected
game to a running RetroArch process: locate the executable, resolve the active
libretro core, construct a safe argument list, and spawn a detached process.

## Module layout

```
src-tauri/src/core/launch/
  mod.rs        — module aggregation (pub re-exports args, launcher, locator)
  locator.rs    — find the RetroArch executable
  args.rs       — build the argv list (space-safe, separate args)
  launcher.rs   — spawn the detached RetroArch process

src-tauri/src/commands/launch.rs  — three Tauri IPC commands

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

1. Load `AppConfig` — read `retroarch_path` override and `launch_fullscreen`.
2. `locator::locate` — resolve the executable (see above).
3. `LibraryRepo::get_game(game_id)` — fetch `path` (ROM) and `system`.
4. `CoresRepo::get_active(system)` — fetch the active libretro core's `installed_path`.
5. `args::build` — construct the argv list.
6. `launcher::spawn` — call `Command::new(exe).args(args).spawn()` (detached).

The spawned process is detached: Harmony does not block waiting for the game
session to end.

## IPC command surface (§2.3)

| Command | TS args | TS return | Rust signature |
|---|---|---|---|
| `launch_game` | `{ gameId: number; fullscreen?: boolean }` | `void` | `async fn launch_game(game_id: i64, fullscreen: Option<bool>, db: State<Db>) -> AppResult<()>` |
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
