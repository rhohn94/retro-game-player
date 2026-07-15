//! Console aliases for search compose and related lookup.
//!
//! Selecting "MD" (Genesis / Mega Drive) should not force only the short tag
//! into provider queries. Meta-search gets an OR group of common names;
//! download-site compose uses a single primary token that ROM catalogs know.

/// One console's search vocabulary.
#[derive(Debug, Clone, Copy)]
pub struct ConsoleSearchAliases {
    /// Canonical system key (matches console catalog / games.system).
    pub key: &'static str,
    /// Short tag shown in the UI (e.g. "MD").
    pub abbreviation: &'static str,
    /// Single token appended to non-meta compose queries.
    pub primary: &'static str,
    /// All common names / tags that should rank or OR-match as this console.
    /// Multi-word entries are quoted when building meta OR groups.
    pub aliases: &'static [&'static str],
}

/// Curated alias table. Lookup by key, abbreviation, or any alias (case-insensitive).
const TABLE: &[ConsoleSearchAliases] = &[
    ConsoleSearchAliases {
        key: "atari2600",
        abbreviation: "2600",
        primary: "2600",
        aliases: &["atari 2600", "2600", "a2600", "vcs"],
    },
    ConsoleSearchAliases {
        key: "odyssey2",
        abbreviation: "O²",
        primary: "odyssey2",
        aliases: &["odyssey 2", "odyssey2", "odyssey²", "videopac"],
    },
    ConsoleSearchAliases {
        key: "intellivision",
        abbreviation: "INTV",
        primary: "intellivision",
        aliases: &["intellivision", "intv"],
    },
    ConsoleSearchAliases {
        key: "atari5200",
        abbreviation: "5200",
        primary: "5200",
        aliases: &["atari 5200", "5200"],
    },
    ConsoleSearchAliases {
        key: "colecovision",
        abbreviation: "CV",
        primary: "colecovision",
        aliases: &["colecovision", "coleco vision"],
    },
    ConsoleSearchAliases {
        key: "nes",
        abbreviation: "NES",
        primary: "nes",
        aliases: &["nes", "famicom", "nintendo entertainment system", "fc"],
    },
    ConsoleSearchAliases {
        key: "mastersystem",
        abbreviation: "SMS",
        primary: "sms",
        aliases: &["master system", "mastersystem", "sms", "mark iii"],
    },
    ConsoleSearchAliases {
        key: "atari7800",
        abbreviation: "7800",
        primary: "7800",
        aliases: &["atari 7800", "7800"],
    },
    ConsoleSearchAliases {
        key: "pcengine",
        abbreviation: "PCE",
        primary: "pc engine",
        aliases: &[
            "pc engine",
            "turbografx",
            "turbografx-16",
            "turbografx 16",
            "tg16",
            "pce",
            "hucard",
        ],
    },
    // Dual-region: US Genesis vs JP/EU Mega Drive — the motivating case.
    ConsoleSearchAliases {
        key: "genesis",
        abbreviation: "MD",
        primary: "genesis",
        aliases: &[
            "genesis",
            "mega drive",
            "megadrive",
            "md",
            "smd",
            "gen",
            "sega genesis",
            "sega mega drive",
        ],
    },
    ConsoleSearchAliases {
        key: "gb",
        abbreviation: "GB",
        primary: "game boy",
        aliases: &["game boy", "gameboy", "gb", "dmg"],
    },
    ConsoleSearchAliases {
        key: "snes",
        abbreviation: "SNES",
        primary: "snes",
        aliases: &[
            "snes",
            "super nintendo",
            "super famicom",
            "sfc",
            "super nes",
        ],
    },
    ConsoleSearchAliases {
        key: "neogeo",
        abbreviation: "NEO",
        primary: "neo geo",
        aliases: &["neo geo", "neogeo", "aes", "mvs"],
    },
    ConsoleSearchAliases {
        key: "3do",
        abbreviation: "3DO",
        primary: "3do",
        aliases: &["3do"],
    },
    ConsoleSearchAliases {
        key: "jaguar",
        abbreviation: "JAG",
        primary: "jaguar",
        aliases: &["atari jaguar", "jaguar"],
    },
    ConsoleSearchAliases {
        key: "ps1",
        abbreviation: "PS1",
        primary: "ps1",
        aliases: &[
            "ps1",
            "psx",
            "playstation",
            "playstation 1",
            "psone",
            "ps 1",
        ],
    },
    ConsoleSearchAliases {
        key: "saturn",
        abbreviation: "SAT",
        primary: "saturn",
        aliases: &["sega saturn", "saturn"],
    },
    ConsoleSearchAliases {
        key: "n64",
        abbreviation: "N64",
        primary: "n64",
        aliases: &["n64", "nintendo 64", "ultra 64"],
    },
    ConsoleSearchAliases {
        key: "gbc",
        abbreviation: "GBC",
        primary: "gbc",
        aliases: &["game boy color", "gameboy color", "gbc", "cgb"],
    },
    ConsoleSearchAliases {
        key: "dreamcast",
        abbreviation: "DC",
        primary: "dreamcast",
        aliases: &["dreamcast", "dc", "sega dreamcast"],
    },
    ConsoleSearchAliases {
        key: "ps2",
        abbreviation: "PS2",
        primary: "ps2",
        aliases: &["ps2", "playstation 2", "playstation2"],
    },
    ConsoleSearchAliases {
        key: "gamecube",
        abbreviation: "GCN",
        primary: "gamecube",
        aliases: &["gamecube", "game cube", "gcn", "ngc"],
    },
    ConsoleSearchAliases {
        key: "gba",
        abbreviation: "GBA",
        primary: "gba",
        aliases: &["game boy advance", "gameboy advance", "gba", "agb"],
    },
    ConsoleSearchAliases {
        key: "wii",
        abbreviation: "Wii",
        primary: "wii",
        aliases: &["wii", "nintendo wii"],
    },
];

fn norm(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_space = true;
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

/// Resolve a console key, abbreviation, or free-text alias to its search set.
pub fn resolve(console: &str) -> Option<&'static ConsoleSearchAliases> {
    let raw = console.trim();
    if raw.is_empty() {
        return None;
    }
    let n = norm(raw);
    // Prefer exact key / abbreviation matches first.
    for row in TABLE {
        if row.key.eq_ignore_ascii_case(raw) || row.abbreviation.eq_ignore_ascii_case(raw) {
            return Some(row);
        }
        if norm(row.key) == n || norm(row.abbreviation) == n {
            return Some(row);
        }
    }
    // Then any alias (full string match after normalize).
    for row in TABLE {
        for a in row.aliases {
            if norm(a) == n {
                return Some(row);
            }
        }
    }
    None
}

/// Token(s) appended into a provider query when compose-filters is on.
///
/// - **Meta search** (DDG, …): multi-alias consoles become
///   `(genesis OR "mega drive" OR md OR …)` so SERPs cover regional names.
/// - **Other providers**: a single `primary` token (ROM catalogs rarely parse OR).
/// - Unknown input is passed through trimmed.
pub fn compose_console_filter(console: &str, for_meta: bool) -> String {
    let raw = console.trim();
    if raw.is_empty() {
        return String::new();
    }
    let Some(set) = resolve(raw) else {
        return raw.to_string();
    };
    if for_meta && set.aliases.len() > 1 {
        let parts: Vec<String> = set
            .aliases
            .iter()
            // Cap OR width — keep the highest-value aliases first in the table.
            .take(6)
            .map(|a| {
                if a.contains(char::is_whitespace) {
                    format!("\"{a}\"")
                } else {
                    (*a).to_string()
                }
            })
            .collect();
        format!("({})", parts.join(" OR "))
    } else {
        set.primary.to_string()
    }
}

/// Flat alias list for ranking / Match boosts (key + abbr + aliases).
pub fn ranking_tokens(console: &str) -> Vec<String> {
    let raw = console.trim();
    if raw.is_empty() {
        return Vec::new();
    }
    if let Some(set) = resolve(raw) {
        let mut out = Vec::with_capacity(set.aliases.len() + 2);
        out.push(set.key.to_string());
        out.push(set.abbreviation.to_string());
        for a in set.aliases {
            out.push((*a).to_string());
        }
        // Dedup while preserving order (case-insensitive).
        let mut seen = std::collections::HashSet::new();
        out.retain(|t| seen.insert(norm(t)));
        return out;
    }
    vec![raw.to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_genesis_by_key_abbr_and_alias() {
        assert_eq!(resolve("genesis").unwrap().key, "genesis");
        assert_eq!(resolve("MD").unwrap().key, "genesis");
        assert_eq!(resolve("mega drive").unwrap().key, "genesis");
        assert_eq!(resolve("SMD").unwrap().key, "genesis");
    }

    #[test]
    fn meta_compose_ors_genesis_names() {
        let q = compose_console_filter("MD", true);
        assert!(q.starts_with('(') && q.ends_with(')'), "got {q}");
        assert!(q.contains(" OR "));
        assert!(q.to_ascii_lowercase().contains("genesis"));
        assert!(q.contains("mega drive") || q.contains("\"mega drive\""));
        assert!(q.to_ascii_lowercase().contains("md"));
    }

    #[test]
    fn non_meta_compose_uses_primary() {
        assert_eq!(compose_console_filter("MD", false), "genesis");
        assert_eq!(compose_console_filter("snes", false), "snes");
    }

    #[test]
    fn unknown_console_passes_through() {
        assert_eq!(compose_console_filter("CustomBox", true), "CustomBox");
    }

    #[test]
    fn ranking_tokens_include_regional_names() {
        let t = ranking_tokens("genesis");
        let joined = t.join(" ").to_ascii_lowercase();
        assert!(joined.contains("genesis"));
        assert!(joined.contains("mega drive") || joined.contains("megadrive"));
        assert!(joined.contains("md"));
    }

    #[test]
    fn empty_is_empty() {
        assert!(compose_console_filter("", true).is_empty());
        assert!(ranking_tokens("").is_empty());
    }
}
