//! High-level Familiar client (W12) — the single entry point the command adapter
//! (`commands/familiar.rs`) calls. It composes the four concerns:
//!   - [`probe`](super::probe) the two-stage presence/authorization state machine,
//!   - [`keychain`](super::keychain) the Keychain-backed Bearer-key store,
//!   - [`cache`](super::cache) the enrichment-result cache,
//!   - [`transport`](super::transport) the mockable HTTP seam.
//!
//! SOFT DEPENDENCY: every method degrades silently. `probe` returns a
//! `FamiliarProbe` (never an error); `enrich` returns `Ok(None)` when the
//! Familiar is absent/unauthorized/rate-limited/slow so the caller falls back to
//! the un-enriched name. The Bearer key is held only in the Keychain and is never
//! serialized into any config/DTO.

use super::cache::{Enrichment, EnrichmentCache};
use super::keychain::KeyStore;
use super::probe::{self, FamiliarProbe};
use super::transport::{
    HttpRequest, HttpTransport, Method, TransportOutcome,
};
use super::{CONSUMER_ID_HEADER, CONSUMER_ID_VALUE, JOBS_PATH, STATUS_OK};
use crate::error::AppResult;

/// Composes transport + key store + cache against a configured base URL. Holds NO
/// plaintext key field — the key is fetched from the [`KeyStore`] on demand and
/// never stored on the struct, so it can never leak into a serialized config.
pub struct FamiliarClient {
    transport: Box<dyn HttpTransport>,
    keystore: Box<dyn KeyStore>,
    cache: EnrichmentCache,
    base_url: String,
}

impl FamiliarClient {
    /// Build a client for `base_url` with the given transport and key store.
    pub fn new(
        transport: Box<dyn HttpTransport>,
        keystore: Box<dyn KeyStore>,
        base_url: String,
    ) -> Self {
        Self {
            transport,
            keystore,
            cache: EnrichmentCache::new(),
            base_url,
        }
    }

    /// Run the two-stage probe and return the UI-facing `FamiliarProbe`. Never
    /// errors: a Keychain read failure is treated as "no key" so the probe still
    /// reports presence honestly and AI affordances stay hidden.
    pub fn probe(&self) -> FamiliarProbe {
        let key = self.keystore.get().ok().flatten();
        let state = probe::probe(self.transport.as_ref(), &self.base_url, key.as_deref());
        FamiliarProbe::from_state(state, &self.base_url)
    }

    /// Enrich a title for `game_id`, given the current best `clean_name`. Returns
    /// `Some(Enrichment)` on success (also cached), or `None` when the Familiar is
    /// absent/unauthorized/rate-limited/slow — the silent-degrade path. Cached
    /// results short-circuit the network call.
    pub fn enrich(&self, game_id: i64, clean_name: &str) -> Option<Enrichment> {
        if let Some(hit) = self.cache.get(game_id) {
            return Some(hit);
        }
        // Only attempt enrichment when authorized; otherwise degrade silently.
        let probe = self.probe();
        if !probe.authorized {
            return None;
        }
        let key = self.keystore.get().ok().flatten()?;
        let enriched = self.submit_job(clean_name, &key)?;
        let result = Enrichment {
            clean_name: enriched,
        };
        self.cache.put(game_id, result.clone());
        Some(result)
    }

    /// POST an enrichment job and parse the disambiguated title from the response.
    /// Any soft failure (timeout / unreachable / non-200 / malformed body) yields
    /// `None`.
    fn submit_job(&self, clean_name: &str, key: &str) -> Option<String> {
        let body = serde_json::json!({
            "task": "disambiguate_title",
            "title": clean_name,
        })
        .to_string();
        let outcome = self.transport.execute(HttpRequest {
            method: Method::Post,
            url: format!("{}{JOBS_PATH}", self.base_url),
            headers: vec![
                (CONSUMER_ID_HEADER, CONSUMER_ID_VALUE.to_string()),
                (
                    reqwest::header::AUTHORIZATION.as_str(),
                    format!("Bearer {key}"),
                ),
            ],
            body: Some(body),
        });
        match outcome {
            TransportOutcome::Response { status, body } if status == STATUS_OK => {
                parse_enriched_title(&body)
            }
            _ => None,
        }
    }

    /// Store a new Bearer key in the Keychain (never on disk).
    pub fn set_key(&self, key: &str) -> AppResult<()> {
        self.keystore.set(key)
    }
}

/// Extract the disambiguated title from a job response. Accepts either
/// `{"clean_name": "..."}` or `{"title": "..."}`. Missing/malformed → `None`.
fn parse_enriched_title(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    v.get("clean_name")
        .or_else(|| v.get("title"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::familiar::keychain::test_support::MemoryKeyStore;
    use crate::core::familiar::transport::test_support::MockTransport;

    const BASE: &str = "http://127.0.0.1:2121";

    fn ok(body: &str) -> TransportOutcome {
        TransportOutcome::Response {
            status: STATUS_OK,
            body: body.to_string(),
        }
    }

    #[test]
    fn probe_absent_when_unreachable() {
        let client = FamiliarClient::new(
            Box::new(MockTransport::new(vec![TransportOutcome::Unreachable])),
            Box::new(MemoryKeyStore::with_key("k")),
            BASE.to_string(),
        );
        let p = client.probe();
        assert!(!p.present && !p.authorized);
    }

    #[test]
    fn enrich_returns_none_when_absent() {
        let client = FamiliarClient::new(
            Box::new(MockTransport::new(vec![TransportOutcome::Unreachable])),
            Box::new(MemoryKeyStore::with_key("k")),
            BASE.to_string(),
        );
        assert!(client.enrich(1, "smb").is_none());
    }

    #[test]
    fn key_never_serializes_onto_client_or_config() {
        // The client holds no plaintext key field, and the file-backed AppConfig
        // has no key field, so a stored secret can never leak into serialized
        // state. Set a key, then assert it appears in NEITHER a serialized config
        // NOR the probe DTO.
        let secret = "TOP-SECRET-KEY";
        let store = MemoryKeyStore::with_key(secret);
        store.set(secret).unwrap();

        let cfg = crate::config::AppConfig::default();
        let cfg_json = serde_json::to_string(&cfg).unwrap();
        assert!(!cfg_json.contains(secret), "config must not carry the key");

        let client = FamiliarClient::new(
            Box::new(MockTransport::new(vec![TransportOutcome::Unreachable])),
            Box::new(store),
            BASE.to_string(),
        );
        let probe_json = serde_json::to_string(&client.probe()).unwrap();
        assert!(!probe_json.contains(secret), "probe DTO must not carry the key");
    }

    #[test]
    fn enrich_succeeds_and_caches_when_authorized() {
        // Sequence: probe stage1 ok, probe stage2 ok (authorized), then job POST ok.
        let client = FamiliarClient::new(
            Box::new(MockTransport::new(vec![
                ok(""),
                ok(r#"["disambiguate_title"]"#),
                ok(r#"{"clean_name":"Super Mario Bros."}"#),
            ])),
            Box::new(MemoryKeyStore::with_key("good")),
            BASE.to_string(),
        );
        let first = client.enrich(7, "smb").expect("enriched");
        assert_eq!(first.clean_name, "Super Mario Bros.");
        // Second call hits the cache — no further transport outcomes are queued,
        // so a network attempt would return Unreachable and fail. It must not.
        let second = client.enrich(7, "smb").expect("cached");
        assert_eq!(second.clean_name, "Super Mario Bros.");
    }
}
