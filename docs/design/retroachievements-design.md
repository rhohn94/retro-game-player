# RetroAchievements integration

> **Up:** [↑ Design index](README.md)

## Motivation

RetroAchievements (retroachievements.org) is the de-facto community
achievement layer for retro games and the roadmap's "strongest unclaimed
community differentiator." Landing a credible foundation — login, per-game
achievement sets, live unlock detection while playing — turns passive library
play into tracked progress and positions v0.38+ for submission, lists, and
more systems. Without it, RGP stays interchangeable with any plain frontend.

## Scope

v0.37 ships the **native-path foundation, NES + SNES only**:

- rcheevos (libretro's official C evaluator) vendored and bound via FFI
  (W370).
- RA-correct ROM hashing via `rc_hash` — **never**
  `core/library/hasher.rs`; RA hashes per-console (e.g. NES strips the
  16-byte iNES header before hashing).
- Per-frame trigger evaluation over `RETRO_MEMORY_SYSTEM_RAM` in the native
  core loop; unlock event stream to the frontend (W370).
- Optional account: username + API key in Settings, stored via `KeyStore`;
  achievement-set fetch cached by hash (W371).
- Unlock toast in the player overlay, unlock count on the detail page,
  local `achievement_unlocks` persistence (W372).

Non-goals this release: server submission of unlocks (local-first),
leaderboards, hardcore mode, rich presence, the full per-game achievement
list UI, systems beyond NES/SNES, and the EmulatorJS fallback path
(vendored EJS 4.2.3 has no rcheevos support — silent, documented
degradation; the feature simply does not appear there).

## Design

**FFI (W370).** Vendor rcheevos sources under `src-tauri/vendor/rcheevos/`
(pure C, no deps) and compile via a `cc`-crate build-script static link —
the same build machinery the stub-core tests already use; fall back to
`libloading` only if static linking fights the Tauri bundle. A thin safe
wrapper module `src-tauri/src/play/achievements/` owns all `unsafe`,
mirroring [native-emulation-design.md](native-emulation-design.md)'s
`host.rs` conventions (RawSymbols-style struct, NUL-name handling).

**Hashing.** `rc_hash` with console id NES/SNES over the ROM bytes already
available to the session loader. Hash computed once at session start;
absent credential or unknown hash ⇒ feature inert.

**Evaluation loop.** The runtime holds an optional `AchievementRuntime`
inside the core-loop context ([native-emulation-design.md]
(native-emulation-design.md) §Module layout, `runtime/core_loop.rs`).
After each `retro_run()`: if a set is loaded, peek
`retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)` (pointer + size fetched
once per session, revalidated on save-state load) and feed rcheevos'
`rc_runtime_do_frame`. Unlocks push onto a bounded channel drained by the
existing frame/event IPC pattern. No set loaded ⇒ a single branch per
frame — the pacing tests must not regress.

**Client + accounts (W371).** `RetroAchievementsClient` follows the
`SteamGridDbClient` shape (reqwest, 10s timeout, test-injectable base URL).
RA's public Web API authenticates with username + web API key as query
params (`z=<user>&y=<key>`); the key lives in the macOS Keychain through
the existing `KeyStore` trait with a new service name (Familiar precedent).
Set fetch: hash → game id → achievement definitions + badge names, cached
on disk under app-support keyed by hash (bounded, JSON). Failures route
through the v0.36 error-telemetry conventions (`swallow`/telemetry — no
silent drops, no panics).

**Unlock UX + persistence (W372).** Toasts render in the existing player
overlay layer (aura-styled, queued, auto-dismiss; never captures input).
Migration `016_achievement_unlocks.sql`: `achievement_unlocks(game_id,
achievement_id, unlocked_at)` with a uniqueness constraint making unlock
recording idempotent. Detail page shows "N of M achievements" when a set
is known; nothing when RA is unconfigured.

## Acceptance

- [ ] rcheevos compiles into the app on aarch64 (clippy/lint clean).
- [ ] `rc_hash` fixture tests: NES with/without iNES header, SNES.
- [ ] Stub-core scripted memory change triggers exactly one unlock event.
- [ ] No-set session shows no frame-loop regression (pacing tests green).
- [ ] Client fixture tests: login-ok / bad-key / fetch-set / network-fail.
- [ ] Credential round-trips through KeyStore (memory stub in tests).
- [ ] No credential ⇒ zero network calls.
- [ ] Unlock toast renders (component test) and persists one idempotent row.
- [ ] Detail page count appears only when a set is known.
- [ ] `recipe.py smoke` passes on every branch.

## Open questions

- rcheevos pin: vendor the latest tagged release; record the tag + sha in
  the vendored README (W370 decides and documents).
- Memory-pointer stability across save-state loads — revalidate the peek
  pointer after `retro_unserialize` (W370 verifies against the stub core).

## Achievement list (v0.38 W384)

The detail page grows a full per-game achievement list under the existing
"N of M" count, from **cache only** — the page never fetches over the
network. A new IPC command joins the cached `AchievementSet` (definitions)
with local `achievement_unlocks` rows into
`{id, title, description, points, badgeName, unlockedAt?}` per achievement;
unconfigured / no-cached-set ⇒ empty answer and the section stays hidden
(mirrors the count's behavior). UI: an expandable section (aura patterns),
unlocked entries visually distinct (badge + unlock date), locked entries
dimmed with their point value; ordering: unlocked first, then by points.

**Badge art.** Best-effort: badge names map to RA's documented media URL
(`https://media.retroachievements.org/Badge/<badgeName>.png`, behind the
client's injectable base for tests) fetched through the RetroAchievements
client into a bounded disk badge cache (reuse the W371 cache module's
conventions and location, one file per badge name). Missing/offline ⇒
neutral placeholder glyph, no spinner, no retry storm (cache the miss for
the session). The list renders fully without any badge art.

**Attract-backdrop unlock flush.** The `background` presentation (W235
attract mode) is a real, recording session — but the frontend unlock
polling gates off ALL spectator presentations, so unlocks earned while
backgrounded sit in the channel until an eventual foreground poll. W384
fixes the gate: `background` sessions keep polling (persisting unlocks as
they happen) but suppress the toast until the presentation returns to
foreground/takeover, then show queued toasts; `preview` (W273 no-trace)
stays fully excluded from polling, toasting, and persistence.

## Follow-ups

- Server submission of unlocks + session "rich presence" ping (v0.39).
- Genesis/N64 expansion (plumbing is system-agnostic).
- EJS-path support investigation (upstream EmulatorJS work required).
- Hardcore mode semantics (disables save states — interacts with
  [save-states design](save-states-design.md) if/when adopted).
