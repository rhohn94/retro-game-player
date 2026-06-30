//! Static provider catalog (v0.20 "Atlas").
//!
//! A curated directory of **legitimate** search providers the user can discover
//! and add in one click — storefronts, indie/homebrew and demoscene archives,
//! preservation libraries, and reference databases. It is the data behind the
//! "Browse providers" gallery; adding an entry just creates a normal
//! `search_providers` row, so the user can then edit, disable, or remove it like
//! any other.
//!
//! Scope (deliberate): this catalog lists only legitimate sources. It is **not**
//! a directory of copyrighted-ROM sites, and Harmony does not web-search the open
//! internet for download sites. Users who want any other source add it manually
//! via the provider dialog — the catalog never gates that.
//!
//! `js_rendered` marks a provider whose search page is client-rendered, so the
//! current static-HTML scrape finds no links on it (the upcoming JS-render fetch
//! tier will unlock these). The gallery surfaces that honestly rather than
//! offering a provider that silently returns nothing.

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
}

/// The curated catalog. Adding a provider is a one-line edit here. Every entry
/// is a legitimate source and an https `{query}` template (asserted by tests).
const CATALOG: &[CatalogProvider] = &[
    // --- Indie & homebrew storefronts ---
    CatalogProvider { name: "itch.io", url_template: "https://itch.io/search?q={query}", kind: "download", media: "Indie & homebrew", description: "The largest independent game storefront — homebrew, freeware, and commercial indies.", js_rendered: true },
    CatalogProvider { name: "GameJolt", url_template: "https://gamejolt.com/search?q={query}", kind: "download", media: "Indie & homebrew", description: "Indie game community and storefront with many free and homebrew titles.", js_rendered: true },
    // --- Public-domain & homebrew ROMs ---
    CatalogProvider { name: "PDRoms", url_template: "https://www.pdroms.de/?s={query}", kind: "download", media: "Homebrew & public-domain", description: "Curated homebrew and public-domain games and ports for retro systems.", js_rendered: false },
    // --- Demoscene ---
    CatalogProvider { name: "Demozoo", url_template: "https://demozoo.org/productions/?q={query}", kind: "download", media: "Demoscene", description: "Demoscene database — author-released demos, intros, and games.", js_rendered: false },
    CatalogProvider { name: "Pouet", url_template: "https://www.pouet.net/prodlist.php?prod={query}", kind: "download", media: "Demoscene", description: "Long-running demoscene production database.", js_rendered: false },
    // --- Preservation libraries ---
    CatalogProvider { name: "Internet Archive", url_template: "https://archive.org/search?query={query}", kind: "download", media: "Preservation library", description: "Nonprofit digital library hosting software, games, and historical media.", js_rendered: false },
    // --- ROM hacks, translations & music ---
    CatalogProvider { name: "ROMhacking.net", url_template: "https://www.romhacking.net/hacks/?title={query}", kind: "download", media: "Hacks & translations", description: "Catalog of fan-made ROM hacks and translations distributed as patches.", js_rendered: false },
    CatalogProvider { name: "Zophar's Domain", url_template: "https://www.zophar.net/music/search?search={query}", kind: "download", media: "Game music", description: "Preservation resource for game-music rips and homebrew.", js_rendered: false },
    // --- Licensed storefronts ---
    CatalogProvider { name: "Steam", url_template: "https://store.steampowered.com/search/?term={query}", kind: "download", media: "Storefront", description: "Valve's licensed commercial storefront, including many retro re-releases.", js_rendered: false },
    CatalogProvider { name: "GOG", url_template: "https://www.gog.com/en/games?query={query}", kind: "download", media: "Storefront", description: "DRM-free storefront strong on classic and retro PC games.", js_rendered: true },
    // --- Reference / metadata ---
    CatalogProvider { name: "MobyGames", url_template: "https://www.mobygames.com/search/?q={query}", kind: "reference", media: "Reference", description: "Comprehensive cross-platform game metadata database.", js_rendered: false },
    CatalogProvider { name: "IGDB", url_template: "https://www.igdb.com/search?type=1&q={query}", kind: "reference", media: "Reference", description: "Internet Game Database — metadata, art, and release info.", js_rendered: false },
    CatalogProvider { name: "Wikipedia", url_template: "https://en.wikipedia.org/w/index.php?search={query}", kind: "reference", media: "Reference", description: "Encyclopedia articles for games, systems, and developers.", js_rendered: false },
    CatalogProvider { name: "GameFAQs", url_template: "https://gamefaqs.gamespot.com/search?game={query}", kind: "reference", media: "Guides & data", description: "Guides, FAQs, and release data across platforms.", js_rendered: false },
    CatalogProvider { name: "Lemon Amiga", url_template: "https://www.lemonamiga.com/games/list.php?list_title={query}", kind: "reference", media: "Reference", description: "Reference database for Amiga games (metadata only; no files hosted).", js_rendered: false },
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
