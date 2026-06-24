//! Two-stage Familiar probe state machine (W12, architecture-design.md §2.8).
//!
//! Stage 1 — presence: `GET {base}/healthz`. A 200 means the service is up.
//! Stage 2 — authorization: `GET {base}/integration/v1/capabilities` with the
//! Bearer key. A 200 means the key is valid and yields the capability list the
//! UI uses to show/hide AI affordances.
//!
//! EVERY soft-failure path — host unreachable, timeout, 401, 429, or any non-200
//! — classifies as "Familiar absent" (`present:false`, `authorized:false`). The
//! probe NEVER returns an error; the caller hides AI affordances and moves on.
//! The logic is pure over [`HttpTransport`] so all five branches are unit-tested
//! against a mock with no live server.

use super::transport::{Header, HttpRequest, HttpTransport, Method, TransportOutcome};
use super::{
    CAPABILITIES_PATH, CONSUMER_ID_HEADER, CONSUMER_ID_VALUE, HEALTHZ_PATH, STATUS_OK,
};
use serde::Serialize;

/// Classification of a probe attempt. `Absent` collapses every soft-failure
/// (unreachable / timeout / non-200 healthz). `Present` means the service is up
/// but the key was rejected (401) or otherwise unauthorized. `Authorized` means
/// both stages passed and carries the parsed capability list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeState {
    /// Service not reachable / not healthy — hide all AI affordances.
    Absent,
    /// Service is up but the Bearer key is missing/invalid/rate-limited.
    Present,
    /// Service is up and the key is valid; capabilities advertised.
    Authorized { capabilities: Vec<String> },
}

/// The serializable probe result returned to the frontend (mirrors the
/// `FamiliarProbe` TS DTO). `present`/`authorized` drive AI-affordance visibility;
/// `capabilities` lists what the Familiar can do (empty unless authorized).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FamiliarProbe {
    /// Whether the service responded healthy (stage 1 passed).
    pub present: bool,
    /// Whether the Bearer key validated (stage 2 passed).
    pub authorized: bool,
    /// The base URL probed (echoed for UI/diagnostics).
    pub base_url: String,
    /// Capabilities the Familiar advertises (empty unless `authorized`).
    pub capabilities: Vec<String>,
}

impl FamiliarProbe {
    /// Build the wire DTO from a [`ProbeState`] and the base URL that was probed.
    pub fn from_state(state: ProbeState, base_url: &str) -> Self {
        match state {
            ProbeState::Absent => Self {
                present: false,
                authorized: false,
                base_url: base_url.to_string(),
                capabilities: Vec::new(),
            },
            ProbeState::Present => Self {
                present: true,
                authorized: false,
                base_url: base_url.to_string(),
                capabilities: Vec::new(),
            },
            ProbeState::Authorized { capabilities } => Self {
                present: true,
                authorized: true,
                base_url: base_url.to_string(),
                capabilities,
            },
        }
    }
}

/// Standard headers for a Familiar request: the consumer id always, the Bearer
/// authorization only when a key is supplied.
fn build_headers(key: Option<&str>) -> Vec<Header> {
    let mut headers = vec![(CONSUMER_ID_HEADER, CONSUMER_ID_VALUE.to_string())];
    if let Some(k) = key {
        headers.push((reqwest::header::AUTHORIZATION.as_str(), format!("Bearer {k}")));
    }
    headers
}

/// Run the two-stage probe. `key` is the Bearer key (from the Keychain) or `None`
/// when no key is stored — in which case stage 2 cannot authorize, so the best
/// possible outcome is [`ProbeState::Present`].
pub fn probe(transport: &dyn HttpTransport, base_url: &str, key: Option<&str>) -> ProbeState {
    // Stage 1 — presence.
    let health = transport.execute(HttpRequest {
        method: Method::Get,
        url: format!("{base_url}{HEALTHZ_PATH}"),
        headers: build_headers(None),
        body: None,
    });
    match health {
        TransportOutcome::Response { status, .. } if status == STATUS_OK => {}
        // Unreachable / timeout / any non-200 → absent.
        _ => return ProbeState::Absent,
    }

    // Stage 2 — authorization. No key → cannot authorize, but service is present.
    let key = match key {
        Some(k) if !k.is_empty() => k,
        _ => return ProbeState::Present,
    };
    let caps = transport.execute(HttpRequest {
        method: Method::Get,
        url: format!("{base_url}{CAPABILITIES_PATH}"),
        headers: build_headers(Some(key)),
        body: None,
    });
    match caps {
        TransportOutcome::Response { status, body } if status == STATUS_OK => {
            ProbeState::Authorized {
                capabilities: parse_capabilities(&body),
            }
        }
        // 401 / 429 / other non-200 → present but unauthorized. Timeout on stage 2
        // means we cannot confirm authorization; the service was healthy, so it is
        // present-but-unauthorized (AI affordances stay hidden either way).
        _ => ProbeState::Present,
    }
}

/// Parse a capabilities response body. Accepts either a bare JSON string array
/// (`["a","b"]`) or an object with a `capabilities` array. A malformed body
/// yields an empty list — never an error (silent degrade).
fn parse_capabilities(body: &str) -> Vec<String> {
    if let Ok(list) = serde_json::from_str::<Vec<String>>(body) {
        return list;
    }
    #[derive(serde::Deserialize)]
    struct Caps {
        capabilities: Vec<String>,
    }
    serde_json::from_str::<Caps>(body)
        .map(|c| c.capabilities)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::familiar::transport::test_support::MockTransport;
    use crate::core::familiar::{STATUS_TOO_MANY_REQUESTS, STATUS_UNAUTHORIZED};

    const BASE: &str = "http://127.0.0.1:2121";

    fn ok(body: &str) -> TransportOutcome {
        TransportOutcome::Response {
            status: STATUS_OK,
            body: body.to_string(),
        }
    }
    fn status(code: u16) -> TransportOutcome {
        TransportOutcome::Response {
            status: code,
            body: String::new(),
        }
    }

    #[test]
    fn absent_when_host_unreachable() {
        let t = MockTransport::new(vec![TransportOutcome::Unreachable]);
        assert_eq!(probe(&t, BASE, Some("k")), ProbeState::Absent);
    }

    #[test]
    fn absent_when_healthz_times_out() {
        let t = MockTransport::new(vec![TransportOutcome::Timeout]);
        assert_eq!(probe(&t, BASE, Some("k")), ProbeState::Absent);
    }

    #[test]
    fn absent_when_healthz_non_200() {
        let t = MockTransport::new(vec![status(503)]);
        assert_eq!(probe(&t, BASE, Some("k")), ProbeState::Absent);
    }

    #[test]
    fn present_when_healthy_but_no_key() {
        let t = MockTransport::new(vec![ok("")]);
        assert_eq!(probe(&t, BASE, None), ProbeState::Present);
    }

    #[test]
    fn present_when_key_unauthorized_401() {
        let t = MockTransport::new(vec![ok(""), status(STATUS_UNAUTHORIZED)]);
        assert_eq!(probe(&t, BASE, Some("bad")), ProbeState::Present);
    }

    #[test]
    fn present_when_rate_limited_429() {
        let t = MockTransport::new(vec![ok(""), status(STATUS_TOO_MANY_REQUESTS)]);
        assert_eq!(probe(&t, BASE, Some("k")), ProbeState::Present);
    }

    #[test]
    fn present_when_capabilities_times_out() {
        let t = MockTransport::new(vec![ok(""), TransportOutcome::Timeout]);
        assert_eq!(probe(&t, BASE, Some("k")), ProbeState::Present);
    }

    #[test]
    fn authorized_with_capabilities_array() {
        let t = MockTransport::new(vec![ok(""), ok(r#"["fuzzy_title","disambiguate"]"#)]);
        assert_eq!(
            probe(&t, BASE, Some("good")),
            ProbeState::Authorized {
                capabilities: vec!["fuzzy_title".into(), "disambiguate".into()]
            }
        );
    }

    #[test]
    fn authorized_with_capabilities_object() {
        let t = MockTransport::new(vec![ok(""), ok(r#"{"capabilities":["enrich"]}"#)]);
        assert_eq!(
            probe(&t, BASE, Some("good")),
            ProbeState::Authorized {
                capabilities: vec!["enrich".into()]
            }
        );
    }

    #[test]
    fn authorized_with_malformed_body_is_empty_caps() {
        let t = MockTransport::new(vec![ok(""), ok("not json")]);
        assert_eq!(
            probe(&t, BASE, Some("good")),
            ProbeState::Authorized {
                capabilities: vec![]
            }
        );
    }

    #[test]
    fn second_request_carries_bearer_and_consumer_id() {
        let t = MockTransport::new(vec![ok(""), ok("[]")]);
        let _ = probe(&t, BASE, Some("secret"));
        let seen = t.seen.lock().unwrap();
        let (_, url, headers) = &seen[1];
        assert!(url.ends_with(CAPABILITIES_PATH));
        assert!(headers
            .iter()
            .any(|(n, v)| *n == CONSUMER_ID_HEADER && v == CONSUMER_ID_VALUE));
        assert!(headers
            .iter()
            .any(|(_, v)| v == "Bearer secret"));
    }

    #[test]
    fn from_state_maps_each_variant() {
        assert!(!FamiliarProbe::from_state(ProbeState::Absent, BASE).present);
        let p = FamiliarProbe::from_state(ProbeState::Present, BASE);
        assert!(p.present && !p.authorized);
        let a = FamiliarProbe::from_state(
            ProbeState::Authorized {
                capabilities: vec!["x".into()],
            },
            BASE,
        );
        assert!(a.present && a.authorized && a.capabilities == vec!["x".to_string()]);
    }
}
