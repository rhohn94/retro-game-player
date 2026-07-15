//! Static provider catalog (v0.20 "Atlas", extended v0.45 research).
//!
//! A curated directory of search providers the user can discover and add in
//! one click. Includes legitimate storefronts/archives **and** a research
//! "ROM archives" section for private testability (seeded by migration 017).
//! Adding an entry creates a normal `search_providers` row.
//!
//! `js_rendered` marks a provider whose search page is client-rendered.
//! `priority` / `suggest_direct_download` guide list order and DD defaults
//! when the user adds from the gallery.

/// One catalog entry. `url_template` carries the `{query}` placeholder and is
/// the exact template written into `search_providers` when the user adds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct CatalogProvider {
    /// Display + unique provider name (matched against existing rows for `added`).
    pub name: &'static str,
    /// URL template containing `{query}` (https, links-only).
    pub url_template: &'static str,
    /// `"download"` (links to obtainable content) or `"reference"` (metadata).
    pub kind: &'static str,
    /// A short media-type tag used to filter the gallery (e.g. "Indie & homebrew").
    pub media: &'static str,
    /// One-line description of what the provider offers.
    pub description: &'static str,
    /// True when the search page is JavaScript-rendered (static scrape finds no
    /// links today; the JS-render tier will unlock it).
    pub js_rendered: bool,
    /// Suggested list priority when added (lower = higher in search results).
    pub priority: i64,
    /// When true, one-click add enables direct_download for this entry.
    pub suggest_direct_download: bool,
}

/// Helper to keep catalog rows readable.
const fn entry(
    name: &'static str,
    url_template: &'static str,
    kind: &'static str,
    media: &'static str,
    description: &'static str,
    js_rendered: bool,
    priority: i64,
    suggest_direct_download: bool,
) -> CatalogProvider {
    CatalogProvider {
        name,
        url_template,
        kind,
        media,
        description,
        js_rendered,
        priority,
        suggest_direct_download,
    }
}

/// The curated catalog. Every entry is an https `{query}` template (asserted by tests).
const CATALOG: &[CatalogProvider] = &[
    // --- Meta web search (best discovery titles; scrape-friendly endpoints only) ---
    entry(
        "DuckDuckGo",
        "https://html.duckduckgo.com/html/?q={query}",
        "download",
        "Web search",
        "Meta search over the web — organic titles (Archive.org, vaults, stores). Prefer this for discovery; not a direct file host.",
        false,
        5,
        false,
    ),
    // --- ROM archives (research T3 — pre-seeded by 017; priority 25 after 019) ---
    // Research ROM archives (T3) — lower priority than preservation; DD suggested.
    entry("RomsGames", "https://www.romsgames.net/?s={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("Romspedia", "https://romspedia.com/search?term={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("RomsFun", "https://www.romsfun.com/?s={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("WoWROMs", "https://wowroms.com/en/roms/list?search={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("CoolROM", "https://coolrom.com.au/search?q={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("EmulatorGames", "https://www.emulatorgames.net/?s={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("ROMSPURE", "https://romspure.cc/search?q={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("Retrostic", "https://www.retrostic.com/search?search={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("Gamulator", "https://www.gamulator.com/?s={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("ROMsMania", "https://romsmania.cc/?s={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    entry("Romulation", "https://www.romulation.org/roms/search?query={query}", "download", "ROM archives", "Research seed — general ROM search template.", false, 25, true),
    // --- Indie & homebrew storefronts ---
    entry("itch.io", "https://itch.io/search?q={query}", "download", "Indie & homebrew", "The largest independent game storefront — homebrew, freeware, and commercial indies.", true, 30, false),
    entry("GameJolt", "https://gamejolt.com/search?q={query}", "download", "Indie & homebrew", "Indie game community and storefront with many free and homebrew titles.", true, 30, false),
    // --- Trusted collections (T1) — homebrew / PD / demoscene ---
    entry("PDRoms", "https://www.pdroms.de/?s={query}", "download", "Homebrew & public-domain", "Curated homebrew and public-domain games and ports for retro systems.", false, 10, false),
    entry("Lexaloffle BBS", "https://www.lexaloffle.com/bbs/?search={query}", "download", "Homebrew & public-domain", "Community board for PICO-8 and Voxatron — thousands of author-released fantasy-console games (v0.25, live-verified).", false, 10, false),
    entry("OpenGameArt", "https://opengameart.org/art-search?keys={query}", "download", "Homebrew & public-domain", "Free/CC-licensed and public-domain game art, sprites, and audio for creators (v0.25, live-verified).", false, 10, false),
    // --- Demoscene ---
    entry("Demozoo", "https://demozoo.org/productions/?q={query}", "download", "Demoscene", "Demoscene database — author-released demos, intros, and games.", false, 10, false),
    entry("Pouet", "https://www.pouet.net/prodlist.php?prod={query}", "download", "Demoscene", "Long-running demoscene production database.", false, 10, false),
    // --- Preservation libraries (T1) — preferred Get path ---
    entry("Internet Archive", "https://archive.org/search?query={query}", "download", "Preservation library", "Nonprofit digital library hosting software, games, and historical media.", false, 8, true),
    // --- ROM hacks, translations & music ---
    entry("ROMhacking.net", "https://www.romhacking.net/hacks/?title={query}", "download", "Hacks & translations", "Catalog of fan-made ROM hacks and translations distributed as patches.", false, 10, false),
    entry("Zophar's Domain", "https://www.zophar.net/music/search?search={query}", "download", "Game music", "Preservation resource for game-music rips and homebrew.", false, 10, false),
    // --- Licensed storefronts ---
    entry("Steam", "https://store.steampowered.com/search/?term={query}", "download", "Storefront", "Valve's licensed commercial storefront, including many retro re-releases.", false, 30, false),
    entry("GOG", "https://www.gog.com/en/games?query={query}", "download", "Storefront", "DRM-free storefront strong on classic and retro PC games.", true, 30, false),
    // --- Reference / metadata ---
    entry("MobyGames", "https://www.mobygames.com/search/?q={query}", "reference", "Reference", "Comprehensive cross-platform game metadata database.", false, 80, false),
    entry("IGDB", "https://www.igdb.com/search?type=1&q={query}", "reference", "Reference", "Internet Game Database — metadata, art, and release info.", false, 80, false),
    entry("Wikipedia", "https://en.wikipedia.org/w/index.php?search={query}", "reference", "Reference", "Encyclopedia articles for games, systems, and developers.", false, 80, false),
    entry("GameFAQs", "https://gamefaqs.gamespot.com/search?game={query}", "reference", "Guides & data", "Guides, FAQs, and release data across platforms.", false, 80, false),
    entry("Lemon Amiga", "https://www.lemonamiga.com/games/list.php?list_title={query}", "reference", "Reference", "Reference database for Amiga games (metadata only; no files hosted).", false, 80, false),
    entry("TheGamesDB", "https://thegamesdb.net/search.php?name={query}", "reference", "Reference", "Open, community-maintained game metadata and artwork database (v0.25, live-verified).", false, 80, false),
    entry("Hardcore Gaming 101", "https://hg101.kontek.net/?s={query}", "reference", "Guides & data", "In-depth articles and histories on retro and obscure games (v0.25, live-verified).", false, 80, false),
];

/// The full catalog, in display order.
pub fn all() -> &'static [CatalogProvider] {
    CATALOG
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_is_an_https_query_link() {
        for p in all() {
            assert!(
                p.url_template.starts_with("https://"),
                "{} must be https",
                p.name
            );
            assert!(
                p.url_template.contains("{query}"),
                "{} must contain {{query}}",
                p.name
            );
        }
    }

    #[test]
    fn kinds_are_known() {
        for p in all() {
            assert!(
                p.kind == "download" || p.kind == "reference",
                "{} has unknown kind {}",
                p.name,
                p.kind
            );
        }
    }

    #[test]
    fn names_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for p in all() {
            assert!(seen.insert(p.name), "duplicate catalog name {}", p.name);
        }
    }

    #[test]
    fn catalog_is_non_trivial() {
        assert!(all().len() >= 12, "expected a substantial catalog");
    }
}
