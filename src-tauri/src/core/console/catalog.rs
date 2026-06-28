//! Static console catalog (v0.12).
//!
//! Human-facing metadata for every console Harmony covers (gen 2–6 home
//! consoles, matching the keys in `core/cores/system_map.rs` and
//! `core/library/mapper.rs`). This is the single source of truth for a console's
//! display name, maker, generation, debut year, short tag, and the Wikipedia
//! article title used to fetch its photo + description. Adding a console is a
//! one-line edit here.
//!
//! Game *content* is decoupled: a console's browsable title list comes from the
//! bundled catalog in [`super::titles`]; this file is metadata only.

use crate::error::{AppError, AppResult};

/// One console's static metadata. `key` matches the `system` key used across the
/// core catalog, scan mapper, and `games.system` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsoleInfo {
    /// Canonical system key (e.g. `"nes"`).
    pub key: &'static str,
    /// Full display name (e.g. "Nintendo Entertainment System").
    pub name: &'static str,
    /// Manufacturer (e.g. "Nintendo").
    pub manufacturer: &'static str,
    /// Short tag / abbreviation (e.g. "NES").
    pub abbreviation: &'static str,
    /// Console generation (2–6).
    pub generation: u8,
    /// Debut year (earliest regional release).
    pub year: u16,
    /// Main CPU (chip + clock), e.g. "Ricoh 2A03 @ 1.79 MHz".
    pub cpu: &'static str,
    /// Graphics processor / video chip, e.g. "Ricoh 2C02 PPU".
    pub gpu: &'static str,
    /// Main system RAM (units vary across the retro era, so a display string),
    /// e.g. "2 KB" or "32 MB".
    pub ram: &'static str,
    /// English Wikipedia article title for the console's photo + description.
    pub wikipedia_title: &'static str,
}

/// The catalog, ordered by generation then debut year. Every `key` is also a
/// curated system in `core/cores/system_map.rs` (pinned by a test there-adjacent
/// is overkill; the console-detail games list simply reads `games.system`).
const CONSOLES: &[ConsoleInfo] = &[
    // --- Generation 2 (1976–1983) ---
    ConsoleInfo { key: "atari2600", name: "Atari 2600", manufacturer: "Atari", abbreviation: "2600", generation: 2, year: 1977, cpu: "MOS 6507 @ 1.19 MHz", gpu: "TIA", ram: "128 bytes", wikipedia_title: "Atari 2600" },
    ConsoleInfo { key: "odyssey2", name: "Magnavox Odyssey²", manufacturer: "Magnavox", abbreviation: "O²", generation: 2, year: 1978, cpu: "Intel 8048 @ 1.79 MHz", gpu: "Intel 8244", ram: "64 bytes", wikipedia_title: "Magnavox Odyssey 2" },
    ConsoleInfo { key: "intellivision", name: "Intellivision", manufacturer: "Mattel", abbreviation: "INTV", generation: 2, year: 1979, cpu: "GI CP1610 @ 0.89 MHz", gpu: "AY-3-8900 STIC", ram: "1.5 KB", wikipedia_title: "Intellivision" },
    ConsoleInfo { key: "atari5200", name: "Atari 5200", manufacturer: "Atari", abbreviation: "5200", generation: 2, year: 1982, cpu: "MOS 6502C @ 1.79 MHz", gpu: "ANTIC + GTIA", ram: "16 KB", wikipedia_title: "Atari 5200" },
    ConsoleInfo { key: "colecovision", name: "ColecoVision", manufacturer: "Coleco", abbreviation: "CV", generation: 2, year: 1982, cpu: "Zilog Z80A @ 3.58 MHz", gpu: "TMS9928A", ram: "1 KB", wikipedia_title: "ColecoVision" },
    // --- Generation 3 (1983–1987) ---
    ConsoleInfo { key: "nes", name: "Nintendo Entertainment System", manufacturer: "Nintendo", abbreviation: "NES", generation: 3, year: 1983, cpu: "Ricoh 2A03 @ 1.79 MHz", gpu: "Ricoh 2C02 PPU", ram: "2 KB", wikipedia_title: "Nintendo Entertainment System" },
    ConsoleInfo { key: "mastersystem", name: "Sega Master System", manufacturer: "Sega", abbreviation: "SMS", generation: 3, year: 1985, cpu: "Zilog Z80 @ 3.58 MHz", gpu: "Sega 315-5124 VDP", ram: "8 KB", wikipedia_title: "Master System" },
    ConsoleInfo { key: "atari7800", name: "Atari 7800", manufacturer: "Atari", abbreviation: "7800", generation: 3, year: 1986, cpu: "Atari SALLY 6502 @ 1.79 MHz", gpu: "MARIA", ram: "4 KB", wikipedia_title: "Atari 7800" },
    // --- Generation 4 (1987–1993) ---
    ConsoleInfo { key: "pcengine", name: "PC Engine / TurboGrafx-16", manufacturer: "NEC", abbreviation: "PCE", generation: 4, year: 1987, cpu: "Hudson HuC6280 @ 7.16 MHz", gpu: "HuC6270 VDC", ram: "8 KB", wikipedia_title: "TurboGrafx-16" },
    ConsoleInfo { key: "genesis", name: "Sega Genesis / Mega Drive", manufacturer: "Sega", abbreviation: "MD", generation: 4, year: 1988, cpu: "Motorola 68000 @ 7.6 MHz", gpu: "Sega 315-5313 VDP", ram: "64 KB", wikipedia_title: "Sega Genesis" },
    ConsoleInfo { key: "snes", name: "Super Nintendo Entertainment System", manufacturer: "Nintendo", abbreviation: "SNES", generation: 4, year: 1990, cpu: "Ricoh 5A22 @ 3.58 MHz", gpu: "S-PPU1 / S-PPU2", ram: "128 KB", wikipedia_title: "Super Nintendo Entertainment System" },
    ConsoleInfo { key: "neogeo", name: "Neo Geo", manufacturer: "SNK", abbreviation: "NEO", generation: 4, year: 1990, cpu: "Motorola 68000 @ 12 MHz", gpu: "LSPC2-A2 / NEO-B1", ram: "64 KB", wikipedia_title: "Neo Geo (system)" },
    // --- Generation 5 (1993–1998) ---
    ConsoleInfo { key: "3do", name: "3DO Interactive Multiplayer", manufacturer: "Panasonic", abbreviation: "3DO", generation: 5, year: 1993, cpu: "ARM60 @ 12.5 MHz", gpu: "2× custom cel engines", ram: "2 MB", wikipedia_title: "3DO Interactive Multiplayer" },
    ConsoleInfo { key: "jaguar", name: "Atari Jaguar", manufacturer: "Atari", abbreviation: "JAG", generation: 5, year: 1993, cpu: "Tom & Jerry @ 26.6 MHz", gpu: "Tom (object processor)", ram: "2 MB", wikipedia_title: "Atari Jaguar" },
    ConsoleInfo { key: "ps1", name: "Sony PlayStation", manufacturer: "Sony", abbreviation: "PS1", generation: 5, year: 1994, cpu: "MIPS R3000A @ 33.9 MHz", gpu: "Sony GPU", ram: "2 MB", wikipedia_title: "PlayStation (console)" },
    ConsoleInfo { key: "saturn", name: "Sega Saturn", manufacturer: "Sega", abbreviation: "SAT", generation: 5, year: 1994, cpu: "2× Hitachi SH-2 @ 28.6 MHz", gpu: "VDP1 + VDP2", ram: "2 MB", wikipedia_title: "Sega Saturn" },
    ConsoleInfo { key: "n64", name: "Nintendo 64", manufacturer: "Nintendo", abbreviation: "N64", generation: 5, year: 1996, cpu: "NEC VR4300 @ 93.75 MHz", gpu: "SGI RCP @ 62.5 MHz", ram: "4 MB RDRAM", wikipedia_title: "Nintendo 64" },
    // --- Generation 6 (1998–2005) ---
    ConsoleInfo { key: "dreamcast", name: "Sega Dreamcast", manufacturer: "Sega", abbreviation: "DC", generation: 6, year: 1998, cpu: "Hitachi SH-4 @ 200 MHz", gpu: "PowerVR2 CLX2", ram: "16 MB", wikipedia_title: "Dreamcast" },
    ConsoleInfo { key: "ps2", name: "Sony PlayStation 2", manufacturer: "Sony", abbreviation: "PS2", generation: 6, year: 2000, cpu: "Emotion Engine @ 294 MHz", gpu: "Graphics Synthesizer @ 147 MHz", ram: "32 MB RDRAM", wikipedia_title: "PlayStation 2" },
    ConsoleInfo { key: "gamecube", name: "Nintendo GameCube", manufacturer: "Nintendo", abbreviation: "GCN", generation: 6, year: 2001, cpu: "IBM Gekko @ 486 MHz", gpu: "ATI Flipper @ 162 MHz", ram: "24 MB 1T-SRAM", wikipedia_title: "GameCube" },
];

/// Every console, in catalog order (generation then year).
pub fn all() -> &'static [ConsoleInfo] {
    CONSOLES
}

/// Look up a console by its system key.
pub fn get(key: &str) -> Option<&'static ConsoleInfo> {
    CONSOLES.iter().find(|c| c.key == key)
}

/// Look up a console by key, returning [`AppError::NotFound`] when absent.
pub fn require(key: &str) -> AppResult<&'static ConsoleInfo> {
    get(key).ok_or_else(|| AppError::NotFound(format!("unknown console: {key}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_has_twenty_consoles() {
        assert_eq!(CONSOLES.len(), 20);
    }

    #[test]
    fn keys_are_unique() {
        let mut seen = HashSet::new();
        for c in CONSOLES {
            assert!(seen.insert(c.key), "duplicate console key: {}", c.key);
        }
    }

    #[test]
    fn keys_match_core_catalog_systems() {
        // Every console key must be a curated system in the core catalog, so the
        // console-detail "your games" list and the core list line up.
        for c in CONSOLES {
            assert!(
                crate::core::cores::system_map::cores_for(c.key).is_ok(),
                "console key '{}' is not a curated core-catalog system",
                c.key
            );
        }
    }

    #[test]
    fn generations_are_in_range() {
        for c in CONSOLES {
            assert!((2..=6).contains(&c.generation), "{} bad gen", c.key);
        }
    }

    #[test]
    fn every_console_has_hardware_specs() {
        // The console detail page renders a CPU/GPU/RAM table; none may be blank.
        for c in CONSOLES {
            assert!(!c.cpu.is_empty(), "{} missing cpu", c.key);
            assert!(!c.gpu.is_empty(), "{} missing gpu", c.key);
            assert!(!c.ram.is_empty(), "{} missing ram", c.key);
        }
    }

    #[test]
    fn lookup_resolves_and_rejects() {
        assert_eq!(get("nes").unwrap().name, "Nintendo Entertainment System");
        assert!(get("nonexistent").is_none());
        assert!(require("xyz").is_err());
    }
}
