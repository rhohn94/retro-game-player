# Games-Directory Creation Design (v0.5 "Threshold")

> Lets Harmony offer to create a games directory for the user, so an empty
> library has a one-click path to a real, scannable folder. Ticket
> [#3](https://github.com/rhohn94/harmony/issues/3).

---

## Motivation

Before v0.5 an empty library only said "add a content folder in Settings", and
the `add_content_folder` command rejects paths that do not already exist. A
first-run user with no ROM folder had no in-app way forward. This feature lets
Harmony create a sensible default games directory (`~/Games`) at a
user-confirmed location and immediately register it for scanning.

## Goals

- One-click "Create a games folder for me" from the empty Library and the empty
  Settings → Folders pane.
- The user always confirms (and may edit) the location before any write — no
  silent filesystem changes.
- Creation is idempotent and never destroys existing data.
- The created folder is immediately a scannable content folder.

## Non-goals

- A native OS folder picker (`tauri-plugin-dialog`) — deferred; v0.5 uses an
  editable text-confirm dialog.
- Scaffolding per-system subfolders inside the created directory.
- Changing the scan/identification pipeline.

## Backend (W51)

- **`AppConfig.games_dir: Option<String>`** (`src-tauri/src/config/mod.rs`) —
  the absolute path Harmony created, persisted to `app-config.json`. `None`
  until the user accepts the offer; `#[serde(default)]` keeps old files loading.
- **`suggest_games_dir() -> String`** — returns the default `~/Games`
  (`dirs::home_dir().join("Games")`) without creating anything, so the dialog can
  pre-fill it.
- **`create_games_folder(suggested_path: Option<String>) -> String`** — delegates
  to a Tauri-free `create_games_folder_inner(&Paths, …)` (so it is unit-testable
  without a Tauri `State`). It:
  1. resolves the target (the supplied path, or the default when empty/absent);
  2. rejects unsafe targets via `is_safe_games_target` — the path must be
     **absolute** and is refused if it is the filesystem root or a top-level
     system dir (`/System`, `/Library`, `/Users`, `/usr`, …);
  3. refuses a path that exists as a non-directory;
  4. creates it with `std::fs::create_dir_all` (idempotent — only ensures the
     directory exists, never overwrites contents);
  5. persists the absolute path to `AppConfig.games_dir` (load → set → save).

Both commands are registered in the append-only `register_commands!` handler.

## Frontend (W52)

- **`CreateGamesFolderDialog`** (`src/features/library/CreateGamesFolderDialog.tsx`)
  — a confirm dialog reused by both empty states. On open it fetches
  `suggestGamesDir()` and pre-fills an editable field. On confirm it chains
  `createGamesFolder` → `addContentFolder` (tolerating the `conflict` kind when
  the folder is already registered) → `rescan`, then calls `onCreated`; each
  caller refreshes its own view.
- **Affordances** — a primary "Create a games folder for me" button in the
  Library empty state and a secondary one in the Settings → Folders empty state.

## Validation (W53)

- Rust unit tests (`commands::library::tests`) cover create-succeeds + persist,
  idempotency (a sentinel file survives a re-create), unsafe-path rejection,
  existing-file rejection, the suggestion shape, and `is_safe_games_target`.
- `scripts/inspect-empty-states.mjs` renders the Library + Settings empty states
  with empty mock fixtures and screenshots the affordance (the standard
  `visual-inspect.mjs` uses populated fixtures, so it never shows them).
- Full gate suite: typecheck, lint, vitest, `cargo test`, clippy, build,
  visual-inspect.
