//! Loopback EmulatorJS host server (v0.15 — in-page WASM play).
//!
//! In a production build the Harmony webview runs on the `tauri://localhost`
//! custom scheme. There, EmulatorJS's core pipeline — fetch a 7z core archive,
//! decompress it in a blob-URL Web Worker, then `WebAssembly`-instantiate the
//! extracted module — silently fails (`EJS_Runtime is not defined`). The custom
//! scheme is not a normal web origin, so blob Workers / WASM don't behave.
//!
//! The fix here serves everything EmulatorJS needs from a real
//! `http://127.0.0.1:<port>` loopback origin (a normal, potentially-trustworthy
//! web origin where Workers, WASM, and blob URLs work), which the frontend
//! embeds in an `<iframe>`:
//!
//!   * `GET /player.html`        → the embedded host page (sets the `EJS_*`
//!     globals from `?core&game&name`, includes the loader).
//!   * `GET /emulatorjs/<path>`  → the vendored EmulatorJS runtime (loader.js,
//!     `src/`, `cores/`, `compression/`, …), embedded into the binary.
//!   * `GET /rom/<id>`           → the raw ROM bytes for a library game, resolved
//!     from the database by id (its own read-only SQLite connection, so the
//!     server never touches Tauri's managed `Db`).
//!   * `GET /healthz`            → `200 ok` liveness probe.
//!
//! Like the Fleet status server ([`crate::fleet::server`]) it binds **127.0.0.1
//! only**, on an **ephemeral** port (so it never clashes with the Fleet port or a
//! second Harmony instance), and serves on a background thread. The single-thread
//! `fceumm` (NES) core needs no `SharedArrayBuffer`, so no COOP/COEP headers are
//! required. Binding is best-effort: on failure an unavailable handle is returned
//! and in-page play degrades to the native external-RetroArch launch.

use crate::error::{AppError, AppResult};
use include_dir::{include_dir, Dir};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The vendored EmulatorJS data dir, embedded into the binary at compile time so
/// the bundled `.app` carries the runtime + the NES core with no on-disk assets.
static EJS_DATA: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/vendor/emulatorjs");

/// The EmulatorJS host page (reads `?core&game&name`, sets `EJS_*`, loads the
/// loader) — served at `/player.html`, embedded as a string.
const PLAYER_HTML: &str = include_str!("../../vendor/player.html");

/// Loopback bind host — reachable from this machine only, never the network.
const BIND_HOST: &str = "127.0.0.1";

/// URL prefix under which the embedded EmulatorJS data dir is served. The player
/// page sets `EJS_pathtodata` to this, so every runtime asset is same-origin.
const EJS_PREFIX: &str = "/emulatorjs/";

/// How long a `/rom/<id>` read-only connection waits on a busy database before
/// giving up (the main app is the only writer; reads are brief).
const DB_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Shared, cheaply-cloneable handle to the running play server: the loopback
/// origin the frontend embeds in its player `<iframe>`. `origin` is empty when
/// the server failed to bind, in which case in-page play is unavailable and the
/// UI falls back to the native launch.
#[derive(Debug, Clone)]
pub struct PlayServer {
    origin: String,
}

impl PlayServer {
    /// A handle for "the server isn't running" (bind failure). Its origin is "".
    fn unavailable() -> Self {
        Self {
            origin: String::new(),
        }
    }

    /// The `http://127.0.0.1:<port>` origin, or `""` if the server isn't running.
    pub fn origin(&self) -> &str {
        &self.origin
    }
}

/// Start the loopback play server on a background thread, serving the embedded
/// EmulatorJS runtime + player page + ROMs resolved from `db_path`. Binds an
/// ephemeral `127.0.0.1` port. Binding is best-effort: on failure an unavailable
/// handle is returned so app startup is never blocked.
pub fn start(db_path: PathBuf) -> PlayServer {
    let server = match tiny_http::Server::http(format!("{BIND_HOST}:0")) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("harmony play server bind failed: {e}");
            return PlayServer::unavailable();
        }
    };
    let port = match server.server_addr().to_ip() {
        Some(addr) => addr.port(),
        None => return PlayServer::unavailable(),
    };
    let origin = format!("http://{BIND_HOST}:{port}");

    if std::thread::Builder::new()
        .name("harmony-play-server".to_string())
        .spawn(move || serve_loop(server, db_path))
        .is_err()
    {
        return PlayServer::unavailable();
    }
    PlayServer { origin }
}

/// Blocking accept loop: route each request and respond. Per-request errors are
/// swallowed — a dropped client must never kill the server.
fn serve_loop(server: tiny_http::Server, db_path: PathBuf) {
    for request in server.incoming_requests() {
        let _ = handle_request(request, &db_path);
    }
}

/// Route + respond to one request. Only `GET`/`HEAD` are meaningful; the
/// EmulatorJS storage cache issues a `HEAD` probe for the ROM, which we answer
/// with an empty `200` (a cache miss simply re-downloads — always correct).
fn handle_request(request: tiny_http::Request, db_path: &Path) -> std::io::Result<()> {
    let raw = request.url().to_string();
    let path = raw.split('?').next().unwrap_or("").to_string();

    // Opt-in request log (set HARMONY_PLAY_LOG) — used to verify, headlessly,
    // that the webview is actually loading the player iframe + core + ROM.
    if std::env::var_os("HARMONY_PLAY_LOG").is_some() {
        eprintln!("[play] {} {}", request.method(), path);
    }

    if request.method() == &tiny_http::Method::Head {
        return request.respond(tiny_http::Response::empty(200));
    }
    if path == "/healthz" {
        return request.respond(tiny_http::Response::from_string("ok"));
    }
    if path == "/" || path == "/player.html" {
        return respond_bytes(request, PLAYER_HTML.as_bytes(), "text/html; charset=utf-8");
    }
    if let Some(rest) = path.strip_prefix(EJS_PREFIX) {
        return match EJS_DATA.get_file(rest) {
            Some(file) => respond_cached(request, file.contents(), content_type(rest)),
            None => not_found(request),
        };
    }
    if let Some(id_str) = path.strip_prefix("/rom/") {
        return serve_rom(request, db_path, id_str);
    }
    not_found(request)
}

/// Serve a library game's ROM bytes by id. Maps id → on-disk path via a fresh
/// read-only SQLite connection, then streams the file. Any failure (bad id,
/// unknown game, moved file) is a `404` — the player surfaces a load error.
fn serve_rom(request: tiny_http::Request, db_path: &Path, id_str: &str) -> std::io::Result<()> {
    let id: i64 = match id_str.parse() {
        Ok(v) => v,
        Err(_) => return not_found(request),
    };
    match rom_path(db_path, id) {
        Ok(Some(p)) => match std::fs::read(&p) {
            Ok(bytes) => respond_bytes(request, &bytes, "application/octet-stream"),
            Err(_) => not_found(request),
        },
        _ => not_found(request),
    }
}

/// Resolve a game id to its stored ROM path using a read-only connection to the
/// same database file the app manages. SQLite permits concurrent readers, so
/// this never blocks the main connection beyond the brief busy window.
fn rom_path(db_path: &Path, id: i64) -> AppResult<Option<String>> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| AppError::Db(e.to_string()))?;
    conn.busy_timeout(DB_BUSY_TIMEOUT)
        .map_err(|e| AppError::Db(e.to_string()))?;
    conn.query_row("SELECT path FROM games WHERE id = ?1", [id], |row| row.get(0))
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(AppError::Db(other.to_string())),
        })
}

/// MIME type for an embedded asset by extension. Workers/`<script>`/`<link>`
/// loads under the loopback origin need a sane `Content-Type`; `.wasm` in
/// particular must be `application/wasm` for streaming instantiation.
fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "html" => "text/html; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Respond `200` with `body` and the given `Content-Type`.
fn respond_bytes(
    request: tiny_http::Request,
    body: &[u8],
    ctype: &str,
) -> std::io::Result<()> {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes())
        .expect("static content-type header");
    request.respond(tiny_http::Response::from_data(body.to_vec()).with_header(header))
}

/// Like [`respond_bytes`] but marks the asset immutably cacheable. The vendored
/// runtime is fixed for a given build (and the origin's port is fresh each app
/// launch), so the webview can reuse the bundle + core across game-to-game
/// navigations within a session without re-fetching them.
fn respond_cached(
    request: tiny_http::Request,
    body: &[u8],
    ctype: &str,
) -> std::io::Result<()> {
    let ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes())
        .expect("static content-type header");
    let cc = tiny_http::Header::from_bytes(
        &b"Cache-Control"[..],
        &b"public, max-age=31536000, immutable"[..],
    )
    .expect("static cache-control header");
    request.respond(
        tiny_http::Response::from_data(body.to_vec())
            .with_header(ct)
            .with_header(cc),
    )
}

/// Respond `404 not found`.
fn not_found(request: tiny_http::Request) -> std::io::Result<()> {
    request.respond(tiny_http::Response::from_string("not found").with_status_code(404))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    /// Create a throwaway SQLite db with one `games` row pointing at `rom_file`,
    /// returning its path. Minimal schema — `rom_path` only needs `id` + `path`.
    fn temp_db_with_game(tag: &str, rom_file: &Path) -> PathBuf {
        let db = std::env::temp_dir().join(format!(
            "harmony-play-{tag}-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&db);
        let conn = Connection::open(&db).expect("open");
        conn.execute_batch(
            "CREATE TABLE games (id INTEGER PRIMARY KEY, path TEXT NOT NULL);",
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO games (id, path) VALUES (1, ?1)",
            [rom_file.to_str().unwrap()],
        )
        .expect("insert");
        db
    }

    /// Bind an ephemeral server over a given db and run `serve_loop` on a thread.
    fn spawn(db_path: PathBuf) -> u16 {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind");
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || serve_loop(server, db_path));
        port
    }

    /// Minimal blocking HTTP GET over a raw socket → (status, body bytes).
    fn http_get(port: u16, path: &str) -> (u16, Vec<u8>) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        // Split headers / body on the CRLFCRLF boundary.
        let sep = b"\r\n\r\n";
        let pos = raw.windows(4).position(|w| w == sep).unwrap();
        let head = String::from_utf8_lossy(&raw[..pos]).to_string();
        let body = raw[pos + 4..].to_vec();
        let status = head
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);
        (status, body)
    }

    #[test]
    fn serves_player_html_and_runtime_and_rom_and_404() {
        // A fake ROM on disk + a db that points game id 1 at it.
        let rom = std::env::temp_dir().join(format!(
            "harmony-rom-{}-{:?}.nes",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::write(&rom, b"NES\x1a fake rom bytes").unwrap();
        let db = temp_db_with_game("routes", &rom);
        let port = spawn(db.clone());

        // player.html
        let (status, body) = http_get(port, "/player.html");
        assert_eq!(status, 200);
        assert!(String::from_utf8_lossy(&body).contains("EJS_pathtodata"));

        // embedded runtime asset (present in every EmulatorJS release)
        let (status, _) = http_get(port, "/emulatorjs/loader.js");
        assert_eq!(status, 200);

        // ROM bytes by id
        let (status, body) = http_get(port, "/rom/1");
        assert_eq!(status, 200);
        assert_eq!(body, b"NES\x1a fake rom bytes");

        // unknown game id → 404
        assert_eq!(http_get(port, "/rom/999").0, 404);
        // unknown route → 404
        assert_eq!(http_get(port, "/nope").0, 404);
        // healthz
        let (status, body) = http_get(port, "/healthz");
        assert_eq!(status, 200);
        assert_eq!(body, b"ok");

        let _ = std::fs::remove_file(&rom);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn content_type_maps_known_extensions() {
        assert_eq!(content_type("src/emulator.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("emulator.css"), "text/css; charset=utf-8");
        assert_eq!(content_type("libunrar.wasm"), "application/wasm");
        assert_eq!(content_type("cores/fceumm-wasm.data"), "application/octet-stream");
        assert_eq!(content_type("cores/reports/fceumm.json"), "application/json; charset=utf-8");
    }

    #[test]
    fn embedded_dir_carries_loader_and_nes_core() {
        // The bundle must ship the loader, the readable src, and the NES core +
        // its report — without these the player can't boot offline.
        assert!(EJS_DATA.get_file("loader.js").is_some());
        assert!(EJS_DATA.get_file("src/emulator.js").is_some());
        assert!(EJS_DATA.get_file("cores/fceumm-wasm.data").is_some());
        assert!(EJS_DATA.get_file("cores/reports/fceumm.json").is_some());
    }
}
