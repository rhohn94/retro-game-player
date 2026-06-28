# Release Planning — v0.5

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.5.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.5` |
| **Previous** | `v0.4` (Motion — fluid animation) |
| **Theme** | "Threshold" — let Harmony offer to create a games directory for the user, so an empty library has a one-click path to a real, scannable folder. Fourth release of the GUI-and-cores program. |
| **Ticket** | [#3](https://github.com/rhohn94/harmony/issues/3) |

**Context.** Today an empty library only tells the user to "add a content folder
in Settings", and adding one requires the folder to already exist (the backend
rejects non-existent paths). There is no way for Harmony to *create* a games
folder. This release adds a Rust command that creates a games directory at a
user-confirmed location (default `~/Games`), persists it to `AppConfig`, and a
confirm-first UI affordance in the empty states. Creation is idempotent
(`create_dir_all` never overwrites existing data) and guarded against unsafe
targets (filesystem root / top-level system dirs).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W51** | Backend: create-games-folder command + config | `AppConfig` gains `games_dir: Option<String>` (defaults `None`, round-trips). New `#[tauri::command] create_games_folder(suggested_path)` validates the target is absolute + safe (rejects root/system dirs and existing non-directory paths), creates it idempotently with `create_dir_all`, and persists it to `AppConfig.games_dir`; `suggest_games_dir()` returns the default `~/Games` path without creating anything. Both registered in the append-only handler. Rust unit tests cover create-succeeds, idempotency, unsafe-path rejection, config persistence, and the suggestion. |
| **W52** | Frontend: confirm-first affordance + wiring | A "Create a games folder for me" affordance in both empty states (Library empty + Settings → Folders empty). It opens a confirm dialog pre-filled with the suggested path (user may edit before confirming — no silent filesystem writes), then chains `createGamesFolder` → `addContentFolder` → `rescan` and refreshes, so the created folder is immediately a scannable content folder. TS IPC wrappers added in `src/ipc/library.ts`. |
| **W53** | Verify | Rust tests pass (`cargo test`). Mock-IPC fixtures for the two new commands added so the empty-state flow renders headlessly; `node scripts/visual-inspect.mjs` passes on all four routes and the Library/Settings empty states show the affordance. All gates green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Dependency order: W51 (backend command +
config + tests) → W52 (frontend affordance + dialog + wiring, consuming the
command) → W53 (verify). The command stays focused on creation + persistence and
reuses the already-tested `add_content_folder`/`rescan` plumbing from the
frontend rather than duplicating it in Rust. No native folder-picker plugin is
added this release (a text-confirm dialog is the v0.5 MVP; a native picker can
follow). Each work item committed atomically; full gate suite before merge.

## 4. Out of scope

- Native OS folder-picker (`tauri-plugin-dialog`) — deferred; v0.5 uses an
  editable text-confirm dialog.
- Per-system subfolder scaffolding inside the created games dir — the directory
  is created flat; organising ROMs by system is the user's choice.
- Changing the scan/identification pipeline (no DAT work — that is a later item).
- Search/filtering (v0.6) and core discovery (v0.7).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W51 — backend command + config | version/0.5 (in-session) | ☑ | `AppConfig.games_dir`; `create_games_folder`/`suggest_games_dir` (+ Tauri-free `create_games_folder_inner`); absolute+system-dir safety, idempotent create, persistence; 190 Rust tests (incl. 6 new) + clippy clean. |
| W52 — frontend affordance + wiring | version/0.5 (in-session) | ☑ | `CreateGamesFolderDialog` (pre-filled editable path, no silent writes) chains create → addContentFolder (tolerates `conflict`) → rescan; primary affordance in Library empty state + secondary in Settings → Folders empty state. |
| W53 — verify | version/0.5 (in-session) | ☑ | `scripts/inspect-empty-states.mjs` screenshots the affordance on both empty states (text asserted); standard visual-inspect verified=true guiOk=true on 4 routes; 44 JS tests green. Design doc added. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.5 → dev | ☑ | merged `--no-ff`; 190 Rust + 44 JS tests + visual-inspect green on dev |
| dev → main promoted + tagged v0.5 | ☑ | |
| pushed to origin | ☐ | HUMAN-GATED — do not push without explicit go |
