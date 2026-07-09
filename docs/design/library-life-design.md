# Library life — favorites, recency, play time (data foundation)

> **Up:** [↑ Design index](README.md)

## Motivation

The TV home shelves ([tv-mode-design.md](tv-mode-design.md)) need to answer
"what was I playing?" and "what do I love?" — before this feature the schema
couldn't: no favorite flag, no last-played timestamp, no play-time accounting
on any of the three play paths. This is the data subset of
[#21](https://github.com/rhohn94/retro-game-player/issues/21) (favorites, recently
played, play-time tracking), shipped in v0.26 (W264); collections and
desktop-library curation UI stay deferred.

## Scope

**In scope**

- Schema: `favorite INTEGER NOT NULL DEFAULT 0`, `last_played_at INTEGER`,
  `play_count INTEGER NOT NULL DEFAULT 0`, `total_play_time_ms INTEGER NOT
  NULL DEFAULT 0` on `games` (new migration, additive only).
- Play-session hooks on **all three paths**: in-page (InPagePlayer
  mount/unmount), native (NativePlayer session start/stop), external
  (`launch_game` spawn → child exit). Session = start/end pair; end updates
  `last_played_at`, increments `play_count`, accumulates
  `total_play_time_ms`.
- IPC: `set_favorite(game_id, on)`, `record_play_start(game_id) -> session_id`,
  `record_play_end(session_id)`, `list_recently_played(limit)`,
  `list_favorites(limit)`; Game DTO gains the four fields.
- Frontend: favorite toggle (heart) on the game detail page; data consumed by
  TV shelves. No desktop library redesign.

**Non-goals**

- Collections, tags, manual ordering (rest of #21).
- Per-session history table/analytics UI (single-row aggregates only).
- Resume-into-save-state wiring (Continue playing = recency, not state).

## Design

- Migration `010_library_life.sql` (`src-tauri/src/db/migrations.rs`) —
  additive columns on `games`, no backfill. Repo layer: `LibraryRepo` gains
  the update/query methods in the `play_life` query-domain submodule
  (`src-tauri/src/db/repo/library/play_life.rs`); Tauri-free inner fns,
  unit-tested.
- Session tracking lives in Rust (`src-tauri/src/commands/play_stats.rs`):
  `SessionTracker` holds an in-memory `HashMap<session_id, (game_id,
  Instant)>` behind managed Tauri state (`PlayStatsState`); `record_play_end`
  computes duration server-side via `Instant::elapsed` (no trusting frontend
  clocks) and persists the aggregate through
  `LibraryRepo::record_play_session`. Ending an unknown/already-ended session
  is a no-op, not an error, so a stray duplicate `record_play_end` never
  double-counts.
- The external path (`src-tauri/src/commands/launch.rs`) starts the session
  at process spawn and ends it once the termination observer reports the
  process has stopped. The two frontend paths (`InPagePlayer`, `NativePlayer`)
  share the `usePlaySession` hook (`src/features/play/playSession.ts`), which
  starts on mount/`gameId` change and ends on unmount plus a `beforeunload`
  listener (so a window close mid-play still records the partial duration).
  `usePlaySession` takes an `enabled` flag gated by
  `presentationRecordsPlaySession` (`src/features/play/presentation.ts`) so
  the TV hover-attract preview presentation records no session at all.
- Orphaned sessions (crash mid-play) are dropped on restart, since the
  in-memory map isn't persisted — acceptable for aggregates; noted as a
  deferred precision improvement below.
- `list_recently_played` orders by `last_played_at DESC` and excludes
  never-played games (`NULL` timestamp) rather than sorting them last;
  `list_favorites` orders by `clean_name` (case-insensitive) and excludes
  non-favorites.
- IPC surface (`src/ipc/play-stats.ts`): `recordPlayStart`, `recordPlayEnd`,
  `setFavorite`, `listRecentlyPlayed`, `listFavorites` — thin typed wrappers
  over the matching `#[tauri::command]`s. The favorite toggle on
  `GameDetailPage` (heart icon) is optimistic: it flips local state
  immediately and reverts on IPC failure.

## Acceptance

- [x] Migration applies on an existing DB without data loss; fresh DB gets
      the columns (both covered by Rust migration tests in
      `src-tauri/src/db/migrations.rs`).
- [x] Ending a session on each of the three paths updates `last_played_at`,
      `play_count`, and `total_play_time_ms` (unit tests per path seam,
      including an end-to-end external-launch seam test in
      `commands/play_stats.rs`).
- [x] Favorite toggle on the detail page persists across restart (backed by
      the `favorite` column; round-trip covered by repo unit tests).
- [x] `list_recently_played` / `list_favorites` return correct ordering
      (repo unit tests) and are exposed through IPC.
- [x] Game DTO round-trips the new fields.

## Open questions

- None blocking; session persistence across crashes remains a deferred
  precision improvement (see Follow-ups).

## Follow-ups

- Collections + curation UI (rest of #21).
- Play-time display on desktop detail page (small UX add, any release).
- Persist in-flight sessions so a crash mid-play doesn't drop that session's
  aggregate update.
