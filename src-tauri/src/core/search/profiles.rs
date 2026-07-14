//! Declarative host profiles for SERP scrape and download-page file discovery
//! (Phase 3). When a page's host matches, prefer profile CSS selectors over the
//! generic structure-aware heuristics.

/// A known host's scrape / file-link hints.
#[derive(Debug, Clone, Copy)]
pub struct HostProfile {
    /// Substring matched against the lowercased host (e.g. `"duckduckgo.com"`).
    pub host_contains: &'static str,
    /// CSS selectors for organic result links on search pages (tried in order).
    pub result_selectors: &'static [&'static str],
    /// CSS selectors for direct file / download controls on detail pages.
    pub file_selectors: &'static [&'static str],
    /// When set, result URLs must contain this path fragment (e.g. `"/details/"`).
    pub result_path_contains: Option<&'static str>,
}

/// Curated profiles — order does not matter; first host match wins.
pub const HOST_PROFILES: &[HostProfile] = &[
    HostProfile {
        host_contains: "duckduckgo.com",
        result_selectors: &[
            "a.result__a",
            "a.result-link",
            ".results_links a.result__a",
            ".result__body a.result__a",
        ],
        file_selectors: &[],
        result_path_contains: None,
    },
    HostProfile {
        host_contains: "archive.org",
        result_selectors: &["a[href*='/details/']"],
        file_selectors: &[
            "a[href*='/download/']",
            "a.download-pill",
            "a[href$='.zip']",
            "a[href$='.7z']",
            "a[href$='.iso']",
            "a[href$='.chd']",
        ],
        result_path_contains: Some("/details/"),
    },
    HostProfile {
        host_contains: "vimm.net",
        result_selectors: &[
            "table.rounded a[href*='/vault/']",
            "a[href*='/vault/']",
        ],
        file_selectors: &[
            "a#download",
            "a[href*='download']",
            "a[href*='media.']",
            "a[href$='.zip']",
        ],
        result_path_contains: Some("/vault/"),
    },
    HostProfile {
        host_contains: "romspedia.com",
        result_selectors: &[
            ".game-item a",
            ".search-results a",
            "a[href*='/rom/']",
            "a[href*='/game/']",
        ],
        file_selectors: &[
            "a.download-button",
            "a[href*='download']",
            "a[href$='.zip']",
        ],
        result_path_contains: None,
    },
    HostProfile {
        host_contains: "romsgames.net",
        result_selectors: &[
            ".game-list a",
            "a[href*='/rom/']",
            "a[href*='/game/']",
        ],
        file_selectors: &[
            "a[href*='download']",
            "a.download",
            "a[href$='.zip']",
        ],
        result_path_contains: None,
    },
    HostProfile {
        host_contains: "romhustler.org",
        result_selectors: &["a[href*='/rom/']", ".results a"],
        file_selectors: &["a[href*='download']", "a[href$='.zip']"],
        result_path_contains: None,
    },
    HostProfile {
        host_contains: "emulatorgames.net",
        result_selectors: &["a[href*='/roms/']", ".post a"],
        file_selectors: &["a[href*='download']", "a[href$='.zip']"],
        result_path_contains: None,
    },
    HostProfile {
        host_contains: "myabandonware.com",
        result_selectors: &["a[href*='/game/']", ".itemlist a"],
        file_selectors: &[
            "a[href*='/download/']",
            "a.download",
            "a[href$='.zip']",
        ],
        result_path_contains: Some("/game/"),
    },
];

/// Find the first profile whose `host_contains` appears in `host` (lowercased).
pub fn profile_for_host(host: &str) -> Option<&'static HostProfile> {
    let h = host.to_ascii_lowercase();
    HOST_PROFILES
        .iter()
        .find(|p| h.contains(p.host_contains))
}

/// Host extracted from an absolute URL, lowercased.
pub fn host_from_url(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .unwrap_or_default()
}

/// True when a result URL from a profile should be kept (path filter).
pub fn result_url_matches_profile(url: &str, profile: &HostProfile) -> bool {
    let Some(frag) = profile.result_path_contains else {
        return true;
    };
    if !url.contains(frag) {
        return false;
    }
    // Reject bare index paths like `/details/` or `/vault/`
    let trimmed = url.trim_end_matches('/');
    !trimmed.ends_with(frag.trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_ddg_and_archive() {
        assert!(profile_for_host("html.duckduckgo.com")
            .unwrap()
            .host_contains
            .contains("duckduckgo"));
        assert!(profile_for_host("archive.org")
            .unwrap()
            .host_contains
            .contains("archive"));
        assert!(profile_for_host("unknown.example.com").is_none());
    }

    #[test]
    fn result_path_filter_rejects_bare_details() {
        let p = profile_for_host("archive.org").unwrap();
        assert!(result_url_matches_profile(
            "https://archive.org/details/sonic_1",
            p
        ));
        assert!(!result_url_matches_profile(
            "https://archive.org/details/",
            p
        ));
        assert!(!result_url_matches_profile("https://archive.org/about", p));
    }
}
