//! Link-liveness probing for previewed search results (v0.19 "Reach").
//!
//! A previewed link that 404s is the worst browsing outcome, so this module adds
//! an OPTIONAL, opt-in liveness check: a cheap `HEAD` request per candidate URL
//! that classifies it as alive / dead / unknown. This is a **probe, not a
//! download** — it reads only response headers (no body), so it stays within
//! Harmony's no-download contract (download-browsing-ux-design.md §6).
//!
//! The probe is conservative: only a definitive 404/410 marks a link `dead`; an
//! anti-bot 403, a 429, a method-rejected 405, or any network/timeout error maps
//! to `unknown` rather than falsely condemning a live page. Probes are bounded
//! (a hard URL cap, a short timeout, and capped concurrency processed in batches)
//! so a large result set or a slow host cannot hang or flood anyone.

use std::time::Duration;

/// Per-request timeout. Short — a slow host degrades to `unknown`, never a hang.
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

/// Hard cap on how many URLs a single call will probe (protects the user's
/// network and remote hosts regardless of how many links a search returned).
const MAX_PROBES: usize = 64;

/// How many probes run at once. Batches are processed sequentially, so at most
/// this many requests are in flight — a courtesy to the probed hosts.
const PROBE_CONCURRENCY: usize = 8;

/// Descriptive User-Agent so probed hosts can identify the client.
const USER_AGENT: &str = concat!(
    "Harmony/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/rhohn94/harmony)"
);

/// The liveness verdict for one link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkState {
    /// The host answered with a success/redirect status — the page is reachable.
    Alive,
    /// The host answered with a definitive "gone" (404 / 410).
    Dead,
    /// Indeterminate — blocked (403/429), method-rejected (405), a server error,
    /// or a network/timeout failure. Never claimed dead on a maybe.
    Unknown,
}

/// One probed URL paired with its verdict (mirrors TS `LinkStatus`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct LinkStatus {
    pub url: String,
    pub state: LinkState,
}

impl LinkStatus {
    fn new(url: &str, state: LinkState) -> Self {
        LinkStatus {
            url: url.to_string(),
            state,
        }
    }
}

/// Map an HTTP status code to a verdict. Pure — the testable core of the probe.
///
/// Only 404/410 are treated as `dead`; every other non-2xx/3xx code is `unknown`
/// (an anti-bot 403, a rate-limit 429, a method-not-allowed 405, or a transient
/// 5xx say nothing definitive about whether the resource exists).
pub fn classify_status(code: u16) -> LinkState {
    match code {
        200..=399 => LinkState::Alive,
        404 | 410 => LinkState::Dead,
        _ => LinkState::Unknown,
    }
}

/// True when `url` parses as an absolute http(s) URL (never probe anything else).
fn is_http_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .map(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or(false)
}

/// Probe a single URL with a `HEAD` request and classify the outcome. Any
/// transport error (DNS, connect, timeout, TLS) is `unknown`, never `dead`.
fn probe_one(client: &reqwest::blocking::Client, url: &str) -> LinkStatus {
    if !is_http_url(url) {
        return LinkStatus::new(url, LinkState::Unknown);
    }
    match client.head(url).send() {
        Ok(resp) => LinkStatus::new(url, classify_status(resp.status().as_u16())),
        Err(_) => LinkStatus::new(url, LinkState::Unknown),
    }
}

/// Probe up to {@link MAX_PROBES} URLs for liveness, in concurrency-capped
/// batches, returning one verdict per probed URL in input order. If the HTTP
/// client cannot be built, every URL degrades to `unknown` (the probe never
/// fails the caller). URLs beyond the cap are simply not probed.
pub fn probe_links(urls: &[String]) -> Vec<LinkStatus> {
    let capped = &urls[..urls.len().min(MAX_PROBES)];
    let client = match reqwest::blocking::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return capped
                .iter()
                .map(|u| LinkStatus::new(u, LinkState::Unknown))
                .collect();
        }
    };

    let mut out = Vec::with_capacity(capped.len());
    for chunk in capped.chunks(PROBE_CONCURRENCY) {
        let batch = std::thread::scope(|scope| {
            let client = &client;
            let handles: Vec<_> = chunk
                .iter()
                .map(|u| (u, scope.spawn(move || probe_one(client, u))))
                .collect();
            handles
                .into_iter()
                .map(|(u, h)| {
                    // A panicking probe thread degrades that one URL to `unknown`
                    // (never `dead` on a maybe) rather than panicking the whole
                    // batch — matches this module's own "never falsely condemn"
                    // contract.
                    h.join()
                        .unwrap_or_else(|_| LinkStatus::new(u, LinkState::Unknown))
                })
                .collect::<Vec<_>>()
        });
        out.extend(batch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_status_marks_success_and_redirect_alive() {
        for code in [200, 201, 204, 301, 302, 308, 399] {
            assert_eq!(classify_status(code), LinkState::Alive, "code {code}");
        }
    }

    #[test]
    fn classify_status_marks_only_gone_dead() {
        assert_eq!(classify_status(404), LinkState::Dead);
        assert_eq!(classify_status(410), LinkState::Dead);
    }

    #[test]
    fn classify_status_keeps_blocked_and_server_errors_unknown() {
        // Anti-bot / auth / rate-limit / method-rejected are NOT proof of death.
        for code in [400, 401, 403, 405, 429, 500, 502, 503] {
            assert_eq!(classify_status(code), LinkState::Unknown, "code {code}");
        }
    }

    #[test]
    fn probe_links_empty_input_is_empty() {
        assert!(probe_links(&[]).is_empty());
    }

    /// W220 — a panicking probe thread must degrade to `Unknown`, never
    /// propagate and crash the whole batch. Exercises the exact
    /// `join().unwrap_or_else(...)` pattern `probe_links` uses, with a
    /// closure that panics on purpose rather than trying to force a real
    /// probe to panic over the network.
    #[test]
    fn a_panicking_probe_thread_degrades_to_unknown_instead_of_propagating() {
        let url = "https://example.test/panics".to_string();
        let result = std::thread::scope(|scope| {
            let handle = scope.spawn(|| -> LinkStatus { panic!("simulated probe panic") });
            handle
                .join()
                .unwrap_or_else(|_| LinkStatus::new(&url, LinkState::Unknown))
        });
        assert_eq!(result.url, url);
        assert_eq!(result.state, LinkState::Unknown);
    }

    #[test]
    fn probe_links_rejects_non_http_without_network() {
        // file:// / junk never opens a socket; it resolves straight to unknown.
        let urls = vec![
            "file:///etc/passwd".to_string(),
            "not a url".to_string(),
        ];
        let out = probe_links(&urls);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|s| s.state == LinkState::Unknown));
        assert_eq!(out[0].url, "file:///etc/passwd");
    }

    #[test]
    fn probe_links_caps_at_the_limit() {
        // More than MAX_PROBES non-http URLs: only MAX_PROBES come back (no
        // network, all unknown), proving the cap is enforced.
        let urls: Vec<String> = (0..(MAX_PROBES + 25))
            .map(|i| format!("file:///x/{i}"))
            .collect();
        assert_eq!(probe_links(&urls).len(), MAX_PROBES);
    }
}
