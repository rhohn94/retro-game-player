# Library life — favorites, recency, play time (data foundation)

> **Up:** [↑ Design index](README.md)

## Motivation

The TV home shelves ([tv-mode-design.md](tv-mode-design.md)) need to answer
"what was I playing?" and "what do I love?" — today the schema can't: no
favorite flag, no last-played timestamp, no play-time accounting on any of the
three play paths. This is the data subset of
[#21](https://github.com/rhohn94/harmony/issues/21) (favorites, recently
played, play-time tracking); collections and desktop-library curation UI stay
deferred.

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

- Migration `00X_library_life.sql` (next free number) — additive columns, no
  backfill. Repo layer: `GamesRepo` gains the update/query methods; Tauri-free
  inner fns, unit-tested like the v0.5 pattern.
- Session tracking lives in Rust (`src-tauri/src/commands/play_stats.rs`):
  an in-memory `HashMap<session_id, (game_id, Instant)>`; `record_play_end`
  computes duration server-side (no trusting frontend clocks). External path
  calls start/end around the RetroArch child process lifetime it already
  waits on; frontend paths call via IPC on player mount/unmount +
  `beforeunload` guard.
- Orphaned sessions (crash mid-play) are dropped on restart — acceptable for
  aggregates; noted as follow-up if precision matters later.
- `list_recently_played` orders by `last_played_at DESC NULLS LAST`;
  `list_favorites` by `clean_name`.

## Acceptance

- [ ] Migration applies on an existing DB without data loss; fresh DB gets
      the columns (both covered by Rust migration tests).
- [ ] Ending a session on each of the three paths updates `last_played_at`,
      `play_count`, and `total_play_time_ms` (unit tests per path seam).
- [ ] Favorite toggle on the detail page persists across restart.
- [ ] `list_recently_played` / `list_favorites` return correct ordering
      (repo unit tests) and are exposed through IPC with mock fixtures
      updated (mock-IPC guard green).
- [ ] Game DTO round-trips the new fields (fixture shape test).

## Open questions

- None blocking; session persistence across crashes deferred.

## Follow-ups

- Collections + curation UI (rest of #21).
- Play-time display on desktop detail page (small UX add, any release).
