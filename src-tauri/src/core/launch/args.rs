//! RetroArch argument builder — constructs the argv list for a RetroArch spawn.
//!
//! Uses separate args (never a shell string) so paths containing spaces are
//! handled correctly by `std::process::Command`.

use std::path::{Path, PathBuf};

/// The fully resolved argument list to pass to `std::process::Command`.
/// The first element is the executable path; subsequent elements are flags/values.
#[derive(Debug, Clone, PartialEq)]
pub struct RetroArchArgs {
    pub executable: PathBuf,
    pub args: Vec<String>,
}

/// Build the argument list for launching a game via RetroArch.
///
/// # Arguments
/// - `executable` — absolute path to the RetroArch binary.
/// - `core_dylib` — absolute path to the libretro core `.dylib`.
/// - `rom_path` — absolute path to the ROM / content file.
/// - `fullscreen` — whether to pass `-f` (fullscreen flag).
///
/// # Result
/// A [`RetroArchArgs`] whose `.args` are safe to pass as separate elements to
/// `Command::args()`. No shell quoting is performed; the OS handles argument
/// separation correctly at the `execve` level.
pub fn build(
    executable: &Path,
    core_dylib: &Path,
    rom_path: &Path,
    fullscreen: bool,
) -> RetroArchArgs {
    let mut args: Vec<String> = Vec::new();

    // Core library: -L <path>
    args.push("-L".to_string());
    args.push(core_dylib.to_string_lossy().into_owned());

    // Fullscreen flag (optional)
    if fullscreen {
        args.push("-f".to_string());
    }

    // Content path — always last (RetroArch positional argument)
    args.push(rom_path.to_string_lossy().into_owned());

    RetroArchArgs {
        executable: executable.to_owned(),
        args,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exe() -> PathBuf {
        PathBuf::from("/Applications/RetroArch.app/Contents/MacOS/RetroArch")
    }

    #[test]
    fn basic_args_without_fullscreen() {
        let core = Path::new("/Library/cores/mesen_libretro.dylib");
        let rom = Path::new("/ROMs/NES/Contra.nes");
        let result = build(&exe(), core, rom, false);

        assert_eq!(result.executable, exe());
        assert_eq!(result.args, vec!["-L", "/Library/cores/mesen_libretro.dylib", "/ROMs/NES/Contra.nes"]);
    }

    #[test]
    fn fullscreen_flag_is_inserted_before_content() {
        let core = Path::new("/Library/cores/snes9x_libretro.dylib");
        let rom = Path::new("/ROMs/SNES/Zelda.sfc");
        let result = build(&exe(), core, rom, true);

        // Expected: -L <core> -f <rom>
        assert_eq!(
            result.args,
            vec!["-L", "/Library/cores/snes9x_libretro.dylib", "-f", "/ROMs/SNES/Zelda.sfc"]
        );
    }

    #[test]
    fn paths_with_spaces_are_preserved_verbatim() {
        let core = Path::new("/My Cores/mesen libretro.dylib");
        let rom = Path::new("/My ROMs/NES/Mike Tyson's Punch-Out.nes");
        let result = build(&exe(), core, rom, false);

        assert_eq!(result.args[0], "-L");
        assert_eq!(result.args[1], "/My Cores/mesen libretro.dylib");
        assert_eq!(result.args[2], "/My ROMs/NES/Mike Tyson's Punch-Out.nes");
        // No shell-level quoting — the string is passed as-is to execve.
        assert!(!result.args[1].contains('"'));
        assert!(!result.args[1].contains('\''));
    }

    #[test]
    fn content_path_is_always_last_without_fullscreen() {
        let core = Path::new("/cores/mesen.dylib");
        let rom = Path::new("/roms/game.nes");
        let result = build(&exe(), core, rom, false);
        assert_eq!(result.args.last().unwrap(), "/roms/game.nes");
    }

    #[test]
    fn content_path_is_always_last_with_fullscreen() {
        let core = Path::new("/cores/mesen.dylib");
        let rom = Path::new("/roms/game.nes");
        let result = build(&exe(), core, rom, true);
        assert_eq!(result.args.last().unwrap(), "/roms/game.nes");
    }

    #[test]
    fn arg_count_without_fullscreen_is_three() {
        // -L <core> <rom>
        let core = Path::new("/cores/mesen.dylib");
        let rom = Path::new("/roms/game.nes");
        let result = build(&exe(), core, rom, false);
        assert_eq!(result.args.len(), 3);
    }

    #[test]
    fn arg_count_with_fullscreen_is_four() {
        // -L <core> -f <rom>
        let core = Path::new("/cores/mesen.dylib");
        let rom = Path::new("/roms/game.nes");
        let result = build(&exe(), core, rom, true);
        assert_eq!(result.args.len(), 4);
    }
}
