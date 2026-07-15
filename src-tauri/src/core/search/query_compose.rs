//! Phase 4 query composition for provider URL templates.
//!
//! Pure helpers that turn a user game-name + structured filters into the string
//! substituted for `{query}`. Features:
//! - **Title aliases** — expand common short codes (`oot` → `ocarina of time`)
//! - **Quoted multi-word titles** — for meta-search hosts only
//! - **`+rom` / `+zip` suffixes** — bias SERPs toward downloadable hits
//! - **Negative noise terms** — `-emulator -wiki -youtube …` on meta hosts

/// Options that shape the effective provider query (Phase 4).
#[derive(Debug, Clone, Copy, Default)]
pub struct ComposeOpts {
    pub append_rom: bool,
    pub append_zip: bool,
    /// Append `-emulator -wiki -youtube …` for meta-search hosts.
    pub exclude_noise: bool,
    /// Wrap multi-word titles in quotes on meta-search hosts.
    pub quote_title: bool,
}

/// Meta-search negative terms (space-joined with leading minuses).
const META_NEGATIVE_TERMS: &[&str] = &[
    "emulator",
    "emulators",
    "wiki",
    "wikipedia",
    "youtube",
    "walkthrough",
    "guide",
    "speedrun",
    "longplay",
];

/// Curated short-code → fuller title expansions (lowercase keys).
/// Conservative: only well-known abbreviations that otherwise miss ROM hits.
fn alias_canonical(normalized: &str) -> Option<&'static str> {
    match normalized {
        // Nintendo
        "smb" | "smb1" => Some("super mario bros"),
        "smb2" => Some("super mario bros 2"),
        "smb3" => Some("super mario bros 3"),
        "smw" => Some("super mario world"),
        "sm64" => Some("super mario 64"),
        "smo" => Some("super mario odyssey"),
        "smsr" | "smsunshine" => Some("super mario sunshine"),
        "oot" | "ocarina" => Some("legend of zelda ocarina of time"),
        "mm" | "majora" | "majoras mask" => Some("legend of zelda majoras mask"),
        "alttp" | "lttp" => Some("legend of zelda a link to the past"),
        "tp" | "twilight princess" => Some("legend of zelda twilight princess"),
        "botw" => Some("legend of zelda breath of the wild"),
        "totk" => Some("legend of zelda tears of the kingdom"),
        "la" | "links awakening" => Some("legend of zelda links awakening"),
        "ssbm" | "melee" => Some("super smash bros melee"),
        "ssbb" | "brawl" => Some("super smash bros brawl"),
        // Sega / Sonic
        "s&k" | "s and k" | "sonic and knuckles" => Some("sonic and knuckles"),
        "sonic 3k" | "s3k" => Some("sonic 3 and knuckles"),
        "s3" | "sonic 3" => Some("sonic the hedgehog 3"),
        "sonic 2" | "s2" => Some("sonic the hedgehog 2"),
        // Capcom / others
        "mmx" | "megaman x" | "mega man x" => Some("mega man x"),
        "mm2" | "megaman 2" => Some("mega man 2"),
        "sf2" | "street fighter 2" => Some("street fighter ii"),
        "ff7" | "ffvii" => Some("final fantasy vii"),
        "ff6" | "ffvi" => Some("final fantasy vi"),
        "ff4" | "ffiv" => Some("final fantasy iv"),
        "chrono" | "ct" => Some("chrono trigger"),
        "dq" => Some("dragon quest"),
        "metroid prime" | "mp1" => Some("metroid prime"),
        "sm" | "super metroid" => Some("super metroid"),
        "cv" => Some("castlevania"),
        "sotn" => Some("castlevania symphony of the night"),
        "pokémon red" | "pokemon red" => Some("pokemon red"),
        "pokémon blue" | "pokemon blue" => Some("pokemon blue"),
        "pokémon yellow" | "pokemon yellow" => Some("pokemon yellow"),
        "pokémon gold" | "pokemon gold" => Some("pokemon gold"),
        "pokémon silver" | "pokemon silver" => Some("pokemon silver"),
        "pokémon crystal" | "pokemon crystal" => Some("pokemon crystal"),
        _ => None,
    }
}

/// Normalize for alias lookup: lowercase, collapse non-alnum to single spaces.
pub fn normalize_for_alias(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_space = true;
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() || c == '&' {
            out.push(c);
            prev_space = false;
        } else if !prev_space {
            out.push(' ');
            prev_space = true;
        }
    }
    out.trim().to_string()
}

/// Expand a well-known short title to a fuller search string when it matches
/// the whole query (not mid-phrase). Returns the original when no alias hits.
pub fn expand_title_aliases(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let key = normalize_for_alias(trimmed);
    if let Some(canon) = alias_canonical(&key) {
        return canon.to_string();
    }
    // Also try without punctuation-only differences already handled.
    trimmed.to_string()
}

/// True when the template points at a meta web-search host (DDG, Bing, …).
pub fn is_meta_search_template(url_template: &str) -> bool {
    let t = url_template.to_ascii_lowercase();
    t.contains("duckduckgo.com")
        || t.contains("bing.com")
        || t.contains("yandex.")
        || t.contains("startpage.com")
        || t.contains("search.brave.com")
        || t.contains("google.com/search")
}

/// Meta-search always benefits from `rom`/`zip` suffixes when opted in;
/// other download providers only when they compose console/region filters.
pub fn should_append_file_suffix(kind: &str, url_template: &str, compose: bool) -> bool {
    is_meta_search_template(url_template) || (compose && kind == "download")
}

fn token_present(hay: &str, needle: &str) -> bool {
    hay.split(|c: char| !c.is_ascii_alphanumeric())
        .any(|t| t.eq_ignore_ascii_case(needle))
}

fn quote_if_multiword(title: &str) -> String {
    let t = title.trim();
    if t.is_empty() {
        return String::new();
    }
    // Already quoted by the user — leave alone.
    if (t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')) {
        return t.to_string();
    }
    let words = t.split_whitespace().count();
    if words >= 2 {
        format!("\"{t}\"")
    } else {
        t.to_string()
    }
}

fn append_negatives(q: &mut String) {
    let lower = q.to_ascii_lowercase();
    for term in META_NEGATIVE_TERMS {
        // Skip if the user already included +term or -term or bare term.
        if token_present(&lower, term) {
            continue;
        }
        let neg = format!("-{term}");
        if lower.contains(&neg) {
            continue;
        }
        if !q.is_empty() {
            q.push(' ');
        }
        q.push_str(&neg);
    }
}

/// Build the effective query for one provider.
///
/// Pipeline:
/// 1. Expand title aliases on the bare game name
/// 2. Optionally quote multi-word titles (meta only)
/// 3. Append console/region when `compose` is on
/// 4. Append `rom` / `zip` when opted in and applicable
/// 5. Append negative noise terms (meta + exclude_noise)
pub fn effective_query(
    query: &str,
    console: &str,
    region: &str,
    compose: bool,
    kind: &str,
    url_template: &str,
    opts: ComposeOpts,
) -> String {
    let expanded = expand_title_aliases(query);
    let meta = is_meta_search_template(url_template);

    let title = if opts.quote_title && meta {
        quote_if_multiword(&expanded)
    } else {
        expanded.trim().to_string()
    };

    let mut q = if !compose {
        title
    } else {
        let mut parts: Vec<String> = Vec::new();
        if !title.is_empty() {
            parts.push(title);
        }
        // Expand MD / genesis / "mega drive" etc. into a meta OR group or a
        // single primary token for ROM-site templates (console_aliases).
        let console_filter =
            crate::core::search::console_aliases::compose_console_filter(console, meta);
        if !console_filter.is_empty() {
            parts.push(console_filter);
        }
        let reg = region.trim();
        if !reg.is_empty() {
            parts.push(reg.to_string());
        }
        parts.join(" ")
    };

    if opts.append_rom && should_append_file_suffix(kind, url_template, compose) {
        let lower = q.to_ascii_lowercase();
        if !token_present(&lower, "rom") && !token_present(&lower, "roms") && !q.is_empty() {
            q.push_str(" rom");
        }
    }

    if opts.append_zip && should_append_file_suffix(kind, url_template, compose) {
        let lower = q.to_ascii_lowercase();
        if !token_present(&lower, "zip") && !q.is_empty() {
            q.push_str(" zip");
        }
    }

    if opts.exclude_noise && meta && !q.is_empty() {
        append_negatives(&mut q);
    }

    q
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(rom: bool, zip: bool, neg: bool, quote: bool) -> ComposeOpts {
        ComposeOpts {
            append_rom: rom,
            append_zip: zip,
            exclude_noise: neg,
            quote_title: quote,
        }
    }

    #[test]
    fn expands_known_aliases() {
        assert_eq!(expand_title_aliases("oot"), "legend of zelda ocarina of time");
        assert_eq!(expand_title_aliases("SMB3"), "super mario bros 3");
        assert_eq!(expand_title_aliases("s3k"), "sonic 3 and knuckles");
        assert_eq!(expand_title_aliases("sonic the hedgehog"), "sonic the hedgehog");
    }

    #[test]
    fn no_compose_returns_bare_expanded() {
        assert_eq!(
            effective_query(
                "super mario",
                "SNES",
                "USA",
                false,
                "download",
                "https://example.com/?q={query}",
                opts(false, false, false, false)
            ),
            "super mario"
        );
    }

    #[test]
    fn compose_appends_filters() {
        // Non-meta: console aliases resolve to a single primary token.
        assert_eq!(
            effective_query(
                "super mario",
                "SNES",
                "USA",
                true,
                "download",
                "https://example.com/?q={query}",
                opts(false, false, false, false)
            ),
            "super mario snes USA"
        );
    }

    #[test]
    fn compose_meta_ors_genesis_aliases() {
        let q = effective_query(
            "sonic",
            "MD",
            "",
            true,
            "download",
            "https://html.duckduckgo.com/html/?q={query}",
            opts(false, false, false, false),
        );
        assert!(q.contains("sonic"), "got {q}");
        assert!(q.contains(" OR "), "expected meta OR group, got {q}");
        assert!(q.to_ascii_lowercase().contains("genesis"), "got {q}");
    }

    #[test]
    fn quote_multiword_on_meta() {
        let q = effective_query(
            "sonic the hedgehog",
            "MD",
            "",
            true,
            "download",
            "https://html.duckduckgo.com/html/?q={query}",
            opts(false, false, false, true),
        );
        assert!(q.starts_with("\"sonic the hedgehog\""), "got {q}");
        // Meta compose expands MD → OR group with genesis / mega drive / …
        assert!(q.contains(" OR ") || q.to_ascii_lowercase().contains("genesis"), "got {q}");
    }

    #[test]
    fn no_quote_on_non_meta() {
        let q = effective_query(
            "sonic the hedgehog",
            "",
            "",
            false,
            "download",
            "https://roms.example.com/?q={query}",
            opts(false, false, false, true),
        );
        assert_eq!(q, "sonic the hedgehog");
    }

    #[test]
    fn append_rom_and_zip_for_ddg() {
        let q = effective_query(
            "sonic",
            "",
            "",
            false,
            "download",
            "https://html.duckduckgo.com/html/?q={query}",
            opts(true, true, false, false),
        );
        assert_eq!(q, "sonic rom zip");
    }

    #[test]
    fn append_rom_skips_when_present() {
        let q = effective_query(
            "sonic rom",
            "",
            "",
            false,
            "download",
            "https://html.duckduckgo.com/html/?q={query}",
            opts(true, false, false, false),
        );
        assert_eq!(q, "sonic rom");
    }

    #[test]
    fn negatives_on_meta_only() {
        let q = effective_query(
            "sonic",
            "",
            "",
            false,
            "download",
            "https://html.duckduckgo.com/html/?q={query}",
            opts(false, false, true, false),
        );
        assert!(q.starts_with("sonic -"));
        assert!(q.contains("-emulator"));
        assert!(q.contains("-youtube"));
        assert!(q.contains("-wiki"));

        let non_meta = effective_query(
            "sonic",
            "",
            "",
            false,
            "download",
            "https://roms.example.com/?q={query}",
            opts(false, false, true, false),
        );
        assert_eq!(non_meta, "sonic");
    }

    #[test]
    fn alias_then_compose() {
        let q = effective_query(
            "oot",
            "N64",
            "",
            true,
            "download",
            "https://html.duckduckgo.com/html/?q={query}",
            opts(true, false, false, true),
        );
        assert!(q.contains("ocarina of time"), "got {q}");
        // Meta: N64 expands to an OR group including n64 / nintendo 64.
        assert!(
            q.to_ascii_lowercase().contains("n64") || q.contains(" OR "),
            "got {q}"
        );
        assert!(q.contains("rom"));
    }
}
