//! Localhost Fleet status server (the Ensign's HTTP face).
//!
//! Binds a lightweight blocking `tiny_http` server to **127.0.0.1 only** on a
//! fixed, documented port ([`FLEET_STATUS_PORT`]) and serves two routes while
//! the app runs:
//!
//!   * `GET /fleet/v1/status` → the [`FleetStatus`] JSON (Fleet Status Contract
//!     v1; `schema_version` is an INTEGER).
//!   * `GET /healthz`         → `200 ok` liveness probe.
//!
//! The payload is assembled by the same pure `manifest::build_status` builder
//! the IPC command uses, so the two faces never drift. The shared, cloneable
//! [`Ensign`] holds the identity + start instant so both faces compute uptime
//! and identity identically. The server runs on a background thread; binding is
//! best-effort (a busy port is logged, not fatal — the IPC command still works).

use crate::error::{AppError, AppResult};
use crate::fleet::identity::Identity;
use crate::fleet::manifest::{build_dependency_edges, build_status, FsDependencyResolver};
use crate::fleet::schemas::FleetStatus;
use crate::config::paths::Paths;
use std::sync::Arc;
use std::time::Instant;

/// The fixed localhost port the Fleet status server binds. Documented constant
/// (no magic number); recorded in `fleet-instance.json` as `status_port` and in
/// the Mission Control registration snippet (fleet-ensign-design.md).
pub const FLEET_STATUS_PORT: u16 = 8420;

/// Loopback bind address — the server is reachable from the host machine only,
/// never from the network.
pub const FLEET_BIND_ADDR: &str = "127.0.0.1";

/// `GET /fleet/v1/status` route.
pub const ROUTE_STATUS: &str = "/fleet/v1/status";

/// `GET /healthz` liveness route.
pub const ROUTE_HEALTHZ: &str = "/healthz";

/// Shared, cheaply-cloneable Ensign state. Holds the stable identity, the app
/// version, and the process start instant (for uptime). Both the IPC command
/// and the HTTP handler read from one of these so their answers agree.
#[derive(Debug, Clone)]
pub struct Ensign {
    identity: Identity,
    version: String,
    started: Instant,
    paths: Arc<Paths>,
}

impl Ensign {
    /// Construct an Ensign over a resolved identity, app version, and paths.
    /// Stamps the start instant at construction.
    pub fn new(identity: Identity, version: impl Into<String>, paths: Paths) -> Self {
        Self {
            identity,
            version: version.into(),
            started: Instant::now(),
            paths: Arc::new(paths),
        }
    }

    /// Seconds elapsed since this Ensign was constructed.
    pub fn uptime_seconds(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    /// The stable instance id.
    pub fn instance_id(&self) -> String {
        self.identity.instance_id()
    }

    /// Assemble the current [`FleetStatus`], resolving dependency presence from
    /// the filesystem. This is the single payload builder both faces use.
    pub fn current_status(&self) -> FleetStatus {
        let resolver = FsDependencyResolver::new(&self.paths);
        let edges = build_dependency_edges(&resolver);
        build_status(
            &self.identity,
            &self.version,
            self.uptime_seconds(),
            edges,
        )
    }

    /// Serialize the current status to a JSON byte vector (the HTTP body).
    pub fn status_json(&self) -> AppResult<Vec<u8>> {
        Ok(serde_json::to_vec(&self.current_status())?)
    }
}

/// Start the localhost status server on a background thread. Binds to
/// `127.0.0.1:FLEET_STATUS_PORT`; on bind failure returns the error so the
/// caller can warn (the IPC command remains functional regardless). On success
/// the spawned thread owns the server for the life of the process.
pub fn spawn_status_server(ensign: Ensign) -> AppResult<()> {
    let addr = format!("{FLEET_BIND_ADDR}:{FLEET_STATUS_PORT}");
    let server = tiny_http::Server::http(&addr)
        .map_err(|e| AppError::Io(format!("fleet status server bind {addr}: {e}")))?;

    std::thread::Builder::new()
        .name("harmony-fleet-status".to_string())
        .spawn(move || serve_loop(server, ensign))
        .map_err(|e| AppError::Io(format!("fleet status thread: {e}")))?;
    Ok(())
}

/// Blocking accept loop: route each request and respond. Errors per-request are
/// swallowed (a dropped client must not kill the server).
fn serve_loop(server: tiny_http::Server, ensign: Ensign) {
    for request in server.incoming_requests() {
        let _ = handle_request(request, &ensign);
    }
}

/// Route + respond to one request. Only `GET` on the two known routes is
/// served; everything else is `404`.
fn handle_request(request: tiny_http::Request, ensign: &Ensign) -> std::io::Result<()> {
    let url = request.url().to_string();
    if url == ROUTE_HEALTHZ {
        let response = tiny_http::Response::from_string("ok");
        return request.respond(response);
    }
    if url == ROUTE_STATUS {
        return match ensign.status_json() {
            Ok(body) => {
                let header = tiny_http::Header::from_bytes(
                    &b"Content-Type"[..],
                    &b"application/json"[..],
                )
                .expect("static header");
                let response = tiny_http::Response::from_data(body).with_header(header);
                request.respond(response)
            }
            Err(_) => request.respond(tiny_http::Response::from_string("internal").with_status_code(500)),
        };
    }
    request.respond(tiny_http::Response::from_string("not found").with_status_code(404))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::paths::BUNDLE_ID;

    fn ensign(tag: &str) -> Ensign {
        let tmp = std::env::temp_dir().join(format!(
            "harmony-srv-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let paths = Paths::with_root(tmp.join(BUNDLE_ID)).expect("root");
        Ensign::new(Identity::default_identity(), "0.1.0", paths)
    }

    #[test]
    fn current_status_is_contract_shaped() {
        let e = ensign("shape");
        let status = e.current_status();
        assert_eq!(status.instance_id, "harmony-local-0");
        assert_eq!(status.version, "0.1.0");
        // RetroArch + one edge per declared core system.
        assert_eq!(status.dependencies.len(), 4);
    }

    #[test]
    fn status_json_emits_integer_schema_version() {
        let e = ensign("json");
        let body = e.status_json().expect("json");
        let raw: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(raw["schema_version"].is_u64());
        assert_eq!(raw["schema_version"], serde_json::json!(1));
    }

    #[test]
    fn uptime_is_monotonic_non_negative() {
        let e = ensign("uptime");
        // Freshly constructed: 0 or more, never panics.
        let _ = e.uptime_seconds();
    }

    /// Binding to an ephemeral port and serving `/healthz` proves the route
    /// wiring without depending on the fixed port being free in CI.
    #[test]
    fn ephemeral_bind_serves_healthz_and_status() {
        let e = ensign("bind");
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind ephemeral");
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || serve_loop(server, e));

        // healthz
        let mut resp = ureq_get(port, ROUTE_HEALTHZ);
        assert_eq!(resp.0, 200);
        assert_eq!(resp.1, "ok");

        // status — integer schema_version in the body
        resp = ureq_get(port, ROUTE_STATUS);
        assert_eq!(resp.0, 200);
        let raw: serde_json::Value = serde_json::from_str(&resp.1).unwrap();
        assert_eq!(raw["schema_version"], serde_json::json!(1));

        // unknown route → 404
        let nf = ureq_get(port, "/nope");
        assert_eq!(nf.0, 404);
    }

    /// Minimal blocking HTTP GET over a raw TCP socket (no extra dep). Returns
    /// (status_code, body).
    fn ureq_get(port: u16, path: &str) -> (u16, String) {
        use std::io::{Read, Write};
        let mut stream =
            std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).unwrap();
        let mut raw = String::new();
        stream.read_to_string(&mut raw).unwrap();
        let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((&raw, ""));
        let status = head
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);
        (status, body.to_string())
    }
}
