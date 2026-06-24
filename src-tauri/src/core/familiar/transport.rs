//! HTTP transport abstraction for the Familiar client (W12).
//!
//! The probe state machine and enrich client depend on the [`HttpTransport`]
//! trait — NOT on `reqwest` directly — so unit tests can drive every branch
//! (present / absent / 401 / 429 / timeout) with a mock that needs no live
//! server. The production implementation [`ReqwestTransport`] wraps a blocking
//! `reqwest` client; the per-request timeout is applied here so a slow Familiar
//! is reported as [`TransportOutcome::Timeout`] (which the probe treats as absent).

use super::REQUEST_TIMEOUT;

/// One header to send with a request (name, value).
pub type Header = (&'static str, String);

/// HTTP verb for a Familiar request. Only the two the domain uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// `GET` — presence + capabilities probes.
    Get,
    /// `POST` — enrichment job submission.
    Post,
}

/// A normalized request the transport executes.
pub struct HttpRequest {
    /// Verb.
    pub method: Method,
    /// Fully-qualified URL (base URL + path).
    pub url: String,
    /// Headers (auth + consumer id) to attach.
    pub headers: Vec<Header>,
    /// Optional JSON body (POST only).
    pub body: Option<String>,
}

/// The outcome of executing an [`HttpRequest`]. Network/transport faults collapse
/// into [`TransportOutcome::Timeout`] (treated as absent) or
/// [`TransportOutcome::Unreachable`] so the caller never sees a raw error type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportOutcome {
    /// A complete HTTP response: status code + body text.
    Response { status: u16, body: String },
    /// The request timed out — counts as "Familiar absent".
    Timeout,
    /// The host could not be reached (connection refused / DNS / etc.) — absent.
    Unreachable,
}

/// Abstraction over the HTTP call. Implemented by [`ReqwestTransport`] in
/// production and by mocks in tests, so the probe logic is server-free testable.
pub trait HttpTransport: Send + Sync {
    /// Execute `req` and return its normalized [`TransportOutcome`]. This call
    /// never returns an error: all faults map onto `Timeout`/`Unreachable`.
    fn execute(&self, req: HttpRequest) -> TransportOutcome;
}

/// Production transport over a blocking `reqwest` client with a fixed timeout.
pub struct ReqwestTransport {
    client: reqwest::blocking::Client,
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl ReqwestTransport {
    /// Build a transport whose client enforces [`REQUEST_TIMEOUT`] per request.
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        Self { client }
    }
}

impl HttpTransport for ReqwestTransport {
    fn execute(&self, req: HttpRequest) -> TransportOutcome {
        let mut builder = match req.method {
            Method::Get => self.client.get(&req.url),
            Method::Post => self.client.post(&req.url),
        };
        for (name, value) in &req.headers {
            builder = builder.header(*name, value);
        }
        if let Some(body) = req.body {
            builder = builder
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body);
        }
        match builder.send() {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().unwrap_or_default();
                TransportOutcome::Response { status, body }
            }
            Err(e) if e.is_timeout() => TransportOutcome::Timeout,
            Err(_) => TransportOutcome::Unreachable,
        }
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! A scripted mock transport: hand it a queue of outcomes and it returns them
    //! in order, recording the requests it saw so tests can assert on headers/urls.
    use super::*;
    use std::sync::Mutex;

    /// A mock that replays a fixed list of outcomes and records requests.
    pub struct MockTransport {
        outcomes: Mutex<std::collections::VecDeque<TransportOutcome>>,
        pub seen: Mutex<Vec<(Method, String, Vec<Header>)>>,
    }

    impl MockTransport {
        /// Build a mock that returns `outcomes` in order (one per `execute` call).
        pub fn new(outcomes: Vec<TransportOutcome>) -> Self {
            Self {
                outcomes: Mutex::new(outcomes.into()),
                seen: Mutex::new(Vec::new()),
            }
        }
    }

    impl HttpTransport for MockTransport {
        fn execute(&self, req: HttpRequest) -> TransportOutcome {
            self.seen
                .lock()
                .unwrap()
                .push((req.method, req.url.clone(), req.headers.clone()));
            self.outcomes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(TransportOutcome::Unreachable)
        }
    }
}
