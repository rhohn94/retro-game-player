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
//!   * `GET|POST /saves/<id>/sram` and `GET|POST /saves/<id>/state/<slot>` →
//!     the EmulatorJS save bridge (v0.23 W231): the player page reads/writes
//!     battery SRAM and save states through the same on-disk layout the
//!     native path uses ([`crate::play::saves`]), so both paths share one
//!     save story. Writes go under `saves/` only — never into the library.
//!   * `GET /healthz`            → `200 ok` liveness probe.
//!
//! Like the Fleet status server ([`crate::fleet::server`]) it binds **127.0.0.1
//! only**, on an **ephemeral** port (so it never clashes with the Fleet port or a
//! second Harmony instance), and serves on a background thread. The single-thread
//! `fceumm` (NES) core needs no `SharedArrayBuffer`, so no COOP/COEP headers are
//! required. Binding is best-effort: on failure an unavailable handle is returned
//! and in-page play degrades to the native external-RetroArch launch.

use crate::db::repo::library;
use crate::db::DB_BUSY_TIMEOUT;
use crate::error::{AppError, AppResult};
use crate::play::saves::{GameSaves, PlayPath};
use include_dir::{include_dir, Dir};
use rusqlite::{Connection, OpenFlags};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Upper bound on a POSTed save body. NES SRAM is 8 KiB and EmulatorJS NES
/// states are well under a megabyte; 32 MiB leaves room for heavier future
/// cores while keeping a hostile local process from ballooning memory.
const SAVE_BODY_CAP: usize = 32 * 1024 * 1024;

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
pub fn start(db_path: PathBuf, saves_root: PathBuf, ejs_cores_root: PathBuf) -> PlayServer {
    gc_stale_ejs_core_versions(&ejs_cores_root);

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
        .spawn(move || serve_loop(server, db_path, saves_root, ejs_cores_root))
        .is_err()
    {
        return PlayServer::unavailable();
    }
    PlayServer { origin }
}

/// Best-effort startup GC of stale extracted-core caches (v0.38 W387, #36;
/// `core_extract`'s module doc "Garbage collection"). Runs once per server
/// start, before the socket is even bound, since it is pure disk cleanup with
/// no dependency on the server being up. Any failure (unreadable root,
/// permissions, …) is swallowed via the standard tagged `eprintln!`
/// convention — GC must never fail a boot.
fn gc_stale_ejs_core_versions(ejs_cores_root: &Path) {
    match crate::play::core_extract::gc_stale_versions(
        ejs_cores_root,
        crate::play::ejs_cores::EJS_VERSION,
    ) {
        Ok(removed) if !removed.is_empty() => {
            eprintln!("[play] gc removed stale EJS core cache version(s): {}", removed.join(", "));
        }
        Ok(_) => {}
        Err(e) => eprintln!("[play] stale EJS core cache gc failed (continuing): {e}"),
    }
}

/// Blocking accept loop: route each request and respond. Per-request errors are
/// swallowed — a dropped client must never kill the server.
fn serve_loop(
    server: tiny_http::Server,
    db_path: PathBuf,
    saves_root: PathBuf,
    ejs_cores_root: PathBuf,
) {
    for request in server.incoming_requests() {
        let _ = handle_request(request, &db_path, &saves_root, &ejs_cores_root);
    }
}

/// Route + respond to one request. `GET`/`HEAD` for assets/ROMs; `POST` only
/// on the `/saves/` bridge. The EmulatorJS storage cache issues a `HEAD`
/// probe for the ROM, which we answer with an empty `200` (a cache miss
/// simply re-downloads — always correct).
fn handle_request(
    request: tiny_http::Request,
    db_path: &Path,
    saves_root: &Path,
    ejs_cores_root: &Path,
) -> std::io::Result<()> {
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
    if let Some(rest) = path.strip_prefix("/saves/") {
        return serve_saves(request, db_path, saves_root, rest);
    }
    if path == "/healthz" {
        return request.respond(tiny_http::Response::from_string("ok"));
    }
    if path == "/" || path == "/player.html" {
        return respond_bytes(request, PLAYER_HTML.as_bytes(), "text/html; charset=utf-8");
    }
    if let Some(rest) = path.strip_prefix(EJS_PREFIX) {
        // Pre-extracted core cache (W374, #31): served ahead of everything
        // else under `cores/extracted/…` — see `serve_extracted_core`.
        if let Some(extracted_rel) = rest.strip_prefix("cores/extracted/") {
            return serve_extracted_core(request, ejs_cores_root, extracted_rel);
        }
        // On-demand core cache first (W241): a downloaded core shadows the
        // embedded bundle for `cores/…` paths; the EmulatorJS loader cannot
        // tell the tiers apart. `cached_file` rejects path traversal.
        if let Some(core_rel) = rest.strip_prefix("cores/") {
            if let Some(disk) = crate::play::ejs_cores::cached_file(ejs_cores_root, core_rel) {
                if let Ok(bytes) = std::fs::read(&disk) {
                    return respond_cached(request, &bytes, content_type(rest));
                }
            }
        }
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

/// Serves the pre-extracted-core cache (W374, #31; see
/// [`crate::play::core_extract`]) under `/emulatorjs/cores/extracted/…`:
///
///   * `GET .../extracted/<archive-filename>.json` → a manifest of
///     `{ "<entry-name>": "cores/extracted/<archive-hash>/<entry-name>" }`
///     for the archive `<archive-filename>` resolves to right now (on-demand
///     disk cache first, then the embedded bundle) — decompressing it once
///     on first request. `404` when the archive doesn't resolve to anything
///     (unknown/uninstalled core) or fails to decompress.
///   * `GET .../extracted/<archive-hash>/<entry-name>` → the raw decompressed
///     bytes of that one entry, immutably cacheable (the hash IS the content).
///
/// `<rest>` is already stripped of the `cores/extracted/` prefix. The two
/// route shapes are disambiguated by path-segment COUNT, not by a `.json`
/// suffix check — a decompressed entry can itself be named `build.json` or
/// `core.json`, which would otherwise be misread as a manifest request for
/// archive filename `<hash>/build`.
fn serve_extracted_core(
    request: tiny_http::Request,
    ejs_cores_root: &Path,
    rest: &str,
) -> std::io::Result<()> {
    if !rest.contains('/') {
        let Some(filename) = rest.strip_suffix(".json") else {
            return not_found(request);
        };
        return match build_extracted_manifest(ejs_cores_root, filename) {
            Some(json) => respond_bytes(request, json.as_bytes(), "application/json; charset=utf-8"),
            None => not_found(request),
        };
    }
    // `<hash>/<entry-name>` — a flat two-component path; anything else
    // (traversal, extra nesting) is rejected before touching the filesystem.
    let mut parts = rest.splitn(2, '/');
    let (Some(hash), Some(entry_name)) = (parts.next(), parts.next()) else {
        return not_found(request);
    };
    if hash.is_empty() || entry_name.is_empty() || entry_name.contains('/') {
        return not_found(request);
    }
    let version_dir = crate::play::ejs_cores::version_dir(ejs_cores_root);
    let dir = crate::play::core_extract::extracted_dir(&version_dir, hash);
    let candidate = dir.join(entry_name);
    // The hash prefix is derived, not attacker-controlled path text, but a
    // defensive canonical-prefix check costs nothing and rules out any
    // clever `hash` value (e.g. containing `..`) short-circuiting `join`.
    // Canonicalize `dir` too (not just `candidate`) — on macOS a tempdir
    // path like `/var/folders/...` and its canonical `/private/var/...`
    // form differ, so comparing an uncanonicalized `dir` against a
    // canonicalized `candidate` would false-reject every real hit.
    let Ok(canonical_dir) = std::fs::canonicalize(&dir) else {
        return not_found(request);
    };
    match std::fs::canonicalize(&candidate) {
        Ok(real) if real.starts_with(&canonical_dir) => match std::fs::read(&real) {
            Ok(bytes) => respond_cached(request, &bytes, content_type(entry_name)),
            Err(_) => not_found(request),
        },
        _ => not_found(request),
    }
}

/// Resolves `filename` (an EmulatorJS core archive name, e.g.
/// `snes9x-wasm.data`) to its bytes — on-demand disk cache first (shadows
/// the embedded bundle, matching the existing tier order), then the
/// embedded bundle — decompresses it once via
/// [`crate::play::core_extract::ensure_extracted`], and returns the
/// manifest JSON body. `None` on any failure (unresolvable filename, corrupt
/// archive): the caller answers `404`, and the page-side loader falls back
/// to its original download-then-decompress path unchanged.
fn build_extracted_manifest(ejs_cores_root: &Path, filename: &str) -> Option<String> {
    let archive_bytes = crate::play::ejs_cores::cached_file(ejs_cores_root, filename)
        .and_then(|p| std::fs::read(p).ok())
        .or_else(|| EJS_DATA.get_file(format!("cores/{filename}")).map(|f| f.contents().to_vec()))?;

    let version_dir = crate::play::ejs_cores::version_dir(ejs_cores_root);
    let dir = crate::play::core_extract::ensure_extracted(&version_dir, &archive_bytes).ok()?;
    let hash = crate::play::core_extract::hex_sha256(&archive_bytes);

    let mut manifest = serde_json::Map::new();
    for entry in std::fs::read_dir(&dir).ok()? {
        let entry = entry.ok()?;
        if !entry.file_type().ok()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = format!("cores/extracted/{hash}/{name}");
        manifest.insert(name, serde_json::Value::String(rel));
    }
    serde_json::to_string(&manifest).ok()
}

/// The EmulatorJS save bridge (W231). Routes, with `<rest>` already stripped
/// of the `/saves/` prefix:
///   * `GET|POST <id>/sram`          — battery SRAM bytes
///   * `GET|POST <id>/state/<slot>`  — a save-state blob (slots 1–4 / auto)
///
/// Reads answer 404 when nothing is saved yet (the player boots fresh);
/// writes are atomic via [`GameSaves`] and tagged `PlayPath::Ejs`.
fn serve_saves(
    mut request: tiny_http::Request,
    db_path: &Path,
    saves_root: &Path,
    rest: &str,
) -> std::io::Result<()> {
    let mut parts = rest.splitn(3, '/');
    let id: i64 = match parts.next().and_then(|s| s.parse().ok()) {
        Some(v) => v,
        None => return not_found(request),
    };
    let saves = match game_saves(db_path, saves_root, id) {
        Some(s) => s,
        None => return not_found(request),
    };
    let kind = parts.next().unwrap_or("");
    let slot = parts.next().map(str::to_string);
    let is_post = request.method() == &tiny_http::Method::Post;

    match (kind, slot, is_post) {
        ("sram", None, false) => match saves.read_sram() {
            Some(bytes) => respond_bytes(request, &bytes, "application/octet-stream"),
            None => not_found(request),
        },
        ("sram", None, true) => match read_capped_body(&mut request) {
            Some(bytes) => respond_result(request, saves.write_sram(&bytes)),
            None => payload_too_large(request),
        },
        ("state", Some(slot), false) => match saves.read_state(&slot) {
            Ok(bytes) => respond_bytes(request, &bytes, "application/octet-stream"),
            Err(_) => not_found(request),
        },
        ("state", Some(slot), true) => match read_capped_body(&mut request) {
            Some(bytes) => respond_result(request, saves.write_state(&slot, &bytes, PlayPath::Ejs)),
            None => payload_too_large(request),
        },
        _ => not_found(request),
    }
}

/// Reads the request body up to [`SAVE_BODY_CAP`]; `None` means over-cap.
fn read_capped_body(request: &mut tiny_http::Request) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    let mut reader = request.as_reader().take((SAVE_BODY_CAP + 1) as u64);
    reader.read_to_end(&mut body).ok()?;
    (body.len() <= SAVE_BODY_CAP).then_some(body)
}

/// `204` on success, `400` with the error text on failure.
fn respond_result(request: tiny_http::Request, result: AppResult<()>) -> std::io::Result<()> {
    match result {
        Ok(()) => request.respond(tiny_http::Response::empty(204)),
        Err(e) => request
            .respond(tiny_http::Response::from_string(e.to_string()).with_status_code(400)),
    }
}

fn payload_too_large(request: tiny_http::Request) -> std::io::Result<()> {
    request.respond(tiny_http::Response::from_string("save too large").with_status_code(413))
}

/// Open a fresh, short-lived **read-only** connection to `db_path`. Both
/// [`game_saves`] and [`serve_rom`] (via [`rom_path`]) call this rather than
/// each carrying their own open-plus-`busy_timeout` boilerplate — but each
/// still gets its **own** connection, one per call: SQLite permits concurrent
/// readers, so this never blocks (or is blocked by) the app's single managed
/// writer connection ([`crate::db::Db`]) beyond the brief busy window. Never
/// centralize these onto a shared connection/handle — that would reintroduce
/// the very contention this design avoids.
fn open_readonly(db_path: &Path) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| AppError::Db(e.to_string()))?;
    conn.busy_timeout(DB_BUSY_TIMEOUT)
        .map_err(|e| AppError::Db(e.to_string()))?;
    Ok(conn)
}

/// Resolve a game id to its [`GameSaves`] layout via the server's own
/// read-only connection (`system` + ROM path give the save dir + stem).
fn game_saves(db_path: &Path, saves_root: &Path, id: i64) -> Option<GameSaves> {
    let conn = open_readonly(db_path).ok()?;
    let (system, path) = library::system_and_path_by_id(&conn, id).ok()??;
    Some(GameSaves::new(saves_root, &system, Path::new(&path)))
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

/// Resolve a game id to its stored ROM path using the server's own read-only
/// connection (see [`open_readonly`]).
fn rom_path(db_path: &Path, id: i64) -> AppResult<Option<String>> {
    let conn = open_readonly(db_path)?;
    library::path_by_id(&conn, id).map_err(|e| AppError::Db(e.to_string()))
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

/// Build a `name: value` header, or `None` if either side is somehow not
/// valid header bytes. Every call site here passes a fixed name and a value
/// drawn from [`content_type`]'s static table (or a fixed literal), so this
/// never actually fails in practice — but a malformed header must degrade to
/// "response without that header" rather than take down the serve thread.
fn try_header(name: &'static [u8], value: &[u8]) -> Option<tiny_http::Header> {
    tiny_http::Header::from_bytes(name, value).ok()
}

/// Respond `200` with `body` and the given `Content-Type`.
fn respond_bytes(
    request: tiny_http::Request,
    body: &[u8],
    ctype: &str,
) -> std::io::Result<()> {
    let mut response = tiny_http::Response::from_data(body.to_vec());
    if let Some(header) = try_header(b"Content-Type", ctype.as_bytes()) {
        response = response.with_header(header);
    }
    request.respond(response)
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
    let mut response = tiny_http::Response::from_data(body.to_vec());
    if let Some(header) = try_header(b"Content-Type", ctype.as_bytes()) {
        response = response.with_header(header);
    }
    if let Some(header) = try_header(b"Cache-Control", b"public, max-age=31536000, immutable") {
        response = response.with_header(header);
    }
    request.respond(response)
}

/// Respond `404 not found`.
fn not_found(request: tiny_http::Request) -> std::io::Result<()> {
    request.respond(tiny_http::Response::from_string("not found").with_status_code(404))
}

/// The `playerControls(<arg>)` argument configured for player slot `slot`
/// (`"0"` or `"1"`) inside the served page's `EJS_defaultControls` block, or
/// `None` if the slot isn't wired to a `playerControls(...)` call at all.
///
/// Reads the *structure* of the assignment (a `playerControls` call keyed to
/// this slot number) rather than matching a literal formatted string — free
/// whitespace around `:`/`(`/`)`, alternate quoting of the slot key (`0` vs
/// `"0"`), and a trailing comma all still match. What must NOT change
/// unnoticed is *which boolean* each slot passes (W353: slot 1 needs
/// `false`/no keyboard, or a second connected pad's presses are silently
/// dropped) — this is exactly the regression the test built on this function
/// guards against, while tolerating a pure reformat of the same call.
#[cfg(test)]
fn player_controls_arg(html: &str, slot: &str) -> Option<String> {
    // Match `<slot key> : playerControls ( <arg> )`, keys optionally quoted,
    // arbitrary whitespace around each token — the "structural" part.
    let quoted = format!(r#""{slot}""#);
    for key in [slot, quoted.as_str()] {
        let mut search_from = 0;
        while let Some(rel) = html[search_from..].find(key) {
            let key_start = search_from + rel;
            let after_key = key_start + key.len();
            // Reject a match inside a longer number (e.g. slot "1" inside a
            // "10" key) — the digit immediately before/after the bare (not
            // quote-wrapped) key must not extend it.
            if key == slot {
                let prev_is_digit = html[..key_start]
                    .chars()
                    .next_back()
                    .is_some_and(|c| c.is_ascii_digit());
                if prev_is_digit {
                    search_from = after_key;
                    continue;
                }
            }
            let rest = html[after_key..].trim_start();
            let Some(rest) = rest.strip_prefix(':') else {
                search_from = after_key;
                continue;
            };
            let rest = rest.trim_start();
            let Some(rest) = rest.strip_prefix("playerControls") else {
                search_from = after_key;
                continue;
            };
            let rest = rest.trim_start();
            let Some(rest) = rest.strip_prefix('(') else {
                search_from = after_key;
                continue;
            };
            let Some(close) = rest.find(')') else {
                search_from = after_key;
                continue;
            };
            return Some(rest[..close].trim().to_string());
        }
    }
    None
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
            "CREATE TABLE games (id INTEGER PRIMARY KEY, system TEXT NOT NULL DEFAULT 'nes', path TEXT NOT NULL);",
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO games (id, system, path) VALUES (1, 'nes', ?1)",
            [rom_file.to_str().unwrap()],
        )
        .expect("insert");
        db
    }

    /// Bind an ephemeral server over a given db and run `serve_loop` on a thread.
    fn spawn(db_path: PathBuf, saves_root: PathBuf) -> u16 {
        spawn_with_cores(db_path, saves_root, std::env::temp_dir().join("harmony-no-ejs-cache"))
    }

    /// Like [`spawn`] but with an explicit on-demand core cache root (W241).
    fn spawn_with_cores(db_path: PathBuf, saves_root: PathBuf, ejs_cores_root: PathBuf) -> u16 {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind");
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || serve_loop(server, db_path, saves_root, ejs_cores_root));
        port
    }

    /// Minimal blocking HTTP POST over a raw socket → status code.
    fn http_post(port: u16, path: &str, body: &[u8]) -> u16 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        let req = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(req.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        String::from_utf8_lossy(&raw)
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0)
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
        let saves_root = tempfile::tempdir().expect("tempdir");
        let port = spawn(db.clone(), saves_root.path().to_path_buf());

        // player.html
        let (status, body) = http_get(port, "/player.html");
        assert_eq!(status, 200);
        let player_html = String::from_utf8_lossy(&body);
        assert!(player_html.contains("EJS_pathtodata"));
        // W276: the audio warm-up master-gain shim must actually ship with
        // the served page (warm-then-reset cold-start fix).
        assert!(player_html.contains("__harmonyMaster"));
        // W353: the served page must configure EmulatorJS's player-1 gamepad
        // button mapping — the vendored runtime ships an EMPTY default
        // control map for players 1-3, so without this override a second
        // connected pad is auto-selected into slot 1 but every button press
        // is silently dropped. Assert both player slots are populated (not
        // just that the config key exists) so a `{0: ..., 1: {}}` regression
        // — which would still leave player 2 unplayable — would fail here.
        assert!(player_html.contains("EJS_defaultControls"));
        assert_eq!(
            player_controls_arg(&player_html, "0").as_deref(),
            Some("true"),
            "player 1 slot must include the keyboard fallback"
        );
        assert_eq!(
            player_controls_arg(&player_html, "1").as_deref(),
            Some("false"),
            "player 2 slot must NOT bind the keyboard (it would steal player 1's keys)"
        );

        // W387 (#36): every child→parent postMessage in the REAL served page
        // must target the loopback origin the page is actually served on,
        // not a wildcard — resolved against this real running server's page,
        // not just asserted as a string in isolation. Scans each
        // `window.parent.postMessage(...)` call site's own argument list
        // (up to its closing `);`), so a "*" appearing elsewhere (e.g. in a
        // comment) can't produce a false failure/pass either way.
        let postmessage_calls: Vec<&str> = player_html
            .match_indices("window.parent.postMessage(")
            .map(|(start, _)| {
                let rest = &player_html[start..];
                let end = rest.find(");").expect("every postMessage call is terminated with );");
                &rest[..end]
            })
            .collect();
        assert_eq!(postmessage_calls.len(), 3, "expected exactly the three known parent-postMessage sends");
        for call in &postmessage_calls {
            assert!(
                call.contains("location.origin"),
                "every parent-postMessage call must target location.origin: {call}"
            );
            assert!(
                !call.contains("\"*\""),
                "no parent-postMessage call should still target the wildcard origin: {call}"
            );
        }

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
    fn save_bridge_round_trips_sram_and_states() {
        let rom = std::env::temp_dir().join(format!(
            "harmony-rom-saves-{}-{:?}.nes",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::write(&rom, b"NES\x1a").unwrap();
        let db = temp_db_with_game("saves", &rom);
        let saves_root = tempfile::tempdir().expect("tempdir");
        let port = spawn(db.clone(), saves_root.path().to_path_buf());

        // Fresh game: nothing saved yet.
        assert_eq!(http_get(port, "/saves/1/sram").0, 404);
        assert_eq!(http_get(port, "/saves/1/state/1").0, 404);

        // SRAM round-trip.
        assert_eq!(http_post(port, "/saves/1/sram", b"battery!"), 204);
        let (status, body) = http_get(port, "/saves/1/sram");
        assert_eq!(status, 200);
        assert_eq!(body, b"battery!");

        // State round-trip (slot validated; bad slot rejected).
        assert_eq!(http_post(port, "/saves/1/state/2", b"statebytes"), 204);
        let (status, body) = http_get(port, "/saves/1/state/2");
        assert_eq!(status, 200);
        assert_eq!(body, b"statebytes");
        assert_eq!(http_post(port, "/saves/1/state/99", b"x"), 400);

        // Unknown game id → 404, never a write.
        assert_eq!(http_post(port, "/saves/42/sram", b"x"), 404);

        let _ = std::fs::remove_file(&rom);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn downloaded_core_cache_shadows_the_embedded_bundle() {
        let rom = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(rom.path(), b"R").unwrap();
        let db = temp_db_with_game("core-shadow", rom.path());
        let saves_root = tempfile::tempdir().unwrap();
        let cores_root = tempfile::tempdir().unwrap();
        // Place a fake downloaded core where W241's installer would.
        let vdir = crate::play::ejs_cores::version_dir(cores_root.path());
        std::fs::create_dir_all(vdir.join("reports")).unwrap();
        std::fs::write(vdir.join("snes9x-wasm.data"), b"DISK-CORE").unwrap();
        let port = spawn_with_cores(
            db,
            saves_root.path().to_path_buf(),
            cores_root.path().to_path_buf(),
        );

        // Cached core served from disk; embedded assets still work; a
        // traversal never escapes the cache dir; uncached cores 404.
        let (code, body) = http_get(port, "/emulatorjs/cores/snes9x-wasm.data");
        assert_eq!((code, body.as_slice()), (200, b"DISK-CORE".as_slice()));
        let (code, _) = http_get(port, "/emulatorjs/cores/fceumm-wasm.data");
        assert_eq!(code, 200); // embedded fallback
        let (code, _) = http_get(port, "/emulatorjs/cores/../secrets");
        assert_ne!(code, 200);
        let (code, _) = http_get(port, "/emulatorjs/cores/mgba-wasm.data");
        assert_eq!(code, 404);
    }

    // ---- W374 (#31): pre-extracted core cache ----

    #[test]
    fn extracted_manifest_serves_the_embedded_core_and_entries_resolve() {
        let rom = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(rom.path(), b"R").unwrap();
        let db = temp_db_with_game("extract-embedded", rom.path());
        let saves_root = tempfile::tempdir().unwrap();
        let cores_root = tempfile::tempdir().unwrap();
        let port = spawn_with_cores(db, saves_root.path().to_path_buf(), cores_root.path().to_path_buf());

        // The manifest for the EMBEDDED fceumm core (no on-demand install
        // needed — it ships in the binary) must resolve, first request.
        let (code, body) = http_get(port, "/emulatorjs/cores/extracted/fceumm-wasm.data.json");
        assert_eq!(code, 200);
        let manifest: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let entries = manifest.as_object().unwrap();
        assert!(entries.contains_key("core.json"));
        assert!(entries.keys().any(|k| k.ends_with(".wasm")));
        assert!(entries.keys().any(|k| k.ends_with(".js")));

        // Test-quality rule: every URL the manifest hands back must ACTUALLY
        // resolve against the real running server, not just look plausible.
        for (name, rel_path) in entries {
            let rel_path = rel_path.as_str().unwrap();
            assert!(rel_path.starts_with("cores/extracted/"));
            let (code, resolved_body) = http_get(port, &format!("/emulatorjs/{rel_path}"));
            assert_eq!(code, 200, "manifest entry {name} did not resolve at {rel_path}");
            assert!(!resolved_body.is_empty(), "resolved entry {name} was empty");
        }
    }

    #[test]
    fn extracted_manifest_serves_an_on_demand_disk_core() {
        let rom = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(rom.path(), b"R").unwrap();
        let db = temp_db_with_game("extract-disk", rom.path());
        let saves_root = tempfile::tempdir().unwrap();
        let cores_root = tempfile::tempdir().unwrap();
        // Install a REAL core archive where W241's installer would put it, so
        // the 7z decompression is exercised against real bytes.
        let vdir = crate::play::ejs_cores::version_dir(cores_root.path());
        std::fs::create_dir_all(vdir.join("reports")).unwrap();
        let real_archive = include_bytes!("../../vendor/emulatorjs/cores/fceumm-wasm.data");
        std::fs::write(vdir.join("snes9x-wasm.data"), real_archive).unwrap();
        let port = spawn_with_cores(db, saves_root.path().to_path_buf(), cores_root.path().to_path_buf());

        let (code, body) = http_get(port, "/emulatorjs/cores/extracted/snes9x-wasm.data.json");
        assert_eq!(code, 200);
        let manifest: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let wasm_path = manifest["fceumm_libretro.wasm"].as_str().unwrap();
        let (code, wasm_bytes) = http_get(port, &format!("/emulatorjs/{wasm_path}"));
        assert_eq!(code, 200);
        assert!(!wasm_bytes.is_empty());
    }

    #[test]
    fn extracted_manifest_404s_for_an_unresolvable_core() {
        let rom = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(rom.path(), b"R").unwrap();
        let db = temp_db_with_game("extract-missing", rom.path());
        let saves_root = tempfile::tempdir().unwrap();
        let cores_root = tempfile::tempdir().unwrap();
        let port = spawn_with_cores(db, saves_root.path().to_path_buf(), cores_root.path().to_path_buf());

        let (code, _) = http_get(port, "/emulatorjs/cores/extracted/mgba-wasm.data.json");
        assert_eq!(code, 404);
    }

    #[test]
    fn extracted_entry_route_rejects_traversal_and_extra_nesting() {
        let rom = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(rom.path(), b"R").unwrap();
        let db = temp_db_with_game("extract-traversal", rom.path());
        let saves_root = tempfile::tempdir().unwrap();
        let cores_root = tempfile::tempdir().unwrap();
        let port = spawn_with_cores(db, saves_root.path().to_path_buf(), cores_root.path().to_path_buf());

        // Prime the cache so a valid hash dir actually exists on disk.
        let (code, body) = http_get(port, "/emulatorjs/cores/extracted/fceumm-wasm.data.json");
        assert_eq!(code, 200);
        let manifest: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let real_hash = manifest["core.json"]
            .as_str()
            .unwrap()
            .strip_prefix("cores/extracted/")
            .unwrap()
            .split('/')
            .next()
            .unwrap();

        let (code, _) = http_get(port, &format!("/emulatorjs/cores/extracted/{real_hash}/../../secrets"));
        assert_ne!(code, 200);
        let (code, _) = http_get(port, &format!("/emulatorjs/cores/extracted/{real_hash}/sub/dir.js"));
        assert_ne!(code, 200);
        let (code, _) = http_get(port, "/emulatorjs/cores/extracted/deadbeef/core.json");
        assert_eq!(code, 404); // a hash with no cache dir at all
    }

    /// Builds a real, decompressable one-entry 7z archive in memory holding
    /// `contents` under `entry_name` — used to fabricate two genuinely
    /// distinct, always-valid "core versions" for
    /// [`extracted_cache_invalidates_when_the_on_disk_archive_bytes_change`]
    /// so its invalidation assertion is never skipped behind a corrupt-archive
    /// 404 (unlike flipping a raw byte in a real archive, which usually
    /// corrupts the end-of-archive footer/CRC and fails to decompress).
    fn build_valid_7z(entry_name: &str, contents: &[u8]) -> Vec<u8> {
        let mut writer =
            sevenz_rust::SevenZWriter::new(std::io::Cursor::new(Vec::new())).expect("new writer");
        let mut entry = sevenz_rust::SevenZArchiveEntry::new();
        entry.name = entry_name.to_string();
        entry.has_stream = true;
        writer
            .push_archive_entry(entry, Some(std::io::Cursor::new(contents.to_vec())))
            .expect("push entry");
        writer.finish().expect("finish archive").into_inner()
    }

    #[test]
    fn extracted_cache_invalidates_when_the_on_disk_archive_bytes_change() {
        // Acceptance criterion: cache invalidates on core version change.
        // Simulated here by swapping the installed archive bytes for a core
        // under one filename — a real re-vendor of a core would change the
        // archive's bytes (and thus its hash) the same way. Both "versions"
        // are real, independently-decompressable 7z archives (not a
        // corrupted byte-flip of one), so the request for the bumped
        // version always succeeds and the invalidation assertion below is
        // never skipped.
        let rom = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(rom.path(), b"R").unwrap();
        let db = temp_db_with_game("extract-invalidate", rom.path());
        let saves_root = tempfile::tempdir().unwrap();
        let cores_root = tempfile::tempdir().unwrap();
        let vdir = crate::play::ejs_cores::version_dir(cores_root.path());
        std::fs::create_dir_all(vdir.join("reports")).unwrap();
        let archive_v1 = build_valid_7z("core.json", b"{\"version\":1}");
        std::fs::write(vdir.join("snes9x-wasm.data"), &archive_v1).unwrap();
        let port = spawn_with_cores(db, saves_root.path().to_path_buf(), cores_root.path().to_path_buf());

        let (code, body_v1) = http_get(port, "/emulatorjs/cores/extracted/snes9x-wasm.data.json");
        assert_eq!(code, 200);
        let manifest_v1: serde_json::Value = serde_json::from_slice(&body_v1).unwrap();
        let hash_v1 = manifest_v1["core.json"].as_str().unwrap().to_string();

        // "Bump the core": a second, distinct, equally-valid archive at the
        // same installed filename.
        let archive_v2 = build_valid_7z("core.json", b"{\"version\":2}");
        assert_ne!(archive_v1, archive_v2, "test fixture sanity: the two archives must differ");
        std::fs::write(vdir.join("snes9x-wasm.data"), &archive_v2).unwrap();

        let (code, body_v2) = http_get(port, "/emulatorjs/cores/extracted/snes9x-wasm.data.json");
        assert_eq!(code, 200, "the bumped archive must decompress and resolve, not 404");
        let manifest_v2: serde_json::Value = serde_json::from_slice(&body_v2).unwrap();
        let hash_v2 = manifest_v2["core.json"].as_str().unwrap().to_string();
        assert_ne!(hash_v1, hash_v2, "changed archive bytes must key a different cache entry");

        // The new hash's entry must resolve too, end-to-end through the
        // served route (test-quality rule: don't just assert the string).
        let (code, entry_body) = http_get(port, &format!("/emulatorjs/{hash_v2}"));
        assert_eq!(code, 200);
        assert_eq!(entry_body, b"{\"version\":2}");

        // The original hash's cache entry must remain intact regardless —
        // nothing overwrites an existing hash-keyed directory in place.
        let (code, entry_body) = http_get(port, &format!("/emulatorjs/{hash_v1}"));
        assert_eq!(code, 200);
        assert_eq!(entry_body, b"{\"version\":1}");
    }

    #[test]
    fn content_type_maps_known_extensions() {
        assert_eq!(content_type("src/emulator.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("emulator.css"), "text/css; charset=utf-8");
        assert_eq!(content_type("libunrar.wasm"), "application/wasm");
        assert_eq!(content_type("cores/fceumm-wasm.data"), "application/octet-stream");
        assert_eq!(content_type("cores/reports/fceumm.json"), "application/json; charset=utf-8");
    }

    // ---- W364 (v0.35 review follow-up): player_controls_arg structural test ----

    #[test]
    fn player_controls_arg_reads_the_exact_source_the_page_ships() {
        let html = "window.EJS_defaultControls = {\n  0: playerControls(true),\n  1: playerControls(false),\n};";
        assert_eq!(player_controls_arg(html, "0").as_deref(), Some("true"));
        assert_eq!(player_controls_arg(html, "1").as_deref(), Some("false"));
    }

    #[test]
    fn player_controls_arg_tolerates_reformatting() {
        // Minified (no whitespace), quoted keys, and a trailing comma are all
        // pure reformats of the same assignment — none of these are the W353
        // regression, so all must still resolve correctly.
        let minified = r#"{0:playerControls(true),1:playerControls(false)}"#;
        assert_eq!(player_controls_arg(minified, "0").as_deref(), Some("true"));
        assert_eq!(player_controls_arg(minified, "1").as_deref(), Some("false"));

        let quoted_keys = r#"{ "0" : playerControls( true ), "1" : playerControls( false ), }"#;
        assert_eq!(player_controls_arg(quoted_keys, "0").as_deref(), Some("true"));
        assert_eq!(player_controls_arg(quoted_keys, "1").as_deref(), Some("false"));
    }

    #[test]
    fn player_controls_arg_catches_the_w353_regression() {
        // The actual bug this test guards against: both player slots wired to
        // the SAME argument (here both `false`) — player 1 would silently
        // lose its keyboard fallback, or player 2 would steal it.
        let regressed = "0: playerControls(false),\n1: playerControls(false),";
        assert_eq!(player_controls_arg(regressed, "0").as_deref(), Some("false"));
        assert_eq!(player_controls_arg(regressed, "1").as_deref(), Some("false"));
        assert_eq!(
            player_controls_arg(regressed, "0"),
            player_controls_arg(regressed, "1"),
            "a real regression collapses both slots to the same argument"
        );
    }

    #[test]
    fn player_controls_arg_is_none_when_the_slot_is_missing_entirely() {
        // The W353 "empty map" failure mode: slot 1 dropped from the config
        // altogether (not just given the wrong argument).
        let missing_slot = "window.EJS_defaultControls = {\n  0: playerControls(true),\n};";
        assert!(player_controls_arg(missing_slot, "1").is_none());
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

    // ---- W284 (issue #28): boot through the REAL public entrypoint ----
    // Every test above drives the private `serve_loop`/`handle_request`
    // helpers directly. This test instead calls the actual `start()` function
    // production code calls (`lib.rs` setup) — the same bind-ephemeral-port +
    // background-thread path a real app run takes — so the coverage proves
    // the whole public loopback contract (bind, origin, player.html, ROM
    // streaming, healthz), not just the routing function in isolation.
    #[test]
    fn start_boots_a_real_server_serving_player_html_rom_and_healthz() {
        let rom = std::env::temp_dir().join(format!(
            "harmony-rom-start-{}-{:?}.nes",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::write(&rom, b"NES\x1a real boot rom").unwrap();
        let db = temp_db_with_game("start-entrypoint", &rom);
        let saves_root = tempfile::tempdir().expect("tempdir");
        let cores_root = tempfile::tempdir().expect("tempdir");

        let server = start(
            db.clone(),
            saves_root.path().to_path_buf(),
            cores_root.path().to_path_buf(),
        );

        // A real bind must produce a non-empty http://127.0.0.1:<port> origin.
        let origin = server.origin().to_string();
        assert!(
            origin.starts_with("http://127.0.0.1:"),
            "unexpected origin: {origin}"
        );
        let port: u16 = origin
            .rsplit(':')
            .next()
            .and_then(|p| p.parse().ok())
            .expect("origin carries a port");

        // player.html actually serves over the real bound port.
        let (status, body) = http_get(port, "/player.html");
        assert_eq!(status, 200);
        assert!(String::from_utf8_lossy(&body).contains("EJS_pathtodata"));

        // /rom/<id> streams the real bytes this handle's db points at.
        let (status, body) = http_get(port, "/rom/1");
        assert_eq!(status, 200);
        assert_eq!(body, b"NES\x1a real boot rom");

        // /healthz liveness probe.
        let (status, body) = http_get(port, "/healthz");
        assert_eq!(status, 200);
        assert_eq!(body, b"ok");

        let _ = std::fs::remove_file(&rom);
        let _ = std::fs::remove_file(&db);
    }
}
